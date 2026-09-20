export const BOOTSTRAP_SEED = 20260919
export const BOOTSTRAP_ROUNDS = 10000
const Z95 = 1.959963984540054

export function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const a = [...xs].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null
  const a = [...xs].sort((x, y) => x - y)
  const i = (a.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return a[lo]
  return a[lo] * (hi - i) + a[hi] * (i - lo)
}

export function stdev(xs: number[], ddof = 1): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - ddof))
}

function centralMoment(xs: number[], k: number, m: number): number {
  return xs.reduce((s, x) => s + (x - m) ** k, 0) / xs.length
}

/** 样本偏度 g1 = m3 / m2^1.5。分布对称时约为 0;负偏=左尾更长(多次小赢+偶发大亏)。方差为 0 或样本<3 返回 null。 */
export function skewness(xs: number[]): number | null {
  if (xs.length < 3) return null
  const m = mean(xs)
  const m2 = centralMoment(xs, 2, m)
  if (m2 < 1e-18) return null
  return centralMoment(xs, 3, m) / m2 ** 1.5
}

/** 超额峰度 g2 = m4 / m2^2 − 3。>0 表示比正态更肥尾。方差为 0 或样本<4 返回 null。 */
export function kurtosis(xs: number[]): number | null {
  if (xs.length < 4) return null
  const m = mean(xs)
  const m2 = centralMoment(xs, 2, m)
  if (m2 < 1e-18) return null
  return centralMoment(xs, 4, m) / (m2 * m2) - 3
}

/** erf(x),Abramowitz-Stegun 7.1.26,最大绝对误差约 1.5e-7。 */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return s * y
}

/** 标准正态 CDF Φ(z) = ½(1 + erf(z/√2))。用于游程检验的 p 值。 */
export function normalCdf(z: number): number {
  return Math.min(1, Math.max(0, 0.5 * (1 + erf(z / Math.SQRT2))))
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function wilsonInterval(wins: number, n: number): { lo: number; hi: number } | null {
  if (n <= 0) return null
  const p = wins / n
  const z2 = Z95 * Z95
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const margin = (Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom
  return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) }
}

export function ols(x: number[], y: number[]): {
  alpha: number
  beta: number
  alphaSe: number
  betaSe: number
  r2: number
  n: number
} | null {
  const n = Math.min(x.length, y.length)
  if (n < 8) return null
  const xs = x.slice(0, n)
  const ys = y.slice(0, n)
  const mx = mean(xs)
  const my = mean(ys)
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (sxx < 1e-18) return null
  const beta = sxy / sxx
  const alpha = my - beta * mx
  let sse = 0
  for (let i = 0; i < n; i++) {
    const e = ys[i] - (alpha + beta * xs[i])
    sse += e * e
  }
  const df = n - 2
  const s2 = sse / df
  const alphaSe = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx))
  const betaSe = Math.sqrt(s2 / sxx)
  const r2 = syy > 0 ? 1 - sse / syy : 0
  return { alpha, beta, alphaSe, betaSe, r2, n }
}

export function olsHac(
  x: number[],
  y: number[],
  maxLag = 1,
): (NonNullable<ReturnType<typeof ols>> & { seMethod: 'newey-west'; lag: number }) | null {
  const classic = ols(x, y)
  if (!classic) return null
  const n = classic.n
  const xs = x.slice(0, n)
  const u = y.slice(0, n).map((yi, i) => yi - classic.alpha - classic.beta * xs[i])
  let xx01 = 0
  let xx11 = 0
  for (const xi of xs) {
    xx01 += xi
    xx11 += xi * xi
  }
  const det = n * xx11 - xx01 * xx01
  if (Math.abs(det) < 1e-18) return { ...classic, seMethod: 'newey-west', lag: 0 }
  const i00 = xx11 / det
  const i01 = -xx01 / det
  const i11 = n / det
  const score = u.map((ui, t) => [ui, ui * xs[t]])
  const lag = Math.max(0, Math.min(maxLag, n - 2))
  let s00 = 0
  let s01 = 0
  let s11 = 0
  for (let l = 0; l <= lag; l++) {
    const w = l === 0 ? 1 : 1 - l / (lag + 1)
    let g00 = 0
    let g01 = 0
    let g10 = 0
    let g11 = 0
    for (let t = l; t < n; t++) {
      g00 += score[t][0] * score[t - l][0]
      g01 += score[t][0] * score[t - l][1]
      g10 += score[t][1] * score[t - l][0]
      g11 += score[t][1] * score[t - l][1]
    }
    if (l === 0) {
      s00 += g00
      s01 += g01
      s11 += g11
    } else {
      s00 += w * 2 * g00
      s01 += w * (g01 + g10)
      s11 += w * 2 * g11
    }
  }
  const t00 = i00 * s00 + i01 * s01
  const t01 = i00 * s01 + i01 * s11
  const t10 = i01 * s00 + i11 * s01
  const t11 = i01 * s01 + i11 * s11
  const v00 = t00 * i00 + t01 * i01
  const v11 = t10 * i01 + t11 * i11
  return {
    ...classic,
    alphaSe: Math.sqrt(Math.max(v00, 0)),
    betaSe: Math.sqrt(Math.max(v11, 0)),
    seMethod: 'newey-west',
    lag,
  }
}

