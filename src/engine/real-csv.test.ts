import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleBook } from './book.ts'
import { importFutu } from './futu.ts'

const fillPath = new URL('../fixtures/real-fills.csv', import.meta.url)
const orderPath = new URL('../fixtures/real-orders.csv', import.meta.url)

describe('real Futu CSV', () => {
  it('filters to US common stock and emits warnings', () => {
    const fillText = readFileSync(fillPath, 'utf8')
    const orderText = readFileSync(orderPath, 'utf8')
    const imported = importFutu(fillText, orderText)
    expect(imported.fills.length).toBeGreaterThan(20)
    expect(imported.fills.every((f) => !f.market || f.market === 'US')).toBe(true)
    expect(imported.fills.filter((f) => f.kind !== 'drip').every((f) => f.qty >= 0.5)).toBe(true)
    expect(imported.dropped.nonUs + imported.dropped.options + imported.dropped.funds).toBeGreaterThan(0)
    expect(imported.warnings.length).toBeGreaterThan(0)

    const book = assembleBook({
      fillText,
      orderText,
      accountName: '真实账本',
      initialCapital: null,
      quotes: { bars: {}, splits: {} },
      cashflowComplete: false,
    })
    expect(book.trips.length).toBeGreaterThan(0)
    expect(book.episodes.length).toBeGreaterThan(0)
    expect(book.performance.hasNav).toBe(false)
    expect(book.warnings.some((w) => w.code === 'filtered' || w.code === 'first-short' || w.code === 'no-bars')).toBe(
      true,
    )
  })
})
