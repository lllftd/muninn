import type { BrokerId } from '../types.ts'

export const BROKER_LABEL: Record<BrokerId, string> = {
  futu: '富途 / Moomoo',
  ib: '盈透 IB',
  tiger: '老虎证券',
  generic: '通用成交表',
}

const headerCache = new Map<string, string>()

export function normHeader(h: string): string {
  const hit = headerCache.get(h)
  if (hit !== undefined) return hit
  const n = h
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_./]+/g, ' ')
    .replace(/\s+/g, ' ')
  headerCache.set(h, n)
  return n
}

const rowIndexCache = new WeakMap<Record<string, string>, Map<string, string>>()

function rowIndex(row: Record<string, string>): Map<string, string> {
  const cached = rowIndexCache.get(row)
  if (cached) return cached
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(row)) map.set(normHeader(k), v ?? '')
  rowIndexCache.set(row, map)
  return map
}

export function pick(row: Record<string, string>, aliases: string[]): string {
  const map = rowIndex(row)
  for (const alias of aliases) {
    const hit = map.get(normHeader(alias))
    if (hit != null && hit.trim() !== '') return hit
  }
  return ''
}

const ALIASES = {
  symbol: ['symbol', 'ticker', 'underlying', '代码', '证券代码', '股票代码', '标的', '合约'],
  name: ['name', 'description', 'desc', '名称', '股票名称', '证券名称', '公司名称'],
  side: ['side', 'buy/sell', 'buy sell', 'buysell', 'b/s', 'direction', 'action', '方向', '买卖', '买卖方向', '操作', '交易方向'],
  qty: ['fill qty', 'filled qty', 'fillqty', 'quantity', 'qty', 'filled quantity', 'shares', '成交数量', '成交量', '数量', '股数'],
  price: ['fill price', 'filled price', 't price', 'trade price', 'avg price', 'average price', 'price', '成交价格', '成交价', '价格', '均价'],
  amount: ['fill amount', 'proceeds', 'notional', 'amount', 'value', '成交金额', '金额', '成交额'],
  time: [
    'fill time',
    'filled time',
    'date/time',
    'date time',
    'datetime',
    'trade time',
    'exec time',
    'execution time',
    'time',
    '成交时间',
    '交易时间',
  ],
  date: ['trade date', 'date', 'run date', 'settle date', '成交日期', '交易日期', '日期'],
  clock: ['trade time', 'time', 'exec time', '成交时间'],
  market: ['markets', 'market', 'exchange', 'listing exchange', 'listingexchange', '市场', '交易所'],
  currency: ['currency', 'currencyprimary', 'ccy', '币种', '结算币种', '货币'],
  asset: ['asset class', 'assetclass', 'asset category', 'assetcategory', 'sec type', 'sectype', '品种', '证券类型'],
  disc: ['data discriminator', 'datadiscriminator'],
}

export function pickField(row: Record<string, string>, field: keyof typeof ALIASES): string {
  return pick(row, ALIASES[field])
}

export function parseAmount(raw: string | number | undefined | null): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (!raw) return 0
  const s = String(raw).trim()
  const neg = /^\(.*\)$/.test(s)
  const m = s.replace(/[(),]/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return 0
  const n = Number(m[0])
  if (!Number.isFinite(n)) return 0
  return neg ? -Math.abs(n) : n
}

export function cleanSymbol(raw: string): string {
  let s = raw.trim().toUpperCase()
  s = s.replace(/^(US[.:]|NYSE:|NASDAQ:|AMEX:)/, '')
  s = s.replace(/\s+(STK|STOCK|USD|NASDAQ|NYSE|ARCA|SMART|NMS|ISLAND)$/i, '')
  s = s.replace(/\s+/g, '.')
  return s
}

export function pickTime(row: Record<string, string>): string {
  const direct = pickField(row, 'time')
  if (direct.trim()) return direct.trim()
  const date = pickField(row, 'date')
  const clock = pick(row, ['trade time', 'exec time', 'time', '成交时间'])
  return [date, clock].filter((x) => x.trim()).join(' ').trim()
}

export function pickFees(row: Record<string, string>): number {
  const combined = pick(row, ['comm/fee', 'comm fee', 'total commission', 'total fee', '佣金合计', '费用合计'])
  if (combined.trim()) return Math.abs(parseAmount(combined))
  const keys = ['commission', 'comm', 'fee', 'fees', 'platform fees', 'sec fees', 'taf', '佣金', '平台费', '手续费']
  const used = new Set<string>()
  let sum = 0
  for (const [k, v] of Object.entries(row)) {
    const n = normHeader(k)
    if (!keys.includes(n) || used.has(n) || !String(v).trim()) continue
    used.add(n)
    sum += Math.abs(parseAmount(v))
  }
  return sum
}

export function detectBroker(headers: string[]): BrokerId {
  const joined = headers.map(normHeader).join(' | ')
  if (headers.some((h) => /fill qty|fill time|fill price|filled@avg/i.test(h))) return 'futu'
  if (
    /data discriminator|asset category|asset class|t price|clientaccountid|ibkr|interactive brokers/.test(joined) ||
    headers.some((h) => /^t\.?\s*price$/i.test(h.trim()) || /date\/time/i.test(h))
  ) {
    return 'ib'
  }
  if (/成交数量|成交时间|成交价格|老虎|tiger/.test(joined) || headers.some((h) => /成交/.test(h))) return 'tiger'
  return 'generic'
}

export function headerFieldScore(cells: string[]): number {
  const found = new Set<string>()
  const norms = cells.map(normHeader).filter(Boolean)
  for (const n of norms) {
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (field === 'clock' || field === 'date') continue
      if (aliases.some((a) => n === normHeader(a))) found.add(field)
    }
    if (n === 't price' || n === 'date time') found.add(n === 't price' ? 'price' : 'time')
  }
  return found.size
}

export function isJunkFillRow(row: Record<string, string>): boolean {
  const disc = pickField(row, 'disc')
  if (/header|subtotal|total|closedlot|notes|internal transfer/i.test(disc)) return true
  const symbol = cleanSymbol(pickField(row, 'symbol'))
  if (!symbol || /^(TOTAL|SUBTOTAL|NAV|FOREX|USD|EUR|GBP|HKD|CNH|CNY|SYMBOL|TICKER)$/.test(symbol)) return true
  return false
}

export function keepIbDiscriminator(rows: Record<string, string>[]): Record<string, string>[] {
  const discs = rows.map((r) => pickField(r, 'disc').trim())
  if (!discs.some(Boolean)) return rows
  if (discs.some((d) => /^trade$/i.test(d))) return rows.filter((r) => /^trade$/i.test(pickField(r, 'disc')))
  if (discs.some((d) => /^order$/i.test(d))) return rows.filter((r) => /^order$/i.test(pickField(r, 'disc')))
  return rows.filter((r) => {
    const d = pickField(r, 'disc')
    return !d || !/header|subtotal|total|closedlot/i.test(d)
  })
}

export function unrecognizedMessage(headers: string[]): string {
  const shown = headers.filter(Boolean).slice(0, 16).join('、') || '（空）'
  return `无法识别这份成交记录。会按表头自动适配富途、盈透 IB、老虎，以及其他带「代码 / 方向 / 数量 / 价格 / 时间」的成交导出。当前表头：${shown}`
}
