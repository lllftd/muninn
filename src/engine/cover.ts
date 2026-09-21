import { money, pct, pctPlain } from '../lib/format.ts'
import type { Diagnosis } from './diagnose.ts'
import type { HealthReport } from './health.ts'
import type { Book } from '../types.ts'
import { isDay4Shadow, isMisalignedHoldExperiment, type ExperimentRecord } from '../lib/experiments.ts'

export type CoverGap = {
  id: string
  title: string
  unlocks: string
  done: boolean
  action?: 'account' | 'guide'
  tone: 'ok' | 'watch' | 'fail'
  statusLabel: string
}

export type CoverReport = {
  verdict: string
  verdictShort: string
  luckLine: string
  luckShort: string
  nLine: string
  gaps: CoverGap[]
  blocked: string[]
  cleared: string[]
  summaries: { what: string; why: string; how: string }
  be: { wr: number; need: number; gapPp: number } | null
  coverageLabel: string
  benchLine: string | null
  benchChip: string | null
  improve: ImproveItem[]
  queue: HowQueueRow[]
  howLead: string
  mainAction: Diagnosis | null
  /** 「为什么」首屏总答：2–4 句现有事实，不写死标的。 */
  whyLead: string
}

export type ImproveItem = {
  id: string
  title: string
  amount: number | null
  finding: string
  action: string
  diagnosisId?: string
  canClaim: boolean
}

export type HowAmountKind = 'historical' | 'mechanical' | 'theoretical' | 'verified'
export type HowQueueStatus = 'verified' | 'running' | 'pending' | 'blocked' | 'rejected' | 'reference'

export type HowQueueRow = {
  id: string
  title: string
  kind: HowAmountKind
  status: HowQueueStatus
  historical: number | null
  recoverable: number | null
  recoverableKind: 'theoretical' | 'mechanical' | 'verified' | 'unknown' | 'none'
  capLines?: string[]
  finding: string
  next: string
  diagnosisId?: string
  canClaim: boolean
}

function nLineOf(n: number) {
  if (n < 10) return `${n} 笔 → 整体低置信，细分不做结论。`
  if (n < 50) return `${n} 笔 → 整体层面中置信，月度/分组低置信。后续部分发现因此标注低置信。`
  return `${n} 笔 → 整体中高置信，月度与小分组仍低置信。`
}

export function symbolPnl(book: Book): Array<{ symbol: string; pnl: number; n: number }> {
  const map = new Map<string, { pnl: number; n: number }>()
  for (const t of book.episodes) {
    if (t.status !== 'closed' || t.tags.includes('DRIP')) continue
    const cur = map.get(t.symbol) || { pnl: 0, n: 0 }
    cur.pnl += t.realizedPnl
    cur.n += 1
    map.set(t.symbol, cur)
  }
  return [...map.entries()]
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((a, b) => b.pnl - a.pnl)
}

