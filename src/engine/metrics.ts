import { etDateKey, eachWeekday } from '../lib/time.ts'
import { alignRf, compoundCashIndex } from '../lib/rf.ts'
import {
  BOOTSTRAP_ROUNDS,
  BOOTSTRAP_SEED,
  clusterBootstrap,
  mean,
  median,
  ols,
  olsHac,
  quantile,
  stdev,
  wilsonInterval,
  xirr,
} from '../lib/stats.ts'
import { METRIC_VERSION } from '../types.ts'
import type {
  AlphaDiag,
  Bar,
  Cashflow,
  CoverageRow,
  EquityPoint,
  Fill,
  MetricPoint,
  PathAudit,
  Performance,
  RfStatus,
  RoundTrip,
} from '../types.ts'

function lastClose(bars: Bar[] | undefined, date: string, fallback: number): number {
  if (!bars?.length) return fallback
  const hit = bars.filter((b) => b.date <= date).at(-1)
  return hit?.close ?? fallback
}

type Lot = { symbol: string; qty: number; price: number; dir: 1 | -1 }

export function buildEquity(args: {
  fills: Fill[]
  cashflows: Cashflow[]
  bars: Record<string, Bar[]>
  initialCapital: number
  sleeve?: boolean
}): { equity: EquityPoint[]; rf: RfStatus } {
  const { fills, cashflows, bars, initialCapital, sleeve = false } = args
  const spy = bars.SPY || []
  const spx = bars['^GSPC'] || bars.SPX || []
  const benchBars = spy.length ? spy : spx
  const tradeDates = [...fills.map((f) => etDateKey(f.time)), ...cashflows.map((c) => etDateKey(c.time))].sort()
  if (!tradeDates.length) {
    return {
      equity: [],
      rf: {
        source: 'zero-fallback',
        version: 'rf0',
        asOf: null,
        lastDate: null,
        warning: '无风险数据缺失，使用 0 近似。这不等于已确认无风险收益接近 0。',
        approx: 'missing-zero' as const,
      },
    }
  }
  const start = tradeDates[0]
  const end = tradeDates[tradeDates.length - 1]
  const days = benchBars.length
    ? benchBars.filter((b) => b.date >= start && b.date <= end).map((b) => b.date)
    : eachWeekday(start, end)

  const fillsByDay = new Map<string, Fill[]>()
  for (const fill of [...fills].sort((a, b) => a.time.getTime() - b.time.getTime())) {
    const k = etDateKey(fill.time)
    const arr = fillsByDay.get(k) || []
    arr.push(fill)
    fillsByDay.set(k, arr)
  }
  const cfByDay = new Map<string, number>()
  for (const cf of cashflows) {
    const k = etDateKey(cf.time)
    const signed = cf.type === 'deposit' ? cf.amount : -cf.amount
    cfByDay.set(k, (cfByDay.get(k) || 0) + signed)
  }

  const { daily: rfDaily, status: rf } = alignRf(days, bars['^IRX'] || bars.IRX)
  const cashIndexSeries = compoundCashIndex(rfDaily)

  let cash = initialCapital
  const lots: Lot[] = []
  const points: EquityPoint[] = []
  let index = 100
  let benchIndex = 100
  let prevBench: number | null = null
  let peak = 100
  let peakEq = sleeve ? 0 : initialCapital
  let prevEquity = initialCapital

  const marketValue = (date: string) =>
    lots.reduce((s, lot) => {
      const px = lastClose(bars[lot.symbol], date, lot.price)
      if (!(px > 0)) return s + lot.price * lot.qty * lot.dir
      return s + px * lot.qty * lot.dir
    }, 0)

  for (let di = 0; di < days.length; di++) {
    const date = days[di]
    const cf = cfByDay.get(date) || 0
    cash += cf
    const dayFills = fillsByDay.get(date) || []
    for (const fill of dayFills) {
      const feeRate = fill.qty ? fill.fees / fill.qty : 0
      let left = fill.qty
      if (fill.side === 'buy') {
        for (const lot of lots) {
          if (left <= 1e-10) break
          if (lot.symbol !== fill.symbol || lot.dir !== -1) continue
          const take = Math.min(lot.qty, left)
          cash -= take * fill.price + feeRate * take
          lot.qty -= take
          left -= take
        }
        if (left > 1e-10) {
          cash -= left * fill.price + feeRate * left
          lots.push({ symbol: fill.symbol, qty: left, price: fill.price, dir: 1 })
        }
      } else {
        for (const lot of lots) {
          if (left <= 1e-10) break
          if (lot.symbol !== fill.symbol || lot.dir !== 1) continue
          const take = Math.min(lot.qty, left)
          cash += take * fill.price - feeRate * take
          lot.qty -= take
          left -= take
        }
        if (left > 1e-10) {
          cash += left * fill.price - feeRate * left
          lots.push({ symbol: fill.symbol, qty: left, price: fill.price, dir: -1 })
        }
      }
    }
    for (let i = lots.length - 1; i >= 0; i--) if (lots[i].qty <= 1e-10) lots.splice(i, 1)

    const mv = marketValue(date)
    const cost = lots.reduce((s, lot) => s + lot.price * lot.qty * lot.dir, 0)
    const mtm = mv - cost
    const equity = cash + mv
    const base = prevEquity + cf
    const ret = !sleeve && base > 1e-8 ? (equity - base) / base : 0
    if (!sleeve) index *= 1 + ret
    const benchPx = lastClose(benchBars, date, prevBench || 0)
    if (benchPx > 0) {
      if (prevBench && prevBench > 0) benchIndex *= benchPx / prevBench
      prevBench = benchPx
    }
    if (sleeve) peakEq = Math.max(peakEq, equity)
    else peak = Math.max(peak, index)
    const gross = lots.reduce((s, lot) => {
      const px = lastClose(bars[lot.symbol], date, lot.price)
      return s + Math.abs((px > 0 ? px : lot.price) * lot.qty)
    }, 0)
    const net = lots.reduce((s, lot) => {
      const px = lastClose(bars[lot.symbol], date, lot.price)
      return s + (px > 0 ? px : lot.price) * lot.qty * lot.dir
    }, 0)
    const den = sleeve ? Math.max(Math.abs(equity), gross, 1e-8) : equity
    const dd = sleeve
      ? peakEq > 1e-8
        ? equity / peakEq - 1
        : equity < 0
          ? -1
          : 0
      : peak
        ? index / peak - 1
        : 0
    prevEquity = equity
    points.push({
      date,
      equity,
      cash,
      mtm,
      cashflow: cf,
      index,
      benchIndex,
      cashIndex: cashIndexSeries[di] ?? 100,
      excess: 0,
      drawdown: dd,
      grossExposure: den > 0 ? gross / den : 0,
      netExposure: den > 0 ? net / den : 0,
      rf: rfDaily[di] ?? 0,
      rollingSharpe: null,
      rollingBeta: null,
    })
  }

  const rets = points.map((p, i) => (i === 0 ? 0 : sleeve ? 0 : p.index / points[i - 1].index - 1))
  const bRets = points.map((p, i) => (i === 0 ? 0 : p.benchIndex / points[i - 1].benchIndex - 1))
  const rfAdj = rets.map((r, i) => r - (points[i]?.rf ?? 0))
  const win = 63
  for (let i = 0; i < points.length; i++) {
    const row = points[i]
    row.excess = row.benchIndex ? row.index / row.benchIndex - 1 : 0
    if (i < win) continue
    const slice = rfAdj.slice(i - win + 1, i + 1)
    const bslice = bRets.slice(i - win + 1, i + 1)
    const sd = stdev(slice)
    points[i].rollingSharpe = sd ? (mean(slice) / sd) * Math.sqrt(252) : 0
    points[i].rollingBeta = ols(bslice, rets.slice(i - win + 1, i + 1))?.beta ?? null
  }
  return { equity: points, rf }
}

