import { mean } from '../lib/stats.ts'
import { money, pctPlain } from '../lib/format.ts'
import type { ExperimentConstraint } from '../lib/experiments.ts'
import { DEFAULT_PRO_PREFS, type ProPrefs } from '../lib/proPrefs.ts'
import { buildSpace } from './space.ts'
import type { Book, GroupRow, MetricPoint, RoundTrip } from '../types.ts'

export type DiagnosisKind = 'structure' | 'luck' | 'side' | 'time' | 'execution' | 'frequency' | 'trend' | 'risk'
export type DiagnosisTone = 'problem' | 'highlight' | 'watch'
export type Confidence = 'low' | 'mid' | 'high'
export type DiagnosisSection = 'impact' | 'observe' | 'highlight'

export type Diagnosis = {
  id: string
  kind: DiagnosisKind
  tone: DiagnosisTone
  section: DiagnosisSection
  headline: string
  phenomenon: string
  explanation: string
  next: string
  canClaim: boolean
  experiment?: {
    hypothesis: string
    constraint: ExperimentConstraint
    targetN: number
  }
  evidenceAnchor: string
  impactAbs: number
  factConfidence: Confidence
  extrapolationConfidence: Confidence
  /** 与 extrapolationConfidence 相同，留给旧调用方。 */
  confidence: Confidence
  n: number
  score: number
}

const WEIGHT: Record<Confidence, number> = { low: 0.35, mid: 0.7, high: 1 }
const OBSERVE = '继续观察，暂不认领实验。外推还不够，等再积累一些笔数再看。'
const NO_EXPERIMENT =
  '此诊断暂无直接实验。优先认领其他行为实验累积样本，或从标的 / 持仓时长维度定位亏损来源后再验证。'
const PDT =
  '美股日内交易受 PDT 规则约束（账户净值通常需 ≥ $25,000），请先确认账户资格；这不是让你改成日内策略。'
const FORBIDDEN = /停止.{0,8}交易|别买|不要买|禁止交易|别做.{0,6}交易/

function ciCrosses(m: MetricPoint | null | undefined, edge: number): boolean {
  if (!m?.ci) return false
  const hi = m.ci.hi
  return m.ci.lo < edge && (m.ci.unboundedHi || hi == null || hi > edge)
}

function groupFact(n: number): Confidence {
  if (n < 10) return 'low'
  if (n < 30) return 'mid'
  return 'high'
}

function groupExtra(n: number, prefs: ProPrefs, crosses = false): Confidence {
  if (n < prefs.minGroupN || n < prefs.minN || crosses) return 'low'
  if (n < 30) return 'mid'
  return 'high'
}

function confWord(c: Confidence) {
  return c === 'high' ? '高' : c === 'mid' ? '中' : '低'
}

function confLine(fact: Confidence, extra: Confidence) {
  return `事实置信度：${confWord(fact)}。外推置信度：${confWord(extra)}。`
}

function closedOf(book: Book): RoundTrip[] {
  return book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
}

function halves(trips: RoundTrip[]): { h1: number | null; h2: number | null; n: number } {
  const byTime = [...trips].sort((a, b) => a.openTime.getTime() - b.openTime.getTime())
  const mid = Math.floor(byTime.length / 2)
  if (!mid || byTime.length <= mid) return { h1: null, h2: null, n: byTime.length }
  return {
    h1: mean(byTime.slice(0, mid).map((t) => t.realizedPnl)),
    h2: mean(byTime.slice(mid).map((t) => t.realizedPnl)),
    n: byTime.length,
  }
}

function halfImproved(h: { h1: number | null; h2: number | null }) {
  if (h.h1 == null || h.h2 == null) return false
  const delta = h.h2 - h.h1
  return delta > 0 && h.h2 > 0 && Math.abs(delta) >= Math.max(Math.abs(h.h1) * 0.25, 1)
}

function halfWorse(h: { h1: number | null; h2: number | null }) {
  if (h.h1 == null || h.h2 == null) return false
  const delta = h.h2 - h.h1
  return delta < 0 && Math.abs(delta) >= Math.max(Math.abs(h.h1) * 0.25, 1)
}

function sectionOf(tone: DiagnosisTone, fact: Confidence, extra: Confidence): DiagnosisSection {
  if (tone === 'highlight') return 'highlight'
  if (fact === 'high') return 'impact'
  if (extra === 'low') return 'observe'
  return 'impact'
}

