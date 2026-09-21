import { etDateKey, etParts } from '../lib/time.ts'
import {
  BOOTSTRAP_SEED,
  clusterBootstrapSamples,
  ciFromSamples,
  mean,
  median,
  wilsonInterval,
} from '../lib/stats.ts'
import { REGIME_LABELS, REGIME_ORDER, holdDiagnostic, regimeMix } from './regime.ts'
import type { Checkup, Credibility, GroupRow, GroupStatus, RoundTrip, SampleBanner, SessionBucket, TagHint } from '../types.ts'

const SESSION_LABELS: Record<SessionBucket, string> = {
  open30: '开盘 30min',
  midday: '盘中',
  close: '尾盘',
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const GROUP_CI_ROUNDS = 400

function seedOf(id: string) {
  let s = BOOTSTRAP_SEED
  for (let i = 0; i < id.length; i++) s = (Math.imul(s, 33) + id.charCodeAt(i)) | 0
  return s >>> 0
}

function expectancyCiOf(id: string, list: RoundTrip[]): GroupRow['expectancyCi'] {
  if (list.length < 5) return null
  const map = new Map<string, RoundTrip[]>()
  for (const t of list) {
    const k = etDateKey(t.openTime)
    const arr = map.get(k) || []
    arr.push(t)
    map.set(k, arr)
  }
  const clusters = [...map.values()]
  if (clusters.length < 3) return null
  const samples = clusterBootstrapSamples(
    clusters,
    (items) => (items.length ? mean(items.map((x) => x.realizedPnl)) : null),
    seedOf(id),
    GROUP_CI_ROUNDS,
  )
  const ci = ciFromSamples(samples, 0.1, 0.9)
  if (!ci || ci.hi - ci.lo < 1e-6) return null
  return { lo: ci.lo, hi: ci.hi, method: 'bootstrap' }
}

function statusOf(n: number): GroupStatus {
  if (n <= 0) return 'empty'
  if (n < 5) return 'raw'
  if (n < 10) return 'observe'
  if (n < 30) return 'weak'
  return 'ok'
}

function factOf(row: { n: number; pnl: number; winRate: number | null; label: string }): string {
  if (row.n <= 0) return '无样本'
  if (row.n < 5) return `${row.n} 笔，只列交易，不排名、不报均值`
  if (row.n < 10) return `${row.n} 笔，探索性观察，可能被一两笔撑起来`
  if (row.n < 30) return `${row.n} 笔，只够弱结论，不能当可重复规律`
  return `${row.n} 笔，可以进入规则验证，仍不能外推样本外`
}

export function weekdayEt(openTime: Date): number {
  const p = etParts(openTime)
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day))
  let wd = dt.getUTCDay()
  if (wd === 0) wd = 1
  else if (wd === 6) wd = 5
  return wd
}

export function holdBucketOf(minutes: number): 'h1' | 'h2' | 'h3' {
  if (minutes < 24 * 60) return 'h1'
  if (minutes < 5 * 24 * 60) return 'h2'
  return 'h3'
}

export const HOLD_BUCKET_LABELS: Record<'h1' | 'h2' | 'h3', string> = {
  h1: '持仓 <1 日',
  h2: '持仓 1–5 日',
  h3: '持仓 ≥5 日',
}

export const WEEKDAY_LABELS = WEEKDAYS

