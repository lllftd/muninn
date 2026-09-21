import { describe, expect, it } from 'vitest'
import {
  evidenceLadder,
  givebackConcentration,
  givebackPoints,
  holdBandStats,
  jitterRate,
  queueEvidenceLevel,
  sampleComposition,
  tripsInSlice,
} from './howViz.ts'
import type { HowQueueRow } from '../engine/cover.ts'
import type { RoundTrip } from '../types.ts'

function t(over: Partial<RoundTrip> & { id: string }): RoundTrip {
  return {
    status: 'closed',
    tags: [],
    pathQuality: 'daily_estimate',
    pathAnomaly: false,
    splitSuspect: false,
    sameDay: false,
    side: 'long',
    symbol: 'AAA',
    openPrice: 100,
    qty: 1,
    fees: 0,
    realizedPnl: 0,
    mfeDollar: 10,
    holdMinutes: 3 * 1440,
    openTime: new Date('2024-01-02T15:00:00Z'),
    closeTime: new Date('2024-01-10T21:00:00Z'),
    ...over,
  } as RoundTrip
}

describe('sampleComposition', () => {
  it('splits floated path, path-without-float, and missing path', () => {
    const rows = [
      t({ id: 'a', mfeDollar: 12, realizedPnl: 2 }),
      t({ id: 'b', mfeDollar: 0, realizedPnl: -4 }),
      t({ id: 'c', pathQuality: 'missing_bars', mfeDollar: null, realizedPnl: -1 }),
    ]
    const c = sampleComposition(rows)
    expect(c.nClosed).toBe(3)
    expect(c.floated).toBe(1)
    expect(c.pathNoFloat).toBe(1)
    expect(c.noPath).toBe(1)
    expect(tripsInSlice(rows, 'floated').map((x) => x.id)).toEqual(['a'])
    expect(tripsInSlice(rows, 'noPath').map((x) => x.id)).toEqual(['c'])
  })
})

describe('holdBandStats', () => {
  it('does not put 1-4 day trades into the ≥5 day band', () => {
    const rows = [
      t({ id: 'h1', holdMinutes: 60, realizedPnl: -10 }),
      t({ id: 'h2', holdMinutes: 3 * 1440, realizedPnl: 5 }),
      t({ id: 'h4', holdMinutes: 4.5 * 1440, realizedPnl: 1 }),
      t({ id: 'h3', holdMinutes: 6 * 1440, realizedPnl: -20 }),
    ]
    const bands = holdBandStats(rows)
    expect(bands.find((b) => b.id === 'h2')?.n).toBe(2)
    expect(bands.find((b) => b.id === 'h3')?.n).toBe(1)
    expect(bands.find((b) => b.id === 'h3')?.pnl).toBe(-20)
  })
})

describe('givebackConcentration', () => {
  it('reports top-5 share of theoretical giveback', () => {
    const pts = givebackPoints([
      t({ id: 'a', mfeDollar: 100, realizedPnl: 10 }),
      t({ id: 'b', mfeDollar: 20, realizedPnl: 5 }),
      t({ id: 'c', mfeDollar: 10, realizedPnl: 2 }),
    ])
    const c = givebackConcentration(pts)
    expect(c.n).toBe(3)
    expect(c.top5Share).toBe(1)
    expect(c.medianRate).toBeGreaterThan(0)
  })
})

describe('evidenceLadder', () => {
  it('marks shadow as current when hold finding exists and nothing is verified', () => {
    const steps = evidenceLadder({
      hasHoldFinding: true,
      replayPassed: false,
      shadowN: 0,
      targetN: 20,
      verified: false,
    })
    expect(steps[0].state).toBe('done')
    expect(steps[1].detail).toMatch(/未找到可上线规则/)
    expect(steps[2].state).toBe('current')
    expect(steps[3].state).toBe('todo')
  })
})

describe('jitterRate', () => {
  it('nudges stacked 100% rates but keeps them near the ceiling', () => {
    const a = jitterRate('aaa', 1)
    const b = jitterRate('bbb', 1)
    expect(a).not.toBe(b)
    expect(a).toBeGreaterThan(0.9)
    expect(a).toBeLessThanOrEqual(1.035)
    expect(jitterRate('mid', 0.5)).toBe(0.5)
  })
})

describe('queueEvidenceLevel', () => {
  it('keeps intraday at historical-observation strength', () => {
    const row = { id: 'intraday', status: 'pending' } as HowQueueRow
    expect(queueEvidenceLevel(row).filled).toBe(1)
  })
})
