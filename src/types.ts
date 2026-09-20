export const METRIC_VERSION = 'p0p1.5'

export type Side = 'buy' | 'sell'
export type Direction = 'long' | 'short'
export type SessionBucket = 'open30' | 'midday' | 'close'
export type TripStatus = 'closed' | 'open'
export type PathQuality = 'same_day_na' | 'daily_estimate' | 'missing_bars'
export type CoverageStatus = 'imported' | 'not_provided' | 'not_computable'
export type CapitalSource = 'user' | 'none' | 'sleeve'
export type SampleBanner = 'cannot-assess' | 'insufficient' | 'positive-sample' | 'sensitive'
export type XirrStatus = 'ok' | 'incomplete' | 'too-few' | 'no-root' | 'multiple' | 'failed'
export type BenchKind = 'spy-total-return' | 'spx-price'
export type GroupStatus = 'empty' | 'raw' | 'observe' | 'ok'

export type BrokerId = 'futu' | 'ib' | 'tiger' | 'generic'

export type Warning = {
  code: string
  message: string
  tone?: 'warn' | 'info'
}

export type Fill = {
  id: string
  symbol: string
  name: string
  side: Side
  rawSide: string
  qty: number
  price: number
  amount: number
  time: Date
  market: string
  currency: string
  fees: number
  orderId?: string
  kind: 'trade' | 'drip'
}

export type BrokerOrder = {
  id: string
  symbol: string
  side: string
  status: string
  filledQty: number
  avgPrice: number
  time: Date
  market: string
  fees: {
    commission: number
    platform: number
    sec: number
    taf: number
    settlement: number
    total: number
  }
  remainingQty: number
  remainingFee: number
}

export type Cashflow = {
  time: Date
  type: 'deposit' | 'withdraw'
  amount: number
}

export type Bar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Interval = {
  lo: number
  hi: number | null
  method: 'wilson' | 'bootstrap' | 'ols'
  unboundedHi?: boolean
}

export type MetricPoint = {
  value: number | null
  n: number
  eligible: number
  excluded: number
  ci: Interval | null
  basis: string
  naReason?: string
}

export type CoverageRow = {
  item: string
  status: CoverageStatus
  countedInPnl: boolean
  note: string
}

export type RfStatus = {
  source: 'dtb3-bundle' | 'irx-quotes' | 'zero-fallback'
  version: string
  asOf: string | null
  lastDate: string | null
  warning: string | null
  approx: 'quoted' | 'missing-zero'
}

/** 频率画像:每笔交易自己的档位,不是给"人"贴标签。intraday=当天平 / swing=隔夜~10日 / position=10~60日 / investor=>60日。 */
export type Regime = 'intraday' | 'swing' | 'position' | 'investor'

export type RegimeShare = { regime: Regime; n: number; share: number }

/** 对 log(持仓天) 做核密度得到的天然结构,用来自证默认锚定坎合不合身——只描述,不替用户重新分类。 */
export type HoldDiagnostic = {
  n: number
  /** 天然聚集峰,单位:持仓天 */
  modes: number[]
  /** 峰之间的谷(自然断点),单位:持仓天 */
  valleys: number[]
  /** 天然断点是否与默认坎(10/60 日)基本吻合;样本不足时为 null */
  fitsDefaultBands: boolean | null
  note: string
}

export type RoundTrip = {
  id: string
  symbol: string
  name: string
  side: Direction
  status: TripStatus
  qty: number
  openTime: Date
  closeTime: Date | null
  openPrice: number
  closePrice: number | null
  realizedPnl: number
  fees: number
  holdMinutes: number
  opens: Fill[]
  closes: Fill[]
  sameDay: boolean
  pathQuality: PathQuality
  maePct: number | null
  mfePct: number | null
  maePrice: number | null
  mfePrice: number | null
  maeDollar: number | null
  mfeDollar: number | null
  captureRate: number | null
  givebackRate: number | null
  recoveryRate: number | null
  pathAnomaly: boolean
  splitSuspect: boolean
  moneyLeft: number | null
  lateStopCost: number | null
  rMultiple: number | null
  atr: number | null
  positionPct: number | null
  executionLocation: number | null
  prevResult: 'win' | 'loss' | 'none'
  prevGapHours: number | null
  chasePercentile: number | null
  chaseReturn: number | null
  ma50Dist: number | null
  ma200Dist: number | null
  vix: number | null
  session: SessionBucket
  tags: string[]
  setup: string
  pathSource: 'bars' | 'none'
  splitWarning: boolean
  /** 该笔的频率档位。由 sameDay + holdMinutes 在 replay 后统一 enrich,构造期为占位值。 */
  regime: Regime
  /** 时间归一年化收益:(1+单笔收益率)^(365/持仓天)−1。仅多日持仓给值,日内为 null(年化无意义)。 */
  annualizedReturn: number | null
}