export function group(id: string, label: string, list: RoundTrip[], total?: number): GroupRow {
  const wins = list.filter((t) => t.realizedPnl > 0)
  const losses = list.filter((t) => t.realizedPnl < 0)
  const gp = wins.reduce((s, t) => s + t.realizedPnl, 0)
  const gl = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0))
  const rs = list.map((t) => t.rMultiple).filter((v): v is number => v != null)
  const n = list.length
  if (!n) {
    return {
      id,
      label,
      n: 0,
      winRate: null,
      winCi: null,
      medianAtrR: null,
      expectancy: null,
      expectancyCi: null,
      expectancyExMax: null,
      pf: null,
      pnl: 0,
      status: 'empty',
      fact: '无样本',
      total,
    }
  }
  const winRate = wins.length / n
  const wilson = n >= 5 ? wilsonInterval(wins.length, n) : null
  const pnls = list.map((t) => t.realizedPnl)
  const expectancy = mean(pnls)
  let expectancyExMax: number | null = null
  if (n >= 2) {
    const maxI = pnls.reduce((best, v, i) => (Math.abs(v) > Math.abs(pnls[best]) ? i : best), 0)
    expectancyExMax = mean(pnls.filter((_, i) => i !== maxI))
  }
  const row = { n, pnl: list.reduce((s, t) => s + t.realizedPnl, 0), winRate, label }
  return {
    id,
    label,
    n,
    winRate,
    winCi: wilson ? { lo: wilson.lo, hi: wilson.hi, method: 'wilson' } : null,
    medianAtrR: median(rs),
    expectancy: n >= 5 ? expectancy : null,
    expectancyCi: n >= 5 ? expectancyCiOf(id, list) : null,
    expectancyExMax: n >= 5 ? expectancyExMax : null,
    pf: n >= 5 ? (gl > 1e-9 ? gp / gl : gp > 0 ? Number.POSITIVE_INFINITY : 0) : null,
    pnl: row.pnl,
    status: statusOf(n),
    fact: factOf(row),
    total,
  }
}

export function buildCheckup(trips: RoundTrip[]): Checkup {
  const closed = trips.filter((t) => t.status === 'closed')
  const wins = closed.filter((t) => t.realizedPnl > 0)
  const losses = closed.filter((t) => t.realizedPnl < 0)
  const winHold = wins.map((t) => t.holdMinutes)
  const lossHold = losses.map((t) => t.holdMinutes)
  const winMed = median(winHold)
  const lossMed = median(lossHold)
  const dispositionRatio = winMed && lossMed ? winMed / lossMed : null
  const dragged = winMed ? losses.filter((t) => t.holdMinutes > winMed) : []
  const dispositionAmount = dragged.reduce((s, t) => s + t.realizedPnl, 0)

  const chaseCovered = closed.filter((t) => t.chasePercentile != null)
  const chaseMean = chaseCovered.length ? mean(chaseCovered.map((t) => t.chasePercentile as number)) : null
  const chased = chaseCovered.filter((t) => (t.chasePercentile ?? 0) >= 80)
  const chaseAmount = chased.reduce((s, t) => s + t.realizedPnl, 0)

  const afterLoss = closed.filter((t) => t.prevResult === 'loss')
  const tiltTrades = afterLoss.filter((t) => t.prevGapHours != null && t.prevGapHours <= 2)
  const tiltSizes = tiltTrades.map((t) => t.positionPct).filter((v): v is number => v != null)
  const normalSizes = closed
    .filter((t) => !tiltTrades.includes(t))
    .map((t) => t.positionPct)
    .filter((v): v is number => v != null)
  const tiltSize = tiltSizes.length ? mean(tiltSizes) : 0
  const normalSize = normalSizes.length ? mean(normalSizes) : 0
  const tiltSizeMultiple = tiltSizes.length && normalSizes.length && normalSize ? tiltSize / normalSize : null
  const tiltAmount = tiltTrades.reduce((s, t) => s + t.realizedPnl, 0)

  // 入场时机(时段)只对日内+短线有意义:波段/长线的分钟级入场点几乎不影响结果。
  // 所以 session 面板只统计这批 cohort,样本量也按 cohort 算,不被长线那批稀释。
  const sessionCohort = closed.filter((t) => t.regime === 'intraday' || t.regime === 'swing')
  const sessions = (['open30', 'midday', 'close'] as SessionBucket[]).map((bucket) =>
    group(bucket, SESSION_LABELS[bucket], sessionCohort.filter((t) => t.session === bucket), sessionCohort.length),
  )
  // 显隐由 cohort 是否够大决定(不是账本单一 regime)。UI 仍留「展开全部」逃生口,判错只花一次点击。
  const sessionRelevant = sessionCohort.length >= 10
  const regimes = REGIME_ORDER.map((rg) =>
    group(rg, REGIME_LABELS[rg], closed.filter((t) => t.regime === rg), closed.length),
  )
  const sides = [
    group('long', '多头', closed.filter((t) => t.side === 'long'), closed.length),
    group('short', '空头', closed.filter((t) => t.side === 'short'), closed.length),
  ]
  const weekdaysEt = [1, 2, 3, 4, 5].map((d) => {
    const list = closed.filter((t) => weekdayEt(t.openTime) === d)
    return group(`wd${d}`, WEEKDAYS[d], list, closed.length)
  })
  const holdBuckets = [
    group('h1', '持仓 <1 日', closed.filter((t) => t.holdMinutes < 24 * 60), closed.length),
    group(
      'h2',
      '持仓 1–5 日',
      closed.filter((t) => t.holdMinutes >= 24 * 60 && t.holdMinutes < 5 * 24 * 60),
      closed.length,
    ),
    group('h3', '持仓 ≥5 日', closed.filter((t) => t.holdMinutes >= 5 * 24 * 60), closed.length),
  ]

  return {
    sessions,
    sessionRelevant,
    sessionCohortN: sessionCohort.length,
    regimeMix: regimeMix(closed),
    holdDiagnostic: holdDiagnostic(closed),
    regimes,
    sides,
    weekdays: weekdaysEt,
    holdBuckets,
    tilt: {
      nAfterLoss: afterLoss.length,
      nTilt: tiltTrades.length,
      sizeMultiple: tiltSizeMultiple,
      amount: tiltAmount,
      fact:
        afterLoss.length < 5
          ? `亏损后再开仓样本 ${afterLoss.length} 笔，不足以谈加码`
          : `疑似 Tilt：${tiltTrades.length}/${afterLoss.length} 在亏损后 2 小时内再开仓。这是规则命中，不是心理鉴定。`,
    },
    chase: {
      covered: chaseCovered.length,
      total: closed.length,
      mean: chaseMean,
      highN: chased.length,
      highPnl: chaseAmount,
      fact:
        chaseCovered.length === 0
          ? '没有足够的 20 日窗口，追高分位为缺失，不是 0'
          : `有 20 日窗口 ${chaseCovered.length}/${closed.length}；分位≥80 记为疑似追高 ${chased.length} 笔，不是已证实追涨`,
    },
    disposition: {
      ratio: dispositionRatio,
      n: closed.length,
      amount: dispositionAmount,
      fact: '盈利持仓时长中位数 / 亏损持仓时长中位数。均值容易被极端值拉动，这里用中位数。',
    },
  }
}

