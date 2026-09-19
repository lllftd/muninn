import { describe, expect, it } from 'vitest'
import { loadSampleBook, REAL_FILLS_CSV, REAL_ORDERS_CSV } from '../fixtures/sampleBook.ts'
import { assembleBook, emptyQuotes } from './book.ts'
import { importFutu } from './futu.ts'
import { wilsonInterval } from '../lib/stats.ts'

describe('real 5185 sample book', () => {
  it('rebuilds FIFO and episodes from the uploaded CSVs without fake NAV', () => {
    const book = loadSampleBook()
    const fifoClosed = book.trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
    const epClosed = book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
    expect(book.isSample).toBe(true)
    expect(fifoClosed.length).toBeGreaterThan(0)
    expect(epClosed.length).toBeGreaterThan(0)
    expect(book.performance.closedCount).toBe(epClosed.length)
    expect(book.performance.hasNav).toBe(false)
    expect(book.performance.pathKind).toBe('sleeve')
    expect(book.performance.twr).toBeNull()
    expect(book.equity.length).toBeGreaterThan(0)
    expect(book.performance.xirr).toBeNull()
    expect(book.performance.xirrStatus).toBe('incomplete')
    expect(book.performance.equitySubsetOnly).toBe(true)
    expect(book.performance.sortinoHurdle).toBe('rf')
    expect(book.performance.winRate.ci?.method).toBe('wilson')
    expect(book.performance.winRateBoot?.ci?.method).toBe('bootstrap')
    expect(book.sensitivity.fifoVsEpisode.fifoN).toBe(fifoClosed.length)
    expect(book.sensitivity.fifoVsEpisode.episodeN).toBe(epClosed.length)
    expect(book.credibility.uniqueOpenDays).toBe(book.performance.uniqueOpenDays)
    expect(['cannot-assess', 'insufficient', 'positive-sample', 'sensitive']).toContain(book.credibility.banner)
    expect(book.credibility.bannerText).not.toMatch(/稳定 edge/)
    expect(book.checkup.disposition.fact).toMatch(/持仓时长/)
  })

  it('keeps mixed-asset rows out of the US common-stock ledger', () => {
    const imported = importFutu(REAL_FILLS_CSV, REAL_ORDERS_CSV)
    expect(imported.dropped.nonUs + imported.dropped.options + imported.dropped.funds).toBeGreaterThan(0)
    expect(imported.fills.every((f) => !f.market || f.market === 'US')).toBe(true)
    const book = assembleBook({
      fillText: REAL_FILLS_CSV,
      orderText: REAL_ORDERS_CSV,
      accountName: '5185',
      initialCapital: 80000,
      quotes: emptyQuotes(),
      cashflowComplete: false,
    })
    expect(book.performance.equitySubsetOnly).toBe(true)
    expect(book.performance.pathKind).toBe('sleeve')
    expect(book.performance.twr).toBeNull()
    expect(book.performance.accountReturnReason).toMatch(/正股/)
  })
})

describe('wilson', () => {
  it('covers 14/23 around 61%', () => {
    const ci = wilsonInterval(14, 23)
    expect(ci).not.toBeNull()
    expect(ci!.lo).toBeLessThan(14 / 23)
    expect(ci!.hi).toBeGreaterThan(14 / 23)
  })
})
