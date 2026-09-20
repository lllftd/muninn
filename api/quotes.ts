type ProxyBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const cache = new Map<string, { at: number; bars: ProxyBar[]; splits: number }>()
const TTL_MS = 30 * 60 * 1000
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

// Yahoo Finance 需要 cookie + crumb 鉴权，否则匿名请求会返回 429。
let authCookie = ''
let authCrumb = ''
let lastError = ''

function getSetCookies(res: any): string[] {
  const headers = res.headers as unknown as { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor
      cursor += 1
      ret[idx] = await fn(items[idx])
    }
  }
  const workers = Array.from({ length: Math.min(n, Math.max(items.length, 1)) }, () => worker())
  await Promise.all(workers)
  return ret
}

function yahooSymbol(symbol: string): string {
  if (symbol === 'SPX' || symbol === '^GSPC') return '^GSPC'
  if (symbol === 'VIX' || symbol === '^VIX') return '^VIX'
  if (symbol === 'IRX' || symbol === '^IRX') return '^IRX'
  return symbol
}

function stooqSymbol(symbol: string): string {
  const u = symbol.replace('^', '').toUpperCase()
  if (u === 'GSPC' || u === 'SPX') return '^spx'
  if (u === 'VIX') return '^vix'
  if (u === 'IRX') return '^irx'
  return `${symbol.toLowerCase()}.us`
}

function toBars(
  timestamps: number[],
  open: Array<number | null>,
  high: Array<number | null>,
  low: Array<number | null>,
  close: Array<number | null>,
  volume: Array<number | null>,
  adjclose?: Array<number | null>,
): ProxyBar[] {
  const bars: ProxyBar[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const o = open[i]
    const h = high[i]
    const l = low[i]
    const raw = close[i]
    const adj = adjclose?.[i]
    const c = adj != null && Number.isFinite(adj) ? adj : raw
    if (o == null || h == null || l == null || raw == null || c == null) continue
    const scale = raw > 0 ? c / raw : 1
    const d = new Date(timestamps[i] * 1000)
    const date = d.toISOString().slice(0, 10)
    bars.push({
      date,
      open: o * scale,
      high: h * scale,
      low: l * scale,
      close: c,
      volume: volume[i] ?? 0,
    })
  }
  return bars
}

async function refreshYahooAuth(): Promise<void> {
  authCookie = ''
  authCrumb = ''
  // 1. 触发 Yahoo 下发会话 cookie（主要是 A3）
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'manual',
  })
  const parts = getSetCookies(cookieRes).map((sc) => sc.split(';')[0])
  authCookie = parts.join('; ')
  if (!authCookie) throw new Error('yahoo 未返回 cookie')

  // 2. 用 cookie 换取 crumb
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: authCookie },
  })
  if (!crumbRes.ok) throw new Error(`yahoo crumb 获取失败 ${crumbRes.status}`)
  const crumb = (await crumbRes.text()).trim()
  if (!crumb) throw new Error('yahoo 未返回 crumb')
  authCrumb = crumb
}

async function fetchYahoo(symbol: string, period1: number, period2: number): Promise<{ bars: ProxyBar[]; splits: number } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!authCookie || !authCrumb) await refreshYahooAuth()
    } catch (e) {
      lastError = `yahoo-auth: ${e instanceof Error ? e.message : String(e)}`
      return null
    }
    const ysym = encodeURIComponent(yahooSymbol(symbol))
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ysym}?period1=${period1}&period2=${period2}&interval=1d&events=split%2Cdiv&includeAdjustedClose=true&crumb=${encodeURIComponent(authCrumb)}`
    let res: Response
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Cookie: authCookie, Accept: 'application/json' },
      })
    } catch (e) {
      lastError = `yahoo-fetch: ${e instanceof Error ? e.message : String(e)}`
      return null
    }
    if (res.status === 401 || res.status === 403) {
      authCookie = ''
      authCrumb = ''
      continue
    }
    if (!res.ok) {
      lastError = `yahoo-http: ${res.status}`
      return null
    }
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[]
          events?: { splits?: Record<string, unknown> }
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>
              high?: Array<number | null>
              low?: Array<number | null>
              close?: Array<number | null>
              volume?: Array<number | null>
            }>
            adjclose?: Array<{ adjclose?: Array<number | null> }>
          }>
        }>
        error?: { code?: string; description?: string }
      }
    }
    if (data.chart?.error) lastError = `yahoo-error: ${data.chart.error.code} ${data.chart.error.description}`
    const result = data.chart?.result?.[0]
    const ts = result?.timestamp
    const q = result?.indicators?.quote?.[0]
    if (!ts || !q?.open || !q.high || !q.low || !q.close) return null
    const adj = yahooSymbol(symbol) === 'SPY' ? result.indicators?.adjclose?.[0]?.adjclose : undefined
    const bars = toBars(ts, q.open, q.high, q.low, q.close, q.volume ?? [], adj)
    const splits = result.events?.splits ? Object.keys(result.events.splits).length : 0
    if (!bars.length) return null
    return { bars, splits }
  }
  return null
}

async function fetchStooq(symbol: string): Promise<{ bars: ProxyBar[]; splits: number } | null> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&i=d`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } })
  } catch (e) {
    lastError = `stooq-fetch: ${e instanceof Error ? e.message : String(e)}`
    return null
  }
  if (!res.ok) {
    lastError = `stooq-http: ${res.status}`
    return null
  }
  const text = await res.text()
  if (!text.includes('Date')) {
    lastError = `stooq-body: ${text.slice(0, 80)}`
    return null
  }
  const bars: ProxyBar[] = []
  const lines = text.trim().split(/\r?\n/).slice(1)
  for (const line of lines) {
    const [date, o, h, l, c, v] = line.split(',')
    const open = Number(o)
    const high = Number(h)
    const low = Number(l)
    const close = Number(c)
    if (!date || !Number.isFinite(open) || !Number.isFinite(close)) continue
    bars.push({ date, open, high, low, close, volume: Number(v) || 0 })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars.length ? { bars, splits: 0 } : null
}

async function loadSymbol(symbol: string, period1: number, period2: number) {
  const key = `${symbol}|${period1}|${period2}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit
  let pack = await fetchYahoo(symbol, period1, period2).catch(() => null)
  if (!pack) pack = await fetchStooq(symbol).catch(() => null)
  if (!pack) return { at: Date.now(), bars: [] as ProxyBar[], splits: 0 }
  const row = { at: Date.now(), bars: pack.bars, splits: pack.splits }
  cache.set(key, row)
  return row
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const symbols = (url.searchParams.get('symbols') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const start = url.searchParams.get('start') || '2019-01-01'
    const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10)

    let body: unknown = { bars: {}, splits: {} }
    if (symbols.length) {
      const period1 = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000)
      const period2 = Math.floor(Date.parse(`${end}T23:59:59Z`) / 1000) + 86400
      const rows = await mapPool(symbols, 4, (symbol) => loadSymbol(symbol, period1, period2))
      const bars: Record<string, ProxyBar[]> = {}
      const splits: Record<string, number> = {}
      symbols.forEach((symbol, i) => {
        bars[symbol] = rows[i].bars
        if (rows[i].splits) splits[symbol] = rows[i].splits
      })
      body = { bars, splits }
      if (url.searchParams.get('debug') === '1') {
        body = { bars, splits, debug: { lastError: lastError || 'none', empty: symbols.filter((s) => !bars[s]?.length) } }
      }
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  },
}
