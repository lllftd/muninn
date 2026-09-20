// 通过 r.jina.ai 中转拉取样本账本所需的全部日线，写入 public/sample-quotes.json。
// 用法: node scripts/build-sample-quotes.mjs
import { writeFileSync } from 'node:fs'

const SYMBOLS = [
  'AA', 'AAPL', 'AMD', 'AMZN', 'ANET', 'AXP', 'BAC', 'BBAI', 'BILI', 'CAN',
  'CB', 'COGT', 'CRM', 'CRWD', 'CVX', 'DBGI', 'DDL', 'EC', 'F', 'FUTU',
  'GOOGL', 'GPUS', 'GRAB', 'HKIT', 'INTC', 'IRS', 'JD', 'KHC', 'KO', 'LGMK',
  'MCO', 'MSFT', 'MSTR', 'NIO', 'NVDA', 'OXY', 'PANW', 'PDD', 'PG', 'POLA',
  'SHPH', 'SOS', 'TME', 'TSLA', 'U', 'V', 'XE', 'XELB',
  'SPY', '^GSPC', '^VIX', '^IRX',
]
const P1 = Math.floor(Date.parse('2023-05-20T00:00:00Z') / 1000)
const P2 = Math.floor(Date.parse('2026-08-14T23:59:59Z') / 1000) + 86400
const DELAY_MS = 3200 // jina 免费档约 20 次/分钟

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round4 = (v) => Math.round(v * 10000) / 10000

async function fetchOne(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${P1}&period2=${P2}&interval=1d&events=split%2Cdiv&includeAdjustedClose=true`
  const res = await fetch(`https://r.jina.ai/${target}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`jina ${res.status}`)
  const text = await res.text()
  const i = text.indexOf('{')
  const j = text.lastIndexOf('}')
  if (i < 0 || j <= i) throw new Error('no json')
  const data = JSON.parse(text.slice(i, j + 1))
  const result = data.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!ts || !q?.close) return { bars: [], splits: 0 }
  const adj = symbol === 'SPY' ? result.indicators?.adjclose?.[0]?.adjclose : undefined
  const bars = []
  for (let k = 0; k < ts.length; k++) {
    const o = q.open?.[k]
    const h = q.high?.[k]
    const l = q.low?.[k]
    const raw = q.close[k]
    const a = adj?.[k]
    const c = a != null && Number.isFinite(a) ? a : raw
    if (o == null || h == null || l == null || raw == null || c == null) continue
    const scale = raw > 0 ? c / raw : 1
    bars.push([
      new Date(ts[k] * 1000).toISOString().slice(0, 10),
      round4(o * scale),
      round4(h * scale),
      round4(l * scale),
      round4(c),
      q.volume?.[k] ?? 0,
    ])
  }
  const splits = result.events?.splits ? Object.keys(result.events.splits).length : 0
  return { bars, splits }
}

const out = { bars: {}, splits: {} }
let done = 0
for (const sym of SYMBOLS) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { bars, splits } = await fetchOne(sym)
      out.bars[sym] = bars
      if (splits) out.splits[sym] = splits
      console.log(`${++done}/${SYMBOLS.length} ${sym}: ${bars.length} bars${splits ? `, ${splits} splits` : ''}`)
      break
    } catch (e) {
      console.log(`${sym} attempt ${attempt + 1} failed: ${e.message}`)
      if (attempt === 2) {
        out.bars[sym] = []
        console.log(`${++done}/${SYMBOLS.length} ${sym}: GAVE UP`)
      } else {
        await sleep(8000)
      }
    }
  }
  await sleep(DELAY_MS)
}

writeFileSync('public/sample-quotes.json', JSON.stringify(out))
const kb = Math.round(JSON.stringify(out).length / 1024)
const empty = Object.entries(out.bars).filter(([, v]) => !v.length).map(([k]) => k)
console.log(`\nwritten public/sample-quotes.json (${kb} KB), empty: ${empty.join(',') || 'none'}`)
