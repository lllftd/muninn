import { etDateKey, etParts } from '../lib/time.ts'
import { mean, median, wilsonInterval } from '../lib/stats.ts'
import { REGIME_LABELS, REGIME_ORDER, holdDiagnostic, regimeMix } from './regime.ts'
import type { Checkup, Credibility, GroupRow, GroupStatus, RoundTrip, SampleBanner, SessionBucket } from '../types.ts'

const SESSION_LABELS: Record<SessionBucket, string> = {
  open30: '开盘 30min',
  midday: '盘中',
  close: '尾盘',
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function statusOf(n: number): GroupStatus {
  if (n <= 0) return 'empty'
  if (n < 5) return 'raw'
  if (n < 10) return 'observe'
  return 'ok'
}

function factOf(row: { n: number; pnl: number; winRate: number | null; label: string }): string {
  if (row.n <= 0) return '无样本'
  if (row.n < 5) {
    const allLoss = row.winRate === 0
    return `${row.n} 笔${allLoss ? '，均亏损' : ''}。仅为观察事实，不支持行为结论`
  }
  if (row.n < 10) {
    const allLoss = row.winRate === 0
    const allWin = row.winRate === 1
    if (allLoss) return `${row.n} 笔样本均亏损，样本不足，不能推断 ${row.label} 稳定较差`
    if (allWin) return `${row.n} 笔样本均盈利，样本不足，不能推断 ${row.label} 稳定较好`
    return `${row.n} 笔，样本不足，不能写成可重复规律`
  }
  return `${row.n} 笔观察，仍不是稳定结论`
}

function group(id: string, label: string, list: RoundTrip[], total?: number): GroupRow {
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
      pf: null,
      pnl: 0,
      status: 'empty',
      fact: '无样本',
      total,
    }
  }
  const winRate = wins.length / n
  const wilson = n >= 5 ? wilsonInterval(wins.length, n) : null
  const row = { n, pnl: list.reduce((s, t) => s + t.realizedPnl, 0), winRate, label }
  return {
    id,
    label,
    n,
    winRate,
    winCi: wilson ? { lo: wilson.lo, hi: wilson.hi, method: 'wilson' } : null,
    medianAtrR: median(rs),
    expectancy: mean(list.map((t) => t.realizedPnl)),
    pf: gl > 1e-9 ? gp / gl : gp > 0 ? Number.POSITIVE_INFINITY : 0,
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

  // 入场时机(时段)只对日内+波段有意义:持仓/长线的分钟级入场点几乎不影响结果。
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
    const list = closed.filter((t) => {
      const p = etParts(t.openTime)
      const dt = new Date(Date.UTC(p.year, p.month - 1, p.day))
      let wd = dt.getUTCDay()
      // 美东周日夜盘在交易日历上属于周一；周六凌晨同理归周五。
      if (wd === 0) wd = 1
      else if (wd === 6) wd = 5
      return wd === d
    })
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
          ? `亏损后样本 ${afterLoss.length} 笔，不足以判断是否加码`
          : `${tiltTrades.length}/${afterLoss.length} 在亏损后 2 小时内再开仓，观察事实，不是建议`,
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
          : `有窗口 ${chaseCovered.length}/${closed.length}；分位≥80 有 ${chased.length} 笔`,
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
  const reasons: string[] = [`${n} 笔复盘单元`, `${openDays} 个开仓日`]
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
      `MAE/MFE 可计算 ${pathOk}/${n}，同日往返不计算`,
      '本轮只做复盘描述，不输出预测、信号或仓位建议',
    ],
    analysisWindow: `${args.start} → ${args.end}（全样本描述）`,
    oosWindow: '未运行',
    modelTraining: '本轮不适用',
    minSampleNote:
      '保护同时看笔数和开仓日。闭环不足 30 笔或开仓日过少会触发保护；达到门槛也不代表自动有效。分组 n<10 不生成规律结论；n<5 只显示点估计。',
  }
}

export function autoTags(trip: RoundTrip): string[] {
  const tags: string[] = []
  if (trip.session === 'open30') tags.push('开盘')
  if ((trip.chasePercentile ?? 0) >= 80 && trip.chasePercentile != null) tags.push('追高')
  if ((trip.ma50Dist ?? 0) < -0.02) tags.push('低吸')
  if (trip.closePrice && Math.abs(trip.closePrice / trip.openPrice - 1) <= 0.01 && (trip.maePct ?? 0) <= -0.01) {
    tags.push('解套区')
  }
  if (trip.prevResult === 'loss' && trip.prevGapHours != null && trip.prevGapHours <= 2) tags.push('Tilt')
  if (trip.sameDay) tags.push('同日')
  if (trip.pathAnomaly) tags.push('路径异常')
  return tags
}
