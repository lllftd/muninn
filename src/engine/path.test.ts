import { describe, expect, it } from 'vitest'
import { replayTrip } from './path.ts'
import type { Bar, RoundTrip } from '../types.ts'

function trip(partial: Partial<RoundTrip>): RoundTrip {
  return {
    id: 't1',
    symbol: 'AAPL',
    name: 'Apple',
    side: 'long',
    status: 'closed',
    qty: 80,
    openTime: new Date('2026-01-08T15:12:14Z'),
    closeTime: new Date('2026-01-09T19:54:14Z'),
    openPrice: 228.4,
    closePrice: 234.1,
    realizedPnl: 80 * (234.1 - 228.4),
    fees: 0,
    holdMinutes: 28.7 * 60,
    opens: [],
    closes: [],
    sameDay: false,
    pathQuality: 'missing_bars',
    maePct: null,
    mfePct: null,
    maePrice: null,
    mfePrice: null,
    maeDollar: null,
    mfeDollar: null,
    captureRate: null,
    givebackRate: null,
    recoveryRate: null,
    pathAnomaly: false,
    splitSuspect: false,
    moneyLeft: null,
    lateStopCost: null,
    rMultiple: null,
    rPrice: null,
    rFee: null,
    riskDollars: null,
    rFlags: [],
    tagHints: [],
    atr: null,
    positionPct: null,
    executionLocation: null,
    prevResult: 'none',
    prevGapHours: null,
    chasePercentile: null,
    chaseReturn: null,
    ma50Dist: null,
    ma200Dist: null,
    vix: null,
    session: 'midday',
    tags: [],
    setup: '',
    pathSource: 'none',
    splitWarning: false,
    regime: 'swing',
    annualizedReturn: null,
    ...partial,
  }
}

describe('MAE/MFE replay', () => {
  it('uses daily high/low for a multi-day long as estimate', () => {
    const bars: Bar[] = [
      { date: '2026-01-07', open: 226, high: 227, low: 224, close: 225, volume: 1 },
      { date: '2026-01-08', open: 229, high: 231, low: 225.8, close: 229.2, volume: 1 },
      { date: '2026-01-09', open: 229, high: 241.65, low: 228, close: 234.1, volume: 1 },
    ]
    const out = replayTrip(trip({}), bars)
    expect(out.pathQuality).toBe('daily_estimate')
    expect(out.maePrice).toBeCloseTo(225.8)
    expect(out.mfePrice).toBeCloseTo(241.65)
    expect(out.maePct).toBeCloseTo((225.8 - 228.4) / 228.4)
    expect(out.mfePct).toBeCloseTo((241.65 - 228.4) / 228.4)
    expect(out.rMultiple).toBeNull()
  })

  it('splits net R into price R and fee R', () => {
    const bars: Bar[] = []
    for (let i = 0; i < 30; i++) {
      const d = `2026-01-${String(i + 1).padStart(2, '0')}`
      bars.push({ date: d, open: 10, high: 10.4, low: 9.6, close: 10, volume: 1 })
    }
    bars.push({ date: '2026-02-10', open: 10, high: 10.2, low: 9.8, close: 10, volume: 1 })
    bars.push({ date: '2026-02-12', open: 10, high: 10.1, low: 9.9, close: 9.95, volume: 1 })
    const out = replayTrip(
      trip({
        qty: 10,
        openPrice: 10,
        closePrice: 9.95,
        fees: 4,
        realizedPnl: 10 * (9.95 - 10) - 4,
        openTime: new Date('2026-02-10T15:00:00Z'),
        closeTime: new Date('2026-02-12T18:00:00Z'),
      }),
      bars,
    )
    expect(out.riskDollars).toBeGreaterThan(0)
    expect(out.rPrice).not.toBeNull()
    expect(out.rFee).not.toBeNull()
    expect(out.rMultiple).toBeCloseTo((out.rPrice as number) - (out.rFee as number), 5)
    expect(out.rFlags.includes('fee-heavy') || Math.abs(out.rMultiple as number) > 0).toBe(true)
  })

  it('returns N/A for same-day round trips', () => {
    const bars: Bar[] = [{ date: '2026-06-16', open: 182, high: 184.2, low: 174.8, close: 176.4, volume: 1 }]
    const out = replayTrip(
      trip({
        openTime: new Date('2026-06-16T13:51:00Z'),
        closeTime: new Date('2026-06-16T19:48:00Z'),
        openPrice: 182,
        closePrice: 176.4,
      }),
      bars,
    )
    expect(out.sameDay).toBe(true)
    expect(out.pathQuality).toBe('same_day_na')
    expect(out.maePct).toBeNull()
    expect(out.mfePct).toBeNull()
    expect(out.captureRate).toBeNull()
  })

  it('inverts excursion for shorts', () => {
    const bars: Bar[] = [
      { date: '2026-08-04', open: 178, high: 181.2, low: 176, close: 178, volume: 1 },
      { date: '2026-08-06', open: 174, high: 175, low: 168.5, close: 171.4, volume: 1 },
    ]
    const out = replayTrip(
      trip({
        symbol: 'NVDA',
        side: 'short',
        qty: 20,
        openPrice: 178,
        closePrice: 171.4,
        realizedPnl: 20 * (178 - 171.4),
        openTime: new Date('2026-08-04T14:40:00Z'),
        closeTime: new Date('2026-08-06T18:12:00Z'),
      }),
      bars,
    )
    expect(out.maePrice).toBeCloseTo(181.2)
    expect(out.mfePrice).toBeCloseTo(168.5)
    expect(out.maePct).toBeLessThan(0)
    expect(out.mfePct).toBeGreaterThan(0)
  })
})
