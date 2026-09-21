import { etDateKey } from '../lib/time.ts'
import {
  bhFdr,
  BOOTSTRAP_SEED,
  ciFromSamples,
  clusterBootstrapSamples,
  mean,
  median,
  mulberry32,
  oneSidedP,
  pearson,
} from '../lib/stats.ts'
import { holdBucketOf, HOLD_BUCKET_LABELS } from './checkup.ts'
import type {
  Bar,
  EvLever,
  ExitEffGroup,
  GivebackReport,
  KellyReport,
  OppBench,
  OppCost,
  OppMatrixRow,
  PsmReport,
  PsmStratum,
  ReplayRule,
  RoundTrip,
  RuleReplay,
  SpaceCi,
  SpaceReport,
  StopLevel,
  StopScan,
} from '../types.ts'

export const SPACE_ROUNDS = 500
export const STOP_PRESETS = [0.02, 0.05, 0.08, 0.12, 0.2] as const
const STOP_SCAN: number[] = Array.from({ length: 20 }, (_, i) => (i + 1) / 100)
const FDR_Q = 0.1

function usable(t: RoundTrip) {
  return t.status === 'closed' && !t.tags.includes('DRIP') && t.pathQuality === 'daily_estimate' && !t.pathAnomaly && !t.splitSuspect
}

function ci80(values: number[]): SpaceCi | null {
  const c = ciFromSamples(values, 0.1, 0.9)
  return c ? { ...c, method: 'bootstrap', level: 0.8 } : null
}

function clustersOf(trips: RoundTrip[]): RoundTrip[][] {
  const map = new Map<string, RoundTrip[]>()
  for (const t of trips) {
    const k = etDateKey(t.openTime)
    const arr = map.get(k) || []
    arr.push(t)
    map.set(k, arr)
  }
  return [...map.values()]
}

/** 出场效率：(实现 − MAE) / (MFE − MAE)。1=出在最优点，0=出在最差点。日线粗估。 */
export function exitEfficiency(t: RoundTrip): number | null {
  if (!usable(t) || t.maeDollar == null || t.mfeDollar == null) return null
  const span = t.mfeDollar - t.maeDollar
  if (!(span > 1e-9)) return null
  const v = (t.realizedPnl - t.maeDollar) / span
  if (!Number.isFinite(v)) return null
  return Math.min(1, Math.max(0, v))
}

function givebackDollar(t: RoundTrip): number | null {
  if (!usable(t) || t.mfeDollar == null || !(t.mfeDollar > 0)) return null
  return t.mfeDollar - t.realizedPnl
}

/** 回吐占峰值浮盈的比例，封顶 1：从浮盈走到亏损记为回吐全部，不写成 600%。 */
function givebackRate(t: RoundTrip): number | null {
  if (!usable(t) || t.mfeDollar == null || !(t.mfeDollar > 0)) return null
  return Math.min(1, Math.max(0, (t.mfeDollar - t.realizedPnl) / t.mfeDollar))
}

/** 若 MAE 触及 −s，按开仓价 × s 止损；否则保留原实现。日线不知道盘中先后。 */
export function counterfactualStopPnl(t: RoundTrip, stopPct: number): { pnl: number; stopped: boolean } {
  const notional = t.openPrice * t.qty
  const stopPnl = -stopPct * notional - t.fees
  if (t.maePct != null && t.maePct <= -stopPct + 1e-12) return { pnl: stopPnl, stopped: true }
  return { pnl: t.realizedPnl, stopped: false }
}

function windowBars(bars: Bar[] | undefined, start: string, end: string): Bar[] {
  return (bars || []).filter((b) => b.date >= start && b.date <= end)
}

function dirOf(t: RoundTrip) {
  return t.side === 'long' ? 1 : -1
}

function pxPnl(t: RoundTrip, exitPx: number) {
  return (exitPx - t.openPrice) * t.qty * dirOf(t) - t.fees
}

