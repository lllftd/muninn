import { describe, expect, it } from 'vitest'
import { buildEpisodes } from './episode.ts'
import { buildRoundTrips } from './fifo.ts'
import { buildSensitivity } from './sensitivity.ts'
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

describe('position episodes', () => {
  it('keeps scale-in as one episode while FIFO can split lots', () => {
    const fills = [
      fill({ symbol: 'AAPL', side: 'buy', qty: 10, price: 10, time: new Date('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'buy', qty: 10, price: 12, time: new Date('2026-01-09T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 10, price: 13, time: new Date('2026-01-10T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 10, price: 14, time: new Date('2026-01-11T15:00:00Z') }),
    ]
    const fifo = buildRoundTrips(fills).trips
    const episodes = buildEpisodes(fills)
    expect(fifo).toHaveLength(1)
    expect(episodes).toHaveLength(1)
    expect(episodes[0].status).toBe('closed')
    expect(episodes[0].qty).toBe(20)
    expect(episodes[0].tags).toContain('episode')
    expect(fifo[0].tags.includes('episode')).toBe(false)
  })

  it('flags concentration when one trade dominates', () => {
    const big = buildEpisodes([
      fill({ symbol: 'AAPL', side: 'buy', qty: 100, price: 10, time: new Date('2026-01-08T15:00:00Z') }),
      fill({ symbol: 'AAPL', side: 'sell', qty: 100, price: 20, time: new Date('2026-01-09T15:00:00Z') }),
    ])
    const small = buildEpisodes([
      fill({ symbol: 'MSFT', side: 'buy', qty: 1, price: 10, time: new Date('2026-01-10T15:00:00Z') }),
      fill({ symbol: 'MSFT', side: 'sell', qty: 1, price: 10.5, time: new Date('2026-01-11T15:00:00Z') }),
    ])
    const sens = buildSensitivity([], [...big, ...small])
    expect(sens.top1Share).toBeGreaterThan(0.4)
    expect(sens.sensitive).toBe(true)
  })
})
