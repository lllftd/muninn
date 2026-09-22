import { etDateKey } from '../lib/time.ts'
import { ciFromSamples, clusterBootstrapSamples, cvar, mean, normalCdf } from '../lib/stats.ts'
import type {
  Bar,
  CounterfactualAction,
  CounterfactualReport,
  Regime,
  RegimeBayes,
  ReplayRule,
  RoundTrip,
  SpaceReport,
  SurvivalReport,
} from '../types.ts'

const CF_ROUNDS = 500

function usable(t: RoundTrip) {
  return (
    t.status === 'closed' &&
    !t.tags.includes('DRIP') &&
    t.pathQuality === 'daily_estimate' &&
    !t.pathAnomaly &&
    !t.splitSuspect
  )
}

function clustersOf(trips: RoundTrip[]): RoundTrip[][] {
  const map = new Map<string, RoundTrip[]>()
  for (const t of trips) {
    const k = etDateKey(t.openTime)
    const arr = map.get(k) || []
    arr.push(t)
    map.set(k, arr)
  }
  return [...map.values()]
}

function windowBars(bars: Bar[] | undefined, start: string, end: string): Bar[] {
  return (bars || []).filter((b) => b.date >= start && b.date <= end)
}

function dirOf(t: RoundTrip) {
  return t.side === 'long' ? 1 : -1
}

function pxPnl(t: RoundTrip, exitPx: number) {
  return (exitPx - t.openPrice) * t.qty * dirOf(t) - t.fees
}

/** 把「交易 id → 反事实 pnl」聚合成一条动作的评估结果。 */
function profileOf(
  path: RoundTrip[],
  cfById: Map<string, number>,
  seed: number,
  name: string,
  kind: CounterfactualAction['kind'],
  note: string,
): CounterfactualAction {
  const clusters = clustersOf(path)
  let delta = 0
  const losses: number[] = []
  let n = 0
  let triggered = 0
  for (const t of path) {
    const cf = cfById.get(t.id)
    if (cf == null) continue
    const d = cf - t.realizedPnl
    delta += d
    if (Math.abs(d) > 1e-9) triggered += 1
    losses.push(-cf)
    n += 1
  }
  const samples =
    n >= 5
      ? clusterBootstrapSamples(
          clusters,
          (items) => {
            if (!items.length) return null
            let act = 0
            let cf = 0
            for (const t of items) {
              const v = cfById.get(t.id)
              if (v == null) continue
              act += t.realizedPnl
              cf += v
            }
            return cf - act
          },
          seed,
          CF_ROUNDS,
        )
      : []
  const ci = ciFromSamples(samples, 0.1, 0.9)
  const noTrigger = triggered === 0
  return {
    id: name,
    name,
    delta: noTrigger ? 0 : delta,
    cvar95: noTrigger ? null : cvar(losses),
    improveProb: noTrigger ? null : samples.length ? samples.filter((s) => s > 0).length / samples.length : null,
    ciLo: noTrigger ? null : ci?.lo ?? null,
    ciHi: noTrigger ? null : ci?.hi ?? null,
    n,
    triggered,
    kind,
    note: noTrigger ? `${note}（未触发）` : note,
  }
}

/** 单笔风险预算：把单笔亏损超过 capR 倍 R 的交易，按 capR 截断（缩小该笔的亏损）。 */
export function riskBudgetCf(path: RoundTrip[], capR: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of path) {
    let cf = t.realizedPnl
    if (t.riskDollars && t.riskDollars > 0) {
      const r = t.realizedPnl / t.riskDollars
      if (r < -capR) cf = -capR * t.riskDollars
    }
    m.set(t.id, cf)
  }
  return m
}

/** EWMA 日收益波动率（截至 endDate 的历史窗口）。 */
function ewmaDailyVol(bars: Bar[], endDate: string, lambda: number): number | null {
  const closes = bars.filter((b) => b.date <= endDate).map((b) => b.close).filter((c) => c > 0)
  if (closes.length < 3) return null
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1)
  if (!rets.length) return null
  let v = rets[0] * rets[0]
  for (let i = 1; i < rets.length; i++) v = lambda * v + (1 - lambda) * rets[i] * rets[i]
  return Math.sqrt(v)
}

