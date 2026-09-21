import { describe, expect, it } from 'vitest'
import { buildCheckup } from './checkup.ts'
import type { RoundTrip } from '../types.ts'

function trip(over: Partial<RoundTrip> & { day: number; pnl: number; side?: 'long' | 'short' }): RoundTrip {
  return {
    id: `t${over.day}`,
    status: 'closed',
    sameDay: false,
    holdMinutes: 1440,
    realizedPnl: over.pnl,
    openPrice: 100,
    qty: 10,
    side: over.side ?? 'long',
    openTime: new Date(Date.UTC(2024, 0, over.day, 14, 30)),
    closeTime: new Date(Date.UTC(2024, 0, over.day + 1, 14, 30)),
    ...over,
  } as RoundTrip
}

describe('group expectancyCi', () => {
  it('attaches an 80% interval when n≥5 and open-days ≥3', () => {
    const trips = Array.from({ length: 12 }, (_, i) =>
      trip({ day: i + 1, pnl: i < 4 ? 40 : -25, side: 'long' }),
    )
    const long = buildCheckup(trips).sides.find((s) => s.id === 'long')
    expect(long?.expectancy).not.toBeNull()
    expect(long?.expectancyCi).toBeTruthy()
    expect(long!.expectancyCi!.lo).toBeLessThan(long!.expectancy!)
    expect(long!.expectancyCi!.hi).toBeGreaterThan(long!.expectancy!)
    expect(long!.expectancyCi!.method).toBe('bootstrap')
  })

  it('does not invent an interval below n=5', () => {
    const trips = Array.from({ length: 4 }, (_, i) => trip({ day: i + 1, pnl: -10, side: 'short' }))
    const short = buildCheckup(trips).sides.find((s) => s.id === 'short')
    expect(short?.expectancy).toBeNull()
    expect(short?.expectancyCi).toBeNull()
  })
})