export function clusterBootstrap<T>(
  clusters: T[][],
  stat: (items: T[]) => number | null,
  seed = BOOTSTRAP_SEED,
  rounds = BOOTSTRAP_ROUNDS,
): { lo: number | null; hi: number | null; unboundedHi: boolean; infShare: number } {
  if (!clusters.length) return { lo: null, hi: null, unboundedHi: false, infShare: 0 }
  const rng = mulberry32(seed)
  const values: number[] = []
  let inf = 0
  let invalid = 0
  for (let r = 0; r < rounds; r++) {
    const sample: T[] = []
    for (let i = 0; i < clusters.length; i++) {
      const pick = clusters[Math.floor(rng() * clusters.length)]
      sample.push(...pick)
    }
    const v = stat(sample)
    if (v == null || Number.isNaN(v)) {
      invalid += 1
      continue
    }
    if (!Number.isFinite(v)) {
      inf += 1
      values.push(Number.POSITIVE_INFINITY)
      continue
    }
    values.push(v)
  }
  if (!values.length) return { lo: null, hi: null, unboundedHi: invalid > 0 || inf > 0, infShare: inf / rounds }
  values.sort((a, b) => a - b)
  const loRaw = values[Math.floor(0.025 * (values.length - 1))]
  const hiRaw = values[Math.ceil(0.975 * (values.length - 1))]
  return {
    lo: Number.isFinite(loRaw) ? loRaw : null,
    hi: Number.isFinite(hiRaw) ? hiRaw : null,
    unboundedHi: !Number.isFinite(hiRaw) || inf / rounds > 0.01,
    infShare: inf / rounds,
  }
}

function yearFrac(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (365 * 86400000)
}

export type XirrStatus = 'ok' | 'too-few' | 'no-root' | 'multiple' | 'failed'

export function xirr(cashflows: Array<{ date: Date; amount: number }>): { value: number | null; status: XirrStatus } {
  const cfs = cashflows.filter((c) => Number.isFinite(c.amount) && c.amount !== 0)
  if (cfs.length < 2) return { value: null, status: 'too-few' }
  const t0 = cfs[0].date
  const npv = (r: number) => {
    if (r <= -0.999999) return Number.POSITIVE_INFINITY
    return cfs.reduce((s, c) => s + c.amount / (1 + r) ** yearFrac(t0, c.date), 0)
  }
  const grid: number[] = []
  for (let r = -0.9; r <= 8.0001; r += 0.05) grid.push(Number(r.toFixed(4)))
  const brackets: Array<[number, number]> = []
  for (let i = 0; i < grid.length - 1; i++) {
    const a = grid[i]
    const b = grid[i + 1]
    const fa = npv(a)
    const fb = npv(b)
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue
    if (fa === 0) return { value: a, status: 'ok' }
    if (fa * fb < 0) brackets.push([a, b])
  }
  if (!brackets.length) return { value: null, status: 'no-root' }
  if (brackets.length > 1) return { value: null, status: 'multiple' }
  const root = brent(npv, brackets[0][0], brackets[0][1])
  if (root == null || !Number.isFinite(root) || Math.abs(npv(root)) > 1e-3) return { value: null, status: 'failed' }
  return { value: root, status: 'ok' }
}

function brent(f: (x: number) => number, a0: number, b0: number): number | null {
  let a = a0
  let b = b0
  let fa = f(a)
  let fb = f(b)
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null
  if (Math.abs(fa) < Math.abs(fb)) {
    ;[a, b] = [b, a]
    ;[fa, fb] = [fb, fa]
  }
  let c = a
  let fc = fa
  let d = b - a
  let e = d
  for (let i = 0; i < 120; i++) {
    if (fb === 0 || Math.abs(b - a) < 1e-10) return b
    if (Math.abs(fa) < Math.abs(fb)) {
      c = b
      b = a
      a = c
      fc = fb
      fb = fa
      fa = fc
    }
    const m = 0.5 * (a - b)
    const tol = 1e-12 * Math.max(1, Math.abs(b))
    if (Math.abs(m) <= tol || fb === 0) return b
    let s: number
    if (Math.abs(e) >= tol && Math.abs(fc) > Math.abs(fb)) {
      const p = (b - a) / fa
      const q = (fa - fb) / fc
      const r = (fb - fc) / fa
      s = b - p * (q / r) * fb
    } else {
      s = b + m
    }
    if (s <= Math.min(a, b) || s >= Math.max(a, b)) s = b + m
    d = e
    e = b - s
    c = b
    fc = fb
    b = s
    fb = f(b)
    if (fa * fb > 0) {
      a = c
      fa = fc
    }
  }
  return Number.isFinite(b) ? b : null
}

/** Start-of-day cashflows use weight 1: CF is fully in the denominator. */
export function modifiedDietz(v0: number, v1: number, flows: Array<{ weight: number; amount: number }>): number | null {
  if (!(v0 > 0)) return null
  const cf = flows.reduce((s, f) => s + f.amount, 0)
  const weighted = flows.reduce((s, f) => s + f.weight * f.amount, 0)
  const den = v0 + weighted
  if (Math.abs(den) < 1e-9) return null
  return (v1 - v0 - cf) / den
}