/** 首屏总答：只用账面事实与已有诊断，不发明标的或规律。 */
export function whyLead(book: Book, items: Diagnosis[], _health: HealthReport): string {
  const parts: string[] = []
  const closed = book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  const net = closed.reduce((s, t) => s + t.realizedPnl, 0)
  const resultWord = net < 0 ? '亏损' : net > 0 ? '盈利' : '结果'
  const signs = symbolPnl(book)
  const wins = signs.filter((s) => s.pnl > 0)
  const losses = [...signs.filter((s) => s.pnl < 0)].sort((a, b) => a.pnl - b.pnl)
  const grossWin = wins.reduce((s, w) => s + w.pnl, 0)
  const top = wins[0]
  const topShare = top && grossWin > 0 ? top.pnl / grossWin : null
  const secondShare = wins[1] && grossWin > 0 ? wins[1].pnl / grossWin : 0

  parts.push(`本期已实现净${resultWord} ${money(net)}。`)
  if (top && topShare != null && topShare >= 0.4) {
    if (secondShare != null && secondShare >= 0.15) {
      parts.push(`毛利集中在 ${top.symbol}、${wins[1].symbol}。`)
    } else {
      parts.push(`毛利主要集中在 ${top.symbol}（占毛利 ${pctPlain(topShare, 0)}），其余正贡献很小。`)
    }
  } else if (top) {
    parts.push(`盈利分散，最大标的为 ${top.symbol}。`)
  }
  if (losses.length) {
    parts.push(`${losses.slice(0, 3).map((l) => l.symbol).join('、')} 构成主要亏损。`)
  }

  const gb = book.space.giveback
  const floatedLoss = closed.filter((t) => (t.mfeDollar ?? 0) > 0 && t.realizedPnl < 0).length
  const coverLine = pathCoverLine(gb)
  if (coverLine) {
    parts.push(`较明确的行为线索是浮盈回吐：其中 ${floatedLoss} 笔最终转亏。${coverLine}。`)
  }

  const hasCandidate = items.some(
    (d) => d.section === 'observe' || d.kind === 'time' || d.kind === 'frequency' || d.kind === 'side',
  )
  if (hasCandidate) {
    parts.push('多空、星期和持仓分组目前仅作为候选观察。')
  }
  parts.push('路径重排未显示本期特别倒霉，但样本不足以判断策略是否具有稳定 edge。')
  return parts.join('')
}

function whyTabSummary(items: Diagnosis[], luckShort: string): string {
  const behavior = items.some((d) => d.id === 'space-giveback' || d.id === 'execution-capture') ? 1 : 0
  const candFlags = [
    items.some((d) => d.id === 'structure-max-win' || d.id === 'risk-concentrate'),
    items.some((d) => d.kind === 'side'),
    items.some((d) => d.kind === 'time' && d.id.startsWith('time-wd-')),
    items.some((d) => d.kind === 'frequency' || (d.kind === 'time' && d.id.startsWith('time-hold-'))),
    items.some((d) => d.kind === 'structure' || d.id === 'payoff-highlight'),
  ]
  const cand = candFlags.filter(Boolean).length
  const luckBit = luckShort === '偏路径' ? '路径偏幸运' : luckShort === '运气未判' ? '运气未判' : '路径运气中性'
  return `${behavior} 项主要行为问题 · ${cand} 项候选观察 · ${luckBit}`
}

function luckLine(book: Book): { long: string; short: string } {
  const mc = book.analytics.monteCarlo
  const main = '没有证据表明本期亏损主要由异常路径顺序造成。'
  const tail = '但由于样本较少且收益高度集中，目前无法判断策略是否具有稳定正或负期望。'
  if (!mc || !mc.terminals.length) {
    return { long: `${main}平行结果还不够，运气先不判。${tail}`, short: '运气未判' }
  }
  const lose = mc.terminals.filter((v) => v <= 0).length / mc.terminals.length
  const pctile = mc.terminalPctile
  if (lose <= 0.4) {
    return {
      long: `${main}在当前样本的回抽结果中，终值为负不到一半，路径可能偏幸运，不要把结果全记在方法上。${tail}`,
      short: '偏路径',
    }
  }
  const mid =
    pctile > 0.3 && pctile < 0.7
      ? '在当前样本的回抽结果中，最终结果位于中间附近，说明本期路径并不特别倒霉。'
      : '回抽未显示本期路径特别倒霉。'
  return { long: `${main}${mid}${tail}`, short: '运气中性' }
}