/** 先按昨高峰检查止盈，再更新高峰：不假设同根 K 线先摸高再回撤。 */
export function replayTrail(
  t: RoundTrip,
  bars: Bar[] | undefined,
  trailPct: number,
): { pnl: number; triggered: boolean; eligible: boolean } {
  if (!usable(t) || t.openPrice <= 0 || t.qty <= 0 || !t.closeTime) {
    return { pnl: t.realizedPnl, triggered: false, eligible: false }
  }
  const window = windowBars(bars, etDateKey(t.openTime), etDateKey(t.closeTime))
  if (!window.length) return { pnl: t.realizedPnl, triggered: false, eligible: false }
  const dir = dirOf(t)
  let peak = t.openPrice
  for (const bar of window) {
    if (dir === 1) {
      const stop = peak * (1 - trailPct)
      if (bar.low <= stop + 1e-12) return { pnl: pxPnl(t, stop), triggered: true, eligible: true }
      if (bar.high > peak) peak = bar.high
    } else {
      const stop = peak * (1 + trailPct)
      if (bar.high >= stop - 1e-12) return { pnl: pxPnl(t, stop), triggered: true, eligible: true }
      if (bar.low < peak) peak = bar.low
    }
  }
  return { pnl: t.realizedPnl, triggered: false, eligible: true }
}

/** 含开仓日在内第 N 根日线收盘强制出场；没拿满 N 日则保持原实现。 */
export function replayHold(
  t: RoundTrip,
  bars: Bar[] | undefined,
  nDays: number,
): { pnl: number; triggered: boolean; eligible: boolean } {
  if (!usable(t) || t.openPrice <= 0 || t.qty <= 0 || !t.closeTime) {
    return { pnl: t.realizedPnl, triggered: false, eligible: false }
  }
  const window = windowBars(bars, etDateKey(t.openTime), etDateKey(t.closeTime))
  if (window.length <= nDays) return { pnl: t.realizedPnl, triggered: false, eligible: window.length > 0 }
  return { pnl: pxPnl(t, window[nDays - 1].close), triggered: true, eligible: true }
}

export function kellyFraction(p: number, b: number): number {
  if (!(b > 0) || !Number.isFinite(p) || !Number.isFinite(b)) return 0
  const f = p - (1 - p) / b
  if (!Number.isFinite(f)) return 0
  return Math.min(1, Math.max(0, f))
}

function nearestClose(bars: Bar[], date: string): number | null {
  let hit: number | null = null
  for (const b of bars) {
    if (b.date <= date && b.close > 0) hit = b.close
    if (b.date > date) break
  }
  return hit
}

function symbolBhPnl(t: RoundTrip, bars: Bar[] | undefined): number | null {
  if (!usable(t) || !t.closeTime || t.openPrice <= 0 || t.qty <= 0) return null
  const window = windowBars(bars, etDateKey(t.openTime), etDateKey(t.closeTime))
  if (!window.length) return null
  const startPx = window[0].open
  const endPx = window[window.length - 1].close
  if (!(startPx > 0) || !(endPx > 0)) return null
  return (endPx - startPx) * t.qty * dirOf(t) - t.fees
}

function spyBhPnl(t: RoundTrip, spy: Bar[]): number | null {
  if (t.status !== 'closed' || t.tags.includes('DRIP') || !t.closeTime || t.openPrice <= 0 || t.qty <= 0) return null
  const bo = nearestClose(spy, etDateKey(t.openTime))
  const bc = nearestClose(spy, etDateKey(t.closeTime))
  if (bo == null || bc == null || !(bo > 0)) return null
  return (bc / bo - 1) * t.openPrice * t.qty - t.fees
}

function reverseAsLong(t: RoundTrip): number | null {
  if (t.side !== 'short' || t.closePrice == null || !(t.openPrice > 0)) return null
  return (t.closePrice - t.openPrice) * t.qty - t.fees
}

const TRAIL_PRESETS = [
  { id: 'trail-10', pct: 0.1, label: '浮盈回撤 10% 止盈' },
  { id: 'trail-20', pct: 0.2, label: '浮盈回撤 20% 止盈' },
] as const
const HOLD_PRESETS = [
  { id: 'hold-1', days: 1, label: '持有 1 个交易日强制出场' },
  { id: 'hold-5', days: 5, label: '持有 5 个交易日强制出场' },
  { id: 'hold-10', days: 10, label: '持有 10 个交易日强制出场' },
] as const