function pack(
  d: Omit<Diagnosis, 'score' | 'canClaim' | 'next' | 'confidence' | 'section'> & {
    next?: string
    noExperiment?: boolean
  },
): Diagnosis {
  const extra = d.extrapolationConfidence
  const section = sectionOf(d.tone, d.factConfidence, extra)
  const canClaim = extra !== 'low' && Boolean(d.experiment) && !d.noExperiment
  let next = d.next
  if (d.noExperiment) next = NO_EXPERIMENT
  else if (extra === 'low') next = OBSERVE
  else if (!next) next = OBSERVE
  const highlightPenalty = d.tone === 'highlight' ? 0.2 : 1
  return {
    ...d,
    section,
    next,
    canClaim,
    confidence: extra,
    score: d.impactAbs * WEIGHT[d.factConfidence] * highlightPenalty,
  }
}

function worstGroup(rows: GroupRow[], minN: number): GroupRow | null {
  const ok = rows.filter((r) => r.n >= minN && r.expectancy != null)
  if (!ok.length) return null
  return [...ok].sort((a, b) => (a.expectancy as number) - (b.expectancy as number))[0]
}

function bestGroup(rows: GroupRow[], minN: number): GroupRow | null {
  const ok = rows.filter((r) => r.n >= minN && r.expectancy != null)
  if (!ok.length) return null
  return [...ok].sort((a, b) => (b.expectancy as number) - (a.expectancy as number))[0]
}

export function pickMain(items: Diagnosis[]): Diagnosis | null {
  const cands = items.filter((d) => d.tone !== 'highlight')
  if (!cands.length) return null
  const highFact = cands.filter((d) => d.factConfidence === 'high')
  const pool = highFact.length ? highFact : cands
  const priority = (d: Diagnosis) => {
    if (d.id === 'luck-loss-mass') return 3
    if (d.kind === 'structure' || d.kind === 'risk') return 2
    return 1
  }
  return [...pool].sort((a, b) => priority(b) - priority(a) || b.score - a.score)[0]
}

