import { etDateKey } from '../lib/time.ts'
import type { Book, RoundTrip, SessionBucket } from '../types.ts'

export function closedEpisodes(trips: RoundTrip[]): RoundTrip[] {
  return trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
}

export type HoldUiId = 'intraday' | 'd1_2' | 'd3_5' | 'd6_10' | 'd10p'

export const HOLD_UI: Array<{ id: HoldUiId; label: string }> = [
  { id: 'intraday', label: '日内' },
  { id: 'd1_2', label: '1–2 日' },
  { id: 'd3_5', label: '3–5 日' },
  { id: 'd6_10', label: '6–10 日' },
  { id: 'd10p', label: '10 日以上' },
]

export function holdUiBucket(t: RoundTrip): { id: HoldUiId; label: string } {
  if (t.sameDay || t.holdMinutes < 1440) return HOLD_UI[0]
  const d = t.holdMinutes / 1440
  if (d < 3) return HOLD_UI[1]
  if (d < 6) return HOLD_UI[2]
  if (d < 10) return HOLD_UI[3]
  return HOLD_UI[4]
}

export function sessionLabelOf(s: SessionBucket) {
  if (s === 'open30') return '开盘'
  if (s === 'close') return '尾盘'
  return '盘中'
}

export type WfDim = 'symbol' | 'trip' | 'side' | 'hold' | 'session'

export type AttrStep = {
  id: string
  label: string
  delta: number
  total?: boolean
  symbol?: string
  tripId?: string
}

const MAX_BARS = 8

function finishWaterfall(parts: AttrStep[]): AttrStep[] {
  const net = parts.reduce((s, p) => s + p.delta, 0)
  return [...parts, { id: 'net', label: '净盈亏', delta: net, total: true }]
}

function mergeTail(rows: AttrStep[], max = MAX_BARS): AttrStep[] {
  if (rows.length <= max) return rows
  const head = rows.slice(0, max)
  const rest = rows.slice(max)
  const delta = rest.reduce((s, r) => s + r.delta, 0)
  return [...head, { id: 'other', label: `其他 ${rest.length} 项`, delta }]
}

export function attrWaterfall(trips: RoundTrip[], dim: WfDim): AttrStep[] {
  const closed = closedEpisodes(trips)
  if (!closed.length) return []
  if (dim === 'symbol') {
    const map = new Map<string, number>()
    for (const t of closed) map.set(t.symbol, (map.get(t.symbol) || 0) + t.realizedPnl)
    const rows = [...map.entries()]
      .map(([symbol, delta]) => ({ id: `sym-${symbol}`, label: symbol, delta, symbol }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    return finishWaterfall(mergeTail(rows))
  }
  if (dim === 'trip') {
    const rows = [...closed]
      .sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl))
      .map((t) => ({
        id: t.id,
        label: t.symbol,
        delta: t.realizedPnl,
        symbol: t.symbol,
        tripId: t.id,
      }))
    return finishWaterfall(mergeTail(rows))
  }
  if (dim === 'side') {
    const long = closed.filter((t) => t.side === 'long').reduce((s, t) => s + t.realizedPnl, 0)
    const short = closed.filter((t) => t.side === 'short').reduce((s, t) => s + t.realizedPnl, 0)
    return finishWaterfall([
      { id: 'side-long', label: '多头', delta: long },
      { id: 'side-short', label: '空头', delta: short },
    ])
  }
  if (dim === 'hold') {
    const rows = HOLD_UI.map((b) => {
      const list = closed.filter((t) => holdUiBucket(t).id === b.id)
      return { id: `hold-${b.id}`, label: b.label, delta: list.reduce((s, t) => s + t.realizedPnl, 0), n: list.length }
    })
      .filter((r) => r.n > 0)
      .map(({ id, label, delta }) => ({ id, label, delta }))
    return finishWaterfall(rows)
  }
  const sess: SessionBucket[] = ['open30', 'midday', 'close']
  const rows = sess.map((s) => ({
    id: `sess-${s}`,
    label: sessionLabelOf(s),
    delta: closed.filter((t) => t.session === s).reduce((sum, t) => sum + t.realizedPnl, 0),
  }))
  return finishWaterfall(rows)
}

