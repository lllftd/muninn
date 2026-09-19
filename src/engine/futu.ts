import { csvToObjects } from '../lib/csv.ts'
import { num } from '../lib/format.ts'
import { parseBrokerTime, parseIsoLike } from '../lib/time.ts'
import type { BrokerOrder, Cashflow, Fill, ImportResult, Side, Warning } from '../types.ts'

const OPTION_RE = /^[A-Z]{1,6}\d{6}[CP]\d+$/i
const FUND_RE = /ETF|ETN|Fund|基金|信托|Trust|Daily Target|UltraPro|UltraShort|2X |3X |Direxion|ProShares|GraniteShares/i
const FUND_SYMBOLS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'IVV', 'BIL', 'SGOV', 'SHV', 'SHY', 'IEF', 'TLT', 'HYG', 'LQD', 'AGG', 'BND',
  'GLD', 'SLV', 'EEM', 'EFA', 'XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLB', 'XLU', 'XLRE', 'SMH', 'ARKK', 'ARKW',
  'IWF', 'IWD', 'GDV', 'TQQQ', 'SQQQ', 'SPXL', 'SPXU', 'QLD', 'QID', 'SSO', 'SDS',
])

export function isOptionSymbol(symbol: string): boolean {
  return OPTION_RE.test(symbol.replace(/\s/g, ''))
}

export function isFundName(name: string, symbol: string): boolean {
  if (FUND_SYMBOLS.has(symbol.toUpperCase())) return true
  if (FUND_RE.test(name)) return true
  if (/^(TQQQ|SQQQ|SPXU|SPXL|SOXL|SOXS|TNA|TZA|LABU|LABD|UVXY|SVXY|QLD|QID|SSO|SDS)$/.test(symbol)) {
    return true
  }
  return false
}

export function isMidnightDrip(fillTime: string, qty: number): boolean {
  return /00:00:00/.test(fillTime) && qty < 1
}

function parseFilledAvg(raw: string): { qty: number; price: number } {
  const m = raw.replace(/,/g, '').match(/([0-9.]+)@([0-9.]+)/)
  if (!m) return { qty: 0, price: 0 }
  return { qty: Number(m[1]), price: Number(m[2]) }
}

function feeTotal(row: Record<string, string>): BrokerOrder['fees'] {
  const commission = num(row['Commission'])
  const platform = num(row['Platform Fees']) + num(row['Platform Handling Fee'])
  const sec = num(row['SEC Fees'])
  const taf = num(row['Trading Activity Fees'])
  const settlement = num(row['Settlement Fees'])
  const listed = num(row['Total'])
  const sum = commission + platform + sec + taf + settlement
  return {
    commission,
    platform,
    sec,
    taf,
    settlement,
    total: listed > 0 ? listed : sum,
  }
}

function normSide(raw: string): Side {
  return raw.toLowerCase().includes('buy') ? 'buy' : 'sell'
}

export function parseFills(text: string): Fill[] {
  return csvToObjects(text).flatMap((row, i) => {
    const qty = num(row['Fill Qty'] || row['Quantity'] || row['Qty'])
    const price = num(row['Fill Price'] || row['Price'])
    const amount = num(row['Fill Amount']) || qty * price
    const timeRaw = row['Fill Time'] || row['Time'] || ''
    if (!timeRaw.trim()) return []
    let time: Date
    try {
      time = parseBrokerTime(timeRaw)
    } catch {
      return []
    }
    if (!Number.isFinite(time.getTime())) return []
    return [
      {
        id: `f${i + 1}`,
        symbol: (row['Symbol'] || '').trim().toUpperCase(),
        name: row['Name'] || row['Symbol'] || '',
        side: normSide(row['Side'] || ''),
        rawSide: row['Side'] || '',
        qty,
        price,
        amount,
        time,
        market: row['Markets'] || row['Market'] || '',
        currency: row['Currency'] || 'USD',
        fees: 0,
        kind: 'trade',
      },
    ]
  })
}

export function parseOrders(text: string): BrokerOrder[] {
  return csvToObjects(text)
    .map((row, i) => {
      const filled = parseFilledAvg(row['Filled@Avg Price'] || '')
      const fees = feeTotal(row)
      const status = row['Status'] || ''
      let time = new Date(0)
      if (row['Order Time']) {
        try {
          time = parseBrokerTime(row['Order Time'])
        } catch {
          time = new Date(0)
        }
      }
      return {
        id: `o${i + 1}`,
        symbol: (row['Symbol'] || '').trim().toUpperCase(),
        side: row['Side'] || '',
        status,
        filledQty: filled.qty,
        avgPrice: filled.price,
        time,
        market: row['Markets'] || '',
        fees,
        remainingQty: filled.qty,
        remainingFee: fees.total,
      }
    })
    .filter((o) => o.filledQty > 0 && /fill/i.test(o.status))
}

export function parseCashflows(text: string): Cashflow[] {
  if (!text.trim()) return []
  return csvToObjects(text)
    .map((row) => {
      const typeRaw = (row['type'] || row['Type'] || '').toLowerCase()
      const amount = Math.abs(num(row['amount'] || row['Amount']))
      const timeRaw = row['time'] || row['Time'] || row['date'] || ''
      const type: Cashflow['type'] = typeRaw.includes('with') || typeRaw.includes('出') ? 'withdraw' : 'deposit'
      return { time: parseIsoLike(timeRaw), type, amount }
    })
    .filter((c) => c.amount > 0 && Number.isFinite(c.time.getTime()))
}

