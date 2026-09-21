import type { RoundTrip } from '../types.ts'
import { holdBucketOf, weekdayEt } from '../engine/checkup.ts'
import type { Regime } from '../types.ts'

export type ExperimentConstraint =
  | { kind: 'observe' }
  | { kind: 'side'; side: 'long' | 'short' }
  | { kind: 'avoid-weekday'; weekdayId: string }
  | { kind: 'regime'; regime: Regime }
  | { kind: 'avoid-regime'; regime: Regime }
  | { kind: 'hold'; bucket: 'h1' | 'h2' | 'h3' }

export type ExperimentVerdict = 'improved' | 'worse' | 'flat' | 'insufficient'

export type ExperimentEvaluation = {
  newN: number
  matchN: number
  changedShare: number | null
  newExpectancy: number | null
  delta: number | null
  verdict: ExperimentVerdict
  note: string
}

export type ExperimentRecord = {
  id: string
  createdAt: string
  diagnosisId: string
  hypothesis: string
  constraint: ExperimentConstraint
  targetN: number
  baselineN: number
  baselineExpectancy: number | null
  claimedTripIds: string[]
  accountKey: string
  status: 'active' | 'archived'
  closedAt?: string
  lastEvaluation?: ExperimentEvaluation
}

const KEY = 'muninn.experiments.v1'

function readAll(): ExperimentRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ExperimentRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(rows: ExperimentRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
  } catch {
    /* ignore */
  }
}

export function accountKeyOf(accountName: string) {
  return accountName.trim() || 'default'
}

export function loadExperiments(accountName: string): ExperimentRecord[] {
  const key = accountKeyOf(accountName)
  return readAll().filter((e) => e.accountKey === key)
}

export function upsertExperiment(row: ExperimentRecord) {
  const all = readAll()
  const i = all.findIndex((e) => e.id === row.id)
  if (i >= 0) all[i] = row
  else all.unshift(row)
  writeAll(all)
}

export function archiveExperiment(id: string) {
  const all = readAll()
  const i = all.findIndex((e) => e.id === id)
  if (i < 0) return
  all[i] = { ...all[i], status: 'archived', closedAt: new Date().toISOString() }
  writeAll(all)
}

export function matchesConstraint(trip: RoundTrip, c: ExperimentConstraint): boolean {
  if (c.kind === 'observe') return true
  if (c.kind === 'side') return trip.side === c.side
  if (c.kind === 'avoid-weekday') return `wd${weekdayEt(trip.openTime)}` !== c.weekdayId
  if (c.kind === 'regime') return trip.regime === c.regime
  if (c.kind === 'avoid-regime') return trip.regime !== c.regime
  if (c.kind === 'hold') return holdBucketOf(trip.holdMinutes) === c.bucket
  return true
}

export function constraintLabel(c: ExperimentConstraint): string {
  if (c.kind === 'observe') return '不额外约束，只积累新样本'
  if (c.kind === 'side') return c.side === 'long' ? '只做多头' : '只做空头'
  if (c.kind === 'avoid-weekday') {
    const names = ['日', '一', '二', '三', '四', '五', '六']
    const d = Number(c.weekdayId.replace('wd', ''))
    return `避开周${names[d] ?? c.weekdayId}`
  }
  if (c.kind === 'regime') return `只做${c.regime}`
  if (c.kind === 'avoid-regime') return `避开${c.regime}`
  if (c.kind === 'hold') return c.bucket === 'h1' ? '偏向日内平仓' : c.bucket === 'h2' ? '偏向 1–5 日' : '偏向 ≥5 日'
  return ''
}