/** 波动率目标仓位：按 EWMA 波动率缩放仓位，高波动降仓、低波动升仓（夹在 0.5×～1.5×）。 */
export function volTargetCf(
  path: RoundTrip[],
  bars: Record<string, Bar[]>,
  targetAnn: number,
  lambda: number,
): Map<string, number> {
  const m = new Map<string, number>()
  const targetDaily = targetAnn / Math.sqrt(252)
  for (const t of path) {
    let cf = t.realizedPnl
    const vol = ewmaDailyVol(bars[t.symbol] || [], etDateKey(t.openTime), lambda)
    if (vol && vol > 0) {
      const scale = Math.min(1.5, Math.max(0.5, targetDaily / vol))
      cf = t.realizedPnl * scale
    }
    m.set(t.id, cf)
  }
  return m
}

/** 条件退出：第 day 日收盘若浮亏则退出，否则保留原实现。区别于无条件按天数退出。 */
export function conditionalExitCf(path: RoundTrip[], bars: Record<string, Bar[]>, day: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of path) {
    let cf = t.realizedPnl
    if (usable(t) && t.openPrice > 0 && t.qty > 0 && t.closeTime) {
      const window = windowBars(bars[t.symbol], etDateKey(t.openTime), etDateKey(t.closeTime))
      if (window.length > day) {
        const exitPx = window[day - 1].close
        const underwater = dirOf(t) === 1 ? exitPx < t.openPrice : exitPx > t.openPrice
        if (underwater) cf = pxPnl(t, exitPx)
      }
    }
    m.set(t.id, cf)
  }
  return m
}

const REGIME_LABEL: Record<Regime, string> = { intraday: '日内', swing: '短线', position: '波段', investor: '长线' }

function holdDays(t: RoundTrip): number {
  return t.holdMinutes / 1440
}

/** 持仓窗口的日线 bars（开仓日之后、平仓日之前）。 */
function dailyBarsOf(t: RoundTrip, bars: Record<string, Bar[]>): Bar[] {
  if (!usable(t) || t.openPrice <= 0 || t.qty <= 0 || !t.closeTime) return []
  return windowBars(bars[t.symbol], etDateKey(t.openTime), etDateKey(t.closeTime))
}

/** 持仓时长的 q 分位（天）。样本不足返回 null。 */
function holdQuantile(path: RoundTrip[], q: number): number | null {
  const days = path.filter((t) => t.holdMinutes > 0).map(holdDays)
  if (days.length < 5) return null
  const a = [...days].sort((x, y) => x - y)
  return a[Math.floor((a.length - 1) * q)]
}

/** 逐笔留一法阈值：每笔交易的「超期」阈值用其它交易的持仓时长 q 分位，避免用自身最终持仓时间算自己的阈值。 */
export function looHoldThreshold(path: RoundTrip[], q: number): Map<string, number | null> {
  const m = new Map<string, number | null>()
  const days = path.map(holdDays)
  for (let i = 0; i < path.length; i++) {
    const others = days.filter((_, j) => j !== i).filter((d) => d > 0)
    if (others.length < 5) {
      m.set(path[i].id, null)
      continue
    }
    const a = [...others].sort((x, y) => x - y)
    m.set(path[i].id, a[Math.floor((a.length - 1) * q)])
  }
  return m
}

/** 条件化减仓/退出：超期且浮亏后，在下一交易日开盘减仓 exitFraction；剩余 (1-exitFraction) 继续按实际持有。 */
export function conditionalDeRiskCf(
  path: RoundTrip[],
  bars: Record<string, Bar[]>,
  thresholdDays: Map<string, number | null>,
  exitFraction: number,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of path) {
    let cf = t.realizedPnl
    const thr = thresholdDays.get(t.id)
    const window = thr == null || !(thr > 0) ? [] : dailyBarsOf(t, bars)
    for (let d = 0; d < window.length; d++) {
      if (d + 1 >= thr! && pxPnl(t, window[d].close) < 0) {
        // 第 d 日收盘确认触发 → 第 d+1 日开盘执行，避免同日收盘成交的前视偏差。
        const execPx = d + 1 < window.length ? window[d + 1].open : window[d].close
        const exitPnl = pxPnl(t, execPx)
        cf = exitFraction * exitPnl + (1 - exitFraction) * t.realizedPnl
        break
      }
    }
    m.set(t.id, cf)
  }
  return m
}

