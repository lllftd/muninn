const cache = new Map()
const TTL_MS = 30 * 60 * 1000
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

// Yahoo Finance 需要 cookie + crumb 鉴权，否则匿名请求会返回 429。
let authCookie = ''
let authCrumb = ''

function getSetCookies(res) {
  const headers = res.headers
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

async function mapPool(items, n, fn) {
  const ret = new Array(items.length)
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

function yahooSymbol(symbol) {
  if (symbol === 'SPX' || symbol === '^GSPC') return '^GSPC'
  if (symbol === 'VIX' || symbol === '^VIX') return '^VIX'
  if (symbol === 'IRX' || symbol === '^IRX') return '^IRX'
  return symbol
}

function stooqSymbol(symbol) {
  const u = symbol.replace('^', '').toUpperCase()
  if (u === 'GSPC' || u === 'SPX') return '^spx'
  if (u === 'VIX') return '^vix'
  if (u === 'IRX') return '^irx'
  return `${symbol.toLowerCase()}.us`
}

function toBars(timestamps, open, high, low, close, volume, adjclose) {
  const bars = []
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

async function refreshYahooAuth() {
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

async function fetchYahoo(symbol, period1, period2) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!authCookie || !authCrumb) await refreshYahooAuth()
    } catch {
      return null
    }
    const ysym = encodeURIComponent(yahooSymbol(symbol))
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ysym}?period1=${period1}&period2=${period2}&interval=1d&events=split%2Cdiv&includeAdjustedClose=true&crumb=${encodeURIComponent(authCrumb)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Cookie: authCookie, Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403) {
      authCookie = ''
      authCrumb = ''
      continue
    }
    if (!res.ok) return null
    const data = await res.json()
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

async function fetchStooq(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&i=d`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const text = await res.text()
  if (!text.includes('Date')) return null
  const bars = []
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

function twelveSymbol(symbol) {
  if (symbol === 'SPX' || symbol === '^GSPC') return 'SPX'
  if (symbol === 'VIX' || symbol === '^VIX') return 'VIX'
  if (symbol === 'IRX' || symbol === '^IRX') return 'IRX'
  return symbol
}

async function fetchTwelveData(symbol, apiKey) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(twelveSymbol(symbol))}&interval=1day&outputsize=5000&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const values = data.values
  if (!Array.isArray(values) || !values.length) return null
  const bars = []
  for (const row of values) {
    const date = row.datetime
    const open = Number(row.open)
    const high = Number(row.high)
    const low = Number(row.low)
    const close = Number(row.close)
    const volume = Number(row.volume)
    if (!date || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue
    bars.push({ date, open, high, low, close, volume: volume || 0 })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars.length ? { bars, splits: 0 } : null
}

async function fetchAlphaVantage(symbol, apiKey) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const series = data['Time Series (Daily)']
  if (!series) return null
  const bars = []
  for (const [date, row] of Object.entries(series)) {
    const open = Number(row['1. open'])
    const high = Number(row['2. high'])
    const low = Number(row['3. low'])
    const raw = Number(row['4. close'])
    const adj = Number(row['5. adjusted close'])
    const volume = Number(row['6. volume'])
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(raw) || !Number.isFinite(adj)) continue
    const scale = raw > 0 ? adj / raw : 1
    bars.push({
      date,
      open: open * scale,
      high: high * scale,
      low: low * scale,
      close: adj,
      volume: volume || 0,
    })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars.length ? { bars, splits: 0 } : null
}

async function loadSymbol(symbol, period1, period2) {
  const key = `${symbol}|${period1}|${period2}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit
  const twelveKey = process.env.TWELVE_DATA_KEY || ''
  const avKey = process.env.ALPHA_VANTAGE_KEY || ''
  let pack = twelveKey ? await fetchTwelveData(symbol, twelveKey).catch(() => null) : null
  if (!pack && avKey) pack = await fetchAlphaVantage(symbol, avKey).catch(() => null)
  if (!pack) pack = await fetchYahoo(symbol, period1, period2).catch(() => null)
  if (!pack) pack = await fetchStooq(symbol).catch(() => null)
  if (!pack) return { at: Date.now(), bars: [], splits: 0 }
  const row = { at: Date.now(), bars: pack.bars, splits: pack.splits }
  cache.set(key, row)
  return row
}

export default async function handler(event) {
  const qs = event.queryStringParameters || {}

  if (qs.diag === '1') {
    const twelveKey = process.env.TWELVE_DATA_KEY || ''
    const avKey = process.env.ALPHA_VANTAGE_KEY || ''
    let tdStatus = 'no_key'
    let tdSample = ''
    if (twelveKey) {
      try {
        const r = await fetch(`https://api.twelvedata.com/time_series?symbol=SPY&interval=1day&outputsize=2&apikey=${twelveKey}`)
        tdStatus = String(r.status)
        tdSample = (await r.text()).slice(0, 120)
      } catch (e) {
        tdStatus = 'error:' + String(e)
      }
    }
    return new Response(JSON.stringify({ hasTwelveKey: !!twelveKey, hasAvKey: !!avKey, tdStatus, tdSample }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const symbols = (qs.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const start = qs.start || '2019-01-01'
  const end = qs.end || new Date().toISOString().slice(0, 10)

  let body = { bars: {}, splits: {} }
  if (symbols.length) {
    const period1 = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000)
    const period2 = Math.floor(Date.parse(`${end}T23:59:59Z`) / 1000) + 86400
    const rows = await mapPool(symbols, 4, (symbol) => loadSymbol(symbol, period1, period2))
    const bars = {}
    const splits = {}
    symbols.forEach((symbol, i) => {
      bars[symbol] = rows[i].bars
      if (rows[i].splits) splits[symbol] = rows[i].splits
    })
    body = { bars, splits }
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
