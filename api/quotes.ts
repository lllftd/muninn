// Vercel 函数：行情代理。自包含（Alpaca 主源 → Yahoo → Stooq → 空降级），
// 不依赖 api/ 目录外的 .ts 模块（Vercel 函数打包器无法可靠追踪跨目录 .ts 依赖）。

export const config = { runtime: 'nodejs', regions: ['iad1'], maxDuration: 60 }

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const ALPACA_BASE = 'https://data.alpaca.markets'
const TTL_MS = 30 * 60 * 1000
const cache = new Map()

/** 带超时的 fetch，防止上游（Yahoo/Stooq）挂死拖垮函数。 */
function fetchTimeout(url, opts = {}, ms = 8000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t))
}

function empty(warnings) {
  return { provider: null, feed: 'unknown', adjusted: false, bars: [], splits: 0, warnings }
}

// ---- Alpaca ----
async function fetchAlpaca(symbol, start, end) {
  const keyId = process.env.ALPACA_API_KEY || ''
  const secret = process.env.ALPACA_API_SECRET || ''
  if (!keyId || !secret) return empty(['alpaca 未配置 API key'])
  if (symbol.startsWith('^')) return empty(['alpaca 不覆盖指数'])
  const url =
    `${ALPACA_BASE}/v2/stocks/${encodeURIComponent(symbol.replace('^', '').toUpperCase())}/bars` +
    `?timeframe=1Day&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
    `&adjustment=split&feed=iex&limit=10000`
  const res = await fetchTimeout(url, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret, Accept: 'application/json' } })
  if (!res.ok) return empty([res.status === 429 ? 'alpaca 限流(429)' : `alpaca http(${symbol}) ${res.status}`])
  const data = await res.json()
  const bars = []
  for (const b of data.bars ?? []) {
    const date = (b.t ?? '').slice(0, 10)
    if (!date || b.o == null || b.h == null || b.l == null || b.c == null) continue
    bars.push({ date, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0 })
  }
  bars.sort((a, z) => a.date.localeCompare(z.date))
  return bars.length ? { provider: 'alpaca', feed: 'iex', adjusted: true, bars, splits: 0, warnings: [] } : empty([`alpaca 无数据(${symbol})`])
}

// ---- Yahoo ----
let yahooCookie = ''
let yahooCrumb = ''
function getSetCookies(res) {
  const headers = res.headers
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = headers.get('set-cookie')
  return raw ? [raw] : []
}
function yahooSymbol(symbol) {
  if (symbol === 'SPX' || symbol === '^GSPC') return '^GSPC'
  if (symbol === 'VIX' || symbol === '^VIX') return '^VIX'
  if (symbol === 'IRX' || symbol === '^IRX') return '^IRX'
  return symbol
}
async function refreshYahooAuth() {
  yahooCookie = ''
  yahooCrumb = ''
  const cookieRes = await fetchTimeout('https://fc.yahoo.com', { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'manual' })
  yahooCookie = getSetCookies(cookieRes).map((sc) => sc.split(';')[0]).join('; ')
  if (!yahooCookie) throw new Error('yahoo 未返回 cookie')
  const crumbRes = await fetchTimeout('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: yahooCookie } })
  if (!crumbRes.ok) throw new Error(`yahoo crumb 获取失败 ${crumbRes.status}`)
  const crumb = (await crumbRes.text()).trim()
  if (!crumb) throw new Error('yahoo 未返回 crumb')
  yahooCrumb = crumb
}
async function fetchYahoo(symbol, start, end) {
  const period1 = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000)
  const period2 = Math.floor(Date.parse(`${end}T23:59:59Z`) / 1000) + 86400
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!yahooCookie || !yahooCrumb) await refreshYahooAuth()
    } catch (e) {
      return empty([`yahoo auth ${e.message}`])
    }
    const ysym = encodeURIComponent(yahooSymbol(symbol))
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ysym}?period1=${period1}&period2=${period2}&interval=1d&events=split%2Cdiv&includeAdjustedClose=true&crumb=${encodeURIComponent(yahooCrumb)}`
    const res = await fetchTimeout(url, { headers: { 'User-Agent': UA, Cookie: yahooCookie, Accept: 'application/json' } })
    if (res.status === 401 || res.status === 403) {
      yahooCookie = ''
      yahooCrumb = ''
      continue
    }
    if (!res.ok) return empty([`yahoo http(${symbol}) ${res.status}`])
    const data = await res.json()
    const r = data.chart?.result?.[0]
    const ts = r?.timestamp
    const q = r?.indicators?.quote?.[0]
    if (!ts || !q?.open || !q.high || !q.low || !q.close) return empty([`yahoo 无数据(${symbol})`])
    const adj = yahooSymbol(symbol) === 'SPY' ? r?.indicators?.adjclose?.[0]?.adjclose : undefined
    const bars = []
    for (let i = 0; i < ts.length; i++) {
      const o = q.open[i]
      const h = q.high[i]
      const l = q.low[i]
      const raw = q.close[i]
      const a = adj?.[i]
      const c = a != null && Number.isFinite(a) ? a : raw
      if (o == null || h == null || l == null || raw == null || c == null) continue
      const scale = raw > 0 ? c / raw : 1
      bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o * scale, high: h * scale, low: l * scale, close: c, volume: q.volume?.[i] ?? 0 })
    }
    const splits = r?.events?.splits ? Object.keys(r.events.splits).length : 0
    return bars.length ? { provider: 'yahoo', feed: 'unknown', adjusted: adj != null, bars, splits, warnings: [] } : empty([`yahoo 无数据(${symbol})`])
  }
  return empty([`yahoo auth 重试失败(${symbol})`])
}