/** 生存/竞争风险：在「超期且浮亏」状态下，统计后续恢复、恶化与删失。与条件化减仓用同一触发逻辑（下一日开盘执行）。 */
export function survivalStats(
  path: RoundTrip[],
  bars: Record<string, Bar[]>,
  thresholdDays: Map<string, number | null>,
): { eligible: number; underwaterLong: number; recovered: number; deteriorated: number; censored: number } {
  let eligible = 0
  let underwaterLong = 0
  let recovered = 0
  let deteriorated = 0
  let censored = 0
  for (const t of path) {
    const window = dailyBarsOf(t, bars)
    if (!window.length) continue
    eligible += 1
    const thr = thresholdDays.get(t.id)
    if (thr == null || !(thr > 0)) continue
    let triggerIdx = -1
    for (let d = 0; d < window.length; d++) {
      if (d + 1 >= thr && pxPnl(t, window[d].close) < 0) {
        triggerIdx = d
        break
      }
    }
    if (triggerIdx < 0) continue
    underwaterLong += 1
    const triggerPnl = pxPnl(t, window[triggerIdx].close)
    const riskUnit = t.riskDollars ?? 0
    let rec = false
    let det = false
    for (let d = triggerIdx + 1; d < window.length; d++) {
      const p = pxPnl(t, window[d].close)
      if (p >= 0) {
        rec = true
        break
      }
      if (riskUnit > 0 && p < triggerPnl - riskUnit) {
        det = true
        break
      }
    }
    if (rec) recovered += 1
    else if (det) deteriorated += 1
    else censored += 1
  }
  return { eligible, underwaterLong, recovered, deteriorated, censored }
}

/** 分策略贝叶斯收缩：把小样本策略的规则改善均值向全局收缩，输出 P(真实改善 > 0)。 */
export function bayesianByRegime(path: RoundTrip[], deltas: Map<string, number>): RegimeBayes[] {
  const groups = new Map<Regime, number[]>()
  for (const t of path) {
    const d = deltas.get(t.id)
    if (d == null) continue
    const arr = groups.get(t.regime) || []
    arr.push(d)
    groups.set(t.regime, arr)
  }
  const all = [...groups.values()].flat()
  if (all.length < 5) return []
  const globalMean = mean(all)
  const rows = [...groups.entries()]
    .map(([regime, xs]) => ({ regime, n: xs.length, ybar: mean(xs) }))
    .filter((g) => g.n >= 1)

  let ss = 0
  let df = 0
  for (const xs of groups.values()) {
    if (xs.length < 2) continue
    const gm = mean(xs)
    for (const x of xs) {
      ss += (x - gm) * (x - gm)
      df += 1
    }
  }
  const sigma2 = df > 0 ? ss / df : 0
  const nAvg = rows.length ? mean(rows.map((g) => g.n)) : 0
  const between =
    rows.length > 1 ? rows.reduce((s, g) => s + (g.ybar - globalMean) * (g.ybar - globalMean), 0) / (rows.length - 1) : 0
  const tau2 = Math.max(0, between - sigma2 / Math.max(1, nAvg))

  return rows.map((g) => {
    let posteriorMean = g.ybar
    let posteriorVar = sigma2 > 0 ? sigma2 / g.n : 0
    if (tau2 > 0 && sigma2 > 0) {
      posteriorMean = (g.n * g.ybar / sigma2 + globalMean / tau2) / (g.n / sigma2 + 1 / tau2)
      posteriorVar = 1 / (g.n / sigma2 + 1 / tau2)
    }
    const prob = posteriorVar > 0 ? normalCdf(posteriorMean / Math.sqrt(posteriorVar)) : null
    const sd = posteriorVar > 0 ? Math.sqrt(posteriorVar) : null
    const z80 = 1.2815515655446004
    return {
      regime: g.regime,
      label: REGIME_LABEL[g.regime] ?? g.regime,
      n: g.n,
      meanDelta: posteriorMean,
      probImprove: prob,
      ciLo: sd == null ? null : posteriorMean - z80 * sd,
      ciHi: sd == null ? null : posteriorMean + z80 * sd,
    }
  })
}

