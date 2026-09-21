import { describe, expect, it } from 'vitest'
import { loadSampleBook } from '../fixtures/sampleBook.ts'
import { diagnose } from './diagnose.ts'
import { buildHealth } from './health.ts'
import { beOf, buildCover, formatBe, waterfallOf } from './cover.ts'
import { tabForAnchor, tabFromView } from '../ui/views.ts'

describe('buildCover', () => {
  it('keeps one-layer summaries and a structure verdict', () => {
    const book = loadSampleBook()
    const items = diagnose(book)
    const cover = buildCover(book, items, buildHealth(book), [])
    expect(cover.verdict).toBe('低胜率高赔率，靠一笔大盈撑着的亏损体系')
    expect(cover.coverageLabel).toMatch(/覆盖/)
    expect(cover.benchLine).toMatch(/同期/)
    expect(cover.benchChip).toMatch(/SPY|SPX/)
    expect(cover.gaps.length).toBe(4)
    expect(cover.gaps[0].id).toBe('flow')
    expect(cover.gaps[0].done).toBe(true)
    expect(cover.summaries.what).toMatch(/数据/)
    expect(cover.summaries.why).toMatch(/主因/)
    expect(cover.summaries.how).toMatch(/空间|实验/)
    expect(cover.luckLine.length).toBeGreaterThan(4)
  })

  it('computes breakeven gap from payoff', () => {
    const book = loadSampleBook()
    const be = beOf(book)
    expect(be == null || Number.isFinite(be.gapPp)).toBe(true)
    if (be) {
      const shown = formatBe(be)
      expect(shown.scan.includes(Math.abs(shown.gapPp).toFixed(1))).toBe(true)
      expect(shown.gapPp).toBe(Math.round((shown.wrPct - shown.needPct) * 10) / 10)
    }
  })

  it('computes gap from displayed percents so 15% vs 18.4% is 3.4pp', () => {
    const shown = formatBe({ wr: 0.151515, need: 0.184 })
    expect(shown.wrText).toBe('15%')
    expect(shown.needText).toBe('18.4%')
    expect(shown.gapPp).toBe(-3.4)
    expect(shown.scan).toBe('距盈亏平衡差 3.4pp')
  })

  it('ends the waterfall on cumulative net pnl, not a residual plug', () => {
    const book = loadSampleBook()
    const wf = waterfallOf(book)
    const last = wf.steps.at(-1)!
    expect(last.total).toBe(true)
    expect(last.label).toBe('净盈亏')
    expect(last.delta).toBe(book.performance.netPnl)
    const win = wf.steps.find((s) => s.id === 'win')!
    const loss = wf.steps.find((s) => s.id === 'loss')!
    expect(win.delta + loss.delta).toBeCloseTo(book.performance.realizedPnl, 2)
    const run = wf.steps.filter((s) => !s.total).reduce((s, x) => s + x.delta, 0)
    expect(run).toBeCloseTo(book.performance.netPnl, 2)
  })
})

describe('tab aliases', () => {
  it('maps old views and evidence anchors onto one layer each', () => {
    expect(tabFromView('review')).toBe('what')
    expect(tabFromView('analysis')).toBe('why')
    expect(tabFromView('lab')).toBe('how')
    expect(tabFromView('space')).toBe('how')
    expect(tabForAnchor('mc')).toBe('why')
    expect(tabForAnchor('path')).toBe('what')
    expect(tabForAnchor('giveback')).toBe('how')
    expect(tabForAnchor('mae')).toBe('why')
  })
})
