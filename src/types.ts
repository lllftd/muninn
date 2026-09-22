export const METRIC_VERSION = 'p0p2'

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
export type GroupStatus = 'empty' | 'raw' | 'observe' | 'weak' | 'ok'
export type TagConfidence = 'low' | 'mid' | 'high'
export type TagHint = {
  tag: string
  confidence: TagConfidence
  evidence: string
  definition: string
}

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
  /** 统一事件模型：稳定唯一身份（生命周期追溯与去重用），见 lib/instrument.ts。 */
  eventUid?: string
  /** 内容指纹：字段一致则一致，仅用于疑似重复检测，不作身份。 */
  eventFingerprint?: string
  /** 券商成交 ID（若导出提供）。 */
  brokerExecutionId?: string
  /** 统一资产类型。正股为 'stock'；期权在 L1 接入后走 OptionTradeEvent，不占用 Fill。 */
  instrumentType?: 'stock'
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
  /** 净 R = 已实现盈亏 / (开仓前 ATR × 数量)。含费用。 */
  rMultiple: number | null
  /** 价差 R = (已实现 + 费用) / 风险单位。 */
  rPrice: number | null
  /** 费用 R = 费用 / 风险单位。 */
  rFee: number | null
  /** 风险单位美元：开仓前 ATR × 数量。 */
  riskDollars: number | null
  rFlags: string[]
  tagHints: TagHint[]
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
  /** 盯市口径：账户或正股子账的累计盈亏（未平仓按最新价/最近收盘），= realized + unrealized + 勾稽差额。 */
  netPnl: number
  /** 已实现口径：已平仓往返的实际盈亏。 */
  realizedPnl: number
  /** 未实现口径：盯市 - 已实现（需要 mtm，账户/子账无净值时为 null）。 */
  unrealizedPnl: number | null
  /** 现金流口径：外部入金。 */
  deposits: number
  /** 现金流口径：外部出金。 */
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
  atrR: {
    mean: number | null
    median: number | null
    p05: number | null
    p10: number | null
    n: number
    meanPrice: number | null
    meanFee: number | null
    flagged: number
  }
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
  /** 单笔期望 80% cluster bootstrap 区间。n<5 或簇太少时为 null。 */
  expectancyCi: Interval | null
  /** 去掉盈亏绝对值最大的一笔后再平均。n<2 为 null。 */
  expectancyExMax: number | null
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

export type QuoteStatus = 'ok' | 'partial' | 'unavailable'

/** 单标的行情来源元数据，用于报告展示「来源/复权口径/覆盖率」。 */
export type QuoteMeta = {
  provider: 'alpaca' | 'yahoo' | 'stooq' | null
  feed: 'iex' | 'sip' | 'unknown'
  adjusted: boolean
  warnings: string[]
}

export type QuotePack = {
  bars: Record<string, Bar[]>
  splits: Record<string, number>
  status?: QuoteStatus
  meta?: Record<string, QuoteMeta>
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

/** 蒙特卡洛:按开仓日 cluster **有放回**抽样,不是改顺序。终值可变,因为大赢可能被抽到多次。 */
export type MonteCarlo = {
  method: 'cluster-bootstrap'
  nTrades: number
  rounds: number
  steps: number
  /** 每一步(第 k 笔)累计已实现盈亏的分位带,长度 = steps。 */
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] }
  /** 真实累计路径(按平仓顺序)——这是交易序列回撤,不是账户回撤。 */
  realizedPath: number[]
  /** 每次有放回抽样的最终盈亏。因可重复抽到同一笔,终值会变。 */
  terminals: number[]
  realizedTerminal: number
  /** realized 终值落在抽样终值分布里的百分位(0..1)。越高=越靠"幸运尾巴"。 */
  terminalPctile: number
  /** 每次抽样的交易序列最大回撤(美元,从累计已实现高峰回落)。 */
  maxDDs: number[]
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

export type SpaceCi = { lo: number; hi: number; method: 'bootstrap'; level: 0.8 }

export type ExitEffGroup = { id: string; label: string; n: number; mean: number | null }

export type GivebackReport = {
  nFloated: number
  nClosed: number
  nPath: number
  meanRate: number | null
  sumDollar: number | null
  sumCi: SpaceCi | null
  meanRateCi: SpaceCi | null
  note: string
}

export type StopLevel = {
  pct: number
  preset: boolean
  pnl: number
  delta: number
  deltaCi: SpaceCi | null
  pValue: number | null
  fdr: boolean
  nStopped: number
}

export type StopScan = {
  actualPnl: number
  levels: StopLevel[]
  presets: StopLevel[]
  bestPreset: StopLevel | null
  note: string
}

export type EvLever = {
  id: 'winRate' | 'avgWin' | 'lossRate' | 'avgLoss'
  label: string
  shock: string
  delta: number
  deltaCi: SpaceCi | null
  worseDelta: number
  worseDeltaCi: SpaceCi | null
}

export type ReplayFamily = 'trail' | 'hold' | 'open30'