function structureVerdict(book: Book, items: Diagnosis[]): { long: string; short: string } {
  const p = book.performance
  const wr = p.winRate.value
  const payoff = p.payoff.value
  const pf = p.profitFactor.value
  const exp = p.expectancy.value
  const share = book.sensitivity.maxWinShareGrossProfit
  const lowWr = wr != null && wr < 0.4
  const highPay = payoff != null && payoff >= 2
  const oneShot = share != null && share >= 0.4
  const losing = (pf != null && Number.isFinite(pf) && pf < 1) || (exp != null && exp < 0)
  const winning = exp != null && exp > 0
  let long = items[0]?.headline || '样本还不够，先看覆盖和笔数。'
  if (lowWr && highPay && oneShot && losing) long = '低胜率高赔率，靠一笔大盈撑着的亏损体系'
  else if (lowWr && highPay && losing) long = '低胜率高赔率的亏损体系'
  else if (lowWr && oneShot && losing) long = '低胜率、靠一笔大盈撑着的亏损体系'
  else if (highPay && oneShot && losing) long = '高赔率、靠一笔大盈撑着的亏损体系'
  else if (losing) long = oneShot ? '靠一笔大盈撑着的亏损体系' : '亏损体系'
  else if (winning) long = oneShot ? '靠一笔大盈撑着、样本期内合计为正' : '样本期内合计为正'
  const short = losing ? '亏损体系' : winning ? '样本期内为正' : '结果未定'
  return { long, short }
}

function blockedByHealth(health: HealthReport): string[] {
  return health.tasks.filter((t) => !t.done).map((t) => `${t.title}：缺了就不能下${t.unlocks}`)
}

function gapTone(done: boolean, id: string, health: HealthReport): CoverGap['tone'] {
  if (done) return 'ok'
  if (id === 'mae') return health.maeShare <= 0 ? 'fail' : 'watch'
  return 'watch'
}

export function capabilityGaps(health: HealthReport): CoverGap[] {
  const byId = new Map(health.tasks.map((t) => [t.id, t]))
  const row = (id: string, title: string, fallbackUnlocks: string, done: boolean, action?: CoverGap['action']): CoverGap => {
    const t = byId.get(id)
    const tone = gapTone(done, id, health)
    const statusLabel = done
      ? '已有'
      : id === 'mae' && health.maeShare > 0
        ? `部分覆盖 ${Math.round(health.maeShare * 100)}%`
        : tone === 'fail'
          ? '缺失'
          : '待补'
    return {
      id,
      title: t?.title ?? title,
      unlocks: t?.unlocks ?? fallbackUnlocks,
      done,
      action: done ? undefined : action,
      tone,
      statusLabel,
    }
  }
  return [
    row('flow', '交易流水', '交易层全部指标', true),
    row('nav', '期初净资产', '夏普 / Calmar / XIRR / 账户回撤 / 相对基准', !!byId.get('nav')?.done, 'account'),
    row('cash', '外部入出金', 'XIRR', !!byId.get('cash')?.done, 'account'),
    row('mae', '日线覆盖', '捕获率 / 回吐 / 退出质量', !!byId.get('mae')?.done, 'guide'),
  ]
}

function benchLineOf(book: Book): { line: string; chip: string } | null {
  const last = book.equity.at(-1)
  if (!last || !(last.benchIndex > 0)) return null
  const ret = last.benchIndex / 100 - 1
  const name = book.performance.benchKind === 'spy-total-return' ? 'SPY' : 'SPX'
  const chip = `同期 ${name} ${pct(ret, 1)}*`
  if (book.performance.pathKind === 'account' && book.performance.relativeSpx != null) {
    return { line: `同期${name} ${pct(ret, 1)}`, chip: `同期 ${name} ${pct(ret, 1)}` }
  }
  return { line: `同期 ${name} 约 ${pct(ret, 1)}（粗略对照，不是账户超额）`, chip }
}

function clearedChecks(book: Book, items: Diagnosis[]): string[] {
  const ids = new Set(items.map((d) => d.id))
  const out: string[] = []
  if (!ids.has('frequency-hot')) out.push('单日频率')
  if (!ids.has('space-sizing') && (book.space.kelly?.corrSizePnl == null || book.space.kelly.corrSizePnl >= -0.25)) {
    out.push('仓位与盈亏负相关')
  }
  const runs = book.analytics.runs
  if (runs.pValue == null || runs.pValue > 0.05) out.push('连亏分布')
  if (!ids.has('side-short') && !ids.has('side-long')) out.push('多空不对称')
  return out
}