export type EquityPoint = {
  date: string
  equity: number
  cash: number
  mtm: number
  cashflow: number
  index: number
  benchIndex: number
  cashIndex: number
  excess: number
  drawdown: number
  grossExposure: number
  netExposure: number
  rf: number
  rollingSharpe: number | null
  rollingBeta: number | null
}

export type AlphaDiag = {
  valid: boolean
  invalidReason: string | null
  daily: number
  annualized: number
  se: number
  ciLo: number
  ciHi: number
  tStat: number
  r2: number
  beta: number
  betaSe: number
  n: number
  start: string
  end: string
  freq: 'daily'
  rfSource: string
  seMethod: string
  basis: string
}

export type PathAudit = {
  ok: boolean
  issues: string[]
  n: number
  twrFromIndex: number
  relativeSpxFromIndex: number
  maxDrawdownFromIndex: number
  maxAbsDaily: number
}

export type Performance = {
  metricVersion: string
  capitalSource: CapitalSource
  cashflowsProvided: boolean
  cashflowComplete: boolean
  hasNav: boolean
  equitySubsetOnly: boolean
  pathKind: 'account' | 'sleeve'
  accountReturnReason: string | null
  initialCapital: number | null
  finalEquity: number | null
  netPnl: number
  realizedPnl: number
  unrealizedPnl: number | null
  deposits: number
  withdrawals: number
  feeDrag: number
  twr: number | null
  twrAnnualized: number | null
  xirr: number | null
  xirrStatus?: XirrStatus
  xirrReason?: string
  benchKind: BenchKind
  sortinoHurdle: 'rf'
  reconDifference: number
  coverage: CoverageRow[]
  rf: RfStatus
  closedCount: number
  openCount: number
  winRate: MetricPoint
  expectancy: MetricPoint
  profitFactor: MetricPoint
  payoff: MetricPoint
  atrR: { mean: number | null; median: number | null; p05: number | null; p10: number | null; n: number }
  capture: MetricPoint
  giveback: MetricPoint
  recovery: MetricPoint
  pathComputable: number
  pathSameDayExcluded: number
  pathMissingExcluded: number
  captureAnomalies: number
  relativeCash: number | null
  relativeSpx: number | null
  pathAudit: PathAudit | null
  alpha: AlphaDiag | null
  volAnn: number | null
  sharpe: number | null
  sortino: number | null
  calmar: number | null
  maxDrawdown: number | null
  maxDrawdownUsd: number
  ddStart: string | null
  ddTrough: string | null
  ddRecover: string | null
  underwaterDays: number
  underwaterDaysKind: 'calendar' | 'observed'
  underwaterEnd: string | null
  currentlyUnderwater: boolean
  ulcer: number | null
  grossExposureMean: number | null
  netExposureMean: number | null
  bootstrapSeed: number
  sampleStart: string
  sampleEnd: string
  dayCount: number
  uniqueOpenDays: number
  kellyHalf: number | null
  sqn: number | null
  pfInfShare: number
  winRateBoot: MetricPoint | null
  /** 基准上/下行捕获:账户日收益在基准涨/跌日分别复利 ÷ 基准同期。仅有账户净值时给值,否则 null。 */
  benchCapture: {
    upside: number | null
    downside: number | null
    upDays: number
    downDays: number
    basis: string
  } | null
  /** 信息比率:年化超额日收益 / 跟踪误差。仅账户级。 */
  infoRatio: number | null
  /** 跑赢率:账户日收益 > 基准日收益 的天数占比。仅账户级。 */
  battingAvg: number | null
  /** Martin 比率:年化超额 / Ulcer。仅账户级。 */
  ulcerPerf: number | null
  /** Omega(阈值 0):超额收益上侧面积 / 下侧面积。仅账户级。 */
  omega: number | null
  /** 单笔已实现盈亏的分布形状(全模式可用):偏度、超额峰度、历史 VaR95/CVaR95(美元)。 */
  tradeShape: { n: number; skew: number | null; kurtosis: number | null; var95: number | null; cvar95: number | null }
}

export type GroupRow = {
  id: string
  label: string
  n: number
  winRate: number | null
  winCi: Interval | null
  medianAtrR: number | null
  expectancy: number | null
  pf: number | null
  pnl: number
  status: GroupStatus
  fact: string
  total?: number
}