export function matchFees(fills: Fill[], orders: BrokerOrder[]): { fills: Fill[]; unmatched: number } {
  const pool = orders.map((o) => ({ ...o }))
  let unmatched = 0
  const next = fills.map((fill) => {
    const candidates = pool
      .map((order, idx) => ({ order, idx }))
      .filter(({ order }) => {
        if (order.symbol !== fill.symbol) return false
        if (normSide(order.side) !== fill.side) return false
        if (order.remainingQty <= 1e-8) return false
        const dt = Math.abs(order.time.getTime() - fill.time.getTime())
        return dt <= 36 * 3600 * 1000
      })
      .sort((a, b) => {
        const da = Math.abs(a.order.time.getTime() - fill.time.getTime())
        const db = Math.abs(b.order.time.getTime() - fill.time.getTime())
        return da - db
      })
    const hit = candidates.find(({ order }) => order.remainingQty + 1e-6 >= fill.qty) || candidates[0]
    if (!hit) {
      unmatched += 1
      return { ...fill, fees: 0 }
    }
    const order = hit.order
    const ratio = Math.min(1, fill.qty / Math.max(order.remainingQty, fill.qty))
    const fee = order.remainingFee * ratio
    order.remainingQty = Math.max(0, order.remainingQty - fill.qty)
    order.remainingFee = Math.max(0, order.remainingFee - fee)
    return { ...fill, fees: fee, orderId: order.id }
  })
  return { fills: next, unmatched }
}

export function mergeSameOrder(fills: Fill[]): Fill[] {
  const groups = new Map<string, Fill[]>()
  const singles: Fill[] = []
  for (const fill of fills) {
    if (!fill.orderId) {
      singles.push(fill)
      continue
    }
    const arr = groups.get(fill.orderId) || []
    arr.push(fill)
    groups.set(fill.orderId, arr)
  }
  const merged: Fill[] = []
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      merged.push(arr[0])
      continue
    }
    const qty = arr.reduce((s, f) => s + f.qty, 0)
    const amount = arr.reduce((s, f) => s + f.qty * f.price, 0)
    const fees = arr.reduce((s, f) => s + f.fees, 0)
    const first = [...arr].sort((a, b) => a.time.getTime() - b.time.getTime())[0]
    merged.push({
      ...first,
      qty,
      amount,
      price: qty ? amount / qty : first.price,
      fees,
    })
  }
  return [...merged, ...singles].sort((a, b) => a.time.getTime() - b.time.getTime() || a.id.localeCompare(b.id))
}

export function importFutu(fillText: string, orderText?: string): ImportResult {
  const warnings: Warning[] = []
  const dropped = { nonUs: 0, options: 0, funds: 0, fractional: 0, drip: 0 }
  const excludedRows: ImportResult['excludedRows'] = []
  const objects = csvToObjects(fillText)
  const raw = parseFills(fillText)
  const filtered: Fill[] = []
  let dripKept = 0
  for (const fill of raw) {
    const row = objects[Number(fill.id.replace(/\D/g, '')) - 1]
    const timeRaw = row?.['Fill Time'] || row?.['Time'] || ''
    if (fill.market && fill.market !== 'US') {
      dropped.nonUs += 1
      excludedRows.push({ symbol: fill.symbol, name: fill.name, reason: 'nonUs', qty: fill.qty, time: timeRaw })
      continue
    }
    if (isOptionSymbol(fill.symbol)) {
      dropped.options += 1
      excludedRows.push({ symbol: fill.symbol, name: fill.name, reason: 'option', qty: fill.qty, time: timeRaw })
      continue
    }
    if (isFundName(fill.name, fill.symbol)) {
      dropped.funds += 1
      excludedRows.push({ symbol: fill.symbol, name: fill.name, reason: 'fund', qty: fill.qty, time: timeRaw })
      continue
    }
    const drip = isMidnightDrip(timeRaw, fill.qty) || (fill.qty > 0 && fill.qty < 0.5)
    if (drip) {
      dripKept += 1
      dropped.drip += 1
      filtered.push({ ...fill, kind: 'drip' })
      continue
    }
    filtered.push(fill)
  }

  const orders = orderText?.trim() ? parseOrders(orderText) : []
  const usOrders = orders.filter((o) => !o.market || o.market === 'US')
  const priced = matchFees(filtered, usOrders)
  if (priced.unmatched && usOrders.length) {
    warnings.push({
      code: 'fee-unmatched',
      message: `${priced.unmatched} 笔没匹配到订单费用，已按缺失处理，不估成 0，也不停止计算。有订单费用的已计入盈亏。`,
    })
  }
  const merged = mergeSameOrder(priced.fills)

  if (dropped.nonUs || dropped.options || dropped.funds) {
    warnings.push({
      code: 'filtered',
      message: `已只保留美股正股（排除非美股 ${dropped.nonUs}、期权 ${dropped.options}、基金 ${dropped.funds}）。下面的数字都是正股子账本。`,
    })
  }
  if (dripKept) {
    warnings.push({
      code: 'drip-kept',
      message: `${dripKept} 笔分红再投资/碎股已保留在核算账本，不计入主动交易质量，也不静默删除。`,
    })
  }

  return {
    fills: merged,
    orders: usOrders,
    warnings,
    rawCount: raw.length,
    feeUnmatched: priced.unmatched,
    dripKept,
    excludedRows,
    dropped,
  }
}
