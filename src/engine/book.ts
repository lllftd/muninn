import { attachSequence, buildRoundTrips } from './fifo.ts'
import { buildEpisodes } from './episode.ts'
import { importFutu, parseCashflows } from './futu.ts'
import { attachPositionPct, buildEquity, summarize } from './metrics.ts'
import { replayAll } from './path.ts'
import { autoTagHints, buildCheckup, buildCredibility } from './checkup.ts'
import { enrichRegime } from './regime.ts'
import { monteCarlo, regimeCumulative, runsTest } from './analytics.ts'
import { etDateKey } from '../lib/time.ts'
import { buildSensitivity } from './sensitivity.ts'
import { METRIC_VERSION } from '../types.ts'
import type { Bar, Book, Cashflow, QuotePack, Warning } from '../types.ts'

function tagTrips(
  trips: ReturnType<typeof attachSequence>,
  extraTags: Record<string, string[]> | undefined,
) {
  return trips.map((trip) => {
    const key = `${trip.symbol}|${trip.openTime.toISOString().slice(0, 10)}`
    const extra = extraTags?.[key] || []
    const drip =
      [...trip.opens, ...trip.closes].length > 0 && [...trip.opens, ...trip.closes].every((f) => f.kind === 'drip')
    const hints = autoTagHints(trip)
    const tags = [...new Set([...hints.map((h) => h.tag), ...extra, ...trip.tags, ...(drip ? ['DRIP'] : [])])]
    return { ...trip, tags, tagHints: hints, setup: tags[0] || '' }
  })
}

function compactWarnings(raw: Warning[], missing: string[]): Warning[] {
  const shorts = raw.filter((w) => w.code === 'first-short')
  const rest = raw.filter((w) => w.code !== 'first-short' && w.code !== 'no-account-return')
  const out = [...rest]
  if (shorts.length) {
    const names = [...new Set(shorts.map((w) => w.message.split(' ')[0]))]
    out.push({
      code: 'first-short',
      message: `${names.join('、')} 第一笔是卖出，已按开空处理。若当时已有底仓，补上开仓记录即可。`,
      tone: 'info',
    })
  }
  if (missing.length) {
    out.push({
      code: 'no-bars',
      message: `${missing.length} 个代码没有日线，MAE/MFE 记为缺失；盯市用最近成交价继续算。`,
      tone: 'warn',
    })
  }
  return out
}

