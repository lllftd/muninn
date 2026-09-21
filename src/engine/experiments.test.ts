import { describe, expect, it } from 'vitest'
import { evaluateExperiment } from './experiments.ts'
import { matchesConstraint, type ExperimentRecord } from '../lib/experiments.ts'
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
})