export function dailyRetsFromIndex(index: number[]): number[] {
  return index.map((v, i) => (i === 0 ? v / 100 - 1 : index[i - 1] ? v / index[i - 1] - 1 : 0))
}

export function auditAccountPath(
  equity: EquityPoint[],
  twr: number | null,
  relativeSpx: number | null,
  maxDrawdown: number | null,
): PathAudit {
  const issues: string[] = []
  if (equity.length < 2) {
    return { ok: false, issues: ['日收益序列不足'], n: equity.length, twrFromIndex: 0, relativeSpxFromIndex: 0, maxDrawdownFromIndex: 0, maxAbsDaily: 0 }
  }
  const last = equity[equity.length - 1]
  const twrFromIndex = last.index / 100 - 1
  const relativeSpxFromIndex = last.benchIndex > 0 ? last.index / last.benchIndex - 1 : 0
  const maxDrawdownFromIndex = Math.min(...equity.map((e) => e.drawdown), 0)
  const rets = dailyRetsFromIndex(equity.map((e) => e.index))
  const maxAbsDaily = rets.reduce((m, r) => Math.max(m, Math.abs(r)), 0)
  if (twr != null && Math.abs(twr - twrFromIndex) > 1e-9) issues.push('TWR 与财富曲线终值不一致')
  if (relativeSpx != null && Math.abs(relativeSpx - relativeSpxFromIndex) > 1e-6) issues.push('相对基准财富与财富曲线终值比不一致')
  if (maxDrawdown != null && Math.abs(maxDrawdown - maxDrawdownFromIndex) > 1e-9) issues.push('最大回撤与财富曲线 drawdown 最小值不一致')
  if (maxAbsDaily > 0.5) issues.push(`单日收益绝对值达 ${(maxAbsDaily * 100).toFixed(1)}%，疑似分母或盯市错误`)
  const cfJump = equity.filter((e, i) => i > 0 && Math.abs(e.cashflow) > 1 && Math.abs(rets[i]) > 0.2)
  if (cfJump.length) issues.push('出入金日出现过大 TWR 跳变，现金流可能未剥离')
  return {
    ok: issues.length === 0,
    issues,
    n: rets.length,
    twrFromIndex,
    relativeSpxFromIndex,
    maxDrawdownFromIndex,
    maxAbsDaily,
  }
}