export function pathCoverLine(gb: { nFloated: number; nClosed: number; nPath: number; meanRate: number | null }): string | null {
  if (gb.nPath <= 0) return null
  const n = gb.nClosed
  const pathPct = n ? pctPlain(gb.nPath / n, 0) : '—'
  const floatPct = n ? pctPlain(gb.nFloated / n, 0) : '—'
  const bits = [
    `日线路径可用 ${gb.nPath}/${n}，覆盖率 ${pathPct}`,
    `浮盈回吐分析有效 ${gb.nFloated}/${n}，有效率 ${floatPct}`,
  ]
  const skippedFloat = gb.nPath - gb.nFloated
  const skippedPath = n - gb.nPath
  if (skippedFloat > 0) bits.push(`另 ${skippedFloat} 笔有路径但未出现浮盈，未计入回吐`)
  if (skippedPath > 0) bits.push(`另 ${skippedPath} 笔因同日或缺行情无法估计路径`)
  if (gb.meanRate != null) bits.push(`平均回吐 ${pctPlain(gb.meanRate, 0)}`)
  return bits.join('。')
}

function queueRank(row: HowQueueRow): number {
  const impact = Math.abs(row.historical ?? row.recoverable ?? 0)
  const evidence =
    row.status === 'verified'
      ? 1
      : row.status === 'running'
        ? 0.8
        : row.status === 'pending'
          ? 0.5
          : row.status === 'blocked'
            ? 0.35
            : row.status === 'reference'
              ? 0.25
              : 0.2
  const exec =
    row.status === 'verified'
      ? 1
      : row.status === 'running'
        ? 0.9
        : row.status === 'pending'
          ? 0.55
          : row.status === 'blocked'
            ? 0.2
            : 0.12
  return impact * evidence * exec
}

