import { assembleBook } from '../engine/book.ts'
import { parseBrokerTime } from '../lib/time.ts'
import type { Bar, QuotePack } from '../types.ts'
import realFills from './real-fills.csv?raw'
import realOrders from './real-orders.csv?raw'

type Spec = {
  symbol: string
  name: string
  side: 'long' | 'short'
  qty: number
  open: number
  close: number
  openAt: string
  closeAt: string
  tags?: string[]
  mae?: number
  mfe?: number
  fee?: number
}

const SPECS: Spec[] = [
  { symbol: 'AAPL', name: 'Apple', side: 'long', qty: 80, open: 228.4, close: 234.1, openAt: 'Jan 8, 2026 10:12:14 ET', closeAt: 'Jan 9, 2026 14:54:14 ET', tags: ['低吸'], mae: 225.8, mfe: 241.65 },
  { symbol: 'NVDA', name: 'NVIDIA', side: 'long', qty: 50, open: 132.24, close: 141.6, openAt: 'Nov 3, 2025 10:05:00 ET', closeAt: 'Jan 12, 2026 15:40:00 ET', mae: 131.84, mfe: 149.56 },
  { symbol: 'NVDA', name: 'NVIDIA', side: 'long', qty: 50, open: 132.24, close: 128.4, openAt: 'Jan 20, 2026 09:41:00 ET', closeAt: 'Jan 21, 2026 15:55:00 ET', mae: 123.91, mfe: 149.56 },
  { symbol: 'AAPL', name: 'Apple', side: 'long', qty: 60, open: 236.2, close: 238.8, openAt: 'Feb 4, 2026 10:18:00 ET', closeAt: 'Feb 5, 2026 16:18:00 ET', mae: 233.6, mfe: 239.51 },
  { symbol: 'COIN', name: 'Coinbase', side: 'long', qty: 50, open: 268.0, close: 241.5, openAt: 'Feb 18, 2026 09:44:00 ET', closeAt: 'Feb 19, 2026 10:38:00 ET', mae: 239.6, mfe: 274.7 },
  { symbol: 'AMD', name: 'AMD', side: 'long', qty: 80, open: 172.4, close: 166.8, openAt: 'Mar 3, 2026 15:52:00 ET', closeAt: 'Mar 4, 2026 13:40:00 ET', tags: ['财报前天', 'TRI'], mae: 167.57, mfe: 173.09 },
  { symbol: 'NVDA', name: 'NVIDIA', side: 'long', qty: 120, open: 148.8, close: 145.2, openAt: 'Mar 10, 2026 15:48:00 ET', closeAt: 'Mar 11, 2026 16:36:00 ET', tags: ['财报前天', 'CPI'], mae: 144.93, mfe: 150.58 },
  { symbol: 'META', name: 'Meta', side: 'long', qty: 25, open: 572.0, close: 576.8, openAt: 'Mar 17, 2026 11:10:00 ET', closeAt: 'Mar 19, 2026 07:34:00 ET', tags: ['解套区', 'FOMC 区'], mae: 568.0, mfe: 580.58 },
  { symbol: 'JPM', name: 'JPMorgan', side: 'long', qty: 40, open: 238.5, close: 248.2, openAt: 'Apr 2, 2026 10:02:00 ET', closeAt: 'Apr 14, 2026 15:50:00 ET', mae: 234.68, mfe: 250.43 },
  { symbol: 'MSFT', name: 'Microsoft', side: 'long', qty: 20, open: 412.0, close: 428.5, openAt: 'Apr 21, 2026 09:38:00 ET', closeAt: 'May 5, 2026 15:10:00 ET', mae: 405.8, mfe: 432.6 },
  { symbol: 'GOOGL', name: 'Alphabet', side: 'long', qty: 30, open: 168.4, close: 175.2, openAt: 'May 12, 2026 10:22:00 ET', closeAt: 'May 13, 2026 14:40:00 ET', tags: ['低吸'], mae: 166.2, mfe: 176.8 },
  { symbol: 'AMZN', name: 'Amazon', side: 'long', qty: 18, open: 188.5, close: 181.2, openAt: 'May 19, 2026 09:46:00 ET', closeAt: 'May 20, 2026 15:33:00 ET', mae: 179.1, mfe: 191.4 },
  { symbol: 'TSLA', name: 'Tesla', side: 'long', qty: 12, open: 248.0, close: 261.4, openAt: 'Jun 3, 2026 11:05:00 ET', closeAt: 'Jun 10, 2026 15:01:00 ET', mae: 242.0, mfe: 266.0 },
  { symbol: 'AVGO', name: 'Broadcom', side: 'long', qty: 15, open: 182.0, close: 176.4, openAt: 'Jun 16, 2026 09:51:00 ET', closeAt: 'Jun 16, 2026 15:48:00 ET', mae: 174.8, mfe: 184.2 },
  { symbol: 'BAC', name: 'Bank of America', side: 'long', qty: 80, open: 41.2, close: 43.8, openAt: 'Jun 24, 2026 10:08:00 ET', closeAt: 'Jul 8, 2026 15:20:00 ET', mae: 40.5, mfe: 44.1 },
  { symbol: 'CRM', name: 'Salesforce', side: 'long', qty: 14, open: 268.0, close: 259.5, openAt: 'Jul 14, 2026 09:33:00 ET', closeAt: 'Jul 14, 2026 15:58:00 ET', mae: 257.0, mfe: 271.0 },
  { symbol: 'AAPL', name: 'Apple', side: 'long', qty: 40, open: 214.0, close: 221.5, openAt: 'Jul 22, 2026 10:14:00 ET', closeAt: 'Jul 29, 2026 15:05:00 ET', mae: 211.2, mfe: 223.8 },
  { symbol: 'NVDA', name: 'NVIDIA', side: 'short', qty: 20, open: 178.0, close: 171.4, openAt: 'Aug 4, 2026 10:40:00 ET', closeAt: 'Aug 6, 2026 14:12:00 ET', mae: 181.2, mfe: 168.5 },
  { symbol: 'META', name: 'Meta', side: 'long', qty: 10, open: 612.0, close: 598.0, openAt: 'Aug 11, 2026 09:47:00 ET', closeAt: 'Aug 11, 2026 15:41:00 ET', mae: 594.0, mfe: 618.0 },
  { symbol: 'JPM', name: 'JPMorgan', side: 'long', qty: 25, open: 252.0, close: 255.4, openAt: 'Aug 18, 2026 13:22:00 ET', closeAt: 'Aug 20, 2026 10:05:00 ET', mae: 249.8, mfe: 256.6 },
  { symbol: 'MSFT', name: 'Microsoft', side: 'long', qty: 8, open: 430.0, close: 441.0, openAt: 'Aug 25, 2026 10:01:00 ET', closeAt: 'Sep 3, 2026 15:44:00 ET', mae: 424.0, mfe: 445.0 },
  { symbol: 'GOOGL', name: 'Alphabet', side: 'long', qty: 22, open: 178.5, close: 174.2, openAt: 'Sep 8, 2026 09:36:00 ET', closeAt: 'Sep 8, 2026 15:52:00 ET', mae: 172.8, mfe: 180.1 },
  { symbol: 'AMZN', name: 'Amazon', side: 'long', qty: 16, open: 192.0, close: 198.6, openAt: 'Sep 10, 2026 11:18:00 ET', closeAt: 'Sep 15, 2026 14:26:00 ET', mae: 189.4, mfe: 201.0 },
]

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function fillsCsv(): string {
  const header = 'Symbol,Name,Side,Fill Qty,Fill Price,Fill Amount,Fill Time,Markets,Currency,Counterparty'
  const rows = [header]
  for (const spec of SPECS) {
    const openSide = spec.side === 'long' ? 'Buy' : 'Short Sell'
    const closeSide = spec.side === 'long' ? 'Sell' : 'Buy'
    const openAmt = (spec.qty * spec.open).toFixed(2)
    const closeAmt = (spec.qty * spec.close).toFixed(2)
    rows.push(
      [spec.symbol, spec.name, openSide, spec.qty, spec.open, openAmt, spec.openAt, 'US', 'USD', ''].map(csvEscape).join(','),
    )
    rows.push(
      [spec.symbol, spec.name, closeSide, spec.qty, spec.close, closeAmt, spec.closeAt, 'US', 'USD', ''].map(csvEscape).join(','),
    )
  }
  return rows.join('\n')
}