export function buildCounterfactual(trips: RoundTrip[], bars: Record<string, Bar[]>): CounterfactualReport {
  const path = trips.filter(usable)
  const actualLosses = path.map((t) => -t.realizedPnl)

  const actions: CounterfactualAction[] = []
  for (const capR of [1, 2, 3]) {
    actions.push(
      profileOf(
        path,
        riskBudgetCf(path, capR),
        1000 + capR,
        `风险预算 ≤${capR}R`,
        'upper-bound',
        `理论上限：仅截断超过 ${capR}R 的亏损、不缩盈利，故改善恒为正；不是可执行回放。`,
      ),
    )
  }
  actions.push(
    profileOf(
      path,
      volTargetCf(path, bars, 0.15, 0.94),
      2000,
      '波动率目标 15%',
      'proxy',
      '代理估计：按 EWMA 波动率缩放仓位（0.5×～1.5×），未含换手成本。',
    ),
  )
  const condCf = conditionalExitCf(path, bars, 5)
  actions.push(
    profileOf(path, condCf, 3000, '第 5 日仅浮亏退出', 'replay', '第 5 日收盘若浮亏则退出，否则继续持有。'),
  )

  const hold80 = holdQuantile(path, 0.8)
  const looThr = looHoldThreshold(path, 0.8)
  if (hold80 != null) {
    const deRisk: Array<{ frac: number; name: string }> = [
      { frac: 0.25, name: '条件化减仓 25%（超期浮亏）' },
      { frac: 0.5, name: '条件化减仓 50%（超期浮亏）' },
      { frac: 0.75, name: '条件化减仓 75%（超期浮亏）' },
      { frac: 1, name: '条件化全部退出（超期浮亏）' },
    ]
    deRisk.forEach((d, k) => {
      actions.push(
        profileOf(
          path,
          conditionalDeRiskCf(path, bars, looThr, d.frac),
          4000 + k,
          d.name,
          'replay',
          `超期且浮亏后下一交易日开盘减仓 ${Math.round(d.frac * 100)}%；阈值逐笔留一法计算（非样本内）。`,
        ),
      )
    })
  }

  const deltas = new Map<string, number>()
  for (const t of path) {
    const cf = condCf.get(t.id)
    if (cf != null) deltas.set(t.id, cf - t.realizedPnl)
  }

  const surv = survivalStats(path, bars, looThr)
  const survival: SurvivalReport = {
    hold80,
    eligible: surv.eligible,
    underwaterLong: surv.underwaterLong,
    recovered: surv.recovered,
    deteriorated: surv.deteriorated,
    censored: surv.censored,
    recoverProb: surv.underwaterLong ? surv.recovered / surv.underwaterLong : null,
    deteriorateProb: surv.underwaterLong ? surv.deteriorated / surv.underwaterLong : null,
    note: `以持仓时长 80% 分位（${hold80 == null ? '—' : Math.round(hold80)} 日，逐笔留一法）为阈值，统计「超期且仍浮亏」交易的恢复/恶化/删失。`,
  }

  return {
    actions,
    actualCvar95: cvar(actualLosses),
    byRegime: bayesianByRegime(path, deltas),
    survival,
  }
}

/** 统一「动作对比」行，供表格与页首摘要共用。 */
export type ActionEval = {
  id: string
  name: string
  delta: number
  /** 尾部风险改善 = 实际尾部损失 − 动作尾部损失（正 = 尾部风险降低）。null = 样本不足。 */
  riskReduction: number | null
  improveProb: number | null
  /** Bootstrap 80% 区间（总改善金额）。 */
  ciLo: number | null
  ciHi: number | null
  /** 受影响交易数。 */
  n: number
  /** 实际触发动作的交易数（cf != 实际）。0 表示未触发。 */
  triggered: number
  sample: string
  basis: string
  kind: 'replay' | 'upper-bound' | 'proxy' | 'stop'
  verdict: string
  tone: 'neg' | 'pos' | 'ok' | 'na'
}

