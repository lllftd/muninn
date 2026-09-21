import { median, quantile, stdev } from '../lib/stats.ts'
import type { HoldDiagnostic, Regime, RegimeShare, RoundTrip } from '../types.ts'

/** 频率分档的边界(持仓日)。坎写在这里,UI 也从这里取,保证"坎写在脸上"是同一处真相。 */
export const REGIME_BANDS = { swingMaxDays: 10, positionMaxDays: 60 } as const

export const REGIME_ORDER: Regime[] = ['intraday', 'swing', 'position', 'investor']

export const REGIME_LABELS: Record<Regime, string> = {
  intraday: '日内',
  swing: '短线',
  position: '波段',
  investor: '长线',
}

/** 每类的大白话说明,直接展示给用户看。 */
export const REGIME_BOUND_TEXT: Record<Regime, string> = {
  intraday: '当天买当天卖',
  swing: '持有几天,通常两周内',
  position: '持有两周到两个月',
  investor: '持有两个月以上',
}

const DAY_MIN = 1440

/** 按锚定分档给单笔定档。intraday 用 sameDay 这个二值事实,不靠阈值;多日部分才用天数坎。 */
export function classifyRegime(t: { sameDay: boolean; holdMinutes: number }): Regime {
  if (t.sameDay) return 'intraday'
  const days = t.holdMinutes / DAY_MIN
  if (days < REGIME_BANDS.swingMaxDays) return 'swing'
  if (days < REGIME_BANDS.positionMaxDays) return 'position'
  return 'investor'
}

/**
 * 时间归一年化收益,让数天~数月的单笔可比。
 * 只对多日持仓、正成本基、结果不吞本金时给值;日内和无效情形返回 null(年化无意义,不冒充)。
 */
export function annualizedTripReturn(t: {
  status: string
  sameDay: boolean
  holdMinutes: number
  realizedPnl: number
  openPrice: number
  qty: number
}): number | null {
  if (t.status !== 'closed' || t.sameDay) return null
  const cost = Math.abs(t.openPrice * t.qty)
  if (!(cost > 0)) return null
  const days = t.holdMinutes / DAY_MIN
  if (!(days >= 1)) return null
  const growth = 1 + t.realizedPnl / cost
  if (growth <= 0) return null // 亏损吃穿本金,年化不成立
  return growth ** (365 / days) - 1
}

/** replay 之后统一 enrich:此时 sameDay 才是最终值。构造期的占位 regime 一定会被这步覆盖。 */
export function enrichRegime(trips: RoundTrip[]): RoundTrip[] {
  return trips.map((t) => ({ ...t, regime: classifyRegime(t), annualizedReturn: annualizedTripReturn(t) }))
}

export function regimeMix(trips: RoundTrip[]): RegimeShare[] {
  const total = trips.length
  return REGIME_ORDER.map((regime) => {
    const n = trips.filter((t) => t.regime === regime).length
    return { regime, n, share: total ? n / total : 0 }
  })
}

function fmtDays(d: number): string {
  if (d < 1) {
    const h = d * 24
    return h < 1 ? `${Math.round(h * 60)} 分钟` : `${h.toFixed(1)} 小时`
  }
  return d < 10 ? `${d.toFixed(1)} 日` : `${Math.round(d)} 日`
}

/**
 * 对 log10(持仓天) 做高斯核密度,找峰(天然聚集)与峰间的谷(自然断点),
 * 再看谷是否落在默认坎附近——只是诊断"默认线合不合身",不拿来重新分类(小样本聚类会飘、且是黑箱)。
 */
export function holdDiagnostic(trips: RoundTrip[]): HoldDiagnostic {
  // 只看多日持仓:intraday 由 sameDay 干净切分,不参与"10/60 日坎合不合身"的判断,
  // 否则分钟级 vs 多日的巨大 log 断崖会盖过真正要验证的多日结构,误报"不吻合"。
  const days = trips
    .filter((t) => t.status === 'closed' && !t.sameDay && t.holdMinutes > 0)
    .map((t) => t.holdMinutes / DAY_MIN)
  const n = days.length
  if (n < 20) {
    return { n, modes: [], valleys: [], fitsDefaultBands: null, note: '持有过夜的交易还不到 20 笔,先不评估你的持仓节奏。' }
  }

  const xs = days.map((d) => Math.log10(Math.max(d, 1 / DAY_MIN))) // 下限 1 分钟,避免 log(0)
  const sorted = [...xs].sort((a, b) => a - b)
  const sd = stdev(xs)
  const iqr = (quantile(sorted, 0.75) as number) - (quantile(sorted, 0.25) as number)
  const spreadCandidates = [sd, iqr > 0 ? iqr / 1.34 : Infinity].filter((v) => v > 0)
  const spread = spreadCandidates.length ? Math.min(...spreadCandidates) : 0
  const h = spread > 0 ? Math.max(0.15, 0.9 * spread * n ** (-1 / 5)) : 0.3

  const lo = sorted[0] - 3 * h
  const hi = sorted[sorted.length - 1] + 3 * h
  const steps = 240
  const grid: number[] = []
  const dens: number[] = []
  const norm = n * h * Math.sqrt(2 * Math.PI)
  for (let i = 0; i <= steps; i++) {
    const x = steps ? lo + ((hi - lo) * i) / steps : lo
    let acc = 0
    for (const xi of xs) {
      const u = (x - xi) / h
      acc += Math.exp(-0.5 * u * u)
    }
    grid.push(x)
    dens.push(acc / norm)
  }

  const maxD = Math.max(...dens)
  const modesIdx: number[] = []
  const valleysIdx: number[] = []
  for (let i = 1; i < dens.length - 1; i++) {
    if (dens[i] > dens[i - 1] && dens[i] >= dens[i + 1] && dens[i] >= 0.05 * maxD) modesIdx.push(i)
    if (dens[i] < dens[i - 1] && dens[i] <= dens[i + 1]) valleysIdx.push(i)
  }
  const modes = modesIdx.map((i) => 10 ** grid[i])
  const valleys: number[] = []
  for (let m = 0; m < modesIdx.length - 1; m++) {
    const between = valleysIdx.filter((v) => v > modesIdx[m] && v < modesIdx[m + 1])
    if (between.length) valleys.push(10 ** grid[between.reduce((a, b) => (dens[b] < dens[a] ? b : a))])
  }

  const edges = [REGIME_BANDS.swingMaxDays, REGIME_BANDS.positionMaxDays]
  if (modes.length <= 1) {
    const center = modes[0] ?? (median(days) as number)
    return {
      n,
      modes,
      valleys,
      fitsDefaultBands: true,
      note: `你持有过夜的交易,时长大多集中在 ${fmtDays(center)} 上下,很集中,这套分类贴合你的交易。`,
    }
  }
  // 每个自然谷是否都落在某条默认坎的半个数量级内(log10 差 ≤0.3,约 0.5×~2×)
  const aligned = valleys.length > 0 && valleys.every((v) => edges.some((e) => Math.abs(Math.log10(v / e)) <= 0.3))
  const vtext = valleys.length ? valleys.map(fmtDays).join('、') : '无明显谷'
  return {
    n,
    modes,
    valleys,
    fitsDefaultBands: aligned,
    note: aligned
      ? `你持有过夜的交易,时长聚成 ${modes.length} 堆,分界大约在 ${vtext},和这套分类基本对得上。`
      : `你持有过夜的交易,时长聚成 ${modes.length} 堆,分界在 ${vtext},和现在的分类不太对得上——也许有更贴合你的分法(以后可以调)。`,
  }
}