function ordersCsv(): string {
  const header =
    'Side,Symbol,Name,Order Price,Order Qty,Order Amount,Status,Filled@Avg Price,Order Time,Order Type,Markets,Currency,Commission,Platform Fees,SEC Fees,Trading Activity Fees,Settlement Fees,Total'
  const rows = [header]
  for (const spec of SPECS) {
    const fee = spec.fee ?? 2.02
    const openSide = spec.side === 'long' ? 'Buy' : 'Short Sell'
    const closeSide = spec.side === 'long' ? 'Sell' : 'Buy'
    const openSec = spec.side === 'short' ? 0.01 : 0
    const closeSec = spec.side === 'long' ? 0.01 : 0
    rows.push(
      [
        openSide,
        spec.symbol,
        spec.name,
        spec.open,
        spec.qty,
        (spec.qty * spec.open).toFixed(2),
        'Filled',
        `${spec.qty}@${spec.open}`,
        spec.openAt,
        'Limit',
        'US',
        'USD',
        0.99,
        1,
        openSec,
        0,
        0,
        fee,
      ].map(csvEscape).join(','),
    )
    rows.push(
      [
        closeSide,
        spec.symbol,
        spec.name,
        spec.close,
        spec.qty,
        (spec.qty * spec.close).toFixed(2),
        'Filled',
        `${spec.qty}@${spec.close}`,
        spec.closeAt,
        'Limit',
        'US',
        'USD',
        0.99,
        1,
        closeSec,
        0.01,
        0,
        fee,
      ].map(csvEscape).join(','),
    )
  }
  return rows.join('\n')
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weekdays(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cur <= last) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function synth(symbol: string, startPx: number, drift: number, vol: number): Bar[] {
  const rand = mulberry(symbol.split('').reduce((s, c) => s + c.charCodeAt(0) * 13, 1))
  const days = weekdays('2024-01-02', '2026-09-18')
  let px = startPx
  const bars: Bar[] = []
  for (const date of days) {
    const shock = (rand() - 0.48) * vol
    const o = px * (1 + (rand() - 0.5) * vol * 0.3)
    const c = px * (1 + drift + shock)
    const h = Math.max(o, c) * (1 + rand() * vol * 0.5)
    const l = Math.min(o, c) * (1 - rand() * vol * 0.5)
    bars.push({ date, open: o, high: h, low: l, close: c, volume: 1_000_000 + rand() * 5_000_000 })
    px = c
  }
  return bars
}

function etDate(raw: string): string {
  const d = parseBrokerTime(raw)
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
  return fmt.format(d)
}

function buildBars(): Record<string, Bar[]> {
  const starts: Record<string, [number, number, number]> = {
    AAPL: [185, 0.00025, 0.008],
    NVDA: [110, 0.00035, 0.01],
    COIN: [210, 0.00015, 0.014],
    AMD: [140, 0.0002, 0.01],
    META: [480, 0.00025, 0.008],
    JPM: [210, 0.0002, 0.006],
    MSFT: [380, 0.00025, 0.007],
    GOOGL: [140, 0.00025, 0.008],
    AMZN: [170, 0.0002, 0.008],
    TSLA: [220, 0.00015, 0.012],
    AVGO: [150, 0.0003, 0.009],
    BAC: [36, 0.0002, 0.007],
    CRM: [250, 0.00015, 0.008],
    '^GSPC': [5100, 0.00018, 0.003],
    '^VIX': [16, 0, 0.015],
    '^IRX': [4.2, 0, 0.002],
  }
  const bars: Record<string, Bar[]> = {}
  for (const [sym, [px, d, v]] of Object.entries(starts)) bars[sym] = synth(sym, px, d, v)

  for (const spec of SPECS) {
    const series = bars[spec.symbol]
    const od = etDate(spec.openAt)
    const cd = etDate(spec.closeAt)
    const i0 = series.findIndex((b) => b.date >= od)
    const i1 = series.findIndex((b) => b.date >= cd)
    if (i0 < 0 || i1 < 0) continue
    const span = Math.max(i1 - i0, 1)
    const mae = spec.mae ?? spec.open * 0.99
    const mfe = spec.mfe ?? spec.close
    for (let k = i0; k <= i1; k++) {
      const t = (k - i0) / span
      const close = spec.open + (spec.close - spec.open) * t
      const open = k === i0 ? spec.open : series[k - 1].close
      const high = spec.side === 'long' ? Math.max(open, close, mfe) : Math.max(open, close, mae)
      const low = spec.side === 'long' ? Math.min(open, close, mae) : Math.min(open, close, mfe)
      series[k] = { ...series[k], open, close: k === i1 ? spec.close : close, high, low }
    }
  }
  return bars
}

export const SAMPLE_FILLS_CSV = fillsCsv()
export const SAMPLE_ORDERS_CSV = ordersCsv()
export const SAMPLE_CASH_CSV = 'time,type,amount\n2026-06-02T09:30:00-04:00,withdraw,22000\n'

export function sampleQuotes(): QuotePack {
  return { bars: buildBars(), splits: {} }
}

export function extraTags(): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const spec of SPECS) {
    if (!spec.tags?.length) continue
    const d = parseBrokerTime(spec.openAt).toISOString().slice(0, 10)
    map[`${spec.symbol}|${d}`] = spec.tags
  }
  return map
}

