import { describe, expect, it } from 'vitest'
import { distributionShape, monteCarlo, regimeCumulative, runsTest } from './analytics.ts'
import type { RoundTrip } from '../types.ts'

describe('distributionShape', () => {
  it('is null under 20 samples', () => {
    expect(distributionShape([1, 2, 3]).skew).toBeNull()
  })
  it('symmetric data has ~0 skew and VaR/CVaR on the loss tail', () => {
    const xs = Array.from({ length: 41 }, (_, i) => i - 20) // -20..20
    const d = distributionShape(xs)
    expect(Math.abs(d.skew as number)).toBeLessThan(1e-6)
    expect(d.var95 as number).toBeLessThanOrEqual(-18)
    expect(d.cvar95 as number).toBeLessThanOrEqual(d.var95 as number)
  })
})

describe('runsTest', () => {
  it('flags clustering (few runs, z<0)', () => {
    const seq = [...Array(12).fill(true), ...Array(12).fill(false)] // 2 runs
    const r = runsTest(seq)
    expect(r.runs).toBe(2)
    expect(r.z as number).toBeLessThan(0)
    expect(r.pValue as number).toBeLessThan(0.05)
  })
  it('perfect alternation gives many runs, z>0', () => {
    const seq = Array.from({ length: 24 }, (_, i) => i % 2 === 0)
    const r = runsTest(seq)
    expect(r.runs).toBe(24)
    expect(r.z as number).toBeGreaterThan(0)
  })
  it('is inconclusive under 20', () => {
    expect(runsTest([true, false, true]).z).toBeNull()
  })
})

describe('monteCarlo', () => {
  const clusters = Array.from({ length: 40 }, (_, i) => [i % 3 === 0 ? -5 : 4]) // 40 单笔 cluster
  const realized = clusters.flat()
  it('is null under 30 trades', () => {
    expect(monteCarlo([[1], [2]], [1, 2])).toBeNull()
  })
  it('is deterministic for a fixed seed', () => {
    const a = monteCarlo(clusters, realized, 123)
    const b = monteCarlo(clusters, realized, 123)
    expect(a?.terminalPctile).toBe(b?.terminalPctile)
    expect(a?.bands.p50.length).toBe(realized.length)
  })
  it('reports realized terminal = sum and percentiles in [0,1]', () => {
    const mc = monteCarlo(clusters, realized, 7)!
    expect(mc.realizedTerminal).toBeCloseTo(realized.reduce((s, v) => s + v, 0), 6)
    expect(mc.terminalPctile).toBeGreaterThanOrEqual(0)
    expect(mc.terminalPctile).toBeLessThanOrEqual(1)
    expect(mc.realizedMaxDD).toBeGreaterThanOrEqual(0)
    expect(mc.method).toBe('cluster-bootstrap')
    expect(mc.maxDDs.length).toBe(mc.rounds)
    expect(mc.note).toMatch(/有放回/)
    expect(mc.note).toMatch(/不是打乱/)
  })
})

function trip(over: Partial<RoundTrip>): RoundTrip {
  return { status: 'closed', regime: 'swing', realizedPnl: 0, closeTime: new Date('2026-01-01T20:00:00Z'), ...over } as RoundTrip
}

describe('regimeCumulative', () => {
  it('accrues each regime into its own running total, sharing the timeline', () => {
    const trips = [
      trip({ regime: 'intraday', realizedPnl: 10, closeTime: new Date('2026-01-01T20:00:00Z') }),
      trip({ regime: 'swing', realizedPnl: -4, closeTime: new Date('2026-01-02T20:00:00Z') }),
      trip({ regime: 'intraday', realizedPnl: 6, closeTime: new Date('2026-01-03T20:00:00Z') }),
    ]
    const rc = regimeCumulative(trips)
    expect(rc.dates.length).toBe(3)
    const intra = rc.series.find((s) => s.regime === 'intraday')!
    const swing = rc.series.find((s) => s.regime === 'swing')!
    expect(intra.values.at(-1)).toBe(16) // 10 + 6
    expect(swing.values.at(-1)).toBe(-4)
    expect(rc.series.some((s) => s.regime === 'position')).toBe(false) // 无样本不建序列
  })
})
