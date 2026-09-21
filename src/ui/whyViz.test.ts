import { describe, expect, it } from 'vitest'
import { loadSampleBook } from '../fixtures/sampleBook.ts'
import {
  attrWaterfall,
  closedEpisodes,
  cumPath,
  exitPoints,
  holdUiBucket,
  holdUiRows,
  maeQuadrants,
  symbolPareto,
  whyLeadFacts,
} from './whyViz.ts'

describe('whyViz', () => {
  it('builds a symbol waterfall that ends on net pnl of the closed episodes', () => {
    const book = loadSampleBook()
    const closed = closedEpisodes(book.episodes)
    const steps = attrWaterfall(closed, 'symbol')
    const last = steps.at(-1)!
    expect(last.total).toBe(true)
    expect(last.label).toBe('净盈亏')
    const run = steps.filter((s) => !s.total).reduce((s, x) => s + x.delta, 0)
    expect(run).toBeCloseTo(last.delta, 6)
    expect(last.delta).toBeCloseTo(
      closed.reduce((s, t) => s + t.realizedPnl, 0),
      6,
    )
    expect(steps.filter((s) => !s.total).length).toBeLessThanOrEqual(9)
  })

  it('cumulative ex-max-win omits the largest winning trip', () => {
    const book = loadSampleBook()
    const closed = closedEpisodes(book.episodes)
    const path = cumPath(closed)!
    expect(path.actual.length).toBe(closed.length)
    const maxWin = closed.reduce((b, t) => (t.realizedPnl > b.realizedPnl ? t : b))
    const lastActual = path.actual.at(-1)!
    const lastEx = path.exMaxWin.at(-1)!
    expect(lastEx).toBeCloseTo(lastActual - maxWin.realizedPnl, 6)
    expect(path.marks.some((m) => m.kind === 'maxWin' && m.tripId === maxWin.id)).toBe(true)
  })

  it('pareto rows carry n, mean, max share and loss contribution', () => {
    const book = loadSampleBook()
    const rows = symbolPareto(book.episodes)
    expect(rows.length).toBeGreaterThan(1)
    const top = rows[0]
    expect(top.n).toBeGreaterThan(0)
    expect(top.mean).toBeCloseTo(top.pnl / top.n, 8)
    const losers = rows.filter((r) => r.pnl < 0)
    if (losers.length) {
      expect(losers.every((r) => r.lossCumShare != null && r.lossCumShare > 0)).toBe(true)
      const lastLoser = [...losers].sort((a, b) => a.pnl - b.pnl).at(-1)!
      expect(lastLoser.lossCumShare).toBeCloseTo(1, 8)
    }
  })

  it('exit points skip trips without mfeDollar and flag floated losses', () => {
    const book = loadSampleBook()
    const pts = exitPoints(book.episodes)
    expect(pts.every((p) => Number.isFinite(p.mfe))).toBe(true)
    const closed = closedEpisodes(book.episodes)
    expect(pts.length).toBe(closed.filter((t) => t.mfeDollar != null).length)
  })

  it('mae quadrants partition points with both mae and mfe', () => {
    const book = loadSampleBook()
    const quads = maeQuadrants(book.episodes)
    const n = closedEpisodes(book.episodes).filter((t) => t.maePct != null && t.mfePct != null).length
    if (n >= 4) {
      expect(quads).not.toBeNull()
      expect(quads!.reduce((s, q) => s + q.n, 0)).toBe(n)
    }
  })

  it('hold ui buckets are disjoint and cover all closed trips', () => {
    const book = loadSampleBook()
    const closed = closedEpisodes(book.episodes)
    const rows = holdUiRows(closed)
    expect(rows.reduce((s, r) => s + r.n, 0)).toBe(closed.length)
    const ids = new Set(closed.map((t) => holdUiBucket(t).id))
    expect([...ids].every((id) => rows.some((r) => r.id === id))).toBe(true)
  })

  it('lead facts use book numbers not hardcoded tickers', () => {
    const book = loadSampleBook()
    const f = whyLeadFacts(book)
    expect(f.n).toBe(closedEpisodes(book.episodes).length)
    expect(f.net).toBeCloseTo(
      closedEpisodes(book.episodes).reduce((s, t) => s + t.realizedPnl, 0),
      6,
    )
    if (f.topWinSymbols[0]) expect(typeof f.topWinSymbols[0]).toBe('string')
    expect(f.seqDdUsd == null || f.seqDdUsd >= 0).toBe(true)
  })
})