export type ReplayRule = {
  id: string
  family: ReplayFamily
  label: string
  pnl: number
  delta: number
  deltaCi: SpaceCi | null
  nTriggered: number
  nEligible: number
  pValue: number | null
  fdr: boolean
  computable: boolean
  /** 规则下的尾部损失 CVaR（最差 10% 亏损均值，正数）。null = 样本不足。 */
  cvar95: number | null
  /** Bootstrap P(总改善 > 0)。null = 样本不足。 */
  improveProb: number | null
}

export type RuleReplay = {
  actualPnl: number
  rules: ReplayRule[]
  bestPreset: ReplayRule | null
  /** 实际交易的尾部损失 CVaR（对照基准）。 */
  actualCvar95: number | null
  note: string
}

export type OppBench = {
  id: 'symbol-bh' | 'spy'
  label: string
  n: number
  actual: number
  bench: number
  delta: number
  deltaCi: SpaceCi | null
}

export type OppMatrixRow = {
  symbol: string
  nLong: number
  nShort: number
  longMean: number | null
  shortMean: number | null
  reverseShortMean: number | null
}

export type OppCost = {
  symbolBh: OppBench | null
  spy: OppBench | null
  matrix: OppMatrixRow[]
  note: string
}

export type PsmStratum = {
  id: string
  symbol: string
  bucket: string
  bucketLabel: string
  nShort: number
  nLong: number
  shortMean: number
  longMean: number
}

export type PsmReport = {
  nTreated: number
  nMatched: number
  unmatchedShare: number | null
  method: 'exact'
  status: 'ok' | 'cannot-control'
  treatedMean: number | null
  controlMean: number | null
  delta: number | null
  deltaCi: SpaceCi | null
  pValue: number | null
  strata: PsmStratum[]
  note: string
}

export type KellyReport = {
  n: number
  nWin: number
  nLoss: number
  p: number | null
  b: number | null
  full: number | null
  half: number | null
  quarter: number | null
  quarterCi: SpaceCi | null
  corrSizePnl: number | null
  medianNotional: number | null
  medianNotionalWin: number | null
  medianNotionalLoss: number | null
  note: string
}

export type SpaceReport = {
  exitEfficiency: { overall: number | null; n: number; groups: ExitEffGroup[] }
  giveback: GivebackReport
  stopScan: StopScan | null
  evLevers: EvLever[]
  ruleReplay: RuleReplay
  oppCost: OppCost
  psm: PsmReport
  kelly: KellyReport | null
  counterfactual: CounterfactualReport
}

/** 一条候选动作的反事实评估结果。 */
export type CounterfactualAction = {
  id: string
  name: string
  delta: number
  /** 动作下每笔亏损（-pnl）的尾部均值 CVaR，正数。null = 样本不足。 */
  cvar95: number | null
  /** Bootstrap P(总改善 > 0)。null = 样本不足。 */
  improveProb: number | null
  /** Bootstrap 80% 区间（总改善金额）。null = 样本不足。 */
  ciLo: number | null
  ciHi: number | null
  n: number
  /** 实际触发该动作的交易数（cf != 实际）。0 表示未触发，结果不可估计。 */
  triggered: number
  /** 计算口径：replay=真实回放；upper-bound=理论上限（不可执行）；proxy=代理估计。 */
  kind: 'replay' | 'upper-bound' | 'proxy'
  note: string
}

/** 分策略的贝叶斯收缩估计。 */
export type RegimeBayes = {
  regime: Regime
  label: string
  n: number
  /** 收缩后的规则改善均值（金额）。 */
  meanDelta: number | null
  /** P(真实改善 > 0 | 数据)。 */
  probImprove: number | null
  /** 后验 80% 可信区间（金额）。 */
  ciLo: number | null
  ciHi: number | null
}

export type CounterfactualReport = {
  actions: CounterfactualAction[]
  /** 实际交易尾部损失 CVaR 基准。 */
  actualCvar95: number | null
  /** 条件退出动作的分策略贝叶斯收缩。 */
  byRegime: RegimeBayes[]
  /** 「异常长时间浮亏」生存分析：超过持仓 80% 分位且仍浮亏的交易，后续恢复/恶化情况。 */
  survival: SurvivalReport
}

/** 生存/竞争风险：给定「超期且浮亏」状态，估计后续恢复与恶化的概率。 */
export type SurvivalReport = {
  /** 持仓时长的 80% 分位（天）。null = 样本不足。 */
  hold80: number | null
  /** 满足价格路径的交易数（eligible）。 */
  eligible: number
  /** 进入「超期且浮亏」状态的交易数（triggered）。 */
  underwaterLong: number
  /** 其中最终恢复（finalPnl > 0）的交易数。 */
  recovered: number
  /** 其中最终继续恶化（亏损扩大超过 1 个风险单位）的交易数。 */
  deteriorated: number
  /** 观察期内既未恢复也未恶化的交易数（删失）。 */
  censored: number
  /** P(恢复)。null = 样本不足。 */
  recoverProb: number | null
  /** P(继续恶化)。null = 样本不足。 */
  deteriorateProb: number | null
  note: string
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
  space: SpaceReport
  bars: Record<string, Bar[]>
  cashflows: Cashflow[]
}