function buildRuleReplay(path: RoundTrip[], bars: Record<string, Bar[]>, seed: number): RuleReplay {
  const actualPnl = path.reduce((s, t) => s + t.realizedPnl, 0)
  const clusters = clustersOf(path)
  const specs: Array<{
    id: string
    family: ReplayRule['family']
    label: string
    computable: boolean
    run: (t: RoundTrip) => { pnl: number; triggered: boolean; eligible: boolean }
  }> = [
    ...TRAIL_PRESETS.map((r) => ({
      id: r.id,
      family: 'trail' as const,
      label: r.label,
      computable: true,
      run: (t: RoundTrip) => replayTrail(t, bars[t.symbol], r.pct),
    })),
    ...HOLD_PRESETS.map((r) => ({
      id: r.id,
      family: 'hold' as const,
      label: r.label,
      computable: true,
      run: (t: RoundTrip) => replayHold(t, bars[t.symbol], r.days),
    })),
    {
      id: 'open-30',
      family: 'open30',
      label: '开盘 30 分钟内出场',
      computable: false,
      run: (t: RoundTrip) => ({ pnl: t.realizedPnl, triggered: false, eligible: false }),
    },
  ]
  const raw = specs.map((spec, i) => {
    if (!spec.computable) {
      return {
        id: spec.id,
        family: spec.family,
        label: spec.label,
        pnl: actualPnl,
        delta: 0,
        deltaCi: null,
        nTriggered: 0,
        nEligible: 0,
        pValue: null as number | null,
        fdr: false,
        computable: false,
      }
    }
    const byId = new Map<string, { pnl: number; triggered: boolean; eligible: boolean }>()
    let pnl = 0
    let nTriggered = 0
    let nEligible = 0
    for (const t of path) {
      const cf = spec.run(t)
      byId.set(t.id, cf)
      pnl += cf.pnl
      if (cf.eligible) nEligible += 1
      if (cf.triggered) nTriggered += 1
    }
    const delta = pnl - actualPnl
    const samples =
      nEligible >= 5
        ? clusterBootstrapSamples(
            clusters,
            (items) => {
              if (!items.length) return null
              let act = 0
              let cf = 0
              for (const t of items) {
                act += t.realizedPnl
                cf += byId.get(t.id)?.pnl ?? t.realizedPnl
              }
              return cf - act
            },
            seed + i * 17,
            SPACE_ROUNDS,
          )
        : []
    return {
      id: spec.id,
      family: spec.family,
      label: spec.label,
      pnl,
      delta,
      deltaCi: ci80(samples),
      nTriggered,
      nEligible,
      pValue: oneSidedP(samples),
      fdr: false,
      computable: true,
    }
  })
  const fdrIdx = raw.map((r, i) => (r.computable ? i : -1)).filter((i) => i >= 0)
  const flags = bhFdr(
    fdrIdx.map((i) => raw[i].pValue ?? 1),
    FDR_Q,
  )
  fdrIdx.forEach((i, k) => {
    raw[i].fdr = flags[k]
  })
  const survivors = raw.filter((r) => r.computable && r.fdr && r.delta > 0)
  const bestPreset = survivors.length ? [...survivors].sort((a, b) => b.delta - a.delta)[0] : null
  return {
    actualPnl,
    rules: raw,
    bestPreset,
    note: '只回放 5 档预设（trailing 10%/20%，持有 1/5/10 日），开盘 30 分钟没有分时所以算不了。日线先检查昨高峰再更新，不假设同根 K 线先摸高。过 FDR 的正档才能认领，不是曲线里最好看的那条。',
  }
}

function benchOf(
  id: OppBench['id'],
  label: string,
  rows: Array<{ actual: number; bench: number }>,
  clusters: RoundTrip[][],
  pick: (t: RoundTrip) => number | null,
  seed: number,
): OppBench | null {
  if (rows.length < 5) return null
  const actual = rows.reduce((s, r) => s + r.actual, 0)
  const bench = rows.reduce((s, r) => s + r.bench, 0)
  const memo = new Map<string, number | null>()
  const cached = (t: RoundTrip) => {
    if (memo.has(t.id)) return memo.get(t.id) as number | null
    const v = pick(t)
    memo.set(t.id, v)
    return v
  }
  const samples = clusterBootstrapSamples(
    clusters,
    (items) => {
      let a = 0
      let b = 0
      let n = 0
      for (const t of items) {
        const v = cached(t)
        if (v == null) continue
        a += t.realizedPnl
        b += v
        n += 1
      }
      return n ? a - b : null
    },
    seed,
    SPACE_ROUNDS,
  )
  return { id, label, n: rows.length, actual, bench, delta: actual - bench, deltaCi: ci80(samples) }
}

