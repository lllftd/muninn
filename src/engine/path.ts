import { etDateKey } from '../lib/time.ts'
import type { Bar, PathQuality, RoundTrip } from '../types.ts'

function sliceBars(bars: Bar[], start: string, end: string): Bar[] {
  return bars.filter((b) => b.date >= start && b.date <= end)
}

function sma(bars: Bar[], endDate: string, n: number): number | null {
  const hist = bars.filter((b) => b.date < endDate)
  if (hist.length < n) return null
  const window = hist.slice(-n)
  return window.reduce((s, b) => s + b.close, 0) / n
}

export function atr20(bars: Bar[], endDate: string): number | null {
  const hist = bars.filter((b) => b.date < endDate)
  if (hist.length < 21) return null
  const window = hist.slice(-21)
  let sum = 0
  for (let i = 1; i < window.length; i++) {
    const cur = window[i]
    const prev = window[i - 1]
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close))
    sum += tr
  }
  return sum / 20
}

export function chaseStats(bars: Bar[], endDate: string, n = 20): { ret: number; percentile: number } | null {
  const hist = bars.filter((b) => b.date <= endDate)
  if (hist.length < n + 30) return null
  const last = hist[hist.length - 1]
  const prev = hist[hist.length - 1 - n]
  if (!prev) return null
  const ret = last.close / prev.close - 1
  const series: number[] = []
  for (let i = n; i < hist.length; i++) {
    series.push(hist[i].close / hist[i - n].close - 1)
  }
  const ranked = [...series].sort((a, b) => a - b)
  const idx = ranked.findIndex((v) => v >= ret)
  const percentile = idx < 0 ? 100 : (idx / ranked.length) * 100
  return { ret, percentile }
}

function executionLocation(fillPx: number, bar: Bar | undefined): number | null {
  if (!bar) return null
  const span = bar.high - bar.low
  if (span < 1e-9) return null
  const loc = (fillPx - bar.low) / span
  if (!Number.isFinite(loc)) return null
  return Math.min(1, Math.max(0, loc))
}