function metric(
  value: number | null,
  n: number,
  eligible: number,
  excluded: number,
  basis: string,
  ci: MetricPoint['ci'] = null,
  naReason?: string,
): MetricPoint {
  return { value, n, eligible, excluded, ci, basis, naReason }
}

function pfOf(trips: RoundTrip[]): number | null {
  const gp = trips.filter((t) => t.realizedPnl > 0).reduce((s, t) => s + t.realizedPnl, 0)
  const gl = Math.abs(trips.filter((t) => t.realizedPnl < 0).reduce((s, t) => s + t.realizedPnl, 0))
  if (gl < 1e-9) return gp > 0 ? Number.POSITIVE_INFINITY : 0
  return gp / gl
}

export function summarize(args: {
  trips: RoundTrip[]
  equity: EquityPoint[]
  cashflows: Cashflow[]
  initialCapital: number | null
  cashflowComplete: boolean
  cashflowsProvided: boolean
  feeImported: boolean
  rf: Performance['rf']
  hasNav: boolean
  equitySubsetOnly: boolean
  accountReturnReason: string | null
  reviewTrips?: RoundTrip[]
  benchKind?: Performance['benchKind']
}): Performance {
  const {
    trips,
    equity,
    cashflows,
    initialCapital,
    cashflowComplete,
    cashflowsProvided,
    feeImported,
    rf,
    hasNav,
    equitySubsetOnly,
    accountReturnReason,
    reviewTrips,
    benchKind = 'spx-price',
  } = args
  const canAccount = hasNav && !equitySubsetOnly && initialCapital != null
  const pathKind: Performance['pathKind'] = canAccount ? 'account' : 'sleeve'
  const ledgerClosed = trips.filter((t) => t.status === 'closed')
  const review = (reviewTrips || trips).filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  const closedAll = ledgerClosed
  const closed = review
  const wins = closed.filter((t) => t.realizedPnl > 0)
  const losses = closed.filter((t) => t.realizedPnl < 0)
  const feeDrag = trips.reduce((s, t) => s + t.fees, 0)
  const deposits = cashflows.filter((c) => c.type === 'deposit').reduce((s, c) => s + c.amount, 0)
  const withdrawals = cashflows.filter((c) => c.type === 'withdraw').reduce((s, c) => s + c.amount, 0)
  const realizedPnl = closedAll.reduce((s, t) => s + t.realizedPnl, 0)
  const sleeve = pathKind === 'sleeve' && equity.length > 0
  const unrealizedPnl = canAccount || sleeve ? (equity.at(-1)?.mtm ?? 0) : null
  const finalEquity = canAccount || sleeve ? (equity.at(-1)?.equity ?? (canAccount ? initialCapital : 0)) : null
  const netPnl =
    canAccount && initialCapital != null && finalEquity != null
      ? finalEquity - initialCapital - deposits + withdrawals
      : sleeve
        ? (equity.at(-1)?.equity ?? realizedPnl)
        : realizedPnl
  const twr = canAccount && equity.at(-1) ? equity[equity.length - 1].index / 100 - 1 : null
  const first = equity[0]
  const last = equity.at(-1)
  const yearFrac =
    first && last ? Math.max((Date.parse(last.date) - Date.parse(first.date)) / (365 * 86400000), 1 / 365) : 1
  const twrAnnualized = twr != null ? (1 + twr) ** (1 / yearFrac) - 1 : null

  let xirrValue: number | null = null
  let xirrReason: string | undefined
  let xirrStatus: Performance['xirrStatus'] = 'incomplete'
  if (!canAccount) {
    xirrReason = '没有账户净资产和完整入出金，不猜 XIRR'
    xirrStatus = 'incomplete'
  } else if (!cashflowComplete) {
    xirrReason = '未确认现金流是否完整，XIRR 显示 N/A'
    xirrStatus = 'incomplete'
  } else {
    const cfs: Array<{ date: Date; amount: number }> = []
    if (first && initialCapital != null) cfs.push({ date: new Date(`${first.date}T20:00:00Z`), amount: -initialCapital })
    for (const cf of cashflows) {
      cfs.push({ date: cf.time, amount: cf.type === 'deposit' ? -cf.amount : cf.amount })
    }
    if (last && finalEquity != null) cfs.push({ date: new Date(`${last.date}T20:00:00Z`), amount: finalEquity })
    const solved = xirr(cfs)
    xirrValue = solved.value
    xirrStatus = solved.status
    if (solved.status === 'no-root') xirrReason = '现金流在合法区间内没有有效解'
    else if (solved.status === 'multiple') xirrReason = '存在多个内部收益率，结果不可唯一解释'
    else if (solved.status === 'failed' || solved.status === 'too-few') xirrReason = '数值求解失败'
  }

  let alpha: AlphaDiag | null = null
  let sharpe: number | null = null
  let sortino: number | null = null
  let volAnn: number | null = null
  let maxDrawdown: number | null = null
  let maxDrawdownUsd = 0
  let maxUnder = 0
  let ddStart: string | null = null
  let ddTrough: string | null = null
  let ddRecover: string | null = null
  let currentlyUnderwater = false
  let ulcer: number | null = null
  let calmar: number | null = null
  let relativeSpx: number | null = null
  let relativeCash: number | null = null
  let grossExposureMean: number | null = null
  let netExposureMean: number | null = null

  if (canAccount && equity.length > 1) {
    const rets = dailyRetsFromIndex(equity.map((e) => e.index))
    const bRets = dailyRetsFromIndex(equity.map((e) => e.benchIndex))
    const rfRets = equity.map((p) => p.rf)
    const rpEx = rets.map((r, i) => r - (rfRets[i] || 0))
    const rbEx = bRets.map((r, i) => r - (rfRets[i] || 0))
    const fit = olsHac(rbEx, rpEx, 1)
    if (fit && first && last) {
      const ann = fit.alpha * 252
      const seAnn = fit.alphaSe * 252
      const invalid: string[] = []
      if (fit.n < 20) invalid.push('对齐后的日收益不足 20 天')
      if (Math.abs(fit.n - rets.length) > 0) invalid.push('回归 n 与日收益长度不一致')
      if (Math.abs(fit.beta) > 8) invalid.push(`β=${fit.beta.toFixed(2)} 超出账户日收益对 SPX 的合理范围`)
      if (Math.abs(ann) > 5 && fit.r2 < 0.02) invalid.push('年化 α 过大且 R² 接近 0，序列未通过一致性校验')
      alpha = {
        valid: invalid.length === 0,
        invalidReason: invalid.length ? `暂不可用：${invalid.join('；')}。` : null,
        daily: fit.alpha,
        annualized: ann,
        se: seAnn,
        ciLo: ann - 1.96 * seAnn,
        ciHi: ann + 1.96 * seAnn,
        tStat: fit.alphaSe ? fit.alpha / fit.alphaSe : 0,
        r2: fit.r2,
        beta: fit.beta,
        betaSe: fit.betaSe,
        n: fit.n,
        start: first.date,
        end: last.date,
        freq: 'daily',
        rfSource: rf.source,
        seMethod: `${fit.seMethod} lag ${fit.lag}`,
        basis: '账户日超额收益对 SPX 日超额收益 OLS 截距 ×252。n 为共同有效交易日，不是往返笔数。标准误为 Newey-West。不等于累计相对收益。',
      }
    }

    const sd = stdev(rpEx)
    sharpe = sd ? (mean(rpEx) / sd) * Math.sqrt(252) : 0
    const down2 = rpEx.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / Math.max(rpEx.length, 1)
    const downDev = Math.sqrt(down2)
    sortino = downDev ? (mean(rpEx) / downDev) * Math.sqrt(252) : 0
    volAnn = stdev(rets) * Math.sqrt(252)

    let peakIdx = 0
    let peak = -Infinity
    let underStart = 0
    let maxDd = 0
    for (let i = 0; i < equity.length; i++) {
      const p = equity[i]
      if (p.index > peak) {
        peak = p.index
        peakIdx = i
        if (underStart && !ddRecover) ddRecover = p.date
      }
      const dd = peak ? p.index / peak - 1 : 0
      if (dd < maxDd) {
        maxDd = dd
        maxDrawdownUsd = equity[peakIdx].equity - p.equity
        ddStart = equity[peakIdx].date
        ddTrough = p.date
        ddRecover = null
      }
      if (dd < -1e-9) {
        if (!underStart) underStart = i
        maxUnder = Math.max(maxUnder, i - underStart + 1)
      } else underStart = 0
    }
    maxDrawdown = maxDd
    currentlyUnderwater = last ? last.drawdown < -1e-9 : false
    if (currentlyUnderwater) ddRecover = null
    ulcer = Math.sqrt(equity.reduce((s, p) => s + p.drawdown ** 2, 0) / equity.length)
    calmar = maxDrawdown < 0 && twrAnnualized != null ? twrAnnualized / Math.abs(maxDrawdown) : 0
    relativeSpx = last && last.benchIndex > 0 ? last.index / last.benchIndex - 1 : null
    relativeCash =
      rf.source === 'zero-fallback' || !last
        ? null
        : last.cashIndex > 0
          ? last.index / last.cashIndex - 1
          : null
    grossExposureMean = mean(equity.map((e) => e.grossExposure))
    netExposureMean = mean(equity.map((e) => e.netExposure))
  } else if (sleeve && equity.length > 1) {
    // 没有账户净值时，只用累计盯市盈亏的金额回落，不计算百分比回撤率。
    let peakIdx = 0
    let peakEq = -Infinity
    let underStart = 0
    let maxDdUsd = 0
    for (let i = 0; i < equity.length; i++) {
      const p = equity[i]
      if (p.equity > peakEq) {
        peakEq = p.equity
        peakIdx = i
        if (underStart && !ddRecover) ddRecover = p.date
      }
      const ddUsd = p.equity - peakEq
      if (ddUsd < maxDdUsd) {
        maxDdUsd = ddUsd
        maxDrawdownUsd = equity[peakIdx].equity - p.equity
        ddStart = equity[peakIdx].date
        ddTrough = p.date
        ddRecover = null
      }
      if (ddUsd < -1e-6) {
        if (!underStart) underStart = i
        maxUnder = Math.max(maxUnder, i - underStart + 1)
      } else underStart = 0
    }
    maxDrawdown = null
    currentlyUnderwater = last ? last.equity < peakEq - 1e-6 : false
    if (currentlyUnderwater) ddRecover = null
    ulcer = null
    grossExposureMean = null
    netExposureMean = null
  }
  const pathAudit = canAccount ? auditAccountPath(equity, twr, relativeSpx, maxDrawdown) : null
  if (alpha && pathAudit && !pathAudit.ok) {
    alpha = {
      ...alpha,
      valid: false,
      invalidReason: alpha.invalidReason || `暂不可用：${pathAudit.issues.join('；')}。`,
    }
  }

  const pathOk = closed.filter((t) => t.pathQuality === 'daily_estimate')
  const sameDayN = closed.filter((t) => t.pathQuality === 'same_day_na').length
  const missingN = closed.filter((t) => t.pathQuality === 'missing_bars').length
  const winPath = pathOk.filter((t) => t.realizedPnl > 0 && (t.mfeDollar ?? 0) > 0)
  const lossPath = pathOk.filter((t) => t.realizedPnl < 0 && (t.maeDollar ?? 0) < 0)
  const sumRealWin = winPath.reduce((s, t) => s + t.realizedPnl, 0)
  const sumMfe = winPath.reduce((s, t) => s + (t.mfeDollar || 0), 0)
  const captureAgg = sumMfe > 0 ? sumRealWin / sumMfe : null
  const sumMaeAbs = lossPath.reduce((s, t) => s + Math.abs(t.maeDollar || 0), 0)
  const sumRecNum = lossPath.reduce((s, t) => s + (t.realizedPnl - (t.maeDollar || 0)), 0)
  const recoveryAgg = sumMaeAbs > 0 ? sumRecNum / sumMaeAbs : null
  const anomalies = pathOk.filter((t) => t.pathAnomaly).length

  const wilson = wilsonInterval(wins.length, closed.length)
  const clusters = new Map<string, RoundTrip[]>()
  for (const t of closed) {
    const k = etDateKey(t.openTime)
    const arr = clusters.get(k) || []
    arr.push(t)
    clusters.set(k, arr)
  }
  const clusterList = [...clusters.values()]
  const expBoot = clusterBootstrap(clusterList, (items) => mean(items.map((t) => t.realizedPnl)), BOOTSTRAP_SEED, BOOTSTRAP_ROUNDS)
  const pfBoot = clusterBootstrap(clusterList, pfOf, BOOTSTRAP_SEED, BOOTSTRAP_ROUNDS)
  const winBoot = clusterBootstrap(
    clusterList,
    (items) => (items.length ? items.filter((t) => t.realizedPnl > 0).length / items.length : null),
    BOOTSTRAP_SEED,
    BOOTSTRAP_ROUNDS,
  )
  const payoff =
    wins.length && losses.length
      ? mean(wins.map((t) => t.realizedPnl)) / Math.abs(mean(losses.map((t) => t.realizedPnl)))
      : null
  const rs = closed.map((t) => t.rMultiple).filter((v): v is number => v != null)
  const n = closed.length
  const kellyFull = payoff && payoff > 0 && n ? wins.length / n - (1 - wins.length / n) / payoff : null
  const sqn = rs.length > 1 && stdev(rs) ? Math.sqrt(rs.length) * (mean(rs) / stdev(rs)) : null

  const coverage: CoverageRow[] = [
    {
      item: '佣金',
      status: feeImported ? 'imported' : 'not_provided',
      countedInPnl: feeImported,
      note: feeImported ? '已计入往返已实现盈亏，对账不再扣除' : '导入文件没有可用费用',
    },
    {
      item: 'SEC / TAF',
      status: feeImported ? 'imported' : 'not_provided',
      countedInPnl: feeImported,
      note: feeImported ? '已随佣金计入已实现盈亏，对账不再扣除' : '导入文件没有可用费用',
    },
    { item: '分红', status: 'not_provided', countedInPnl: false, note: '导入未提供，缺失不是零' },
    { item: '借券费', status: 'not_provided', countedInPnl: false, note: '导入未提供，缺失不是零' },
    { item: '滑点', status: 'not_computable', countedInPnl: false, note: '无决策价，无法计算；不从日线 OHLC 伪造' },
    {
      item: '期初净资产',
      status: hasNav ? 'imported' : 'not_provided',
      countedInPnl: false,
      note: hasNav
        ? '用户填写，用于账户收益率与基准比较'
        : '未提供。不从成交额猜账户净资产；正股盯市盈亏仍按成交还原。',
    },
    {
      item: '外部入出金',
      status: cashflowComplete ? 'imported' : 'not_provided',
      countedInPnl: false,
      note: cashflowComplete
        ? cashflows.length
          ? '已提供现金流，XIRR 可计算'
          : '用户确认分析期间没有外部入出金'
        : '未确认是否完整，缺失不等于零，XIRR 为 N/A',
    },
  ]

  const openTimes = trips.map((t) => t.openTime.getTime()).filter((n) => Number.isFinite(n))
  const endTimes = trips
    .map((t) => (t.closeTime ?? t.openTime).getTime())
    .filter((n) => Number.isFinite(n))
  const sampleStart = first?.date ?? (openTimes.length ? etDateKey(new Date(Math.min(...openTimes))) : '')
  const sampleEnd = last?.date ?? (endTimes.length ? etDateKey(new Date(Math.max(...endTimes))) : '')

  return {
    metricVersion: METRIC_VERSION,
    capitalSource: canAccount ? 'user' : sleeve ? 'sleeve' : 'none',
    cashflowsProvided,
    cashflowComplete,
    hasNav,
    equitySubsetOnly,
    pathKind,
    accountReturnReason,
    initialCapital,
    finalEquity,
    netPnl,
    realizedPnl,
    unrealizedPnl,
    deposits,
    withdrawals,
    feeDrag,
    twr,
    twrAnnualized,
    xirr: xirrValue,
    xirrStatus,
    xirrReason,
    benchKind,
    sortinoHurdle: 'rf',
    reconDifference: unrealizedPnl == null ? 0 : netPnl - (realizedPnl + unrealizedPnl),
    coverage,
    rf,
    closedCount: closed.length,
    openCount: trips.filter((t) => t.status === 'open').length,
    winRate: metric(
      closed.length ? wins.length / closed.length : null,
      closed.length,
      closed.length,
      0,
      '闭环往返笔数，Wilson 95%（按单笔独立近似）',
      wilson ? { lo: wilson.lo, hi: wilson.hi, method: 'wilson' } : null,
    ),
    expectancy: metric(
      closed.length ? mean(closed.map((t) => t.realizedPnl)) : null,
      closed.length,
      closed.length,
      0,
      `按开仓日 cluster bootstrap ${BOOTSTRAP_ROUNDS} 次，seed ${BOOTSTRAP_SEED}`,
      closed.length
        ? { lo: expBoot.lo ?? 0, hi: expBoot.hi, method: 'bootstrap', unboundedHi: expBoot.unboundedHi }
        : null,
    ),
    profitFactor: metric(
      pfOf(closed),
      closed.length,
      closed.length,
      0,
      '毛利/毛亏；无亏损重采样记为 +∞，不删除',
      closed.length
        ? { lo: pfBoot.lo ?? 0, hi: pfBoot.hi, method: 'bootstrap', unboundedHi: pfBoot.unboundedHi }
        : null,
      pfOf(closed) != null && !Number.isFinite(pfOf(closed)!) ? '没有亏损，PF 为 +∞' : undefined,
    ),
    payoff: metric(
      payoff,
      wins.length && losses.length ? closed.length : 0,
      closed.length,
      0,
      '平均盈利 / |平均亏损|，仅在同时有盈亏样本时计算',
    ),
    atrR: {
      mean: rs.length ? mean(rs) : null,
      median: median(rs),
      p05: quantile(rs, 0.05),
      p10: quantile(rs, 0.1),
      n: rs.length,
    },
    capture: metric(
      captureAgg,
      winPath.length,
      closed.length,
      closed.length - winPath.length,
      `金额加权；仅最终盈利且 MFE>0。有效 ${winPath.length}/${closed.length}，同日排除 ${sameDayN}，缺行情 ${missingN}`,
    ),
    giveback: metric(
      captureAgg != null ? 1 - captureAgg : null,
      winPath.length,
      closed.length,
      closed.length - winPath.length,
      '1 − 盈利捕获率（金额加权）',
    ),
    recovery: metric(
      recoveryAgg,
      lossPath.length,
      closed.length,
      closed.length - lossPath.length,
      '金额加权；仅最终亏损且 MAE<0',
    ),
    pathComputable: pathOk.length,
    pathSameDayExcluded: sameDayN,
    pathMissingExcluded: missingN,
    captureAnomalies: anomalies,
    relativeCash,
    relativeSpx,
    pathAudit,
    alpha,
    volAnn,
    sharpe,
    sortino,
    calmar,
    maxDrawdown,
    maxDrawdownUsd: Math.abs(maxDrawdownUsd),
    ddStart,
    ddTrough,
    ddRecover,
    underwaterDays: maxUnder,
    currentlyUnderwater,
    ulcer,
    grossExposureMean,
    netExposureMean,
    bootstrapSeed: BOOTSTRAP_SEED,
    sampleStart,
    sampleEnd,
    dayCount: equity.length,
    uniqueOpenDays: clusterList.length,
    kellyHalf: kellyFull != null ? kellyFull / 2 : null,
    sqn,
    pfInfShare: pfBoot.infShare,
    winRateBoot: metric(
      closed.length ? wins.length / closed.length : null,
      closed.length,
      closed.length,
      0,
      `按开仓日 cluster bootstrap ${BOOTSTRAP_ROUNDS} 次`,
      closed.length
        ? { lo: winBoot.lo ?? 0, hi: winBoot.hi, method: 'bootstrap', unboundedHi: winBoot.unboundedHi }
        : null,
    ),
  }
}

export function attachPositionPct(trips: RoundTrip[], equity: EquityPoint[]): RoundTrip[] {
  return trips.map((trip) => {
    const day = etDateKey(trip.openTime)
    const eq = equity.find((p) => p.date >= day)?.equity
    const notion = trip.qty * trip.openPrice
    return { ...trip, positionPct: eq ? notion / eq : null }
  })
}