function buildOppCost(closed: RoundTrip[], path: RoundTrip[], bars: Record<string, Bar[]>, seed: number): OppCost {
  const spy = bars.SPY || bars.QQQ || bars['^GSPC'] || bars.SPX || []
  const clusters = clustersOf(path)
  const bhRows: Array<{ actual: number; bench: number }> = []
  for (const t of path) {
    const bench = symbolBhPnl(t, bars[t.symbol])
    if (bench == null) continue
    bhRows.push({ actual: t.realizedPnl, bench })
  }
  const spyRows: Array<{ actual: number; bench: number }> = []
  const spyClusters = clustersOf(closed)
  for (const t of closed) {
    const bench = spyBhPnl(t, spy)
    if (bench == null) continue
    spyRows.push({ actual: t.realizedPnl, bench })
  }
  const bySym = new Map<string, RoundTrip[]>()
  for (const t of closed) {
    const arr = bySym.get(t.symbol) || []
    arr.push(t)
    bySym.set(t.symbol, arr)
  }
  const matrix: OppMatrixRow[] = [...bySym.entries()]
    .map(([symbol, list]) => {
      const longs = list.filter((x) => x.side === 'long')
      const shorts = list.filter((x) => x.side === 'short')
      const reverse = shorts.map(reverseAsLong).filter((v): v is number => v != null)
      return {
        symbol,
        nLong: longs.length,
        nShort: shorts.length,
        longMean: longs.length >= 3 ? mean(longs.map((x) => x.realizedPnl)) : null,
        shortMean: shorts.length >= 3 ? mean(shorts.map((x) => x.realizedPnl)) : null,
        reverseShortMean: reverse.length >= 3 ? mean(reverse) : null,
      }
    })
    .filter((r) => r.nLong + r.nShort >= 3)
    .sort((a, b) => b.nLong + b.nShort - (a.nLong + a.nShort))
    .slice(0, 8)
  return {
    symbolBh: benchOf('symbol-bh', '同期标的持有不动（开盘→收盘）', bhRows, clusters, (t) => symbolBhPnl(t, bars[t.symbol]), seed),
    spy: spy.length
      ? benchOf('spy', '同期把同样名义本金放在 SPY/QQQ', spyRows, spyClusters, (t) => spyBhPnl(t, spy), seed + 3)
      : null,
    matrix,
    note: '机会成本是实际盈亏 − 同期基准，不是「你该一直拿着」。没有用 CAPM alpha：样本太小会装精确。反向列是把每笔空头假设改成做多重算一遍，不是另一组交易。',
  }
}

function psmAtt(strata: Array<{ shorts: number[]; longs: number[] }>): {
  nMatched: number
  treatedMean: number
  controlMean: number
  delta: number
} | null {
  let nMatched = 0
  let treatedSum = 0
  let controlSum = 0
  for (const s of strata) {
    if (!s.shorts.length || !s.longs.length) continue
    const c = mean(s.longs)
    for (const y of s.shorts) {
      treatedSum += y
      controlSum += c
      nMatched += 1
    }
  }
  if (!nMatched) return null
  const treatedMean = treatedSum / nMatched
  const controlMean = controlSum / nMatched
  return { nMatched, treatedMean, controlMean, delta: treatedMean - controlMean }
}