export function buildCredibility(args: {
  trips: RoundTrip[]
  dayCount: number
  start: string
  end: string
  feeImported: boolean
  metricVersion: string
  expectancyCi: { lo: number; hi: number | null; unboundedHi?: boolean } | null
  pfCi: { lo: number; hi: number | null; unboundedHi?: boolean } | null
  pf: number | null
  uniqueOpenDays?: number
  sensitive?: boolean
}): Credibility {
  const closed = args.trips.filter((t) => t.status === 'closed')
  const openDays = args.uniqueOpenDays ?? new Set(closed.map((t) => etDateKey(t.openTime))).size
  const pathOk = closed.filter((t) => t.pathQuality === 'daily_estimate').length
  const chaseOk = closed.filter((t) => t.chasePercentile != null).length
  const n = closed.length
  const expCross =
    !!args.expectancyCi && args.expectancyCi.lo < 0 && (args.expectancyCi.hi == null || args.expectancyCi.hi > 0)
  const pfCross =
    args.pf == null ||
    (!!args.pfCi && args.pfCi.lo < 1 && (args.pfCi.unboundedHi || args.pfCi.hi == null || args.pfCi.hi > 1))
  const reasons: string[] = [`${n} 笔`, `${openDays} 个开仓日`]
  if (expCross) reasons.push('单笔期望区间跨 0')
  if (pfCross) reasons.push('PF 区间跨 1')
  if (args.sensitive) reasons.push('对少数交易或复盘口径较敏感')

  let banner: SampleBanner
  let bannerText: string
  if (n < 10 || openDays < 5) {
    banner = 'cannot-assess'
    bannerText = '当前样本还不足以评估这段交易结果。'
  } else if (args.sensitive) {
    banner = 'sensitive'
    bannerText = '当前样本呈现结果，但对少数交易或复盘口径较敏感。'
  } else if (n < 30 || openDays < 15 || expCross || pfCross) {
    banner = 'insufficient'
    bannerText = '当前样本不足，区间仍跨过无优势一侧。'
  } else if (args.expectancyCi && args.expectancyCi.lo > 0) {
    banner = 'positive-sample'
    bannerText = '当前样本呈现正向结果，仍不能外推到样本外。'
  } else {
    banner = 'insufficient'
    bannerText = '当前样本可以描述，仍不足以支持外推。'
  }

  return {
    closedCount: n,
    uniqueOpenDays: openDays,
    dayCount: args.dayCount,
    start: args.start,
    end: args.end,
    feeCoverage: args.feeImported ? '佣金/SEC/TAF 已导入，已计入已实现盈亏' : '费用未提供',
    maeMfeComputableShare: n ? pathOk / n : 0,
    chaseCoverage: n ? chaseOk / n : 0,
    metricVersion: args.metricVersion,
    banner,
    bannerText,
    bannerDetail: reasons.join('｜'),
    notes: [
      `MAE/MFE 可计算 ${pathOk}/${n}（日线粗估，同日往返不计算）`,
      '本轮只做复盘描述，不输出预测、信号或仓位建议',
    ],
    analysisWindow: `${args.start} → ${args.end}（全样本描述）`,
    oosWindow: '未运行',
    modelTraining: '本轮不适用',
    minSampleNote:
      'n<5 只列交易不报均值；5–9 灰显探索性；10–29 弱结论；≥30 才进入规则验证。同时看去掉最大一笔后的均值。',
  }
}