// ---- Stooq ----
async function fetchStooq(symbol) {
  const u = symbol.replace('^', '').toUpperCase()
  const s = u === 'GSPC' || u === 'SPX' ? '^spx' : u === 'VIX' ? '^vix' : u === 'IRX' ? '^irx' : `${symbol.toLowerCase()}.us`
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`
  const res = await fetchTimeout(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return empty([`stooq http(${symbol}) ${res.status}`])
  const text = await res.text()
  if (!text.includes('Date')) return empty([`stooq 无数据(${symbol})`])
  const bars = []
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [date, o, h, l, c, v] = line.split(',')
    const open = Number(o)
    const high = Number(h)
    const low = Number(l)
    const close = Number(c)
    if (!date || !Number.isFinite(open) || !Number.isFinite(close)) continue
    bars.push({ date, open, high, low, close, volume: Number(v) || 0 })
  }
  bars.sort((a, z) => a.date.localeCompare(z.date))
  return bars.length ? { provider: 'stooq', feed: 'unknown', adjusted: false, bars, splits: 0, warnings: [] } : empty([`stooq 无数据(${symbol})`])
}

const PROVIDERS = [fetchAlpaca, fetchYahoo, fetchStooq]

async function loadSymbol(symbol, start, end) {
  const key = `${symbol}|${start}|${end}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const warnings = []
  for (const p of PROVIDERS) {
    const r = await p(symbol, start, end).catch((e) => empty([`provider 异常 ${e.message}`]))
    if (r.bars.length) {
      const value = { bars: r.bars, splits: r.splits, provider: r.provider, feed: r.feed, adjusted: r.adjusted, warnings: [...warnings, ...r.warnings] }
      cache.set(key, { at: Date.now(), value })
      return value
    }
    warnings.push(...r.warnings)
  }
  const value = { bars: [], splits: 0, provider: null, feed: 'unknown', adjusted: false, warnings }
  cache.set(key, { at: Date.now(), value })
  return value
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

export default async function handler(request) {
  try {
    const url = new URL(request.url)
    const symbols = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const start = url.searchParams.get('start') || '2019-01-01'
    const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10)

    if (!symbols.length) return json({ bars: {}, splits: {}, meta: {} })

    const uniq = [...new Set(symbols)]
    const results = await Promise.all(uniq.map((s) => loadSymbol(s, start, end)))
    const bars = {}
    const splits = {}
    const meta = {}
    uniq.forEach((s, i) => {
      bars[s] = results[i].bars
      splits[s] = results[i].splits
      meta[s] = { provider: results[i].provider, feed: results[i].feed, adjusted: results[i].adjusted, warnings: results[i].warnings }
    })
    const body = url.searchParams.get('debug') === '1' ? { bars, splits, meta, debug: { empty: uniq.filter((s) => !bars[s]?.length) } } : { bars, splits, meta }
    return json(body)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, 500)
  }
}