function buildPsm(closed: RoundTrip[], seed: number): PsmReport {
  const treated = closed.filter((t) => t.side === 'short')
  const nTreated = treated.length
  const map = new Map<string, { symbol: string; bucket: string; shorts: RoundTrip[]; longs: RoundTrip[] }>()
  for (const t of closed) {
    const bucket = holdBucketOf(t.holdMinutes)
    const id = `${t.symbol}|${bucket}`
    const row = map.get(id) || { symbol: t.symbol, bucket, shorts: [], longs: [] }
    if (t.side === 'short') row.shorts.push(t)
    else row.longs.push(t)
    map.set(id, row)
  }
  const mixed = [...map.values()].filter((r) => r.shorts.length && r.longs.length)
  const att = psmAtt(mixed.map((r) => ({ shorts: r.shorts.map((t) => t.realizedPnl), longs: r.longs.map((t) => t.realizedPnl) })))
  const nMatched = att?.nMatched ?? 0
  const unmatchedShare = nTreated ? 1 - nMatched / nTreated : null
  const status: PsmReport['status'] =
    nMatched >= 5 && (unmatchedShare == null || unmatchedShare <= 0.5) ? 'ok' : 'cannot-control'
  const strata: PsmStratum[] = mixed.map((r) => ({
    id: `${r.symbol}|${r.bucket}`,
    symbol: r.symbol,
    bucket: r.bucket,
    bucketLabel: HOLD_BUCKET_LABELS[r.bucket as 'h1' | 'h2' | 'h3'],
    nShort: r.shorts.length,
    nLong: r.longs.length,
    shortMean: mean(r.shorts.map((t) => t.realizedPnl)),
    longMean: mean(r.longs.map((t) => t.realizedPnl)),
  }))
  const samples: number[] = []
  if (att && mixed.length) {
    const rnd = mulberry32(seed)
    for (let i = 0; i < 400; i++) {
      const shuffled = mixed.map((r) => {
        const pool = [...r.shorts, ...r.longs].map((t) => t.realizedPnl)
        for (let j = pool.length - 1; j > 0; j--) {
          const k = Math.floor(rnd() * (j + 1))
          const tmp = pool[j]
          pool[j] = pool[k]
          pool[k] = tmp
        }
        return { shorts: pool.slice(0, r.shorts.length), longs: pool.slice(r.shorts.length) }
      })
      const p = psmAtt(shuffled)
      if (p) samples.push(p.delta)
    }
  }
  const pValue =
    att && samples.length
      ? (1 + samples.filter((v) => (att.delta <= 0 ? v <= att.delta : v >= att.delta)).length) / (1 + samples.length)
      : null
  const deltaSamples = att
    ? clusterBootstrapSamples(
        clustersOf(closed),
        (items) => {
          const inner = new Map<string, { shorts: number[]; longs: number[] }>()
          for (const t of items) {
            const id = `${t.symbol}|${holdBucketOf(t.holdMinutes)}`
            const row = inner.get(id) || { shorts: [], longs: [] }
            if (t.side === 'short') row.shorts.push(t.realizedPnl)
            else row.longs.push(t.realizedPnl)
            inner.set(id, row)
          }
          return psmAtt([...inner.values()])?.delta ?? null
        },
        seed + 9,
        SPACE_ROUNDS,
      )
    : []
  return {
    nTreated,
    nMatched,
    unmatchedShare,
    method: 'exact',
    status,
    treatedMean: att?.treatedMean ?? null,
    controlMean: att?.controlMean ?? null,
    delta: att?.delta ?? null,
    deltaCi: ci80(deltaSamples),
    pValue,
    strata,
    note:
      nTreated < 5
        ? '空头不足 5 笔，不做匹配。'
        : status === 'cannot-control'
          ? '样本小于 50，只用标的×持仓档精确匹配。对照不足或未匹配比例过高，无法把方向从标的里剥离开。方向实验先不要认领。'
          : '精确匹配：同一标的、同一持仓档的做多作为对照。这不是倾向得分模型，小样本不拟合 logit。',
  }
}

function kellyParts(trips: RoundTrip[]) {
  const wins = trips.filter((t) => t.realizedPnl > 0).map((t) => t.realizedPnl)
  const losses = trips.filter((t) => t.realizedPnl < 0).map((t) => t.realizedPnl)
  if (!trips.length || !wins.length || !losses.length) return null
  const p = wins.length / trips.length
  const b = Math.abs(mean(wins) / mean(losses))
  const full = kellyFraction(p, b)
  return { p, b, full, half: full / 2, quarter: full / 4, nWin: wins.length, nLoss: losses.length }
}

function buildKelly(closed: RoundTrip[]): KellyReport | null {
  const parts = kellyParts(closed)
  if (!parts) return null
  const notionals = closed.map((t) => t.openPrice * t.qty)
  const winN = closed.filter((t) => t.realizedPnl > 0).map((t) => t.openPrice * t.qty)
  const lossN = closed.filter((t) => t.realizedPnl < 0).map((t) => t.openPrice * t.qty)
  const samples = clusterBootstrapSamples(
    clustersOf(closed),
    (items) => kellyParts(items)?.quarter ?? null,
    BOOTSTRAP_SEED + 41,
    SPACE_ROUNDS,
  )
  return {
    n: closed.length,
    nWin: parts.nWin,
    nLoss: parts.nLoss,
    p: parts.p,
    b: parts.b,
    full: parts.full,
    half: parts.half,
    quarter: parts.quarter,
    quarterCi: ci80(samples),
    corrSizePnl: pearson(notionals, closed.map((t) => t.realizedPnl)),
    medianNotional: median(notionals),
    medianNotionalWin: median(winN),
    medianNotionalLoss: median(lossN),
    note: 'f* = p − q/b。full Kelly 波动极大，只展示 1/4 与 1/2，且小样本的 p、b 本身不稳。没有账户净资产时不能把比例换成美元仓位。这是参考，不是仓位建议。',
  }
}

