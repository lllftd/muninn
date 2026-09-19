import { describe, expect, it } from 'vitest'
import { assembleBook, emptyQuotes } from './book.ts'
import { importFutu } from './futu.ts'
import { SAMPLE_CASH_CSV, SAMPLE_FILLS_CSV, SAMPLE_ORDERS_CSV, sampleQuotes } from '../fixtures/sampleBook.ts'

const mixed = `Symbol,Name,Side,Fill Qty,Fill Price,Fill Amount,Fill Time,Markets,Currency,Counterparty
AAPL,Apple,Buy,10,190.00,1900.00,"Jan 8, 2026 10:12:14 ET",US,USD,
AAPL,Apple,Sell,10,196.50,1965.00,"Jan 9, 2026 14:54:14 ET",US,USD,
AAPL,Apple,Buy,0.0014,305.26,0.43,"Aug 13, 2026 00:00:00 ET",US,USD,
00020,SENSETIME-W,Buy,"1,000",1.435,"1,435.00","Aug 31, 2026 14:49:17 HKT",HK,HKD,6087
MRAL,GraniteShares 2X Long MARA Daily ETF,Buy,101,5.03,508.03,"Apr 28, 2026 22:17:06 ET",US,USD,
`

describe('accounting gates', () => {
  it('keeps DRIP in the ledger and excludes it from quality', () => {
    const imported = importFutu(mixed)
    expect(imported.dripKept).toBeGreaterThan(0)
    expect(imported.fills.some((f) => f.kind === 'drip')).toBe(true)
    expect(imported.excludedRows.length).toBeGreaterThan(0)
    const book = assembleBook({
      fillText: mixed,
      accountName: 'mixed',
      initialCapital: 80000,
      quotes: emptyQuotes(),
      cashflowComplete: true,
    })
    expect(book.dripKept).toBeGreaterThan(0)
    expect(book.trips.some((t) => t.tags.includes('DRIP'))).toBe(true)
    expect(book.performance.closedCount).toBe(
      book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP')).length,
    )
  })

  it('does not estimate TWR without NAV', () => {
    const book = assembleBook({
      fillText: SAMPLE_FILLS_CSV,
      orderText: SAMPLE_ORDERS_CSV,
      cashText: SAMPLE_CASH_CSV,
      accountName: 'no-nav',
      initialCapital: null,
      quotes: sampleQuotes(),
      cashflowComplete: true,
    })
    expect(book.performance.hasNav).toBe(false)
    expect(book.performance.pathKind).toBe('sleeve')
    expect(book.performance.twr).toBeNull()
    expect(book.performance.twrAnnualized).toBeNull()
    expect(book.performance.sharpe).toBeNull()
    expect(book.performance.relativeSpx).toBeNull()
    expect(book.performance.xirr).toBeNull()
    expect(book.equity.length).toBeGreaterThan(0)
    expect(book.performance.winRate.value).not.toBeNull()
    expect(book.performance.accountReturnReason).toMatch(/盯市/)
  })

  it('disables account returns when the file is a mixed-asset subset', () => {
    const book = assembleBook({
      fillText: mixed,
      accountName: 'subset',
      initialCapital: 80000,
      quotes: emptyQuotes(),
      cashflowComplete: true,
    })
    expect(book.performance.hasNav).toBe(true)
    expect(book.performance.equitySubsetOnly).toBe(true)
    expect(book.performance.pathKind).toBe('sleeve')
    expect(book.performance.twr).toBeNull()
    expect(book.performance.relativeSpx).toBeNull()
    expect(book.equity.length).toBeGreaterThan(0)
    expect(book.performance.accountReturnReason).toMatch(/正股/)
  })

  it('hides XIRR when cashflows are not confirmed complete', () => {
    const book = assembleBook({
      fillText: SAMPLE_FILLS_CSV,
      orderText: SAMPLE_ORDERS_CSV,
      accountName: 'incomplete-cf',
      initialCapital: 80000,
      quotes: sampleQuotes(),
      cashflowComplete: false,
    })
    expect(book.performance.twr).not.toBeNull()
    expect(book.performance.xirr).toBeNull()
    expect(book.performance.xirrReason).toMatch(/现金流/)
  })
})
