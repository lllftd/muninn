import { mean } from '../lib/stats.ts'
import {
  matchesConstraint,
  type ExperimentEvaluation,
  type ExperimentRecord,
  type ExperimentVerdict,
} from '../lib/experiments.ts'
import { DEFAULT_PRO_PREFS, type ProPrefs } from '../lib/proPrefs.ts'
import type { RoundTrip } from '../types.ts'

export function evaluateExperiment(
  exp: ExperimentRecord,
  closed: RoundTrip[],
  prefs: ProPrefs = DEFAULT_PRO_PREFS,
): ExperimentEvaluation {
  const newTrips = closed.filter((t) => t.status === 'closed' && !exp.claimedTripIds.includes(t.id))
  const match = newTrips.filter((t) => matchesConstraint(t, exp.constraint))
  const newN = newTrips.length
  const matchN = match.length
  const changedShare = newN ? matchN / newN : null
  const sample = exp.constraint.kind === 'observe' ? newTrips : match
  const n = sample.length

  if (n < prefs.minGroupN) {
    return {
      newN,
      matchN,
      changedShare,
      newExpectancy: n ? mean(sample.map((t) => t.realizedPnl)) : null,
      delta: null,
      verdict: 'insufficient',
      note: n === 0 ? '还没有新的闭环，谈不上改了没、好没好。' : `新样本 ${n} 笔，不够判断，结案记为样本不够。`,
    }
  }

  const newExpectancy = mean(sample.map((t) => t.realizedPnl))
  const delta = exp.baselineExpectancy == null ? null : newExpectancy - exp.baselineExpectancy
  let verdict: ExperimentVerdict = 'flat'
  if (delta == null) verdict = 'flat'
  else if (delta > Math.max(Math.abs(exp.baselineExpectancy ?? 0) * 0.05, 1)) verdict = 'improved'
  else if (delta < -Math.max(Math.abs(exp.baselineExpectancy ?? 0) * 0.05, 1)) verdict = 'worse'

  const changeText =
    changedShare == null
      ? '还没有新交易。'
      : exp.constraint.kind === 'observe'
        ? `新闭环 ${newN} 笔。`
        : `新闭环里符合约束 ${matchN}/${newN}（${Math.round(changedShare * 100)}%）。`

  const resultText =
    verdict === 'improved'
      ? `新样本单笔均值 ${newExpectancy.toFixed(0)}，高于认领时基线。`
      : verdict === 'worse'
        ? `新样本单笔均值 ${newExpectancy.toFixed(0)}，低于认领时基线。`
        : `新样本单笔均值 ${newExpectancy.toFixed(0)}，和基线差不多。`

  return {
    newN,
    matchN,
    changedShare,
    newExpectancy,
    delta,
    verdict,
    note: `${changeText}${resultText}`,
  }
}

export function withEvaluations(
  rows: ExperimentRecord[],
  closed: RoundTrip[],
  prefs: ProPrefs = DEFAULT_PRO_PREFS,
): ExperimentRecord[] {
  return rows.map((e) => ({ ...e, lastEvaluation: evaluateExperiment(e, closed, prefs) }))
}