function evOf(trips: RoundTrip[]) {
  const wins = trips.filter((t) => t.realizedPnl > 0).map((t) => t.realizedPnl)
  const losses = trips.filter((t) => t.realizedPnl < 0).map((t) => t.realizedPnl)
  const n = trips.length
  if (!n || !wins.length || !losses.length) return null
  const p = wins.length / n
  const W = mean(wins)
  const L = Math.abs(mean(losses))
  return { n, p, W, L, ev: p * W - (1 - p) * L }
}

function leverDeltas(trips: RoundTrip[]): Record<EvLever['id'], number> | null {
  const base = evOf(trips)
  if (!base) return null
  const { n, p, W, L, ev } = base
  const pWin = Math.min(0.99, p * 1.1)
  const qLoss = Math.max(0.01, (1 - p) * 0.9)
  const pFromQ = 1 - qLoss
  return {
    winRate: (pWin * W - (1 - pWin) * L - ev) * n,
    avgWin: (p * (W * 1.1) - (1 - p) * L - ev) * n,
    lossRate: (pFromQ * W - qLoss * L - ev) * n,
    avgLoss: (p * W - (1 - p) * (L * 0.9) - ev) * n,
  }
}

function groupMean(id: string, label: string, list: RoundTrip[]): ExitEffGroup {
  const vs = list.map(exitEfficiency).filter((v): v is number => v != null)
  return { id, label, n: vs.length, mean: vs.length >= 5 ? mean(vs) : null }
}