export const REAL_FILLS_CSV = realFills
export const REAL_ORDERS_CSV = realOrders

/** 用账户 5185 真实成交做样本账本。不填期初净资产，也不把成交额当成 NAV。 */
export function loadSampleBook(quotes: QuotePack = { bars: {}, splits: {} }) {
  return assembleBook({
    fillText: REAL_FILLS_CSV,
    orderText: REAL_ORDERS_CSV,
    accountName: '保证金综合账户 5185',
    initialCapital: null,
    quotes,
    isSample: true,
    cashflowComplete: false,
  })
}

export const FILL_TEMPLATE = `Symbol,Name,Side,Fill Qty,Fill Price,Fill Amount,Fill Time,Markets,Currency,Counterparty
AAPL,Apple,Buy,10,190.00,1900.00,"Jan 8, 2026 10:12:14 ET",US,USD,
AAPL,Apple,Sell,10,196.50,1965.00,"Jan 9, 2026 14:54:14 ET",US,USD,
`

export const ORDER_TEMPLATE = `Side,Symbol,Name,Order Price,Order Qty,Order Amount,Status,Filled@Avg Price,Order Time,Order Type,Markets,Currency,Commission,Platform Fees,SEC Fees,Trading Activity Fees,Settlement Fees,Total
Buy,AAPL,Apple,190.00,10,1900.00,Filled,10@190.00,"Jan 8, 2026 10:12:14 ET",Limit,US,USD,0.99,1,0,0,0,1.99
Sell,AAPL,Apple,196.50,10,1965.00,Filled,10@196.50,"Jan 9, 2026 14:54:14 ET",Limit,US,USD,0.99,1,0.01,0.01,0,2.01
`

export const CASH_TEMPLATE = `time,type,amount
2024-03-01T09:00:00,deposit,25000
2026-06-02T09:30:00,withdraw,10000
`
