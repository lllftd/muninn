// 统一行情 provider 模块：Alpaca(主) → Yahoo → Stooq(备用) → 空(降级为已实现复盘)。
// 本地 dev / Vercel / Netlify 三处都委托到这里，消除重复实现。

export type QuoteProviderId = 'alpaca' | 'yahoo' | 'stooq'

export type ProxyBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** 单标的日线结果，带来源与口径，供报告展示「行情来源/覆盖率/复权口径」。 */
export type DailyBarResult = {
  provider: QuoteProviderId | null
  feed: 'iex' | 'sip' | 'unknown'
  adjusted: boolean
  bars: ProxyBar[]
  /** 拆股/合股事件数（用于拆股提示）。Alpaca/Stooq 已复权时为 0。 */
  splits: number
  warnings: string[]
}

export interface QuoteProvider {
  id: QuoteProviderId
  getDailyBars(params: { symbol: string; start: string; end: string }): Promise<DailyBarResult>
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

function empty(warnings: string[]): DailyBarResult {
  return { provider: null, feed: 'unknown', adjusted: false, bars: [], splits: 0, warnings }
}

// ---- Alpaca ----
const ALPACA_BASE = 'https://data.alpaca.markets'

export const alpacaProvider: QuoteProvider = {
  id: 'alpaca',
  async getDailyBars({ symbol, start, end }) {
    const keyId = process.env.ALPACA_API_KEY || ''
    const secret = process.env.ALPACA_API_SECRET || ''
    if (!keyId || !secret) return empty(['alpaca 未配置 API key'])
    // 免费版不覆盖指数，直接跳过，交给 Yahoo/Stooq。
    if (symbol.startsWith('^')) return empty(['alpaca 不覆盖指数'])
    const url =
      `${ALPACA_BASE}/v2/stocks/${encodeURIComponent(symbol.replace('^', '').toUpperCase())}/bars` +
      `?timeframe=1Day&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
      `&adjustment=split&feed=iex&limit=10000`
    let res: Response
    try {
      res = await fetch(url, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret, Accept: 'application/json' } })
    } catch (e) {
      return empty([`alpaca fetch(${symbol}) ${e instanceof Error ? e.message : String(e)}`])
    }
    if (!res.ok) return empty([res.status === 429 ? 'alpaca 限流(429)' : `alpaca http(${symbol}) ${res.status}`])
    const data = (await res.json()) as { bars?: Array<{ t?: string; o?: number; h?: number; l?: number; c?: number; v?: number }> }
    const bars: ProxyBar[] = []
    for (const b of data.bars ?? []) {
      const date = (b.t ?? '').slice(0, 10)
      if (!date || b.o == null || b.h == null || b.l == null || b.c == null) continue
      bars.push({ date, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0 })
    }
    bars.sort((a, z) => a.date.localeCompare(z.date))
    return bars.length ? { provider: 'alpaca', feed: 'iex', adjusted: true, bars, splits: 0, warnings: [] } : empty([`alpaca 无数据(${symbol})`])
  },
}

// ---- Yahoo ----
let yahooCookie = ''
let yahooCrumb = ''

function getSetCookies(res: Response): string[] {
  const headers = res.headers as unknown as { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

function yahooSymbol(symbol: string): string {
  if (symbol === 'SPX' || symbol === '^GSPC') return '^GSPC'
  if (symbol === 'VIX' || symbol === '^VIX') return '^VIX'
  if (symbol === 'IRX' || symbol === '^IRX') return '^IRX'
  return symbol
}

async function refreshYahooAuth(): Promise<void> {
  yahooCookie = ''
  yahooCrumb = ''
  const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'manual' })
  yahooCookie = getSetCookies(cookieRes).map((sc) => sc.split(';')[0]).join('; ')
  if (!yahooCookie) throw new Error('yahoo 未返回 cookie')
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: yahooCookie } })
  if (!crumbRes.ok) throw new Error(`yahoo crumb 获取失败 ${crumbRes.status}`)
  const crumb = (await crumbRes.text()).trim()
  if (!crumb) throw new Error('yahoo 未返回 crumb')
  yahooCrumb = crumb
}

export const yahooProvider: QuoteProvider = {
  id: 'yahoo',
  async getDailyBars({ symbol, start, end }) {
    const period1 = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000)
    const period2 = Math.floor(Date.parse(`${end}T23:59:59Z`) / 1000) + 86400
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!yahooCookie || !yahooCrumb) await refreshYahooAuth()
      } catch (e) {
        return empty([`yahoo auth ${e instanceof Error ? e.message : String(e)}`])
      }
      const ysym = encodeURIComponent(yahooSymbol(symbol))
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ysym}?period1=${period1}&period2=${period2}&interval=1d&events=split%2Cdiv&includeAdjustedClose=true&crumb=${encodeURIComponent(yahooCrumb)}`
      const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: yahooCookie, Accept: 'application/json' } })
      if (res.status === 401 || res.status === 403) {
        yahooCookie = ''
        yahooCrumb = ''
        continue
      }
      if (!res.ok) return empty([`yahoo http(${symbol}) ${res.status}`])
      const data = (await res.json()) as {
        chart?: { result?: Array<{ timestamp?: number[]; events?: { splits?: Record<string, unknown> }; indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }> }
      }
      const r = data.chart?.result?.[0]
      const ts = r?.timestamp
      const q = r?.indicators?.quote?.[0]
      if (!ts || !q?.open || !q.high || !q.low || !q.close) return empty([`yahoo 无数据(${symbol})`])
      const adj = yahooSymbol(symbol) === 'SPY' ? r?.indicators?.adjclose?.[0]?.adjclose : undefined
      const bars: ProxyBar[] = []
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
  },
}

