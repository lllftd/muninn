import { money, pct, pctPlain } from '../lib/format.ts'
import type { Diagnosis } from './diagnose.ts'
import type { HealthReport } from './health.ts'
import type { Book } from '../types.ts'
import { evaluateActions } from './counterfactual.ts'

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
  howLead: { problem: string; action: string; limit: string }
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
  /** 候选卡片结构化字段：哪里做得不好 */
  problem?: string
  /** 发生范围（影响多少笔、集中度） */
  scope?: string
  /** 如何优化 */
  action?: string
  /** 不适用 / 排除范围 */
  excludes?: string
  /** 潜在副作用 */
  risk?: string
  /** 当前结论（观察阶段用，区别于「如何优化」） */
  conclusion?: string
  /** 证据阶段标签，如「仅作诊断 / 当前证据不足 / 历史回放未通过 / 已否决」 */
  stage?: string
  /** 前 5 笔贡献比例 (0..1)。null 表示无法计算或不足 5 笔。 */
  concentrationShare?: number | null
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
  return `${behavior} 项行为问题 · ${cand} 项分组差异 · ${luckBit}`
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

function holdLossConcentration(book: Book, minDays: number): number | null {
  const losses = book.episodes
    .filter(
      (t) =>
        t.status === 'closed' &&
        !t.tags.includes('DRIP') &&
        t.holdMinutes >= minDays * 1440 &&
        t.realizedPnl < 0,
    )
    .sort((a, b) => a.realizedPnl - b.realizedPnl)
  const total = losses.reduce((s, t) => s + t.realizedPnl, 0)
  if (total >= 0 || !losses.length) return null
  const top5 = losses.slice(0, 5).reduce((s, t) => s + t.realizedPnl, 0)
  return top5 / total
}

function givebackTopShare(book: Book): number | null {
  const rows = book.episodes
    .filter(
      (t) =>
        t.status === 'closed' &&
        !t.tags.includes('DRIP') &&
        t.pathQuality === 'daily_estimate' &&
        !t.pathAnomaly &&
        !t.splitSuspect &&
        (t.mfeDollar ?? 0) > 0,
    )
    .map((t) => ({ dollar: Math.max(0, (t.mfeDollar as number) - t.realizedPnl) }))
    .sort((a, b) => b.dollar - a.dollar)
  const total = rows.reduce((s, r) => s + r.dollar, 0)
  const top5 = rows.slice(0, 5).reduce((s, r) => s + r.dollar, 0)
  return total > 0 ? top5 / total : null
}

