import { etDateKey } from '../lib/time.ts'
import { kurtosis, mean, mulberry32, normalCdf, quantile, skewness } from '../lib/stats.ts'
import { REGIME_LABELS, REGIME_ORDER } from './regime.ts'
import type { MonteCarlo, RegimeCum, RoundTrip, RunsTest } from '../types.ts'

const MC_SEED = 20260920
const MC_ROUNDS = 2000

/** 单笔已实现盈亏的分布形状。偏度/峰度看"钱靠什么赚的",VaR/CVaR 看尾部。样本<20 给 null。 */
export function distributionShape(pnls: number[]): {
  n: number
  skew: number | null
  kurtosis: number | null
  var95: number | null
  cvar95: number | null
} {
  const n = pnls.length
  if (n < 20) return { n, skew: null, kurtosis: null, var95: null, cvar95: null }
  const var95 = quantile(pnls, 0.05)
  const tail = var95 == null ? [] : pnls.filter((v) => v <= var95)
  return {
    n,
    skew: skewness(pnls),
    kurtosis: kurtosis(pnls),
    var95,
    cvar95: tail.length ? mean(tail) : var95,
  }
}

/** Wald–Wolfowitz 游程检验:盈亏是随机交替,还是成串(热手/tilt)。需要正负样本各≥1、总数≥20。 */
export function runsTest(results: boolean[]): RunsTest {
  const n = results.length
  const wins = results.filter(Boolean).length
  const losses = n - wins
  let runs = 0
  for (let i = 0; i < n; i++) if (i === 0 || results[i] !== results[i - 1]) runs += 1
  if (n < 20 || wins === 0 || losses === 0) {
    return {
      n,
      wins,
      runs,
      expected: 0,
      z: null,
      pValue: null,
      note: n < 20 ? '样本不足 20 笔,不做游程检验。' : '全胜或全负,游程检验不适用。',
    }
  }
  const expected = 1 + (2 * wins * losses) / n
  const variance = (2 * wins * losses * (2 * wins * losses - n)) / (n * n * (n - 1))
  const z = variance > 0 ? (runs - expected) / Math.sqrt(variance) : null
  const pValue = z == null ? null : 2 * (1 - normalCdf(Math.abs(z)))
  let note: string
  if (z == null || pValue == null || pValue > 0.05) {
    note = `游程 ${runs} 次(期望 ${expected.toFixed(1)}),与"随机"无显著差异——盈亏顺序看不出规律。`
  } else if (z < 0) {
    note = `游程偏少(${runs} vs 期望 ${expected.toFixed(1)},p=${pValue.toFixed(3)}):盈亏成串,可能有热手/tilt。`
  } else {
    note = `游程偏多(${runs} vs 期望 ${expected.toFixed(1)},p=${pValue.toFixed(3)}):盈亏过度交替,少见。`
  }
  return { n, wins, runs, expected, z, pValue, note }
}

function maxDrawdown(cumulative: number[]): number {
  let peak = 0
  let mdd = 0
  for (const v of cumulative) {
    if (v > peak) peak = v
    const dd = peak - v
    if (dd > mdd) mdd = dd
  }
  return mdd
}

/**
 * 蒙特卡洛:按开仓日 cluster **有放回**抽样 N 次。终值会变,因为大赢可被重复抽到。
 * 这不是打乱顺序——打乱顺序总盈亏不变。
 */
export function monteCarlo(clusters: number[][], realizedSequence: number[], seed = MC_SEED, rounds = MC_ROUNDS): MonteCarlo | null {
  const n = realizedSequence.length
  if (n < 30 || clusters.length < 2) return null
  const rng = mulberry32(seed)
  const steps = n
  const stepVals: number[][] = Array.from({ length: steps }, () => [])
  const terminals: number[] = []
  const maxDDs: number[] = []
  let lostMoney = 0

  for (let r = 0; r < rounds; r++) {
    const seq: number[] = []
    while (seq.length < n) seq.push(...clusters[Math.floor(rng() * clusters.length)])
    seq.length = n // 末段 cluster 截断,偏差可忽略
    let cum = 0
    let peak = 0
    let mdd = 0
    for (let k = 0; k < n; k++) {
      cum += seq[k]
      stepVals[k].push(cum)
      if (cum > peak) peak = cum
      const dd = peak - cum
      if (dd > mdd) mdd = dd
    }
    terminals.push(cum)
    maxDDs.push(mdd)
    if (cum <= 0) lostMoney += 1
  }

  const band = (q: number) => stepVals.map((col) => quantile(col, q) as number)
  const realizedTerminal = realizedSequence.reduce((s, v) => s + v, 0)
  const realizedCum: number[] = []
  realizedSequence.reduce((s, v) => {
    const next = s + v
    realizedCum.push(next)
    return next
  }, 0)
  const realizedMaxDD = maxDrawdown(realizedCum)
  const share = (arr: number[], pred: (v: number) => boolean) => arr.filter(pred).length / arr.length

  const ddProb = [1, 1.5, 2]
    .map((m) => ({ dd: realizedMaxDD * m, prob: share(maxDDs, (v) => v >= realizedMaxDD * m) }))
    .filter((row) => row.dd > 0)

  const pLose = lostMoney / rounds

  return {
    method: 'cluster-bootstrap',
    nTrades: n,
    rounds,
    steps,
    bands: { p5: band(0.05), p25: band(0.25), p50: band(0.5), p75: band(0.75), p95: band(0.95) },
    realizedPath: realizedCum,
    terminals,
    realizedTerminal,
    terminalPctile: share(terminals, (v) => v <= realizedTerminal),
    maxDDs,
    realizedMaxDD,
    maxDDPctile: share(maxDDs, (v) => v <= realizedMaxDD),
    ddProb,
    note: `方法是按开仓日有放回抽样（cluster bootstrap），不是打乱这 ${n} 笔的顺序。从历史开仓日里有放回抽取，凑满 ${n} 笔，重复 ${rounds} 次（seed ${seed}）。同一笔大赢可能被抽到多次，所以最终盈亏会变；若只改顺序，总盈亏不变、只会改回撤路径。抽样里亏损收场占 ${(pLose * 100).toFixed(0)}%。回撤是交易序列回撤（按抽取顺序累加已实现），不是账户净值回撤。`,
  }
}

/** 各 regime 按平仓时间的累计已实现盈亏,共享一条事件时间轴(每个已平仓单元一步)。 */
export function regimeCumulative(trips: RoundTrip[]): RegimeCum {
  const closed = trips
    .filter((t) => t.status === 'closed' && t.closeTime)
    .sort((a, b) => (a.closeTime as Date).getTime() - (b.closeTime as Date).getTime())
  const dates = closed.map((t) => etDateKey(t.closeTime as Date))
  const present = REGIME_ORDER.filter((rg) => closed.some((t) => t.regime === rg))
  const series = present.map((regime) => {
    let cum = 0
    const values = closed.map((t) => {
      if (t.regime === regime) cum += t.realizedPnl
      return cum
    })
    return { regime, label: REGIME_LABELS[regime], values }
  })
  return { dates, series }
}