export function autoTagHints(trip: RoundTrip): TagHint[] {
  const hints: TagHint[] = []
  if (trip.session === 'open30') {
    hints.push({
      tag: '开盘',
      confidence: 'high',
      evidence: '开仓落在美东开盘后约 30 分钟内。',
      definition: '时段标签，不是好坏判断。',
    })
  }
  if (trip.chasePercentile != null && trip.chasePercentile >= 80) {
    hints.push({
      tag: '追高',
      confidence: trip.chasePercentile >= 90 ? 'high' : 'mid',
      evidence: `开仓时 20 日涨幅处在历史 ${trip.chasePercentile.toFixed(0)} 分位。`,
      definition: '疑似追高：相对自身近期涨幅偏贵。不是建议，也可能只是趋势跟随。',
    })
  }
  if (trip.ma50Dist != null && trip.ma50Dist < -0.02) {
    hints.push({
      tag: '低吸',
      confidence: trip.ma50Dist < -0.05 ? 'mid' : 'low',
      evidence: `开仓价低于 50 日均线 ${Math.abs(trip.ma50Dist * 100).toFixed(1)}%。`,
      definition: '疑似低吸：相对均线偏便宜。不是价值判断。',
    })
  }
  if (
    trip.closePrice &&
    trip.openPrice > 0 &&
    Math.abs(trip.closePrice / trip.openPrice - 1) <= 0.01 &&
    (trip.maePct ?? 0) <= -0.01
  ) {
    hints.push({
      tag: '解套区',
      confidence: 'low',
      evidence: `收盘价回到开仓价附近（±1%），持仓期内日线估算曾回撤 ${((trip.maePct as number) * 100).toFixed(1)}%。也可能是正常重新入场。`,
      definition: '仅当「几乎原价离场」且「持仓期出现过明显浮亏」时标记。不是心理鉴定。',
    })
  }
  if (trip.prevResult === 'loss' && trip.prevGapHours != null && trip.prevGapHours <= 2) {
    const mins = Math.max(1, Math.round(trip.prevGapHours * 60))
    hints.push({
      tag: 'Tilt',
      confidence: trip.prevGapHours <= 0.5 ? 'high' : trip.prevGapHours <= 1 ? 'mid' : 'low',
      evidence: `亏损平仓后 ${mins} 分钟内同方向或下一笔再开仓。`,
      definition: '疑似 Tilt：亏损后很快再开。仓位是否放大看账户层，不在这一笔上坐实。',
    })
  }
  if (trip.sameDay) {
    hints.push({
      tag: '同日',
      confidence: 'high',
      evidence: '开平仓落在同一交易日，日线 MAE/MFE 不适用。',
      definition: '路径口径标签。',
    })
  }
  if (trip.pathAnomaly) {
    hints.push({
      tag: '路径异常',
      confidence: 'mid',
      evidence: '已实现盈亏超过日线估算 MFE，日线高低可能没覆盖真实成交。',
      definition: '数据口径警告，不是交易评价。',
    })
  }
  return hints
}

export function autoTags(trip: RoundTrip): string[] {
  return autoTagHints(trip).map((h) => h.tag)
}