export type CumMark = {
  i: number
  tripId: string
  kind: 'maxWin' | 'maxLoss' | 'streak' | 'maxDd'
  label: string
}

export type CumPath = {
  dates: string[]
  tripIds: string[]
  actual: number[]
  exMaxWin: number[]
  seqDd: number[]
  marks: CumMark[]
  ddPeakI: number
  ddTroughI: number
}

export function cumPath(trips: RoundTrip[]): CumPath | null {
  const closed = [...closedEpisodes(trips)].sort((a, b) => {
    const ac = a.closeTime?.getTime() ?? a.openTime.getTime()
    const bc = b.closeTime?.getTime() ?? b.openTime.getTime()
    return ac - bc
  })
  if (!closed.length) return null
  const dates = closed.map((t) => etDateKey(t.closeTime ?? t.openTime))
  const tripIds = closed.map((t) => t.id)
  const actual: number[] = []
  let run = 0
  for (const t of closed) {
    run += t.realizedPnl
    actual.push(run)
  }
  const maxWin = closed.reduce((best, t) => (t.realizedPnl > best.realizedPnl ? t : best), closed[0])
  const exMaxWin: number[] = []
  run = 0
  for (const t of closed) {
    if (t.id !== maxWin.id) run += t.realizedPnl
    exMaxWin.push(run)
  }
  const seqDd: number[] = []
  let peak = -Infinity
  let peakI = 0
  let troughI = 0
  let worst = 0
  let peakAtWorst = 0
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] > peak) {
      peak = actual[i]
      peakI = i
    }
    const dd = actual[i] - peak
    seqDd.push(dd)
    if (dd < worst) {
      worst = dd
      troughI = i
      peakAtWorst = peakI
    }
  }
  const marks: CumMark[] = []
  const maxWinI = closed.findIndex((t) => t.id === maxWin.id)
  if (maxWin.realizedPnl > 0 && maxWinI >= 0) {
    marks.push({ i: maxWinI, tripId: maxWin.id, kind: 'maxWin', label: `最大盈利 ${maxWin.symbol}` })
  }
  const maxLoss = closed.reduce((best, t) => (t.realizedPnl < best.realizedPnl ? t : best), closed[0])
  const maxLossI = closed.findIndex((t) => t.id === maxLoss.id)
  if (maxLoss.realizedPnl < 0 && maxLossI >= 0) {
    marks.push({ i: maxLossI, tripId: maxLoss.id, kind: 'maxLoss', label: `最大亏损 ${maxLoss.symbol}` })
  }
  let bestLen = 0
  let bestStart = -1
  let curLen = 0
  let curStart = 0
  for (let i = 0; i < closed.length; i++) {
    if (closed[i].realizedPnl < 0) {
      if (curLen === 0) curStart = i
      curLen += 1
      if (curLen > bestLen) {
        bestLen = curLen
        bestStart = curStart
      }
    } else {
      curLen = 0
    }
  }
  if (bestLen >= 2 && bestStart >= 0) {
    const t = closed[bestStart]
    marks.push({ i: bestStart, tripId: t.id, kind: 'streak', label: `连亏 ${bestLen} 笔起点` })
  }
  if (worst < 0) {
    marks.push({
      i: troughI,
      tripId: closed[troughI].id,
      kind: 'maxDd',
      label: '序列最大回撤',
    })
  }
  return {
    dates,
    tripIds,
    actual,
    exMaxWin,
    seqDd,
    marks,
    ddPeakI: peakAtWorst,
    ddTroughI: troughI,
  }
}

export type ExitFlag = 'floatedLoss' | 'giveback80' | 'highMfeLowReal' | 'highMaeWin'

