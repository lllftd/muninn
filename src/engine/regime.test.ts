import { describe, expect, it } from 'vitest'
import {
  REGIME_BANDS,
  REGIME_LABELS,
  annualizedTripReturn,
  classifyRegime,
  enrichRegime,
  holdDiagnostic,
  regimeMix,
} from './regime.ts'
import type { RoundTrip } from '../types.ts'

const DAY = 1440

function trip(over: Partial<RoundTrip>): RoundTrip {
  return {
    status: 'closed',
    sameDay: false,
    holdMinutes: DAY,
    realizedPnl: 0,
    openPrice: 100,
    qty: 10,
    regime: 'intraday',
    annualizedReturn: null,
    ...over,
  } as RoundTrip
}

describe('REGIME_LABELS', () => {
  it('does not reuse 持仓 for the position band', () => {
    expect(REGIME_LABELS.intraday).toBe('日内')
    expect(REGIME_LABELS.swing).toBe('短线')
    expect(REGIME_LABELS.position).toBe('波段')
    expect(REGIME_LABELS.investor).toBe('长线')
  })
})

describe('classifyRegime', () => {
  it('same-day is intraday regardless of minutes', () => {
    expect(classifyRegime({ sameDay: true, holdMinutes: 30 })).toBe('intraday')
    expect(classifyRegime({ sameDay: true, holdMinutes: 900 })).toBe('intraday')
  })

  it('bands the multi-day holds by the named edges', () => {
    expect(classifyRegime({ sameDay: false, holdMinutes: 18 * 60 })).toBe('swing') // 隔夜
    expect(classifyRegime({ sameDay: false, holdMinutes: (REGIME_BANDS.swingMaxDays - 0.5) * DAY })).toBe('swing')
    expect(classifyRegime({ sameDay: false, holdMinutes: REGIME_BANDS.swingMaxDays * DAY })).toBe('position')
    expect(classifyRegime({ sameDay: false, holdMinutes: (REGIME_BANDS.positionMaxDays - 1) * DAY })).toBe('position')
    expect(classifyRegime({ sameDay: false, holdMinutes: REGIME_BANDS.positionMaxDays * DAY })).toBe('investor')
    expect(classifyRegime({ sameDay: false, holdMinutes: 400 * DAY })).toBe('investor')
  })
})

describe('annualizedTripReturn', () => {
  it('is null for intraday, open, and capital-wiping trips (no fake annualization)', () => {
    expect(annualizedTripReturn(trip({ sameDay: true, holdMinutes: 60 }))).toBeNull()
    expect(annualizedTripReturn(trip({ status: 'open' }))).toBeNull()
    expect(annualizedTripReturn(trip({ realizedPnl: -2000, openPrice: 100, qty: 10 }))).toBeNull() // -200% 吃穿本金
  })

  it('annualizes a multi-day winner correctly', () => {
    // +5% held 73 days -> (1.05)^(365/73) - 1 = (1.05)^5 - 1
    const r = annualizedTripReturn(trip({ holdMinutes: 73 * DAY, realizedPnl: 50, openPrice: 100, qty: 10 }))
    expect(r).not.toBeNull()
    expect(r as number).toBeCloseTo(1.05 ** 5 - 1, 6)
  })
})

describe('regimeMix', () => {
  it('summs to the trip count with shares', () => {
    const trips = [
      trip({ regime: 'intraday' }),
      trip({ regime: 'intraday' }),
      trip({ regime: 'swing' }),
      trip({ regime: 'investor' }),
    ]
    const mix = regimeMix(trips)
    expect(mix.find((m) => m.regime === 'intraday')).toMatchObject({ n: 2, share: 0.5 })
    expect(mix.find((m) => m.regime === 'swing')).toMatchObject({ n: 1, share: 0.25 })
    expect(mix.find((m) => m.regime === 'position')).toMatchObject({ n: 0, share: 0 })
    expect(mix.reduce((s, m) => s + m.n, 0)).toBe(4)
  })
})

describe('enrichRegime', () => {
  it('overwrites the placeholder regime and fills annualizedReturn', () => {
    const [out] = enrichRegime([trip({ regime: 'intraday', sameDay: false, holdMinutes: 30 * DAY, realizedPnl: 100 })])
    expect(out.regime).toBe('position')
    expect(out.annualizedReturn).not.toBeNull()
  })
})

describe('holdDiagnostic', () => {
  it('stays silent under 20 trips', () => {
    const d = holdDiagnostic(Array.from({ length: 10 }, () => trip({ holdMinutes: 3 * DAY })))
    expect(d.fitsDefaultBands).toBeNull()
    expect(d.n).toBe(10)
  })

  it('single cluster fits the default bands', () => {
    const d = holdDiagnostic(Array.from({ length: 30 }, () => trip({ holdMinutes: 3 * DAY })))
    expect(d.fitsDefaultBands).toBe(true)
    expect(d.modes.length).toBeLessThanOrEqual(1)
  })

  it('two clusters straddling a default edge read as aligned', () => {
    const trips = [
      ...Array.from({ length: 20 }, () => trip({ holdMinutes: 2 * DAY })),
      ...Array.from({ length: 20 }, () => trip({ holdMinutes: 40 * DAY })),
    ]
    const d = holdDiagnostic(trips)
    expect(d.modes.length).toBeGreaterThanOrEqual(2)
    expect(d.valleys.length).toBeGreaterThanOrEqual(1)
    expect(d.fitsDefaultBands).toBe(true)
  })

  it('flags a natural break that misses every default edge', () => {
    const trips = [
      ...Array.from({ length: 20 }, () => trip({ holdMinutes: 2 * DAY })),
      ...Array.from({ length: 20 }, () => trip({ holdMinutes: 300 * DAY })),
    ]
    const d = holdDiagnostic(trips)
    expect(d.valleys.length).toBeGreaterThanOrEqual(1)
    expect(d.fitsDefaultBands).toBe(false)
  })
})