export function assembleBook(args: {
  fillText: string
  orderText?: string
  cashText?: string
  cashflows?: Cashflow[]
  accountName: string
  initialCapital: number | null
  quotes: QuotePack
  isSample?: boolean
  extraTags?: Record<string, string[]>
  cashflowComplete?: boolean
}): Book {
  const imported = importFutu(args.fillText, args.orderText)
  const cashflows = args.cashflows || (args.cashText ? parseCashflows(args.cashText) : [])
  const cashflowComplete = args.cashflowComplete ?? Boolean(args.cashText?.trim() || args.cashflows?.length)
  const hasNav = args.initialCapital != null && args.initialCapital > 0
  const equitySubsetOnly = imported.dropped.nonUs + imported.dropped.options + imported.dropped.funds > 0
  let accountReturnReason: string | null = null
  if (!hasNav) accountReturnReason = '未提供期初净资产，所以没有账户 TWR / XIRR。正股盯市盈亏已按成交还原。'
  else if (equitySubsetOnly) {
    accountReturnReason = '文件含其他资产，账户 TWR 不能用这本正股子账代表。正股盯市盈亏已按成交还原。'
  }
  const canAccount = hasNav && !equitySubsetOnly
  const vix = args.quotes.bars['^VIX'] || args.quotes.bars.VIX

  const fifo = buildRoundTrips(imported.fills)
  let trips = attachSequence(fifo.trips)
  const fifoReplay = replayAll(trips, args.quotes.bars, args.quotes.splits, vix)
  // replay 之后 sameDay/holdMinutes 才最终确定,此处再 enrich 每笔的 regime 与时间归一收益。
  trips = enrichRegime(tagTrips(attachPositionPct(fifoReplay.trips, []), args.extraTags))

  let episodes = attachSequence(buildEpisodes(imported.fills))
  const epReplay = replayAll(episodes, args.quotes.bars, args.quotes.splits, vix)
  episodes = enrichRegime(tagTrips(epReplay.trips, args.extraTags))

  const missing = [...new Set([...fifoReplay.missing, ...epReplay.missing])]
  const warnings = compactWarnings([...imported.warnings, ...fifo.warnings], missing)
  const splitSyms = Object.entries(args.quotes.splits)
    .filter(([, n]) => n > 0)
    .map(([s]) => s)
  if (splitSyms.length) {
    warnings.push({
      code: 'splits',
      message: `持仓期有拆股记录的代码：${splitSyms.join(', ')}。日线估算 MAE/MFE 仅供参考。`,
    })
  }
  const suspectSyms = [...new Set([...fifoReplay.trips, ...epReplay.trips].filter((t) => t.splitSuspect).map((t) => t.symbol))]
  if (suspectSyms.length) {
    warnings.push({
      code: 'split-suspect',
      message: `疑似公司行动（价格出现非市场性跳变，可能拆股未复权）：${suspectSyms.join(', ')}。请确认拆股后的持仓数量与成本基础。`,
    })
  }

  const { equity, rf } = buildEquity({
    fills: imported.fills,
    cashflows: canAccount ? cashflows : [],
    bars: args.quotes.bars,
    initialCapital: canAccount ? (args.initialCapital as number) : 0,
    sleeve: !canAccount,
  })
  if (rf.warning && rf.approx !== 'missing-zero') warnings.push({ code: 'rf', message: rf.warning, tone: 'warn' })
  trips = attachPositionPct(trips, equity)
  episodes = attachPositionPct(episodes, equity)
  const feeImported = imported.fills.some((f) => f.fees > 0)
  const benchKind = (args.quotes.bars.SPY || []).length ? 'spy-total-return' : 'spx-price'
  const review = episodes.filter((t) => !t.tags.includes('DRIP'))
  const performance = summarize({
    trips,
    reviewTrips: review,
    equity,
    cashflows,
    initialCapital: hasNav ? args.initialCapital : null,
    cashflowComplete,
    cashflowsProvided: cashflowComplete,
    feeImported,
    rf,
    hasNav,
    equitySubsetOnly,
    accountReturnReason,
    benchKind,
  })
  const checkup = buildCheckup(review)
  const sensitivity = buildSensitivity(trips, episodes)

  // 蒙特卡洛 / 游程 / regime 累计,均用复盘口径(review = episodes 去 DRIP)。
  const reviewClosed = review.filter((t) => t.status === 'closed' && t.closeTime)
  const byOpenDay = new Map<string, number[]>()
  for (const t of reviewClosed) {
    const k = etDateKey(t.openTime)
    const arr = byOpenDay.get(k) || []
    arr.push(t.realizedPnl)
    byOpenDay.set(k, arr)
  }
  const closeOrdered = [...reviewClosed].sort(
    (a, b) => (a.closeTime as Date).getTime() - (b.closeTime as Date).getTime(),
  )
  const analytics = {
    monteCarlo: monteCarlo([...byOpenDay.values()], closeOrdered.map((t) => t.realizedPnl)),
    runs: runsTest(closeOrdered.map((t) => t.realizedPnl > 0)),
    regimeCum: regimeCumulative(review),
  }
  const credibility = buildCredibility({
    trips: review,
    dayCount: equity.length,
    start: performance.sampleStart,
    end: performance.sampleEnd,
    feeImported,
    metricVersion: METRIC_VERSION,
    expectancyCi: performance.expectancy.ci,
    pfCi: performance.profitFactor.ci,
    pf: performance.profitFactor.value,
    uniqueOpenDays: performance.uniqueOpenDays,
    sensitive: sensitivity.sensitive,
  })
  return {
    accountName: args.accountName,
    isSample: !!args.isSample,
    warnings,
    fills: imported.fills,
    trips,
    episodes,
    excludedRows: imported.excludedRows,
    dripKept: imported.dripKept,
    equity,
    performance,
    checkup,
    credibility,
    sensitivity,
    analytics,
    bars: args.quotes.bars,
    cashflows,
  }
}

export function emptyQuotes(): QuotePack {
  return { bars: {}, splits: {} }
}

export function mergeQuotes(base: QuotePack, extra: Record<string, Bar[]>): QuotePack {
  return { bars: { ...base.bars, ...extra }, splits: { ...base.splits } }
}
