import { money, pct, pctPlain } from '../lib/format.ts'
import type { Diagnosis } from './diagnose.ts'
import type { HealthReport } from './health.ts'
import type { Book } from '../types.ts'
import type { ExperimentRecord } from '../lib/experiments.ts'

export type CoverGap = {
  id: string
  title: string
  unlocks: string
  done: boolean
  action?: 'account' | 'guide'
  tone: 'ok' | 'watch' | 'fail'
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
  mainAction: Diagnosis | null
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

function nLineOf(n: number) {
  if (n < 10) return `${n} 笔 → 整体低置信，细分不做结论。`
  if (n < 50) return `${n} 笔 → 整体层面中置信，月度/分组低置信。后续部分发现因此标注低置信。`
  return `${n} 笔 → 整体中高置信，月度与小分组仍低置信。`
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

function luckLine(book: Book, items: Diagnosis[]): { long: string; short: string } {
  const luck = items.find((d) => d.id === 'luck-loss-mass')
  const mc = book.analytics.monteCarlo
  if (luck) {
    return { long: '更像体系偏亏，不是路径运气。', short: '非运气' }
  }
  if (!mc || !mc.terminals.length) return { long: '平行结果还不够，运气先不判。', short: '运气未判' }
  const lose = mc.terminals.filter((v) => v <= 0).length / mc.terminals.length
  if (lose >= 0.55) return { long: '更像体系偏亏，不是路径运气。', short: '非运气' }
  if (lose <= 0.4) return { long: '终值为负的抽样不到一半，路径运气的成分更大。', short: '偏路径' }
  return { long: '运气大致中性，结构问题看归因。', short: '运气中性' }
}

function blockedByHealth(health: HealthReport): string[] {
  return health.tasks.filter((t) => !t.done).map((t) => `${t.title}：缺了就不能下${t.unlocks}`)
}

function gapTone(done: boolean, id: string, health: HealthReport): CoverGap['tone'] {
  if (done) return 'ok'
  if (id === 'mae' && health.score < 0.4) return 'fail'
  return 'watch'
}

export function capabilityGaps(health: HealthReport): CoverGap[] {
  const byId = new Map(health.tasks.map((t) => [t.id, t]))
  const row = (id: string, title: string, fallbackUnlocks: string, done: boolean, action?: CoverGap['action']): CoverGap => {
    const t = byId.get(id)
    return {
      id,
      title: t?.title ?? title,
      unlocks: t?.unlocks ?? fallbackUnlocks,
      done,
      action: done ? undefined : action,
      tone: gapTone(done, id, health),
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

function improveItems(book: Book, items: Diagnosis[]): ImproveItem[] {
  const out: ImproveItem[] = []
  const gb = book.space.giveback
  if (gb.sumDollar != null && gb.nFloated >= 5) {
    const d = items.find((x) => x.id === 'space-giveback')
    out.push({
      id: 'giveback',
      title: '浮盈回吐（规则回放可达上界）',
      amount: gb.sumDollar,
      finding: d ? d.headline : `曾经浮盈 ${gb.nFloated} 笔，平均回吐 ${gb.meanRate == null ? '—' : pctPlain(gb.meanRate, 0)}`,
      action: '看规则回放，不要按最高点兑现。',
      diagnosisId: d?.id,
      canClaim: false,
    })
  }
  for (const id of ['space-stop', 'space-replay', 'time-hold-h3', 'time-hold-h2', 'time-hold-h1']) {
    const d = items.find((x) => x.id === id || x.id.startsWith(id))
    if (!d || d.tone === 'highlight') continue
    if (out.some((x) => x.diagnosisId === d.id)) continue
    out.push({
      id: d.id,
      title: d.headline,
      amount: d.impactAbs || null,
      finding: d.phenomenon,
      action: d.canClaim ? '可认领实验' : d.next,
      diagnosisId: d.id,
      canClaim: d.canClaim,
    })
  }
  out.sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0))
  return out.slice(0, 3)
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
  if (p.unrealizedPnl != null) {
    steps.push({ id: 'unreal', label: '未实现', delta: p.unrealizedPnl })
    steps.push({ id: 'recon', label: '勾稽', delta: p.reconDifference })
  }
  steps.push({ id: 'net', label: '净盈亏', delta: p.netPnl, total: true })
  return {
    steps,
    feeNote: p.feeDrag
      ? `已实现已含费用 ${money(-Math.abs(p.feeDrag))}，瀑布不再扣一次。最后一根是累计净盈亏。`
      : '毛盈亏接到未实现与勾稽，最后一根是累计净盈亏。',
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
  const luck = luckLine(book, items)
  const high = items.filter((d) => d.section === 'impact' && d.tone !== 'highlight')
  const active = experiments.filter((e) => e.status === 'active').length
  const spaceAmt = book.space.giveback.sumDollar
  const howSpace = spaceAmt != null && book.space.giveback.nFloated >= 5 ? money(spaceAmt) : '—'
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
      why: `${high.length} 个主因 · ${luck.short}`,
      how: `空间 ${howSpace} · ${active} 个实验进行中`,
    },
    be: beOf(book),
    improve: improveItems(book, items),
    mainAction: pickAction(items),
  }
}