export type ExitPoint = {
  id: string
  symbol: string
  mfe: number
  pnl: number
  notional: number
  up: boolean
  holdId: HoldUiId
  flags: ExitFlag[]
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function exitPoints(trips: RoundTrip[]): ExitPoint[] {
  const closed = closedEpisodes(trips).filter((t) => t.mfeDollar != null && Number.isFinite(t.mfeDollar))
  if (!closed.length) return []
  const mfes = closed.map((t) => t.mfeDollar as number)
  const maes = closed.map((t) => Math.abs(t.maeDollar ?? 0))
  const medMfe = median(mfes) ?? 0
  const medMae = median(maes) ?? 0
  return closed.map((t) => {
    const mfe = t.mfeDollar as number
    const mae = Math.abs(t.maeDollar ?? 0)
    const flags: ExitFlag[] = []
    if (mfe > 0 && t.realizedPnl < 0) flags.push('floatedLoss')
    if (t.givebackRate != null && t.givebackRate >= 0.8) flags.push('giveback80')
    if (mfe >= medMfe && medMfe > 0 && t.realizedPnl < mfe * 0.2) flags.push('highMfeLowReal')
    if (mae >= medMae && medMae > 0 && t.realizedPnl > 0) flags.push('highMaeWin')
    return {
      id: t.id,
      symbol: t.symbol,
      mfe,
      pnl: t.realizedPnl,
      notional: Math.max(t.openPrice * t.qty, 1),
      up: t.realizedPnl >= 0,
      holdId: holdUiBucket(t).id,
      flags,
    }
  })
}

export type SymbolPareto = {
  symbol: string
  pnl: number
  n: number
  mean: number
  maxTrip: number
  maxShare: number | null
  lossCumShare: number | null
}

export function symbolPareto(trips: RoundTrip[]): SymbolPareto[] {
  const closed = closedEpisodes(trips)
  const map = new Map<string, RoundTrip[]>()
  for (const t of closed) {
    const list = map.get(t.symbol) || []
    list.push(t)
    map.set(t.symbol, list)
  }
  const rows: SymbolPareto[] = [...map.entries()].map(([symbol, list]) => {
    const pnl = list.reduce((s, t) => s + t.realizedPnl, 0)
    const maxTrip = list.reduce((m, t) => (Math.abs(t.realizedPnl) > Math.abs(m) ? t.realizedPnl : m), 0)
    const maxShare = pnl !== 0 ? Math.abs(maxTrip) / Math.abs(pnl) : null
    return { symbol, pnl, n: list.length, mean: pnl / list.length, maxTrip, maxShare, lossCumShare: null }
  })
  rows.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || b.pnl - a.pnl)
  const losers = [...rows.filter((r) => r.pnl < 0)].sort((a, b) => a.pnl - b.pnl)
  const lossAbs = losers.reduce((s, r) => s + Math.abs(r.pnl), 0)
  let run = 0
  const cum = new Map<string, number>()
  for (const r of losers) {
    run += Math.abs(r.pnl)
    if (lossAbs > 0) cum.set(r.symbol, run / lossAbs)
  }
  for (const r of rows) r.lossCumShare = cum.get(r.symbol) ?? null
  return rows
}

export type MaeQuadId = 'mfeWin' | 'mfeLoss' | 'maeWin' | 'maeLoss'

export type MaeQuad = {
  id: MaeQuadId
  label: string
  n: number
  pnl: number
  meanHoldMin: number | null
}

export function maeQuadrants(trips: RoundTrip[]): MaeQuad[] | null {
  const pts = closedEpisodes(trips).filter((t) => t.maePct != null && t.mfePct != null)
  if (pts.length < 4) return null
  const medMae = median(pts.map((t) => Math.abs(t.maePct as number))) ?? 0
  const medMfe = median(pts.map((t) => t.mfePct as number)) ?? 0
  const bucket = (t: RoundTrip): MaeQuadId => {
    const highMfe = (t.mfePct as number) >= medMfe
    const highMae = Math.abs(t.maePct as number) >= medMae
    if (highMfe && t.realizedPnl >= 0) return 'mfeWin'
    if (highMfe && t.realizedPnl < 0) return 'mfeLoss'
    if (highMae && t.realizedPnl >= 0) return 'maeWin'
    return 'maeLoss'
  }
  const labels: Record<MaeQuadId, string> = {
    mfeWin: '高 MFE · 最终盈利（正常兑现观察）',
    mfeLoss: '高 MFE · 最终亏损（浮盈回吐候选）',
    maeWin: '高 MAE · 最终盈利（逆向后仍盈）',
    maeLoss: '高 MAE · 最终亏损（入场或止损观察）',
  }
  const ids: MaeQuadId[] = ['mfeWin', 'mfeLoss', 'maeWin', 'maeLoss']
  return ids.map((id) => {
    const list = pts.filter((t) => bucket(t) === id)
    const hold = list.map((t) => t.holdMinutes)
    return {
      id,
      label: labels[id],
      n: list.length,
      pnl: list.reduce((s, t) => s + t.realizedPnl, 0),
      meanHoldMin: hold.length ? hold.reduce((s, v) => s + v, 0) / hold.length : null,
    }
  })
}

