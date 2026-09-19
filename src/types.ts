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
  currentlyUnderwater: boolean
  ulcer: number
  grossExposureMean: number
  netExposureMean: number
  bootstrapSeed: number
  sampleStart: string
  sampleEnd: string
  dayCount: number
  uniqueOpenDays: number
  kellyHalf: number | null
  sqn: number | null
  pfInfShare: number
  winRateBoot: MetricPoint | null
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
}

export type Checkup = {
  sessions: GroupRow[]
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
  bars: Record<string, Bar[]>
  cashflows: Cashflow[]
}
