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
  | { kind: 'shadow-hold'; days: number }

export type ExperimentVerdict = 'improved' | 'worse' | 'flat' | 'insufficient'

export const DAY4_SHADOW_DAYS = 4
export const DAY4_SHADOW_TITLE = '第 4 个交易日收盘退出｜影子实验'
export const DAY4_SHADOW_RULE =
  '对持仓至第 4 个交易日收盘仍未平仓的交易，记录按当日收盘价模拟退出的结果；真实交易继续按原方式管理，不实际改变仓位。'
export const DAY4_SHADOW_HYPOTHESIS =
  '对持仓至第 4 个交易日收盘仍未平仓的新开仓，记录按当日收盘价模拟退出的结果；真实交易不改变仓位。主指标为模拟退出盈亏减实际最终盈亏。'
export const MISALIGNED_CLOSE_REASON = '假设与历史发现不一致，未产生有效样本。'

export type ExperimentEvaluation = {
  newN: number
  matchN: number
  eligibleN: number
  shadowN: number
  changedShare: number | null
  newExpectancy: number | null
  delta: number | null
  verdict: ExperimentVerdict
  note: string
  pairs?: Array<{ id: string; symbol: string; actual: number; shadow: number }>
  funnel?: { held: number; priced: number }
  deltaCi?: { lo: number; hi: number } | null
  guards?: {
    winRateActual: number | null
    winRateShadow: number | null
    avgWinActual: number | null
    avgWinShadow: number | null
    maxLossActual: number | null
    maxLossShadow: number | null
    winTruncation: number | null
  }
}

/** 开始实验前由用户预先记录、用于第 4 日判断是否入组的条件（不能事后解释）。 */
export type EligibilityRecord = {
  tradeType: string
  planHold: string
  entryLogic: string
  invalidation: string
  extendException: string
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
  closeReason?: string
  closeKind?: 'cancel' | 'early' | 'complete'
  lastEvaluation?: ExperimentEvaluation
  /** 第 4 日退出实验的事先入组条件；仅当用户开始实验前填写后才存在。 */
  eligibility?: EligibilityRecord
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

export function archiveExperiment(id: string, opts?: { reason?: string; kind?: 'cancel' | 'early' | 'complete' }) {
  const all = readAll()
  const i = all.findIndex((e) => e.id === id)
  if (i < 0) return
  all[i] = {
    ...all[i],
    status: 'archived',
    closedAt: new Date().toISOString(),
    closeReason: opts?.reason,
    closeKind: opts?.kind ?? (opts?.reason ? 'early' : 'complete'),
  }
  writeAll(all)
}

export function matchesConstraint(trip: RoundTrip, c: ExperimentConstraint): boolean {
  if (c.kind === 'observe') return true
  if (c.kind === 'side') return trip.side === c.side
  if (c.kind === 'avoid-weekday') return `wd${weekdayEt(trip.openTime)}` !== c.weekdayId
  if (c.kind === 'regime') return trip.regime === c.regime
  if (c.kind === 'avoid-regime') return trip.regime !== c.regime
  if (c.kind === 'hold') return holdBucketOf(trip.holdMinutes) === c.bucket
  if (c.kind === 'shadow-hold') return true
  return true
}

export function isIntradayHoldExperiment(c: ExperimentConstraint): boolean {
  return c.kind === 'hold' && c.bucket === 'h1'
}

export function isDay4Shadow(c: ExperimentConstraint): boolean {
  return c.kind === 'shadow-hold' && c.days === DAY4_SHADOW_DAYS
}

export function isMisalignedHoldExperiment(c: ExperimentConstraint): boolean {
  if (c.kind === 'hold') return true
  if (c.kind === 'shadow-hold' && c.days !== DAY4_SHADOW_DAYS) return true
  return false
}

export function realignToDay4Shadow(old: ExperimentRecord, diagnosisId?: string): ExperimentRecord {
  archiveExperiment(old.id, { kind: 'cancel', reason: MISALIGNED_CLOSE_REASON })
  const next: ExperimentRecord = {
    id: `${diagnosisId ?? old.diagnosisId}-d4-${Date.now()}`,
    createdAt: new Date().toISOString(),
    diagnosisId: diagnosisId ?? old.diagnosisId,
    hypothesis: DAY4_SHADOW_HYPOTHESIS,
    constraint: { kind: 'shadow-hold', days: DAY4_SHADOW_DAYS },
    targetN: old.targetN || 20,
    baselineN: old.baselineN,
    baselineExpectancy: 0,
    claimedTripIds: old.claimedTripIds,
    accountKey: old.accountKey,
    status: 'active',
  }
  upsertExperiment(next)
  return next
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
  if (c.kind === 'shadow-hold') {
    return c.days === DAY4_SHADOW_DAYS
      ? DAY4_SHADOW_TITLE
      : `第 ${c.days} 个交易日收盘影子退出（不改真实交易）`
  }
  return ''
}