export function evaluateActions(space: SpaceReport): ActionEval[] {
  const rows: ActionEval[] = []
  const nClosed = space.giveback.nClosed
  const nPath = space.giveback.nPath
  const actual = space.ruleReplay.actualCvar95 ?? space.counterfactual.actualCvar95
  const riskReduction = (cvar95: number | null) => (cvar95 == null || actual == null ? null : actual - cvar95)

  const pushRule = (r: ReplayRule | undefined, name: string, basis: string) => {
    if (!r) return
    const comp = r.computable
    const delta = comp ? r.delta : 0
    rows.push({
      id: r.id,
      name,
      delta,
      riskReduction: comp ? riskReduction(r.cvar95) : null,
      improveProb: comp ? r.improveProb : null,
      ciLo: comp ? r.deltaCi?.lo ?? null : null,
      ciHi: comp ? r.deltaCi?.hi ?? null : null,
      n: r.nEligible,
      triggered: r.nTriggered,
      sample: `${comp ? r.nEligible : 0}/${nClosed}`,
      basis,
      kind: 'replay',
      verdict: !comp ? '当前无法估计' : delta < 0 ? '当前不支持' : r.fdr ? '值得考虑' : '当前证据不足',
      tone: !comp ? 'na' : delta < 0 ? 'neg' : r.fdr ? 'ok' : 'pos',
    })
  }

  pushRule(space.ruleReplay.rules.find((r) => r.id === 'hold-5'), '第 5 日统一退出', '日线近似')

  const stop = space.stopScan?.bestPreset ?? space.stopScan?.presets[0]
  if (stop) {
    rows.push({
      id: 'stop',
      name: '固定硬止损',
      delta: stop.delta,
      riskReduction: null,
      improveProb: null,
      ciLo: stop.deltaCi?.lo ?? null,
      ciHi: stop.deltaCi?.hi ?? null,
      n: nPath,
      triggered: stop.nStopped,
      sample: `${nPath}/${nClosed}`,
      basis: '日线触及',
      kind: 'stop',
      verdict: stop.fdr ? '值得考虑' : '当前不支持',
      tone: stop.fdr ? 'ok' : stop.delta < 0 ? 'neg' : 'na',
    })
  } else {
    rows.push({
      id: 'stop',
      name: '固定硬止损',
      delta: 0,
      riskReduction: null,
      improveProb: null,
      ciLo: null,
      ciHi: null,
      n: 0,
      triggered: 0,
      sample: `${nPath}/${nClosed}`,
      basis: '日线触及',
      kind: 'stop',
      verdict: '当前无法估计',
      tone: 'na',
    })
  }

  const trail = space.ruleReplay.rules.find((r) => r.id === 'trail-10') ?? space.ruleReplay.rules.find((r) => r.id === 'trail-20')
  pushRule(trail, '浮盈回撤退出', '日线近似')

  for (const a of space.counterfactual.actions) {
    const kind: ActionEval['kind'] = a.kind === 'upper-bound' ? 'upper-bound' : a.kind === 'proxy' ? 'proxy' : 'replay'
    const basis = kind === 'upper-bound' ? '理论上限' : kind === 'proxy' ? '代理估计' : '日线近似'
    const noTrigger = a.triggered === 0 && kind === 'replay'
    rows.push({
      id: a.id,
      name: a.name,
      delta: a.delta,
      riskReduction: riskReduction(a.cvar95),
      improveProb: a.improveProb,
      ciLo: a.ciLo,
      ciHi: a.ciHi,
      n: a.n,
      triggered: a.triggered,
      sample: `${a.n}/${nClosed}`,
      basis,
      kind,
      verdict: noTrigger ? '当前无法估计' : kind === 'upper-bound' ? '情景估算' : a.delta < 0 ? '当前不支持' : a.improveProb != null && a.improveProb >= 0.7 ? '值得考虑' : '当前证据不足',
      tone: noTrigger ? 'na' : kind === 'upper-bound' ? 'na' : a.delta < 0 ? 'neg' : a.improveProb != null && a.improveProb >= 0.7 ? 'ok' : 'pos',
    })
  }

  return rows
}