// ---- Stooq ----
export const stooqProvider: QuoteProvider = {
  id: 'stooq',
  async getDailyBars({ symbol }) {
    const u = symbol.replace('^', '').toUpperCase()
    const s = u === 'GSPC' || u === 'SPX' ? '^spx' : u === 'VIX' ? '^vix' : u === 'IRX' ? '^irx' : `${symbol.toLowerCase()}.us`
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA } })
    } catch (e) {
      return empty([`stooq fetch(${symbol}) ${e instanceof Error ? e.message : String(e)}`])
    }
    if (!res.ok) return empty([`stooq http(${symbol}) ${res.status}`])
    const text = await res.text()
    if (!text.includes('Date')) return empty([`stooq 无数据(${symbol})`])
    const bars: ProxyBar[] = []
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
  },
}

// ---- 降级链与缓存 ----
const PROVIDERS: QuoteProvider[] = [alpacaProvider, yahooProvider, stooqProvider]
const cache = new Map<string, { at: number; value: SymbolResult }>()
const TTL_MS = 30 * 60 * 1000

export type SymbolResult = {
  bars: ProxyBar[]
  splits: number
  provider: QuoteProviderId | null
  feed: 'iex' | 'sip' | 'unknown'
  adjusted: boolean
  warnings: string[]
}

async function loadSymbol(symbol: string, start: string, end: string): Promise<SymbolResult> {
  const key = `${symbol}|${start}|${end}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const warnings: string[] = []
  for (const p of PROVIDERS) {
    const r = await p.getDailyBars({ symbol, start, end }).catch((e) => empty([`${p.id} 异常 ${e instanceof Error ? e.message : String(e)}`]))
    if (r.bars.length) {
      const value: SymbolResult = { bars: r.bars, splits: r.splits, provider: r.provider, feed: r.feed, adjusted: r.adjusted, warnings: [...warnings, ...r.warnings] }
      cache.set(key, { at: Date.now(), value })
      return value
    }
    warnings.push(...r.warnings)
  }
  const value: SymbolResult = { bars: [], splits: 0, provider: null, feed: 'unknown', adjusted: false, warnings }
  cache.set(key, { at: Date.now(), value })
  return value
}

export type QuotePackMeta = {
  provider: QuoteProviderId | null
  feed: 'iex' | 'sip' | 'unknown'
  adjusted: boolean
  warnings: string[]
}

export async function fetchQuotePack(symbols: string[], start: string, end: string) {
  const uniq = [...new Set(symbols)]
  const results = await Promise.all(uniq.map((s) => loadSymbol(s, start, end)))
  const bars: Record<string, ProxyBar[]> = {}
  const splits: Record<string, number> = {}
  const meta: Record<string, QuotePackMeta> = {}
  uniq.forEach((s, i) => {
    bars[s] = results[i].bars
    splits[s] = results[i].splits
    meta[s] = { provider: results[i].provider, feed: results[i].feed, adjusted: results[i].adjusted, warnings: results[i].warnings }
  })
  return { bars, splits, meta }
}
