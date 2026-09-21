import { median } from '../lib/stats.ts'
import type { HowQueueRow } from '../engine/cover.ts'
import type { ExperimentEvaluation, ExperimentRecord } from '../lib/experiments.ts'
import { isDay4Shadow } from '../lib/experiments.ts'
import type { RoundTrip } from '../types.ts'

function closedOf(trips: RoundTrip[]) {
  return trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
}

function hasPath(t: RoundTrip) {
  return t.pathQuality === 'daily_estimate' && !t.pathAnomaly && !t.splitSuspect
}

export type SampleSlice = 'floated' | 'pathNoFloat' | 'noPath'

export type SampleComposition = {
  nClosed: number
  floated: number
  pathNoFloat: number
  noPath: number
  floatedPct: number
  pathNoFloatPct: number
  noPathPct: number
}

export function sampleComposition(trips: RoundTrip[]): SampleComposition {
  const closed = closedOf(trips)
  const floated = closed.filter((t) => hasPath(t) && (t.mfeDollar ?? 0) > 0).length
  const pathNoFloat = closed.filter((t) => hasPath(t) && (t.mfeDollar ?? 0) <= 0).length
  const noPath = Math.max(0, closed.length - floated - pathNoFloat)
  const n = closed.length || 1
  return {
    nClosed: closed.length,
    floated,
    pathNoFloat,
    noPath,
    floatedPct: floated / n,
    pathNoFloatPct: pathNoFloat / n,
    noPathPct: noPath / n,
  }
}

export function tripsInSlice(trips: RoundTrip[], slice: SampleSlice): RoundTrip[] {
  const closed = closedOf(trips)
  if (slice === 'floated') return closed.filter((t) => hasPath(t) && (t.mfeDollar ?? 0) > 0)
  if (slice === 'pathNoFloat') return closed.filter((t) => hasPath(t) && (t.mfeDollar ?? 0) <= 0)
  return closed.filter((t) => !hasPath(t))
}

export function holdDays(t: RoundTrip) {
  return t.holdMinutes / 1440
}

export function holdScatterPoints(trips: RoundTrip[]) {
  return closedOf(trips)
    .filter((t) => t.holdMinutes > 0)
    .map((t) => ({
      id: t.id,
      x: holdDays(t),
      y: t.realizedPnl,
      up: t.realizedPnl >= 0,
      size: Math.max(4, Math.min(12, Math.sqrt(Math.max(t.openPrice * t.qty, 1)) / 18)),
      symbol: t.symbol,
      label: `${t.symbol} · ${t.realizedPnl >= 0 ? '+' : ''}${Math.round(t.realizedPnl)} · ${holdDays(t).toFixed(1)} 日`,
    }))
}

export function holdBandStats(trips: RoundTrip[]) {
  const closed = closedOf(trips)
  const bands = [
    { id: 'h1', label: '<1 日', list: closed.filter((t) => t.holdMinutes < 1440) },
    { id: 'h2', label: '1–4 日', list: closed.filter((t) => t.holdMinutes >= 1440 && t.holdMinutes < 5 * 1440) },
    { id: 'h3', label: '≥5 日', list: closed.filter((t) => t.holdMinutes >= 5 * 1440) },
  ]
  return bands.map((b) => ({
    id: b.id,
    label: b.label,
    n: b.list.length,
    pnl: b.list.reduce((s, t) => s + t.realizedPnl, 0),
  }))
}

export function givebackPoints(trips: RoundTrip[]) {
  return closedOf(trips)
    .filter((t) => hasPath(t) && (t.mfeDollar ?? 0) > 0)
    .map((t) => {
      const mfe = t.mfeDollar as number
      const dollar = mfe - t.realizedPnl
      const rate = Math.min(1, Math.max(0, dollar / mfe))
      return {
        id: t.id,
        x: mfe,
        y: rate,
        dollar,
        up: t.realizedPnl >= 0,
        label: `${t.symbol} · 回吐 ${(rate * 100).toFixed(0)}% · MFE ${Math.round(mfe)}`,
      }
    })
}