function howQueue(book: Book, items: Diagnosis[], experiments: ExperimentRecord[]): HowQueueRow[] {
  const out: HowQueueRow[] = []
  const gb = book.space.giveback
  const mae = book.credibility.maeMfeComputableShare
  const active = experiments.filter((e) => e.status === 'active')
  const holdDx = items.find((d) => d.id.startsWith('time-hold-'))
  const holdRunning = active.some((e) => isDay4Shadow(e.constraint))
  const holdMisaligned = active.some((e) => isMisalignedHoldExperiment(e.constraint))
  const holdH3 = book.checkup.holdBuckets.find((r) => r.id === 'h3')
  const holdH1 = book.checkup.holdBuckets.find((r) => r.id === 'h1')
  const holdRest = book.checkup.holdBuckets.filter((r) => r.id !== 'h1')
  const restN = holdRest.reduce((s, r) => s + r.n, 0)
  const restPnl = holdRest.reduce((s, r) => s + r.pnl, 0)
  const restExp = restN ? restPnl / restN : null
  const stopBest = book.space.stopScan?.bestPreset
  const replayBest = book.space.ruleReplay.bestPreset
  const bh = book.space.oppCost.symbolBh
  const spy = book.space.oppCost.spy

  if (gb.nPath > 0 && gb.nFloated >= 5 && gb.sumDollar != null) {
    const partial = mae < 0.7 || gb.nPath < gb.nClosed
    out.push({
      id: 'giveback',
      title: '浮盈回吐',
      kind: 'theoretical',
      status: partial ? 'blocked' : 'pending',
      historical: null,
      recoverable: gb.sumDollar,
      recoverableKind: 'theoretical',
      finding: pathCoverLine(gb) ?? `日线最高点口径的回吐上限 ${money(gb.sumDollar)}`,
      next: partial ? '补齐日线路径后再做规则回放。不是可实现收益。' : '看规则回放，不要按最高点兑现。',
      diagnosisId: items.find((x) => x.id === 'space-giveback')?.id,
      canClaim: false,
    })
  }

  if (holdH3 && holdH3.n >= 5) {
    const d = holdDx
    const cap = money(-holdH3.pnl)
    out.push({
      id: 'hold-h3',
      title: '第 4 个交易日收盘退出（影子）',
      kind: 'historical',
      status: holdRunning ? 'running' : 'pending',
      historical: holdH3.pnl,
      recoverable: null,
      recoverableKind: 'mechanical',
      capLines: [`完全避开该组：${cap}`, '第 4 日退出可改善金额：未知，等待影子实验'],
      finding: `${holdH3.label} ${holdH3.n} 笔历史合计 ${money(holdH3.pnl)}。完全避开该组的样本内机械上限是 ${cap}。「第 4 日收盘退出」不等于完全不做这些交易，不能把 ${cap} 当成可实现改善。`,
      next: holdRunning
        ? '继续第 4 个交易日收盘影子实验。'
        : holdMisaligned
          ? '右侧把当前实验修正为第 4 个交易日收盘退出。'
          : '认领第 4 个交易日收盘影子实验，不改变真实退出。',
      diagnosisId: d?.id,
      canClaim: Boolean(d?.canClaim) && !holdRunning && !holdMisaligned,
    })
  }

  out.push({
    id: 'stops',
    title: '硬止损 2%～20%',
    kind: 'verified',
    status: stopBest ? 'verified' : 'rejected',
    historical: null,
    recoverable: stopBest && stopBest.delta > 0 ? stopBest.delta : null,
    recoverableKind: stopBest && stopBest.delta > 0 ? 'verified' : 'none',
    finding: stopBest
      ? `有预设档通过 FDR，相对实际 ${money(stopBest.delta)}`
      : '当前样本未验证任何预设硬止损参数，不建议上线。',
    next: stopBest ? '可认领该档规则实验。' : '保留现有方式。',
    diagnosisId: items.find((x) => x.id === 'space-stop')?.id,
    canClaim: Boolean(items.find((x) => x.id === 'space-stop')?.canClaim),
  })

  const ruleN = book.space.ruleReplay.rules.filter((r) => r.computable).length
  out.push({
    id: 'replay',
    title: '预设退出规则',
    kind: 'verified',
    status: replayBest ? 'verified' : 'rejected',
    historical: null,
    recoverable: replayBest && replayBest.delta > 0 ? replayBest.delta : null,
    recoverableKind: replayBest && replayBest.delta > 0 ? 'verified' : 'none',
    finding: replayBest
      ? `「${replayBest.label}」通过 FDR`
      : `当前 ${ruleN || 5} 条预设退出规则均未获得足够统计支持。`,
    next: replayBest ? '可认领该规则实验。' : '暂不采用。',
    diagnosisId: items.find((x) => x.id === 'space-replay')?.id,
    canClaim: Boolean(items.find((x) => x.id === 'space-replay')?.canClaim),
  })

  if (bh || spy) {
    const hit = bh ?? spy!
    out.push({
      id: 'opp-cost',
      title: '机会成本',
      kind: 'historical',
      status: 'reference',
      historical: hit.delta,
      recoverable: null,
      recoverableKind: 'none',
      finding: `本期主动交易相对同期持有基准落后 ${money(hit.delta)}。它不能直接告诉你应该采用哪条退出规则，可用于设置主动交易的最低收益门槛。`,
      next: '决策参考，不是候选修复。',
      canClaim: false,
    })
  }

  if (holdH1 && holdH1.n >= 0) {
    const h1Line =
      holdH1.n >= 5
        ? `持仓 <1 日 n=${holdH1.n}，合计 ${money(holdH1.pnl)}，单笔均值 ${holdH1.expectancy == null ? '—' : money(holdH1.expectancy)}`
        : `持仓 <1 日 n=${holdH1.n}，样本不足以单独下结论`
    const restLine =
      restN >= 5
        ? `≥1 日 n=${restN}，合计 ${money(restPnl)}，单笔均值 ${restExp == null ? '—' : money(restExp)}`
        : `≥1 日 n=${restN}`
    out.push({
      id: 'intraday',
      title: '日内平仓（候选）',
      kind: 'historical',
      status: 'pending',
      historical: holdH1.n >= 5 ? holdH1.pnl : null,
      recoverable: null,
      recoverableKind: 'unknown',
      finding: `${h1Line}。对照：${restLine}。这与「≥5 日亏损」不是同一个假设，不能用长持仓数字支持日内平仓。`,
      next: '待 <1 日 vs ≥1 日证据站稳后再认领。现在不要改成日内策略。',
      canClaim: false,
    })
  }

  return [...out].sort((a, b) => queueRank(b) - queueRank(a))
}