export function diagnose(book: Book, prefs: ProPrefs = DEFAULT_PRO_PREFS): Diagnosis[] {
  const p = book.performance
  const n = p.closedCount
  const openDays = p.uniqueOpenDays
  const sv = book.sensitivity
  const mc = book.analytics.monteCarlo
  const expCross = ciCrosses(p.expectancy, 0)
  const out: Diagnosis[] = []
  const trips = closedOf(book)
  const space = book.space ?? buildSpace(trips)

  const share = sv.maxWinShareGrossProfit
  const drop = sv.expectancyDropMaxWin
  if (share != null && share >= prefs.concentration) {
    const extra = groupExtra(n, prefs, expCross)
    out.push(
      pack({
        id: 'structure-max-win',
        kind: 'structure',
        tone: 'problem',
        headline: `毛利里约 ${pctPlain(share, 0)} 来自最大一笔`,
        phenomenon: `最大一笔贡献了毛利的 ${pctPlain(share, 0)}。去掉它之后，单笔均值从 ${money(sv.meanPnl ?? 0)} 变成 ${drop == null ? '—' : money(drop)}。`,
        explanation: `这是这份账里的结构事实，不是外推。未来是否还靠单笔，另算。${confLine('high', extra)}`,
        evidenceAnchor: 'sensitivity',
        impactAbs: Math.abs((sv.meanPnl ?? 0) - (drop ?? 0)) * Math.max(n, 1),
        factConfidence: 'high',
        extrapolationConfidence: extra,
        n,
        noExperiment: true,
      }),
    )
  }

  if (mc) {
    const pctile = mc.terminalPctile
    const lose = mc.terminals.filter((v) => v <= 0).length / mc.terminals.length
    const fact = mc.nTrades >= 30 ? 'high' : groupFact(mc.nTrades)
    const extra = groupExtra(mc.nTrades, prefs, false)
    if (pctile >= 0.7) {
      out.push(
        pack({
          id: 'luck-lucky',
          kind: 'luck',
          tone: 'watch',
          headline: `有放回抽样里，约 ${Math.round(pctile * 100)}% 的终值不如这次`,
          phenomenon: `真实终值 ${money(mc.realizedTerminal)}，排在 ${mc.rounds} 次有放回抽样的约第 ${Math.round(pctile * 100)} 百分位。`,
          explanation: `这次抽到的交易组合偏好运，不宜把全部结果记在方法上。${confLine(fact, extra)}`,
          evidenceAnchor: 'mc',
          impactAbs: Math.abs(mc.realizedTerminal) * (pctile - 0.5) * 2,
          factConfidence: fact,
          extrapolationConfidence: extra,
          n: mc.nTrades,
          noExperiment: true,
        }),
      )
    } else if (pctile <= 0.3) {
      out.push(
        pack({
          id: 'luck-unlucky',
          kind: 'luck',
          tone: 'watch',
          headline: `有放回抽样里，约 ${Math.round((1 - pctile) * 100)}% 的终值比这次好`,
          phenomenon: `真实终值 ${money(mc.realizedTerminal)}，约第 ${Math.round(pctile * 100)} 百分位，偏背运一侧。`,
          explanation: `方法未必有这次数字看起来那么差，路径运气占了一部分。${confLine(fact, extra)}`,
          evidenceAnchor: 'mc',
          impactAbs: Math.abs(mc.realizedTerminal) * (0.5 - pctile) * 2,
          factConfidence: fact,
          extrapolationConfidence: extra,
          n: mc.nTrades,
          noExperiment: true,
        }),
      )
    }
    if (lose >= 0.55) {
      out.push(
        pack({
          id: 'luck-loss-mass',
          kind: 'luck',
          tone: 'problem',
          headline: `有放回抽样中约 ${Math.round(lose * 100)}% 的平行结果为负`,
          phenomenon: `${mc.rounds} 次抽样中，约 ${Math.round(lose * 100)}% 终值为负；点估计 PF ${p.profitFactor.value == null ? '—' : p.profitFactor.value.toFixed(2)}，单笔均值 ${p.expectancy.value == null ? '—' : money(p.expectancy.value)}。`,
          explanation: `这更像交易集合本身偏亏，不只是路径顺序的问题。${confLine(fact, extra)}`,
          evidenceAnchor: 'mc',
          impactAbs: Math.abs(mc.realizedTerminal) * lose + 1,
          factConfidence: fact,
          extrapolationConfidence: extra,
          n: mc.nTrades,
          noExperiment: true,
        }),
      )
    }
  }

  const long = book.checkup.sides.find((s) => s.id === 'long')
  const short = book.checkup.sides.find((s) => s.id === 'short')
  if (long && short && long.n >= 5 && short.n >= 5 && long.expectancy != null && short.expectancy != null) {
    const gap = long.expectancy - short.expectancy
    if (Math.abs(gap) > 0 && (long.pnl < 0 || short.pnl < 0 || Math.abs(gap) >= Math.abs((p.expectancy.value ?? 0) * 0.5))) {
      const worse = gap > 0 ? short : long
      const better = gap > 0 ? long : short
      const groupN = worse.n
      const fact = groupFact(groupN)
      const extra = groupExtra(groupN, prefs)
      const betterSide = better.id === 'long' ? 'long' : 'short'
      const psm = space.psm
      const psmBlocks = Boolean(psm && psm.nTreated >= 5 && psm.status === 'cannot-control')
      const psmOk = Boolean(psm && psm.status === 'ok' && psm.nMatched >= 5)
      const psmContradicts = psmOk && worse.id === 'short' && (psm!.delta ?? 0) >= 0
      const holdSide = psmBlocks || psmContradicts
      const psmNote = psmBlocks
        ? '精确匹配后无法把方向从标的×持仓档里剥离开，方向结论可能是标的混杂。'
        : psmContradicts
          ? `同一标的、同一持仓档匹配后，空头相对做多 ${money(psm!.delta ?? 0)}/笔，空头合计亏损更像标的混杂而不是方向本身。`
          : psmOk
            ? `同一标的、同一持仓档匹配后，空头相对做多 ${money(psm!.delta ?? 0)}/笔。`
            : ''
      out.push(
        pack({
          id: `side-${worse.id}`,
          kind: 'side',
          tone: worse.expectancy != null && worse.expectancy < 0 ? 'problem' : 'watch',
          headline: `${worse.label}单笔均值 ${money(worse.expectancy ?? 0)}（${worse.n} 笔）`,
          phenomenon: `${worse.label} ${worse.n} 笔、合计 ${money(worse.pnl)}。`,
          explanation: `多空不对称在这份样本里看得出来，但是否可重复要靠下一批评测。${psmNote}${confLine(fact, extra)}`,
          evidenceAnchor: psmBlocks || psmOk ? 'psm' : 'sides',
          impactAbs: Math.abs(worse.pnl),
          factConfidence: fact,
          extrapolationConfidence: extra,
          n: worse.n,
          noExperiment: holdSide,
          experiment: holdSide
            ? undefined
            : {
                hypothesis: `如果${better.label}更站得住，未来一段时间以${better.label}为主时，新样本单笔均值应不低于当前基线。`,
                constraint: { kind: 'side', side: betterSide },
                targetN: 20,
              },
          next: holdSide
            ? undefined
            : `建议实验：未来 20 笔以${better.label}为主，导入后对比符合约束的占比和单笔均值。`,
        }),
      )
    }
  }

  const worstWd = worstGroup(book.checkup.weekdays, 5)
  if (worstWd && worstWd.expectancy != null && worstWd.expectancy < 0) {
    const fact = groupFact(worstWd.n)
    const extra = groupExtra(worstWd.n, prefs)
    out.push(
      pack({
        id: `time-wd-${worstWd.id}`,
        kind: 'time',
        tone: 'problem',
        headline: `${worstWd.label}单笔均值 ${money(worstWd.expectancy)}（${worstWd.n} 笔）`,
        phenomenon: `${worstWd.label} ${worstWd.n} 笔、合计 ${money(worstWd.pnl)}。`,
        explanation: `该星期在这份样本里偏弱，先不当成日历规律。${confLine(fact, extra)}`,
        evidenceAnchor: 'weekdays',
        impactAbs: Math.abs(worstWd.pnl),
        factConfidence: fact,
        extrapolationConfidence: extra,
        n: worstWd.n,
        experiment: {
          hypothesis: `若${worstWd.label}确实拖后腿，避开它之后新样本的单笔均值应不低于当前基线。`,
          constraint: { kind: 'avoid-weekday', weekdayId: worstWd.id },
          targetN: 20,
        },
        next: `建议实验：未来 20 笔避开${worstWd.label}开仓，导入后对比符合约束的占比和单笔均值。`,
      }),
    )
  }

  const worstHold = worstGroup(book.checkup.holdBuckets, 5)
  const bestHold = bestGroup(book.checkup.holdBuckets, 5)
  if (worstHold && worstHold.expectancy != null && worstHold.expectancy < 0 && bestHold && bestHold.id !== worstHold.id && bestHold.expectancy != null) {
    const fact = groupFact(worstHold.n)
    const extra = groupExtra(worstHold.n, prefs)
    const keep = bestHold.id as 'h1' | 'h2' | 'h3'
    const pdtNote = keep === 'h1' ? ` ${PDT}` : ''
    out.push(
      pack({
        id: `time-hold-${worstHold.id}`,
        kind: 'time',
        tone: 'watch',
        headline: `${worstHold.label}单笔均值 ${money(worstHold.expectancy)}`,
        phenomenon: `${worstHold.label} ${worstHold.n} 笔、合计 ${money(worstHold.pnl)}。`,
        explanation: `这是持仓时长分档，不是频率档。${confLine(fact, extra)}`,
        evidenceAnchor: 'hold',
        impactAbs: Math.abs(worstHold.pnl),
        factConfidence: fact,
        extrapolationConfidence: extra,
        n: worstHold.n,
        experiment: {
          hypothesis: `若${bestHold.label}更站得住，未来一段时间靠近该档时，新样本单笔均值应不低于当前基线。`,
          constraint: { kind: 'hold', bucket: keep },
          targetN: 20,
        },
        next: `建议实验：未来 20 笔靠近「${bestHold.label}」，导入后对比单笔均值。${pdtNote}`,
      }),
    )
  }

  const worstRg = worstGroup(book.checkup.regimes, 5)
  if (worstRg && worstRg.expectancy != null && worstRg.expectancy < 0) {
    const fact = groupFact(worstRg.n)
    const extra = groupExtra(worstRg.n, prefs)
    const listed = book.checkup.regimes.filter((r) => r.n >= 5 && r.expectancy != null)
    const roster = listed.map((r) => `${r.label} ${r.n} 笔 ${money(r.expectancy as number)}`).join('；')
    const bestRg = bestGroup(book.checkup.regimes, 5)
    const towardIntraday = bestRg?.id === 'intraday'
    out.push(
      pack({
        id: `time-regime-${worstRg.id}`,
        kind: 'time',
        tone: 'watch',
        headline: `频率档「${worstRg.label}」单笔均值 ${money(worstRg.expectancy)}`,
        phenomenon: roster || `${worstRg.label} ${worstRg.n} 笔、合计 ${money(worstRg.pnl)}。`,
        explanation: `这是频率分档（日内 / 短线 / 波段 / 长线），不是持仓时长。${confLine(fact, extra)}`,
        evidenceAnchor: 'freq',
        impactAbs: Math.abs(worstRg.pnl),
        factConfidence: fact,
        extrapolationConfidence: extra,
        n: worstRg.n,
        experiment:
          bestRg && bestRg.id !== worstRg.id
            ? {
                hypothesis: `若「${bestRg.label}」更站得住，未来以该频率为主时，新样本单笔均值应不低于当前基线。`,
                constraint: { kind: 'regime', regime: bestRg.id as 'intraday' | 'swing' | 'position' | 'investor' },
                targetN: 20,
              }
            : undefined,
        next:
          bestRg && bestRg.id !== worstRg.id
            ? `建议实验：未来 20 笔以「${bestRg.label}」为主，导入后对比单笔均值。${towardIntraday ? PDT : ''}`
            : undefined,
      }),
    )
  }

  const gb = space.giveback
  if (gb.nFloated >= 5 && gb.meanRate != null && gb.meanRate >= 0.4 && gb.sumDollar != null && gb.sumDollar > 0) {
    const fact = groupFact(gb.nFloated)
    const extra = groupExtra(gb.nFloated, prefs)
    const ci = gb.sumCi
      ? `合计回吐 ${money(gb.sumDollar)}（80% CI ${money(gb.sumCi.lo)} ~ ${money(gb.sumCi.hi)}）`
      : `合计回吐 ${money(gb.sumDollar)}`
    out.push(
      pack({
        id: 'space-giveback',
        kind: 'execution',
        tone: 'watch',
        headline: `${gb.nClosed} 笔里有 ${gb.nFloated} 笔曾经浮盈，平均回吐 ${pctPlain(gb.meanRate, 0)}`,
        phenomenon: `${ci}。这是日线估算的理论上界，不是「能多赚这么多」。`,
        explanation: `没人能稳定出在最高点。可验证的空间是规则回放（硬止损、trailing、持有时限），不是 MFE。${confLine(fact, extra)}`,
        evidenceAnchor: 'mae',
        impactAbs: gb.sumDollar,
        factConfidence: 'high',
        extrapolationConfidence: extra,
        n: gb.nFloated,
        noExperiment: true,
      }),
    )
  }

  const stop = space.stopScan
  if (stop?.bestPreset) {
    const bp = stop.bestPreset
    const extra = groupExtra(stop.levels[0] ? space.giveback.nPath : n, prefs)
    const ci = bp.deltaCi ? `（80% CI ${money(bp.deltaCi.lo)} ~ ${money(bp.deltaCi.hi)}）` : ''
    out.push(
      pack({
        id: 'space-stop',
        kind: 'execution',
        tone: 'watch',
        headline: `硬止损 ${pctPlain(bp.pct, 0)} 档的规则回放合计 ${money(bp.pnl)}，相对实际 ${money(bp.delta)}${ci}`,
        phenomenon: `${bp.nStopped} 笔会触及该档。这是「如果执行这条规则」的反事实，经过 FDR 校正。`,
        explanation: `不是出在最高点。日线不知道盘中先后，所以这是可验证的纪律空间，不是预测。${confLine(groupFact(space.giveback.nPath), extra)}`,
        evidenceAnchor: 'stop-scan',
        impactAbs: Math.abs(bp.delta),
        factConfidence: groupFact(space.giveback.nPath),
        extrapolationConfidence: extra,
        n: space.giveback.nPath,
        experiment: {
          hypothesis: `若执行开仓后 ${pctPlain(bp.pct, 0)} 硬止损，新样本单笔均值应不低于当前基线。`,
          constraint: { kind: 'observe' },
          targetN: 20,
        },
        next: `建议实验：未来 20 笔使用 ${pctPlain(bp.pct, 0)} 硬止损，导入后对比单笔均值。这是规则反事实，不是出在最高点。`,
      }),
    )
  }

  const replay = space.ruleReplay
  if (replay?.bestPreset) {
    const bp = replay.bestPreset
    const extra = groupExtra(space.giveback.nPath || n, prefs)
    const ci = bp.deltaCi ? `（80% CI ${money(bp.deltaCi.lo)} ~ ${money(bp.deltaCi.hi)}）` : ''
    const pdtNote = bp.id === 'hold-1' ? PDT : ''
    out.push(
      pack({
        id: 'space-replay',
        kind: 'execution',
        tone: 'watch',
        headline: `${bp.label}回放合计 ${money(bp.pnl)}，相对实际 ${money(bp.delta)}${ci}`,
        phenomenon: `${bp.nTriggered} / ${bp.nEligible} 笔会触及该规则。这是日线路径上的规则反事实，经过 FDR。`,
        explanation: `不是出在最高点，也没有预测下一段行情。${confLine(groupFact(bp.nEligible), extra)}`,
        evidenceAnchor: 'rule-replay',
        impactAbs: Math.abs(bp.delta),
        factConfidence: groupFact(bp.nEligible),
        extrapolationConfidence: extra,
        n: bp.nEligible,
        experiment: {
          hypothesis: `若执行「${bp.label}」，新样本单笔均值应不低于当前基线。`,
          constraint: { kind: 'observe' },
          targetN: 20,
        },
        next: `建议实验：未来 20 笔执行「${bp.label}」，导入后对比单笔均值。这是规则反事实。${pdtNote}`,
      }),
    )
  }

  const bh = space.oppCost?.symbolBh
  if (bh && bh.n >= 5 && bh.delta < -1 && (bh.deltaCi == null || bh.deltaCi.hi < 0)) {
    const extra = groupExtra(bh.n, prefs)
    const ci = bh.deltaCi ? `（80% CI ${money(bh.deltaCi.lo)} ~ ${money(bh.deltaCi.hi)}）` : ''
    out.push(
      pack({
        id: 'space-opp',
        kind: 'execution',
        tone: 'watch',
        headline: `同期标的持有不动 ${money(bh.bench)}，实际 ${money(bh.actual)}，差 ${money(bh.delta)}${ci}`,
        phenomenon: `${bh.n} 笔有日线窗口。这是机会成本，不是「你该一直拿着」。`,
        explanation: `波段进出相对标的自身开盘→收盘路径的差额。没有用 CAPM。${confLine(groupFact(bh.n), extra)}`,
        evidenceAnchor: 'opp-cost',
        impactAbs: Math.abs(bh.delta),
        factConfidence: groupFact(bh.n),
        extrapolationConfidence: extra,
        n: bh.n,
        noExperiment: true,
      }),
    )
  }

  const kelly = space.kelly
  if (kelly?.corrSizePnl != null && kelly.corrSizePnl < -0.25 && kelly.n >= 15) {
    const extra = groupExtra(kelly.n, prefs)
    out.push(
      pack({
        id: 'space-sizing',
        kind: 'risk',
        tone: 'watch',
        headline: `名义本金与盈亏负相关 r=${kelly.corrSizePnl.toFixed(2)}`,
        phenomenon: `盈利单中位名义本金 ${kelly.medianNotionalWin == null ? '—' : money(kelly.medianNotionalWin)}，亏损单 ${kelly.medianNotionalLoss == null ? '—' : money(kelly.medianNotionalLoss)}。`,
        explanation: `负相关表示在结果更差的交易上下了更重的注。Kelly 比例只作参考，小样本的 p、b 不稳。${confLine(groupFact(kelly.n), extra)}`,
        evidenceAnchor: 'kelly',
        impactAbs: Math.abs(kelly.medianNotional ?? 0) * Math.abs(kelly.corrSizePnl),
        factConfidence: groupFact(kelly.n),
        extrapolationConfidence: extra,
        n: kelly.n,
        noExperiment: true,
      }),
    )
  }

  const cap = p.capture
  const execN = Math.min(cap.n, p.giveback.n || cap.n)
  const alreadyGiveback = out.some((d) => d.id === 'space-giveback')
  if (!alreadyGiveback && cap.value != null && execN >= 5 && (cap.value < 0.45 || (p.giveback.value != null && p.giveback.value > 0.45))) {
    const fact = groupFact(execN)
    const extra = groupExtra(execN, prefs)
    out.push(
      pack({
        id: 'execution-capture',
        kind: 'execution',
        tone: 'watch',
        headline: `日线估算捕获率 ${pctPlain(cap.value, 0)}${p.giveback.value != null ? `，回吐 ${pctPlain(p.giveback.value, 0)}` : ''}`,
        phenomenon: `有 ${cap.n} 笔盈利样本能算捕获率${p.giveback.n ? `，${p.giveback.n} 笔能算回吐` : ''}。这是日线粗估，不是盘中路径。`,
        explanation: `捕获偏低或回吐偏高，说明有一部分浮盈没有落袋。${confLine(fact, extra)}`,
        evidenceAnchor: 'mae',
        impactAbs: Math.abs((p.expectancy.value ?? 0) * execN) * (1 - cap.value),
        factConfidence: fact,
        extrapolationConfidence: extra,
        n: execN,
        experiment: {
          hypothesis: '若退出质量改善，未来盈利单的捕获率应高于当前基线。',
          constraint: { kind: 'observe' },
          targetN: 20,
        },
        next: '建议实验：未来 20 笔记录退出，导入后对比捕获率 / 回吐。',
      }),
    )
  }

  if (openDays > 0 && n >= 5) {
    const perDay = n / openDays
    if (perDay >= 4) {
      const fact = groupFact(openDays)
      const extra = groupExtra(openDays, prefs)
      out.push(
        pack({
          id: 'frequency-hot',
          kind: 'frequency',
          tone: 'watch',
          headline: `开仓日均 ${perDay.toFixed(1)} 笔`,
          phenomenon: `${n} 笔分布在 ${openDays} 个开仓日，日均 ${perDay.toFixed(1)} 笔。`,
          explanation: `频率偏高时，单笔期望更容易被噪声和费用吃掉。${confLine(fact, extra)}`,
          evidenceAnchor: 'sides',
          impactAbs: Math.abs(p.expectancy.value ?? 0) * n * Math.min(perDay / 8, 1),
          factConfidence: fact,
          extrapolationConfidence: extra,
          n,
          experiment: {
            hypothesis: '若降低频率后单笔均值上升，说明当前日均笔数偏高在拖后腿。',
            constraint: { kind: 'observe' },
            targetN: 20,
          },
          next: '建议实验：未来 20 笔把日均笔数降下来，导入后对比单笔均值。',
        }),
      )
    }
  }

  if (n >= 10) {
    const full = halves(trips)
    const top = trips.reduce<RoundTrip | null>((best, t) => {
      if (!best) return t
      return Math.abs(t.realizedPnl) > Math.abs(best.realizedPnl) ? t : best
    }, null)
    const robust = top ? halves(trips.filter((t) => t.id !== top.id)) : full
    const fact = groupFact(Math.floor(n / 2))
    const extra = groupExtra(Math.floor(n / 2), prefs)
    if (halfImproved(full)) {
      const drivenByTop = !halfImproved(robust)
      if (drivenByTop) {
        out.push(
          pack({
            id: 'trend-better',
            kind: 'trend',
            tone: 'watch',
            headline: `后半段单笔均值 ${money(full.h2 ?? 0)}，好于前半 ${money(full.h1 ?? 0)}`,
            phenomenon: `按开仓时间对半切：前半 ${money(full.h1 ?? 0)} → 后半 ${money(full.h2 ?? 0)}。剔除最大单笔后，该改善消失。`,
            explanation: `该改善由单笔贡献，与集中度是同一件事的两面，不当趋势。${confLine('low', 'low')}`,
            evidenceAnchor: 'sensitivity',
            impactAbs: Math.abs((full.h2 ?? 0) - (full.h1 ?? 0)) * 0.15,
            factConfidence: 'low',
            extrapolationConfidence: 'low',
            n: Math.floor(n / 2),
            noExperiment: true,
          }),
        )
      } else {
        out.push(
          pack({
            id: 'trend-better',
            kind: 'trend',
            tone: 'highlight',
            headline: `后半段单笔均值 ${money(full.h2 ?? 0)}，好于前半 ${money(full.h1 ?? 0)}`,
            phenomenon: `按开仓时间对半切：前半 ${money(full.h1 ?? 0)} → 后半 ${money(full.h2 ?? 0)}。剔除最大单笔后仍然成立。`,
            explanation: `后半段在这份样本里更好，仍可能是一段运气。${confLine(fact, extra)}`,
            evidenceAnchor: 'sensitivity',
            impactAbs: Math.abs((full.h2 ?? 0) - (full.h1 ?? 0)) * Math.floor(n / 2),
            factConfidence: fact,
            extrapolationConfidence: extra,
            n: Math.floor(n / 2),
          }),
        )
      }
    } else if (halfWorse(full)) {
      const drivenByTop = !halfWorse(robust)
      out.push(
        pack({
          id: 'trend-worse',
          kind: 'trend',
          tone: 'watch',
          headline: `后半段单笔均值 ${money(full.h2 ?? 0)}，弱于前半 ${money(full.h1 ?? 0)}`,
          phenomenon: drivenByTop
            ? `按开仓时间对半切：前半 ${money(full.h1 ?? 0)} → 后半 ${money(full.h2 ?? 0)}。剔除最大单笔后，该变差消失。`
            : `按开仓时间对半切：前半 ${money(full.h1 ?? 0)} → 后半 ${money(full.h2 ?? 0)}。剔除最大单笔后仍然成立。`,
          explanation: drivenByTop
            ? `该变差由单笔贡献，不当趋势。${confLine('low', 'low')}`
            : `后半段变弱，需要新样本确认是不是还在恶化。${confLine(fact, extra)}`,
          evidenceAnchor: 'sensitivity',
          impactAbs: Math.abs((full.h2 ?? 0) - (full.h1 ?? 0)) * (drivenByTop ? 0.15 : Math.floor(n / 2)),
          factConfidence: drivenByTop ? 'low' : fact,
          extrapolationConfidence: drivenByTop ? 'low' : extra,
          n: Math.floor(n / 2),
          noExperiment: drivenByTop,
          experiment: drivenByTop
            ? undefined
            : {
                hypothesis: '若优势在衰减，下一批新样本的单笔均值应接近或低于后半段。',
                constraint: { kind: 'observe' },
                targetN: 20,
              },
          next: drivenByTop ? undefined : '建议实验：未来 20 笔继续记录，导入后对比新样本单笔均值与后半段。',
        }),
      )
    }
  }

  const alreadyStructure = out.some((d) => d.kind === 'structure')
  if (!alreadyStructure && (sv.sensitive || (sv.top1Share != null && sv.top1Share >= prefs.concentration))) {
    const extra = groupExtra(n, prefs, expCross)
    out.push(
      pack({
        id: 'risk-concentrate',
        kind: 'risk',
        tone: 'problem',
        headline: sv.top1Share != null ? `最大一笔约占毛利 ${pctPlain(sv.top1Share, 0)}` : '结果对少数交易或口径较敏感',
        phenomenon: sv.note || '集中度或口径敏感性已触发。',
        explanation: `这是这份账里的结构事实。${confLine('high', extra)}`,
        evidenceAnchor: 'sensitivity',
        impactAbs: Math.abs(sv.meanPnl ?? p.expectancy.value ?? 0) * n * (sv.top1Share ?? 0.5),
        factConfidence: 'high',
        extrapolationConfidence: extra,
        n,
        noExperiment: true,
      }),
    )
  }

  const payoff = p.payoff.value
  const wr = p.winRate.value
  if (payoff != null && Number.isFinite(payoff) && payoff >= 2 && wr != null && wr < 0.45 && p.payoff.n >= 10) {
    out.push(
      pack({
        id: 'payoff-highlight',
        kind: 'structure',
        tone: 'highlight',
        headline: `平均盈利是平均亏损的 ${payoff.toFixed(1)} 倍`,
        phenomenon: `盈亏比 ${payoff.toFixed(1)}，胜率 ${pctPlain(wr, 0)}。亏在胜率，不是亏在赔率。`,
        explanation: `这是这份样本的结构事实：单笔赚的时候赚得够多，但赢的次数不够。${confLine('high', groupExtra(p.payoff.n, prefs))}`,
        evidenceAnchor: 'quality',
        impactAbs: payoff * Math.max(p.payoff.n, 1),
        factConfidence: 'high',
        extrapolationConfidence: groupExtra(p.payoff.n, prefs),
        n: p.payoff.n,
      }),
    )
  }

  return out
    .filter((d) => d.impactAbs > 0 || d.tone === 'highlight')
    .sort((a, b) => b.score - a.score || b.impactAbs - a.impactAbs)
}

export function diagnosisText(d: Diagnosis): string {
  return `${d.headline}\n${d.phenomenon}\n${d.explanation}\n${d.next}`
}

export function hasForbiddenCopy(d: Diagnosis): boolean {
  return FORBIDDEN.test(diagnosisText(d))
}