export function replayTrip(trip: RoundTrip, bars: Bar[] | undefined, vixBars?: Bar[]): RoundTrip {
  const start = etDateKey(trip.openTime)
  const end = etDateKey(trip.closeTime || trip.openTime)
  const sameDay = start === end
  const dir = trip.side === 'long' ? 1 : -1
  const qty = trip.qty
  const open = trip.openPrice
  const realized = trip.realizedPnl
  const window = bars?.length ? sliceBars(bars, start, end) : []
  const openBar = bars?.find((b) => b.date === start)

  let pathQuality: PathQuality
  if (sameDay && trip.status === 'closed') pathQuality = 'same_day_na'
  else if (!window.length) pathQuality = 'missing_bars'
  else pathQuality = 'daily_estimate'

  let maePrice: number | null = null
  let mfePrice: number | null = null
  if (pathQuality === 'daily_estimate') {
    let worst = dir === 1 ? Infinity : -Infinity
    let best = dir === 1 ? -Infinity : Infinity
    for (const bar of window) {
      if (dir === 1) {
        if (bar.low < worst) worst = bar.low
        if (bar.high > best) best = bar.high
      } else {
        if (bar.high > worst) worst = bar.high
        if (bar.low < best) best = bar.low
      }
    }
    maePrice = Number.isFinite(worst) ? worst : null
    mfePrice = Number.isFinite(best) ? best : null
  }

  const maeDisplay = maePrice != null ? ((maePrice - open) / open) * dir : null
  const mfeDisplay = mfePrice != null ? ((mfePrice - open) / open) * dir : null
  const maeDollar = maePrice != null ? (maePrice - open) * qty * dir : null
  const mfeDollar = mfePrice != null ? (mfePrice - open) * qty * dir : null

  let captureRate: number | null = null
  let givebackRate: number | null = null
  let recoveryRate: number | null = null
  let pathAnomaly = false
  if (mfeDollar != null && mfeDollar > 0 && realized > 0) {
    captureRate = realized / mfeDollar
    givebackRate = 1 - captureRate
    if (realized > mfeDollar * 1.001) pathAnomaly = true
  }
  if (maeDollar != null && maeDollar < 0 && realized < 0) {
    recoveryRate = (realized - maeDollar) / Math.abs(maeDollar)
  }

  // 疑似公司行动（如拆股未复权）：开仓价与持仓期日线价格量级不匹配
  const splitSuspect =
    pathQuality === 'daily_estimate' &&
    open > 0 &&
    mfePrice != null &&
    maePrice != null &&
    Math.max(open / mfePrice, open / maePrice, mfePrice / open, maePrice / open) > 2

  const atr = bars?.length ? atr20(bars, start) : null
  const risk = atr && atr > 0 ? atr * qty : null
  const grossPnl = realized + trip.fees
  const rPrice = risk && risk > 0 ? grossPnl / risk : null
  const rFee = risk && risk > 0 ? trip.fees / risk : null
  const rMultiple = risk && risk > 0 ? realized / risk : null
  const notional = open * qty
  const rFlags: string[] = []
  if (risk != null && trip.fees > 0.2 * risk) rFlags.push('fee-heavy')
  if (risk != null && risk < 8) rFlags.push('tiny-risk')
  if (notional > 0 && notional < 250) rFlags.push('tiny-notional')
  if (rMultiple != null && Math.abs(rMultiple) > 8) rFlags.push('extreme-r')
  if (splitSuspect) rFlags.push('split-suspect')
  if (!sameDay && atr == null) rFlags.push('atr-missing')
  if (open > 0 && open < 5 && atr != null && atr / open < 0.015) rFlags.push('low-price-atr')
  const stopPct = atr && open ? atr / open : null
  const stopPrice = stopPct != null ? open * (1 - stopPct * dir) : null
  const stopPnl = stopPrice != null ? (stopPrice - open) * qty * dir - trip.fees : null
  let lateStopCost = 0
  if (stopPct != null && stopPnl != null && maeDisplay != null && maeDisplay <= -stopPct && realized < stopPnl) {
    lateStopCost = stopPnl - realized
  }

  const moneyLeft = mfeDollar != null ? Math.max(0, mfeDollar - realized) : null
  const ma50 = bars?.length ? sma(bars, start, 50) : null
  const ma200 = bars?.length ? sma(bars, start, 200) : null
  const chase = bars?.length ? chaseStats(bars, start) : null
  const vix = vixBars?.length ? vixBars.filter((b) => b.date <= start).at(-1)?.close ?? null : null

  return {
    ...trip,
    sameDay,
    pathQuality,
    maePct: maeDisplay,
    mfePct: mfeDisplay,
    maePrice,
    mfePrice,
    maeDollar,
    mfeDollar,
    captureRate,
    givebackRate,
    recoveryRate,
    pathAnomaly,
    splitSuspect,
    moneyLeft,
    lateStopCost: Math.max(0, lateStopCost),
    rMultiple,
    rPrice,
    rFee,
    riskDollars: risk,
    rFlags,
    tagHints: [],
    atr,
    executionLocation: executionLocation(open, openBar),
    chasePercentile: chase?.percentile ?? null,
    chaseReturn: chase?.ret ?? null,
    ma50Dist: ma50 ? open / ma50 - 1 : null,
    ma200Dist: ma200 ? open / ma200 - 1 : null,
    vix,
    pathSource: pathQuality === 'daily_estimate' ? 'bars' : 'none',
  }
}

export function replayAll(
  trips: RoundTrip[],
  bars: Record<string, Bar[]>,
  splits: Record<string, number> = {},
  vixBars?: Bar[],
): { trips: RoundTrip[]; missing: string[] } {
  const missing: string[] = []
  const next = trips.map((trip) => {
    const series = bars[trip.symbol]
    if (!series?.length) missing.push(trip.symbol)
    const replayed = replayTrip(trip, series, vixBars)
    return { ...replayed, splitWarning: (splits[trip.symbol] || 0) > 0 }
  })
  return { trips: next, missing: [...new Set(missing)] }
}