function howLeadOf(book: Book, queue: HowQueueRow[], experiments: ExperimentRecord[]): string {
  const gb = book.space.giveback
  const cap = gb.nPath > 0 && gb.nFloated >= 5 && gb.sumDollar != null ? money(gb.sumDollar) : null
  const running = experiments.some((e) => e.status === 'active' && isDay4Shadow(e.constraint))
  const misaligned = experiments.some((e) => e.status === 'active' && isMisalignedHoldExperiment(e.constraint))
  const hold = queue.find((r) => r.id === 'hold-h3')
  if (cap) {
    const expBit = misaligned
      ? '先把当前实验修正为第 4 个交易日收盘退出'
      : running || hold
        ? '继续第 4 个交易日收盘影子实验'
        : '认领第 4 个交易日收盘影子实验'
    return `本期观察到明显的浮盈回吐，但尚未验证出可靠的退出规则。${cap} 是日线路径下的理论回吐上限，不是可实现收益。当前建议${expBit}，并补齐 MAE/MFE 路径；2%～20% 硬止损和现有 5 条退出规则暂不建议采用。`
  }
  return '当前没有已验证、可直接上线的修复规则。先补齐日线路径，再决定是否做退出规则回放。硬止损和现有预设退出规则暂不建议采用。'
}

function howTabSummary(book: Book, experiments: ExperimentRecord[]): string {
  const gb = book.space.giveback
  const theory =
    gb.nPath > 0 && gb.nFloated >= 5 && gb.sumDollar != null ? money(gb.sumDollar) : '—'
  const stop = book.space.stopScan?.bestPreset
  const replay = book.space.ruleReplay.bestPreset
  const verified = Math.max(0, stop && stop.delta > 0 ? stop.delta : 0, replay && replay.delta > 0 ? replay.delta : 0)
  const active = experiments.filter((e) => e.status === 'active').length
  return `理论回吐上限 ${theory}｜已验证改善 ${money(verified)}｜${active} 项实验中`
}

function improveItems(queue: HowQueueRow[]): ImproveItem[] {
  return queue.map((r) => ({
    id: r.id,
    title: r.title,
    amount: r.recoverable ?? r.historical,
    finding: r.finding,
    action: r.next,
    diagnosisId: r.diagnosisId,
    canClaim: r.canClaim,
  }))
}

export function pickAction(items: Diagnosis[]): Diagnosis | null {
  const cands = items.filter((d) => d.canClaim && d.tone !== 'highlight')
  if (!cands.length) return null
  return [...cands].sort((a, b) => b.score - a.score)[0]
}

export function beOf(book: Book): CoverReport['be'] {
  const wr = book.performance.winRate.value
  const payoff = book.performance.payoff.value
  if (wr == null || payoff == null || !(payoff > 0)) return null
  const need = 1 / (1 + payoff)
  return { wr, need, gapPp: (wr - need) * 100 }
}