export type HoldUiRow = {
  id: HoldUiId
  label: string
  n: number
  mean: number | null
  median: number | null
  winRate: number | null
  pnl: number
  points: Array<{ id: string; v: number; label: string }>
}

export function holdUiRows(trips: RoundTrip[]): HoldUiRow[] {
  const closed = closedEpisodes(trips)
  return HOLD_UI.map((b) => {
    const list = closed.filter((t) => holdUiBucket(t).id === b.id)
    const pnls = list.map((t) => t.realizedPnl)
    const pnl = pnls.reduce((s, v) => s + v, 0)
    return {
      id: b.id,
      label: b.label,
      n: list.length,
      mean: list.length ? pnl / list.length : null,
      median: median(pnls),
      winRate: list.length ? list.filter((t) => t.realizedPnl > 0).length / list.length : null,
      pnl,
      points: list.map((t) => ({ id: t.id, v: t.realizedPnl, label: `${t.symbol} ${t.realizedPnl}` })),
    }
  })
}

export type WhyLeadFacts = {
  net: number
  n: number
  wr: number | null
  seqDdUsd: number | null
  payoff: number | null
  maxWinShare: number | null
  top3LossShare: number | null
  netExMaxWin: number | null
  floatedToLoss: number
  pathN: number
  rFlagged: number
  rValid: number
  topWinSymbols: string[]
  topLossSymbols: string[]
  oneShot: boolean
}

export function whyLeadFacts(book: Book): WhyLeadFacts {
  const closed = closedEpisodes(book.episodes)
  const n = closed.length
  const net = closed.reduce((s, t) => s + t.realizedPnl, 0)
  const wins = closed.filter((t) => t.realizedPnl > 0)
  const grossWin = wins.reduce((s, t) => s + t.realizedPnl, 0)
  const maxWinTrip = wins.reduce((best: RoundTrip | null, t) => (!best || t.realizedPnl > best.realizedPnl ? t : best), null)
  const floatedToLoss = closed.filter((t) => (t.mfeDollar ?? 0) > 0 && t.realizedPnl < 0).length
  const bySym = symbolPareto(closed)
  const topWin = bySym.filter((r) => r.pnl > 0)[0]
  const maxWinShare = grossWin > 0 && topWin ? topWin.pnl / grossWin : null
  const lossSym = [...bySym.filter((r) => r.pnl < 0)].sort((a, b) => a.pnl - b.pnl)
  const grossLoss = lossSym.reduce((s, r) => s + Math.abs(r.pnl), 0)
  const top3LossShare = grossLoss > 0 ? lossSym.slice(0, 3).reduce((s, r) => s + Math.abs(r.pnl), 0) / grossLoss : null
  const netExMaxWin = maxWinTrip ? net - maxWinTrip.realizedPnl : net
  const topWinSymbols = bySym.filter((r) => r.pnl > 0).slice(0, 2).map((r) => r.symbol)
  const topLossSymbols = lossSym.slice(0, 3).map((r) => r.symbol)
  const oneShot = Boolean(topWin && maxWinShare != null && maxWinShare >= 0.4)
  const path = cumPath(closed)
  const seqDdUsd = path ? Math.abs(Math.min(...path.seqDd, 0)) : null
  const p = book.performance
  return {
    net,
    n,
    wr: p.winRate.value,
    seqDdUsd,
    payoff: p.payoff.value,
    maxWinShare,
    top3LossShare,
    netExMaxWin,
    floatedToLoss,
    pathN: p.pathComputable,
    rFlagged: p.atrR.flagged,
    rValid: Math.max(0, n - p.atrR.flagged),
    topWinSymbols,
    topLossSymbols,
    oneShot,
  }
}

export function dimOf(active: { symbol?: string; tripId?: string } | null, symbol?: string, tripId?: string) {
  if (!active?.symbol && !active?.tripId) return false
  if (active.tripId && tripId) return tripId !== active.tripId
  if (active.symbol && symbol) return symbol !== active.symbol
  return false
}
