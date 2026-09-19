import { describe, expect, it } from 'vitest'
import { assembleBook } from './book.ts'
import { auditAccountPath, dailyRetsFromIndex } from './metrics.ts'
import { eachWeekday } from '../lib/time.ts'
import type { Bar, QuotePack } from '../types.ts'

function csvFills(open: string, close: string, qty: number, pxOpen: number, pxClose: number): string {
  return `Symbol,Name,Side,Fill Qty,Fill Price,Fill Amount,Fill Time,Markets,Currency,Counterparty
AAPL,Apple,Buy,${qty},${pxOpen},${qty * pxOpen},"${open}",US,USD,
AAPL,Apple,Sell,${qty},${pxClose},${qty * pxClose},"${close}",US,USD,
`
}

function pack(days: string[], aapl: number[], spx: number[]): QuotePack {
  const bars: Record<string, Bar[]> = {
    AAPL: days.map((date, i) => ({
      date,
      open: aapl[i],
      high: aapl[i],
      low: aapl[i],
      close: aapl[i],
      volume: 1,
    })),
    '^GSPC': days.map((date, i) => ({
      date,
      open: spx[i],
      high: spx[i],
      low: spx[i],
      close: spx[i],
      volume: 1,
    })),
    '^IRX': days.map((date) => ({ date, open: 4.2, high: 4.2, low: 4.2, close: 4.2, volume: 1 })),
  }
  return { bars, splits: {} }
}

describe('account path homology', () => {
  const days = eachWeekday('2026-01-05', '2026-02-13')

  it('keeps TWR, relative SPX, drawdown and vol on one wealth path', () => {
    const aapl = days.map(() => 100)
    const spx = days.map((_, i) => 5000 * 1.001 ** i)
    const book = assembleBook({
      fillText: csvFills('Jan 5, 2026 10:00:00 ET', 'Feb 13, 2026 15:00:00 ET', 1, 100, 100),
      accountName: 'flat',
      initialCapital: 10000,
      quotes: pack(days, aapl, spx),
      cashflowComplete: true,
    })
    const p = book.performance
    expect(p.pathAudit?.ok).toBe(true)
    expect(p.twr).toBeCloseTo(p.pathAudit!.twrFromIndex, 10)
    expect(p.relativeSpx).toBeCloseTo(p.pathAudit!.relativeSpxFromIndex, 10)
    expect(p.maxDrawdown).toBeCloseTo(p.pathAudit!.maxDrawdownFromIndex, 10)
    expect(Math.abs(p.twr || 0)).toBeLessThan(0.002)
    expect(p.volAnn || 0).toBeLessThan(0.05)
    expect(p.alpha?.n).toBe(book.equity.length)
    expect(Math.abs(p.alpha?.beta || 0)).toBeLessThan(1)
    expect(p.alpha?.valid).toBe(true)
    const rets = dailyRetsFromIndex(book.equity.map((e) => e.index))
    expect(rets).toHaveLength(book.equity.length)
    expect(p.dayCount).toBe(book.equity.length)
  })

  it('does not jump TWR when a cash withdrawal does not change holdings', () => {
    const aapl = days.map(() => 100)
    const spx = days.map((_, i) => 5000 * 1.001 ** i)
    const quotes = pack(days, aapl, spx)
    const fills = csvFills('Jan 5, 2026 10:00:00 ET', 'Feb 13, 2026 15:00:00 ET', 1, 100, 100)
    const base = assembleBook({
      fillText: fills,
      accountName: 'no-cf',
      initialCapital: 10000,
      quotes,
      cashflowComplete: true,
    })
    const withCf = assembleBook({
      fillText: fills,
      cashText: 'time,type,amount\n2026-01-20T09:30:00-05:00,withdraw,2000\n',
      accountName: 'with-cf',
      initialCapital: 10000,
      quotes,
      cashflowComplete: true,
    })
    expect(base.performance.twr).toBeCloseTo(withCf.performance.twr || 0, 4)
    expect(withCf.equity.at(-1)!.equity).toBeLessThan(base.equity.at(-1)!.equity - 1000)
    expect(withCf.performance.pathAudit?.ok).toBe(true)
    const jump = withCf.equity.find((e) => e.date === '2026-01-20')
    expect(jump).toBeTruthy()
    const idx = withCf.equity.findIndex((e) => e.date === '2026-01-20')
    const ret = dailyRetsFromIndex(withCf.equity.map((e) => e.index))[idx]
    expect(Math.abs(ret)).toBeLessThan(0.01)
  })

  it('matches monotone 10% TWR when a fully marked position rises 10%', () => {
    const aapl = days.map((_, i) => 100 + (10 * i) / (days.length - 1))
    const spx = days.map(() => 5000)
    const book = assembleBook({
      fillText: csvFills(
        'Jan 5, 2026 10:00:00 ET',
        'Feb 13, 2026 15:00:00 ET',
        100,
        aapl[0],
        aapl[aapl.length - 1],
      ),
      accountName: 'up10',
      initialCapital: 10000,
      quotes: pack(days, aapl, spx),
      cashflowComplete: true,
    })
    expect(book.performance.twr).toBeCloseTo(0.1, 2)
    expect(book.performance.pathAudit?.ok).toBe(true)
    expect(auditAccountPath(book.equity, book.performance.twr, book.performance.relativeSpx, book.performance.maxDrawdown).ok).toBe(
      true,
    )
    expect(book.performance.maxDrawdown).toBeGreaterThan(-0.02)
  })
})
