import { describe, expect, it } from 'vitest'
import { evaluateExperiment } from './experiments.ts'
import {
  isDay4Shadow,
  isMisalignedHoldExperiment,
  realignToDay4Shadow,
  matchesConstraint,
  type ExperimentRecord,
} from '../lib/experiments.ts'
import type { RoundTrip } from '../types.ts'

function trip(over: Partial<RoundTrip> & Pick<RoundTrip, 'id'>): RoundTrip {
  return {
    status: 'closed',
    side: 'long',
    realizedPnl: 10,
    holdMinutes: 60,
    regime: 'intraday',
    openTime: new Date('2026-01-05T15:00:00Z'), // Monday ET-ish
    tags: [],
    ...over,
  } as RoundTrip
}

function exp(over: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: 'e1',
    createdAt: '2026-01-01T00:00:00Z',
    diagnosisId: 'side-short',
    hypothesis: 'test',
    constraint: { kind: 'side', side: 'long' },
    targetN: 10,
    baselineN: 20,
    baselineExpectancy: 5,
    claimedTripIds: ['old'],
    accountKey: 'a',
    status: 'active',
    ...over,
  }
}

describe('matchesConstraint', () => {
  it('matches long-only and observe-all', () => {
    const long = trip({ id: 'a', side: 'long' })
    const short = trip({ id: 'b', side: 'short' })
    expect(matchesConstraint(long, { kind: 'side', side: 'long' })).toBe(true)
    expect(matchesConstraint(short, { kind: 'side', side: 'long' })).toBe(false)
    expect(matchesConstraint(short, { kind: 'observe' })).toBe(true)
  })
})

describe('evaluateExperiment', () => {
  it('returns insufficient when new n is below the group floor', () => {
    const ev = evaluateExperiment(exp(), [trip({ id: 'old', realizedPnl: 1 }), trip({ id: 'n1', realizedPnl: 8 })])
    expect(ev.verdict).toBe('insufficient')
    expect(ev.note).toMatch(/不够/)
  })

  it('reports improved when new matching mean beats baseline', () => {
    const news = Array.from({ length: 12 }, (_, i) => trip({ id: `n${i}`, realizedPnl: 20, side: 'long' }))
    const ev = evaluateExperiment(exp({ claimedTripIds: [] }), news)
    expect(ev.verdict).toBe('improved')
    expect(ev.matchN).toBe(12)
    expect(ev.changedShare).toBe(1)
  })

  it('shadow-hold waits when new trades have no path', () => {
    const ev = evaluateExperiment(
      exp({ constraint: { kind: 'shadow-hold', days: 5 }, claimedTripIds: [] }),
      [trip({ id: 'n1', realizedPnl: 8, pathQuality: 'missing_bars' })],
    )
    expect(ev.verdict).toBe('insufficient')
    expect(ev.note).toMatch(/等待|影子|路径/)
  })

  it('shadow-hold scores same-trade delta via replayHold, not the old baseline', () => {
    const t = trip({
      id: 'hold',
      symbol: 'AAA',
      openPrice: 100,
      qty: 1,
      fees: 0,
      realizedPnl: -20,
      pathQuality: 'daily_estimate',
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-08T21:00:00Z'),
    })
    const bars = {
      AAA: [
        { date: '2024-01-02', open: 100, high: 101, low: 99, close: 100, volume: 1 },
        { date: '2024-01-03', open: 100, high: 104, low: 100, close: 103, volume: 1 },
        { date: '2024-01-04', open: 103, high: 103, low: 90, close: 91, volume: 1 },
        { date: '2024-01-08', open: 91, high: 92, low: 80, close: 80, volume: 1 },
      ],
    }
    const ev = evaluateExperiment(
      exp({ constraint: { kind: 'shadow-hold', days: 2 }, claimedTripIds: [], baselineExpectancy: 999 }),
      [t],
      undefined,
      bars,
    )
    expect(ev.shadowN).toBe(1)
    expect(ev.delta).toBeCloseTo(23)
    expect(ev.note).not.toMatch(/基线/)
    expect(ev.pairs?.map((p) => p.id)).toEqual(['hold'])
    expect(ev.funnel?.priced).toBe(1)
  })

  it('does not count short holds as zero-delta pairs', () => {
    const short = trip({
      id: 'short',
      symbol: 'BBB',
      openPrice: 50,
      qty: 1,
      fees: 0,
      realizedPnl: -8,
      pathQuality: 'daily_estimate',
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-02T18:00:00Z'),
      holdMinutes: 180,
    })
    const long = trip({
      id: 'hold',
      symbol: 'AAA',
      openPrice: 100,
      qty: 1,
      fees: 0,
      realizedPnl: -20,
      pathQuality: 'daily_estimate',
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-08T21:00:00Z'),
      holdMinutes: 6 * 1440,
    })
    const bars = {
      AAA: [
        { date: '2024-01-02', open: 100, high: 101, low: 99, close: 100, volume: 1 },
        { date: '2024-01-03', open: 100, high: 104, low: 100, close: 103, volume: 1 },
        { date: '2024-01-04', open: 103, high: 103, low: 90, close: 91, volume: 1 },
        { date: '2024-01-08', open: 91, high: 92, low: 80, close: 80, volume: 1 },
      ],
      BBB: [{ date: '2024-01-02', open: 50, high: 51, low: 49, close: 49, volume: 1 }],
    }
    const ev = evaluateExperiment(
      exp({ constraint: { kind: 'shadow-hold', days: 2 }, claimedTripIds: [] }),
      [short, long],
      undefined,
      bars,
    )
    expect(ev.pairs?.map((p) => p.id)).toEqual(['hold'])
    expect(ev.funnel?.held).toBe(1)
    expect(ev.funnel?.priced).toBe(1)
    expect(ev.shadowN).toBe(1)
  })
})

describe('day-4 realign', () => {
  it('treats h1 hold as misaligned and converts to day-4 shadow with $0 baseline', () => {
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
      get length() {
        return Object.keys(store).length
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    }
    const old = exp({ constraint: { kind: 'hold', bucket: 'h1' }, baselineExpectancy: -64 })
    expect(isMisalignedHoldExperiment(old.constraint)).toBe(true)
    const next = realignToDay4Shadow(old, 'time-hold-h3')
    expect(isDay4Shadow(next.constraint)).toBe(true)
    expect(next.baselineExpectancy).toBe(0)
    expect(next.diagnosisId).toBe('time-hold-h3')
    expect(next.hypothesis).toMatch(/第 4 个交易日收盘/)
  })
})
