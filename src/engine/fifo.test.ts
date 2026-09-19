import { describe, expect, it } from 'vitest'
import { attachSequence, buildRoundTrips } from './fifo.ts'
import type { Fill } from '../types.ts'

function fill(partial: Partial<Fill> & Pick<Fill, 'symbol' | 'side' | 'qty' | 'price' | 'time'>): Fill {
  return {
    id: partial.id || `${partial.symbol}-${partial.time.toISOString()}`,
    name: partial.symbol,
    rawSide: partial.side === 'buy' ? 'Buy' : 'Sell',
    amount: partial.qty * partial.price,
    market: 'US',
    currency: 'USD',
    fees: partial.fees ?? 0,
    kind: 'trade',
    ...partial,
  }
}

const t = (s: string) => new Date(s)

describe('FIFO round-trips', () => {
  it('closes a simple long', () => {
    const { trips } = buildRoundTrips([
      fill({ symbol: 'AAPL', side: 'buy', qty: 100, price: 10, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 100, price: 12, time: t('2026-01-09T15:00:00Z') }),
    ])
    expect(trips).toHaveLength(1)
    expect(trips[0].side).toBe('long')
    expect(trips[0].qty).toBe(100)
    expect(trips[0].realizedPnl).toBe(200)
    expect(trips[0].status).toBe('closed')
  })

  it('keeps partials in one round-trip until flat', () => {
    const { trips } = buildRoundTrips([
      fill({ symbol: 'AAPL', side: 'buy', qty: 100, price: 10, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 40, price: 12, time: t('2026-01-09T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 60, price: 11, time: t('2026-01-10T15:00:00Z') }),
    ])
    expect(trips).toHaveLength(1)
    expect(trips[0].qty).toBe(100)
    expect(trips[0].closePrice).toBeCloseTo(11.4)
    expect(trips[0].realizedPnl).toBeCloseTo(140)
  })

  it('splits two cycles', () => {
    const { trips } = buildRoundTrips([
      fill({ symbol: 'AAPL', side: 'buy', qty: 100, price: 10, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 100, price: 12, time: t('2026-01-09T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'buy', qty: 50, price: 11, time: t('2026-01-10T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 50, price: 10, time: t('2026-01-11T15:00:00Z') }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].realizedPnl).toBe(200)
    expect(trips[1].realizedPnl).toBe(-50)
  })

  it('treats a first sell as a short', () => {
    const { trips, warnings } = buildRoundTrips([
      fill({ symbol: 'NVDA', side: 'sell', qty: 50, price: 20, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'NVDA', side: 'buy', qty: 50, price: 15, time: t('2026-01-09T15:00:00Z') }),
    ])
    expect(warnings.some((w) => w.code === 'first-short')).toBe(true)
    expect(trips[0].side).toBe('short')
    expect(trips[0].realizedPnl).toBe(250)
  })

  it('scales in then flattens', () => {
    const { trips } = buildRoundTrips([
      fill({ symbol: 'MSFT', side: 'buy', qty: 100, price: 10, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'MSFT', side: 'buy', qty: 50, price: 11, time: t('2026-01-09T15:00:00Z') }),
      fill({ symbol: 'MSFT', side: 'sell', qty: 150, price: 12, time: t('2026-01-10T15:00:00Z') }),
    ])
    expect(trips).toHaveLength(1)
    expect(trips[0].openPrice).toBeCloseTo(10.333, 3)
    expect(trips[0].realizedPnl).toBeCloseTo(250)
  })

  it('flips short to long as two trips', () => {
    const { trips } = buildRoundTrips([
      fill({ symbol: 'TSLA', side: 'sell', qty: 10, price: 200, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'TSLA', side: 'buy', qty: 25, price: 190, time: t('2026-01-09T15:00:00Z') }),
      fill({ symbol: 'TSLA', side: 'sell', qty: 15, price: 195, time: t('2026-01-10T15:00:00Z') }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].side).toBe('short')
    expect(trips[0].qty).toBe(10)
    expect(trips[1].side).toBe('long')
    expect(trips[1].qty).toBe(15)
  })

  it('attaches previous loss gap for tilt', () => {
    const { trips } = buildRoundTrips([
      fill({ symbol: 'A', side: 'buy', qty: 1, price: 10, time: t('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'A', side: 'sell', qty: 1, price: 9, time: t('2026-01-08T16:00:00Z') }),
      fill({ symbol: 'B', side: 'buy', qty: 1, price: 20, time: t('2026-01-08T16:30:00Z') }),
      fill({ symbol: 'B', side: 'sell', qty: 1, price: 21, time: t('2026-01-09T16:30:00Z') }),
    ])
    const seq = attachSequence(trips)
    expect(seq[1].prevResult).toBe('loss')
    expect(seq[1].prevGapHours).toBeCloseTo(0.5)
  })
})