export type Checkup = {
  sessions: GroupRow[]
  /** 入场时段面板是否默认展示。由"日内+波段"这批的样本量决定,不是账本单一 regime。UI 仍留「展开全部」逃生口。 */
  sessionRelevant: boolean
  /** 入场时机面板(时段/成交位置)只统计这批的样本量:日内+波段。 */
  sessionCohortN: number
  /** 账本的频率构成,把混合摊开而不是压成一个中位数。 */
  regimeMix: RegimeShare[]
  /** 持仓时长的天然结构诊断,自证默认坎合不合身。 */
  holdDiagnostic: HoldDiagnostic
  /** 各 regime 的条件统计组(胜率/期望/PF/中位R + 区间),看"哪个频率真有 edge"。 */
  regimes: GroupRow[]
  sides: GroupRow[]
  weekdays: GroupRow[]
  holdBuckets: GroupRow[]
  tilt: { nAfterLoss: number; nTilt: number; sizeMultiple: number | null; amount: number; fact: string }
  chase: { covered: number; total: number; mean: number | null; highN: number; highPnl: number; fact: string }
  disposition: { ratio: number | null; n: number; amount: number; fact: string }
}

export type Credibility = {
  closedCount: number
  uniqueOpenDays: number
  dayCount: number
  start: string
  end: string
  feeCoverage: string
  maeMfeComputableShare: number
  chaseCoverage: number
  metricVersion: string
  banner: SampleBanner
  bannerText: string
  bannerDetail: string
  notes: string[]
  analysisWindow: string
  oosWindow: string
  modelTraining: string
  minSampleNote: string
}

export type ExcludedRow = {
  symbol: string
  name: string
  reason: 'nonUs' | 'option' | 'fund'
  qty: number
  time: string
}

export type ImportResult = {
  fills: Fill[]
  orders: BrokerOrder[]
  warnings: Warning[]
  rawCount: number
  feeUnmatched: number
  dripKept: number
  excludedRows: ExcludedRow[]
  broker: BrokerId
  dropped: {
    nonUs: number
    options: number
    funds: number
    fractional: number
    drip: number
  }
}

export type QuotePack = {
  bars: Record<string, Bar[]>
  splits: Record<string, number>
}

export type Sensitivity = {
  n: number
  openDays: number
  expectancy: number | null
  expectancyDropMaxTrade: number | null
  expectancyDropMaxDay: number | null
  maxTradePnlShare: number | null
  maxDayPnlShare: number | null
  maxWinShareGrossProfit: number | null
  maxLossShareGrossLoss: number | null
  maxAbsShareTotalAbs: number | null
  expectancyDropMaxWin: number | null
  top1Share: number | null
  top3Share: number | null
  top5Share: number | null
  meanPnl: number | null
  medianPnl: number | null
  trimmedMean: number | null
  firstHalfExpectancy: number | null
  secondHalfExpectancy: number | null
  cost: Array<{ bps: number; expectancy: number | null; pf: number | null }>
  fifoVsEpisode: { fifoN: number; episodeN: number; fifoExp: number | null; episodeExp: number | null }
  sensitive: boolean
  note: string
}

/** 蒙特卡洛:按开仓日 cluster 有放回重采样你的真实交易 N 次,摊开"运气"成分。不制造新信息。 */
export type MonteCarlo = {
  rounds: number
  steps: number
  /** 每一步(第 k 笔)累计已实现盈亏的分位带,长度 = steps。 */
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] }
  /** 你的真实累计路径(按平仓顺序),叠在扇形上看落点。 */
  realizedPath: number[]
  /** 每次重采样的最终盈亏,用来画"所有可能结果"的分布直方图。 */
  terminals: number[]
  realizedTerminal: number
  /** realized 终值落在重采样终值分布里的百分位(0..1)。越高=越靠"幸运尾巴"。 */
  terminalPctile: number
  realizedMaxDD: number
  maxDDPctile: number
  /** P(最大回撤 ≥ 阈值)。 */
  ddProb: Array<{ dd: number; prob: number }>
  note: string
}

/** Wald–Wolfowitz 游程检验:盈亏序列是随机,还是成串(热手/tilt)。 */
export type RunsTest = {
  n: number
  wins: number
  runs: number
  expected: number
  z: number | null
  pValue: number | null
  note: string
}

/** 各 regime 按平仓时间的累计已实现盈亏序列,共享一条日期轴。 */
export type RegimeCum = {
  dates: string[]
  series: Array<{ regime: Regime; label: string; values: number[] }>
}

export type Analytics = {
  monteCarlo: MonteCarlo | null
  runs: RunsTest
  regimeCum: RegimeCum
}

export type Book = {
  accountName: string
  isSample: boolean
  warnings: Warning[]
  fills: Fill[]
  trips: RoundTrip[]
  episodes: RoundTrip[]
  excludedRows: ExcludedRow[]
  dripKept: number
  equity: EquityPoint[]
  performance: Performance
  checkup: Checkup
  credibility: Credibility
  sensitivity: Sensitivity
  analytics: Analytics
  bars: Record<string, Bar[]>
  cashflows: Cashflow[]
}
