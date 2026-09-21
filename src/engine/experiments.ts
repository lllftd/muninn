import { ciFromSamples, mean } from '../lib/stats.ts'
import {
  matchesConstraint,
  type ExperimentEvaluation,
  type ExperimentRecord,
  type ExperimentVerdict,
} from '../lib/experiments.ts'
import { DEFAULT_PRO_PREFS, type ProPrefs } from '../lib/proPrefs.ts'
import { replayHold } from './space.ts'
import type { Bar, RoundTrip } from '../types.ts'

function emptyEval(over: Partial<ExperimentEvaluation>): ExperimentEvaluation {
  return {
    newN: 0,
    matchN: 0,
    eligibleN: 0,
    shadowN: 0,
    changedShare: null,
    newExpectancy: null,
    delta: null,
    verdict: 'insufficient',
    note: '',
    ...over,
  }
}

function evaluateShadow(
  exp: ExperimentRecord,
  closed: RoundTrip[],
  prefs: ProPrefs,
  bars: Record<string, Bar[]>,
): ExperimentEvaluation {
  const days = exp.constraint.kind === 'shadow-hold' ? exp.constraint.days : 4
  const newTrips = closed.filter((t) => t.status === 'closed' && !exp.claimedTripIds.includes(t.id))
  const newN = newTrips.length
  const pairs: Array<{ id: string; symbol: string; actual: number; shadow: number; eligible: boolean; triggered: boolean; held: boolean }> = []
  for (const t of newTrips) {
    const run = replayHold(t, bars[t.symbol], days)
    pairs.push({
      id: t.id,
      symbol: t.symbol,
      actual: t.realizedPnl,
      shadow: run.pnl,
      eligible: run.eligible,
      triggered: run.triggered,
      held: t.holdMinutes >= days * 1440,
    })
  }
  const eligible = pairs.filter((p) => p.triggered)
  const shadowN = eligible.length
  const deltas = eligible.map((p) => p.shadow - p.actual)
  const delta = deltas.length ? mean(deltas) : null
  const deltaCi = deltas.length >= 5 ? ciFromSamples(deltas, 0.1, 0.9) : null
  const newExpectancy = eligible.length ? mean(eligible.map((p) => p.shadow)) : null
  const winRate = (xs: number[]) => (xs.length ? xs.filter((v) => v > 0).length / xs.length : null)
  const avgWin = (xs: number[]) => {
    const w = xs.filter((v) => v > 0)
    return w.length ? mean(w) : null
  }
  const maxLoss = (xs: number[]) => {
    const l = xs.filter((v) => v < 0)
    return l.length ? Math.min(...l) : null
  }
  const truncs = eligible.filter((p) => p.actual > 0).map((p) => Math.max(0, p.actual - p.shadow))
  const winTruncation = truncs.length ? truncs.reduce((s, v) => s + v, 0) : null
  const guards = {
    winRateActual: winRate(eligible.map((p) => p.actual)),
    winRateShadow: winRate(eligible.map((p) => p.shadow)),
    avgWinActual: avgWin(eligible.map((p) => p.actual)),
    avgWinShadow: avgWin(eligible.map((p) => p.shadow)),
    maxLossActual: maxLoss(eligible.map((p) => p.actual)),
    maxLossShadow: maxLoss(eligible.map((p) => p.shadow)),
    winTruncation,
  }
  const pairOut = eligible.map((p) => ({ id: p.id, symbol: p.symbol, actual: p.actual, shadow: p.shadow }))
  const funnel = { held: pairs.filter((p) => p.held).length, priced: pairs.filter((p) => p.triggered).length }

  if (shadowN < prefs.minGroupN) {
    return emptyEval({
      newN,
      matchN: newN,
      eligibleN: shadowN,
      shadowN,
      changedShare: newN ? shadowN / newN : null,
      newExpectancy,
      delta,
      deltaCi,
      pairs: pairOut,
      funnel,
      verdict: 'insufficient',
      note:
        newN === 0
          ? '等待首笔符合条件的交易。'
          : shadowN === 0
            ? `新闭环 ${newN} 笔，但还没有可计算日线路径的影子对照。`
            : `已完成影子对照 ${shadowN} 笔，不够判断。`,
      guards,
    })
  }

  let verdict: ExperimentVerdict = 'flat'
  if (delta == null) verdict = 'flat'
  else if (delta > 1) verdict = 'improved'
  else if (delta < -1) verdict = 'worse'

  const resultText =
    verdict === 'improved'
      ? `影子相对实际单笔均差 ${delta!.toFixed(0)}，方向为正。`
      : verdict === 'worse'
        ? `影子相对实际单笔均差 ${delta!.toFixed(0)}，方向为负。`
        : `影子相对实际单笔均差 ${delta == null ? '—' : delta.toFixed(0)}，接近持平。`

  return emptyEval({
    newN,
    matchN: newN,
    eligibleN: shadowN,
    shadowN,
    changedShare: newN ? shadowN / newN : null,
    newExpectancy,
    delta,
    deltaCi,
    pairs: pairOut,
    funnel,
    verdict,
    note: `新闭环 ${newN} 笔，完成影子对照 ${shadowN} 笔。${resultText}`,
    guards,
  })
}

export function evaluateExperiment(
  exp: ExperimentRecord,
  closed: RoundTrip[],
  prefs: ProPrefs = DEFAULT_PRO_PREFS,
  bars: Record<string, Bar[]> = {},
): ExperimentEvaluation {
  if (exp.constraint.kind === 'shadow-hold') return evaluateShadow(exp, closed, prefs, bars)

  const newTrips = closed.filter((t) => t.status === 'closed' && !exp.claimedTripIds.includes(t.id))
  const match = newTrips.filter((t) => matchesConstraint(t, exp.constraint))
  const newN = newTrips.length
  const matchN = match.length
  const changedShare = newN ? matchN / newN : null
  const sample = exp.constraint.kind === 'observe' ? newTrips : match
  const n = sample.length

  if (n < prefs.minGroupN) {
    return emptyEval({
      newN,
      matchN,
      eligibleN: n,
      shadowN: 0,
      changedShare,
      newExpectancy: n ? mean(sample.map((t) => t.realizedPnl)) : null,
      delta: null,
      verdict: 'insufficient',
      note: n === 0 ? '等待首笔符合条件的交易。' : `新样本 ${n} 笔，不够判断，结案记为样本不够。`,
    })
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

  return emptyEval({
    newN,
    matchN,
    eligibleN: n,
    shadowN: 0,
    changedShare,
    newExpectancy,
    delta,
    verdict,
    note: `${changeText}${resultText}`,
  })
}

export function withEvaluations(
  rows: ExperimentRecord[],
  closed: RoundTrip[],
  prefs: ProPrefs = DEFAULT_PRO_PREFS,
  bars: Record<string, Bar[]> = {},
): ExperimentRecord[] {
  return rows.map((e) => ({ ...e, lastEvaluation: evaluateExperiment(e, closed, prefs, bars) }))
}