export function buildSpace(trips: RoundTrip[], bars: Record<string, Bar[]> = {}): SpaceReport {
  const closed = trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  const path = closed.filter(usable)
  const effs = path.map(exitEfficiency).filter((v): v is number => v != null)
  const floated = path.filter((t) => (t.mfeDollar ?? 0) > 0)
  const gbVals = floated.map(givebackDollar).filter((v): v is number => v != null)
  const clusters = clustersOf(path)

  const groups: ExitEffGroup[] = [
    groupMean('long', '多头', path.filter((t) => t.side === 'long')),
    groupMean('short', '空头', path.filter((t) => t.side === 'short')),
    ...(['h1', 'h2', 'h3'] as const).map((b) =>
      groupMean(b, HOLD_BUCKET_LABELS[b], path.filter((t) => holdBucketOf(t.holdMinutes) === b)),
    ),
  ]
  const bySym = new Map<string, RoundTrip[]>()
  for (const t of path) {
    const arr = bySym.get(t.symbol) || []
    arr.push(t)
    bySym.set(t.symbol, arr)
  }
  const symGroups = [...bySym.entries()]
    .map(([sym, list]) => groupMean(sym, sym, list))
    .filter((g) => g.n >= 5)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
  groups.push(...symGroups)

  const sumDollar = gbVals.length ? gbVals.reduce((s, v) => s + v, 0) : null
  const meanRate = floated.length ? mean(floated.map((t) => givebackRate(t) as number)) : null
  const sumSamples = clusterBootstrapSamples(clusters, (items) => {
    const g = items.map(givebackDollar).filter((v): v is number => v != null)
    return g.length ? g.reduce((s, v) => s + v, 0) : null
  }, BOOTSTRAP_SEED, SPACE_ROUNDS)
  const rateSamples = clusterBootstrapSamples(clusters, (items) => {
    const f = items.filter((t) => (t.mfeDollar ?? 0) > 0)
    if (!f.length) return null
    return mean(f.map((t) => givebackRate(t) as number))
  }, BOOTSTRAP_SEED + 1, SPACE_ROUNDS)

  const giveback: GivebackReport = {
    nFloated: floated.length,
    nClosed: closed.length,
    nPath: path.length,
    meanRate,
    sumDollar,
    sumCi: ci80(sumSamples),
    meanRateCi: ci80(rateSamples),
    note: '回吐金额是 MFE 浮盈 − 实际实现，只统计曾经浮盈的交易。比例封顶 100%：从浮盈走到亏损记为回吐全部，不把后续亏损写成 600%。这是理论上界：没人能稳定出在最高点。可验证的空间看下面的硬止损回放。日线 OHLC 粗估，同日与缺行情不计入。',
  }

  let stopScan: StopScan | null = null
  const withMae = path.filter((t) => t.maePct != null && t.openPrice > 0 && t.qty > 0)
  if (withMae.length >= 5) {
    const actualPnl = withMae.reduce((s, t) => s + t.realizedPnl, 0)
    const maeClusters = clustersOf(withMae)
    const raw: Omit<StopLevel, 'fdr'>[] = STOP_SCAN.map((pct) => {
      let pnl = 0
      let nStopped = 0
      for (const t of withMae) {
        const cf = counterfactualStopPnl(t, pct)
        pnl += cf.pnl
        if (cf.stopped) nStopped += 1
      }
      const delta = pnl - actualPnl
      const preset = STOP_PRESETS.some((p) => Math.abs(p - pct) < 1e-9)
      const samples = preset
        ? clusterBootstrapSamples(
            maeClusters,
            (items) => {
              if (!items.length) return null
              const act = items.reduce((s, t) => s + t.realizedPnl, 0)
              const cf = items.reduce((s, t) => s + counterfactualStopPnl(t, pct).pnl, 0)
              return cf - act
            },
            BOOTSTRAP_SEED + Math.round(pct * 1000),
            SPACE_ROUNDS,
          )
        : []
      return {
        pct,
        preset,
        pnl,
        delta,
        deltaCi: preset ? ci80(samples) : null,
        pValue: preset ? oneSidedP(samples) : null,
        nStopped,
      }
    })
    const presetIdx = raw.map((r, i) => (r.preset ? i : -1)).filter((i) => i >= 0)
    const fdrFlags = bhFdr(
      presetIdx.map((i) => raw[i].pValue ?? 1),
      FDR_Q,
    )
    const levels: StopLevel[] = raw.map((r, i) => ({
      ...r,
      fdr: presetIdx.includes(i) ? fdrFlags[presetIdx.indexOf(i)] : false,
    }))
    const presets = levels.filter((l) => l.preset)
    const survivors = presets.filter((l) => l.fdr && l.delta > 0)
    const bestPreset = survivors.length ? [...survivors].sort((a, b) => b.delta - a.delta)[0] : null
    stopScan = {
      actualPnl,
      levels,
      presets,
      bestPreset,
      note: '横轴是开仓后的硬止损线。触及日线 MAE 即按该档出场，否则保留原实现。这是规则反事实，不是出在最高点。扫了 20 档，最高点不能当最优——可验证的只有 2%/5%/8%/12%/20% 五档，且需通过 FDR。日线不知道盘中先后。',
    }
  }

  const leverIds: Array<EvLever['id']> = ['winRate', 'avgWin', 'lossRate', 'avgLoss']
  const labels: Record<EvLever['id'], { label: string; shock: string }> = {
    winRate: { label: '胜率', shock: '相对 +10%' },
    avgWin: { label: '均盈', shock: '相对 +10%' },
    lossRate: { label: '败率', shock: '相对 −10%' },
    avgLoss: { label: '均亏', shock: '相对 −10%' },
  }
  const point = leverDeltas(closed)
  const evLevers: EvLever[] = leverIds.map((id) => {
    const samples = point
      ? clusterBootstrapSamples(clustersOf(closed), (items) => leverDeltas(items)?.[id] ?? null, BOOTSTRAP_SEED + id.length, SPACE_ROUNDS)
      : []
    return {
      id,
      label: labels[id].label,
      shock: labels[id].shock,
      delta: point?.[id] ?? 0,
      deltaCi: ci80(samples),
    }
  })
  evLevers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    exitEfficiency: {
      overall: effs.length >= 5 ? mean(effs) : null,
      n: effs.length,
      groups: groups.filter((g) => g.n > 0),
    },
    giveback,
    stopScan,
    evLevers: point ? evLevers : [],
    ruleReplay: buildRuleReplay(path, bars, BOOTSTRAP_SEED + 70),
    oppCost: buildOppCost(closed, path, bars, BOOTSTRAP_SEED + 90),
    psm: buildPsm(closed, BOOTSTRAP_SEED + 110),
    kelly: buildKelly(closed),
  }
}