function howQueue(book: Book, items: Diagnosis[]): HowQueueRow[] {
  const out: HowQueueRow[] = []
  const gb = book.space.giveback
  const mae = book.credibility.maeMfeComputableShare
  const holdDx = items.find((d) => d.id.startsWith('time-hold-'))
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
  const gbTopShare = givebackTopShare(book)

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
      problem: '部分交易从最大浮盈大幅回吐，最终转亏或利润明显缩水。',
      scope: `${gb.nFloated} 笔有浮盈路径可分析；回吐损失高度集中，不代表普遍问题。`,
      conclusion: '暂未形成可直接执行的退出调整。',
      action: '分别回放移动止盈、持有时限和预设退出规则，比较净改善与盈利截断。',
      excludes: '最大浮盈（MFE）是事后才知道的，不能当作实时退出条件。',
      risk: '过早止盈可能截断原本能走得更远的趋势交易。',
      stage: '仅作诊断',
      concentrationShare: gbTopShare,
    })
  }

  if (holdH3 && holdH3.n >= 5) {
    const d = holdDx
    const cap = money(-holdH3.pnl)
    out.push({
      id: 'hold-h3',
      title: '长持仓（≥5 日）亏损',
      kind: 'historical',
      status: 'pending',
      historical: holdH3.pnl,
      recoverable: null,
      recoverableKind: 'mechanical',
      capLines: [`完全避开该组：${cap}`, '这是样本内机械上限，不是可实现改善'],
      finding: `${holdH3.label} ${holdH3.n} 笔历史合计 ${money(holdH3.pnl)}。完全避开该组的样本内机械上限是 ${cap}，不等于可实现的改善。`,
      next: '作为诊断，不建议据此对持仓天数做统一干预。',
      diagnosisId: d?.id,
      canClaim: false,
      problem: '部分长持仓交易最终亏损扩大。',
      scope: `影响 ${holdH3.n} 笔持仓 ≥5 日；主要损失集中在少数几笔。`,
      action: '优先约束单笔亏损规模与建仓风险。',
      excludes: '中长线仓位、事件交易、已有明确延长持有理由的交易。',
      risk: '对持仓天数做统一干预可能截断仍在恢复的交易。',
      stage: '当前证据不足',
      concentrationShare: holdLossConcentration(book, 5),
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
    problem: '部分亏损交易回撤幅度可能过大，缺少机械止损保护。',
    action: stopBest ? `验证 ${pctPlain(stopBest.pct, 0)} 档硬止损。` : '验证 2%～20% 预设硬止损。',
    excludes: '日线无法判断盘中先后；止损触发点可能与实际成交价存在偏差。',
    risk: '过紧的止损可能把正常波动震出。',
    stage: stopBest ? '已验证' : '历史回放未通过',
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
    problem: '现有退出方式缺乏可重复的纪律，结果受临场判断影响。',
    action: replayBest ? `验证「${replayBest.label}」规则。` : '验证 trailing / 持有时限等预设退出规则。',
    excludes: '规则回放只覆盖有日线路径的交易，不含同日或缺行情交易。',
    risk: '机械规则可能在某些市场状态下系统性劣于人工管理。',
    stage: replayBest ? '已验证' : '历史回放未通过',
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
      title: '日内与隔夜持有差异',
      kind: 'historical',
      status: 'pending',
      historical: holdH1.n >= 5 ? holdH1.pnl : null,
      recoverable: null,
      recoverableKind: 'unknown',
      finding: `${h1Line}。对照：${restLine}。这与「≥5 日亏损」不是同一个假设，不能用长持仓数字支持日内平仓。`,
      next: '待 <1 日 vs ≥1 日证据站稳后再认领。现在不要改成日内策略。',
      canClaim: false,
      problem: '日内平仓是否优于隔夜 / 多日持有，证据尚未站稳。',
      action: '待 <1 日 vs ≥1 日对照证据站稳后再考虑，不直接改成日内策略。',
      excludes: '与「≥5 日亏损」不是同一个假设；不能用长持仓数字支持日内平仓。',
      risk: '日内交易受 PDT 约束，且频繁进出会推高成本。',
      stage: '待分析',
    })
  }

  return [...out].sort((a, b) => queueRank(b) - queueRank(a))
}

function howLeadOf(book: Book): { problem: string; action: string; limit: string } {
  const gb = book.space.giveback
  const topShare = givebackTopShare(book)

  const conc = topShare != null && topShare >= 0.7 ? `前 5 笔贡献超过 ${Math.round(topShare * 100)}%` : '高度集中'
  const problem = `损失主要集中在少数长持仓和高回吐交易中，但${conc}，不代表普遍问题。`
  const action = '优先约束单笔亏损规模与建仓风险，而不是按持仓天数统一干预。'
  const hasPathGap = gb.nPath > 0 && gb.nPath < gb.nClosed
  const limit = `该结论基于当前账本${hasPathGap ? '（部分交易缺少日线路径）' : ''}，不构成后续追踪承诺。`
  return { problem, action, limit }
}

function howTabSummary(book: Book): string {
  const actions = evaluateActions(book.space)
  const exec = actions.filter((a) => a.kind === 'replay' || a.kind === 'stop')
  const unsupported = exec.filter((a) => a.verdict === '当前不支持')
  const worth = exec.filter((a) => a.verdict === '值得考虑')
  const s = book.sensitivity
  if (exec.length && unsupported.length === exec.length) return '统一退出/止损未改善历史结果'
  if (worth.length) return '部分改法有历史依据'
  if (s.top5Share != null && s.top5Share >= 0.5) return '亏损集中在少数大额交易'
  return '暂无可靠改进规则'
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
): CoverReport {
  const n = book.performance.closedCount
  const struct = structureVerdict(book, items)
  const luck = luckLine(book)
  const queue = howQueue(book, items)
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
      how: howTabSummary(book),
    },
    be: beOf(book),
    queue,
    improve: improveItems(queue),
    howLead: howLeadOf(book),
    mainAction: pickAction(items),
    whyLead: whyLead(book, items, health),
  }
}