/** 全站盈亏平衡：胜率取整数百分点，平衡点取一位小数，差距用这两个展示值相减。 */
export function formatBe(be: { wr: number; need: number }) {
  const wrPct = Math.round(be.wr * 100)
  const needPct = Math.round(be.need * 1000) / 10
  const gapPp = Math.round((wrPct - needPct) * 10) / 10
  return {
    wrPct,
    needPct,
    gapPp,
    wrText: `${wrPct}%`,
    needText: `${needPct.toFixed(1)}%`,
    scan:
      gapPp === 0
        ? '距盈亏平衡持平'
        : gapPp > 0
          ? `距盈亏平衡多 ${gapPp.toFixed(1)}pp`
          : `距盈亏平衡差 ${Math.abs(gapPp).toFixed(1)}pp`,
  }
}

export function waterfallOf(book: Book) {
  const p = book.performance
  // 已实现走 FIFO 平仓合计，才能和绩效口径勾上；复盘往返不含 DRIP，不能拿来当瀑布前两根。
  const closed = book.trips.filter((t) => t.status === 'closed')
  const grossWin = closed.filter((t) => t.realizedPnl > 0).reduce((s, t) => s + t.realizedPnl, 0)
  const grossLoss = closed.filter((t) => t.realizedPnl < 0).reduce((s, t) => s + t.realizedPnl, 0)
  const steps: Array<{ id: string; label: string; delta: number; total?: boolean }> = [
    { id: 'win', label: '毛盈利', delta: grossWin },
    { id: 'loss', label: '毛亏损', delta: grossLoss },
  ]
  if (p.unrealizedPnl != null && Math.abs(p.unrealizedPnl) > 1e-6) {
    steps.push({ id: 'unreal', label: '未实现', delta: p.unrealizedPnl })
  }
  // 关键:末柱必须落在 hero 同一个 netPnl 上。中间步骤之和与 netPnl 的差,
  // 显式补成一根"分红/费用等"调节柱,而不是让末柱自己漂走 —— 保证瀑布自洽、终点=页面头条。
  const runBeforeNet = steps.reduce((s, x) => s + x.delta, 0)
  const plug = p.netPnl - runBeforeNet
  if (Math.abs(plug) > 1) {
    steps.push({ id: 'recon', label: '分红/费用等', delta: plug })
  }
  steps.push({ id: 'net', label: '净盈亏', delta: p.netPnl, total: true })
  return {
    steps,
    feeNote: p.feeDrag
      ? `已实现已含费用 ${money(-Math.abs(p.feeDrag))}，瀑布不再重复扣。最后一根 = 各段累加 = 页面头部的净盈亏。`
      : '毛盈亏加未实现,再补上分红/费用等未直接入账项,累加到最后一根 = 页面头部的净盈亏。',
  }
}

export function buildCover(
  book: Book,
  items: Diagnosis[],
  health: HealthReport,
  experiments: ExperimentRecord[],
): CoverReport {
  const n = book.performance.closedCount
  const struct = structureVerdict(book, items)
  const luck = luckLine(book)
  const queue = howQueue(book, items, experiments)
  const bench = benchLineOf(book)
  return {
    verdict: struct.long,
    verdictShort: struct.short,
    luckLine: luck.long,
    luckShort: luck.short,
    nLine: nLineOf(n),
    gaps: capabilityGaps(health),
    blocked: blockedByHealth(health),
    cleared: clearedChecks(book, items),
    benchLine: bench?.line ?? null,
    benchChip: bench?.chip ?? null,
    coverageLabel: health.label,
    summaries: {
      what: `${struct.short} · 数据${health.score >= 0.7 ? '较完整' : health.score >= 0.4 ? '中等可信' : '缺口较多'}`,
      why: whyTabSummary(items, luck.short),
      how: howTabSummary(book, experiments),
    },
    be: beOf(book),
    queue,
    improve: improveItems(queue),
    howLead: howLeadOf(book, queue, experiments),
    mainAction: pickAction(items),
    whyLead: whyLead(book, items, health),
  }
}