export function givebackConcentration(points: Array<{ id: string; dollar: number; y: number }>) {
  const sorted = [...points].sort((a, b) => b.dollar - a.dollar)
  const total = sorted.reduce((s, p) => s + Math.max(0, p.dollar), 0)
  const top = sorted.slice(0, 5)
  const topSum = top.reduce((s, p) => s + Math.max(0, p.dollar), 0)
  return {
    n: points.length,
    medianRate: points.length ? median(points.map((p) => p.y)) : null,
    highN: points.filter((p) => p.y >= 0.8).length,
    top5Share: total > 0 ? topSum / total : null,
    total,
    top5: top,
  }
}

/** Deterministic vertical jitter so stacked 100% rates remain countable. Hover still uses true y. */
export function jitterRate(id: string, y: number) {
  if (y < 0.92) return y
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const unit = ((Math.abs(h) % 19) - 9) / 9
  return Math.min(1.035, Math.max(0.905, y + unit * 0.04))
}

export type LadderStep = {
  id: string
  title: string
  detail: string
  state: 'done' | 'current' | 'todo' | 'verified'
}

export function evidenceLadder(opts: {
  hasHoldFinding: boolean
  replayPassed: boolean
  shadowN: number
  targetN: number
  verified: boolean
}): LadderStep[] {
  const shadowCurrent = !opts.verified && opts.hasHoldFinding
  return [
    {
      id: 'find',
      title: '发现问题',
      detail: opts.hasHoldFinding ? '持仓 ≥5 日亏损' : '尚未形成可实验发现',
      state: opts.hasHoldFinding ? 'done' : 'current',
    },
    {
      id: 'replay',
      title: '历史回放',
      detail: !opts.hasHoldFinding
        ? '尚未回放'
        : opts.replayPassed
          ? '已完成回放｜有规则通过 FDR'
          : '已完成回放｜未找到可上线规则',
      state: opts.hasHoldFinding ? 'done' : 'todo',
    },
    {
      id: 'shadow',
      title: '影子实验',
      detail: `当前 ${opts.shadowN}/${opts.targetN}`,
      state: opts.verified ? 'done' : shadowCurrent ? 'current' : 'todo',
    },
    {
      id: 'live',
      title: '已验证上线',
      detail: opts.verified ? '已通过验证' : '尚未达到',
      state: opts.verified ? 'verified' : 'todo',
    },
  ]
}

export function queueEvidenceLevel(row: HowQueueRow): { filled: number; note: string } {
  if (row.status === 'verified') return { filled: 4, note: '已验证上线' }
  if (row.status === 'running') return { filled: 2, note: '等待影子实验' }
  if (row.id === 'giveback') return { filled: 2, note: '数据部分覆盖' }
  if (row.id === 'hold-h3') return { filled: 2, note: '等待影子实验' }
  if (row.id === 'intraday') return { filled: 1, note: '候选假设' }
  if (row.status === 'rejected') return { filled: 2, note: '回放未通过' }
  return { filled: 1, note: '历史观察' }
}

export function queueImpact(row: HowQueueRow): { amount: number | null; kind: 'historical' | 'hatched' | 'verified' | 'unknown' } {
  if (row.status === 'verified' && row.recoverable != null) return { amount: row.recoverable, kind: 'verified' }
  if (row.id === 'hold-h3' && row.historical != null) return { amount: Math.abs(row.historical), kind: 'hatched' }
  if (row.recoverableKind === 'theoretical' && row.recoverable != null) return { amount: row.recoverable, kind: 'hatched' }
  if (row.historical != null) return { amount: Math.abs(row.historical), kind: 'historical' }
  return { amount: null, kind: 'unknown' }
}

export function experimentProgress(exp: ExperimentRecord | null) {
  if (!exp || !isDay4Shadow(exp.constraint)) return { n: 0, target: 20 }
  return { n: exp.lastEvaluation?.shadowN ?? 0, target: exp.targetN || 20 }
}

export type ShadowFunnel = {
  held: number
  priced: number
  closed: number
  paired: number
}

export function funnelOf(ev: ExperimentEvaluation | undefined): ShadowFunnel {
  return {
    held: ev?.funnel?.held ?? 0,
    priced: ev?.funnel?.priced ?? 0,
    closed: ev?.newN ?? 0,
    paired: ev?.shadowN ?? 0,
  }
}
