import { describe, expect, it } from 'vitest'
import { loadSampleBook } from '../fixtures/sampleBook.ts'
import { diagnose } from './diagnose.ts'
import { buildHealth } from './health.ts'
import { beOf, buildCover, formatBe, pathCoverLine, symbolPnl, waterfallOf, whyLead } from './cover.ts'
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
    expect(cover.summaries.why).toMatch(/行为问题|候选观察/)
    expect(cover.summaries.why).not.toMatch(/个主因/)
    expect(cover.luckLine).not.toMatch(/体系偏亏/)
    expect(cover.summaries.how).toMatch(/理论回吐上限|已验证改善|实验/)
    expect(cover.summaries.how).not.toMatch(/空间 \+/)
    expect(cover.howLead).toMatch(/不是可实现收益|没有已验证/)
    const give = cover.queue.find((r) => r.id === 'giveback')
    if (give) {
      expect(give.kind).toBe('theoretical')
      expect(give.recoverableKind).toBe('theoretical')
      expect(give.status).toMatch(/blocked|pending/)
      expect(give.finding).toMatch(/日线路径可用/)
      expect(give.finding).toMatch(/浮盈回吐分析有效/)
    }
    const hold = cover.queue.find((r) => r.id === 'hold-h3')
    if (hold) {
      expect(hold.kind).toBe('historical')
      expect(hold.recoverableKind).toBe('mechanical')
      expect(hold.capLines?.join(' ')).toMatch(/完全避开该组/)
      expect(hold.capLines?.join(' ')).toMatch(/未知，等待影子实验/)
      expect(hold.finding).toMatch(/不能把/)
    }
    const stops = cover.queue.find((r) => r.id === 'stops')
    expect(stops?.status).toMatch(/rejected|verified/)
    const intra = cover.queue.find((r) => r.id === 'intraday')
    if (intra) {
      expect(intra.canClaim).toBe(false)
      expect(intra.finding).toMatch(/<1 日|日内/)
      expect(intra.finding).toMatch(/不能用长持仓数字支持日内/)
    }
    const maeGap = cover.gaps.find((g) => g.id === 'mae')
    if (maeGap && !maeGap.done && book.credibility.maeMfeComputableShare > 0) {
      expect(maeGap.statusLabel).toMatch(/部分覆盖/)
      expect(maeGap.tone).not.toBe('fail')
    }
    expect(cover.luckLine.length).toBeGreaterThan(4)
    expect(cover.whyLead.length).toBeGreaterThan(20)
    expect(cover.whyLead).toMatch(/本期/)
  })

  it('splits path coverage from floated giveback n', () => {
    const line = pathCoverLine({ nFloated: 20, nClosed: 33, nPath: 21, meanRate: 0.83 })
    expect(line).toMatch(/日线路径可用 21\/33/)
    expect(line).toMatch(/覆盖率 64%/)
    expect(line).toMatch(/浮盈回吐分析有效 20\/33/)
    expect(line).toMatch(/有效率 61%/)
    expect(line).toMatch(/另 1 笔有路径但未出现浮盈/)
    expect(line).toMatch(/另 12 笔因同日或缺行情/)
  })

  it('builds whyLead from symbols and diagnoses without hardcoded tickers', () => {
    const book = loadSampleBook()
    const items = diagnose(book)
    const lead = whyLead(book, items, buildHealth(book))
    const signs = symbolPnl(book)
    expect(lead).toMatch(/亏损|盈利/)
    expect(lead).toMatch(/毛利/)
    const top = signs.filter((s) => s.pnl > 0)[0]
    const second = signs.filter((s) => s.pnl > 0)[1]
    const grossWin = signs.filter((s) => s.pnl > 0).reduce((s, x) => s + x.pnl, 0)
    if (top) expect(lead).toContain(top.symbol)
    if (second && grossWin > 0 && second.pnl < 0.15 * grossWin) {
      expect(lead).not.toContain(second.symbol)
    }
    if (signs.some((s) => s.pnl < 0)) expect(lead).toMatch(/亏损/)
    expect(lead).not.toMatch(/分散在/)
    if (items.some((d) => d.id === 'space-giveback')) {
      expect(lead).toMatch(/浮盈/)
      expect(lead).toMatch(/转亏|回吐/)
    }
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
