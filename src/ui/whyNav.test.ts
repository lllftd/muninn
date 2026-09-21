import { describe, expect, it } from 'vitest'
import { loadSampleBook } from '../fixtures/sampleBook.ts'
import { diagnose } from '../engine/diagnose.ts'
import { buildHealth } from '../engine/health.ts'
import { buildWhyChapters, EXPLORE_BANNER } from './whyNav.ts'

describe('buildWhyChapters', () => {
  it('maps existing diagnoses and n into chapter status chips', () => {
    const book = loadSampleBook()
    const diagnoses = diagnose(book)
    const health = buildHealth(book)
    const chapters = buildWhyChapters({
      diagnoses,
      health,
      closedN: book.performance.closedCount,
      sides: book.checkup.sides,
      weekdays: book.checkup.weekdays,
      holds: book.checkup.holdBuckets,
      sessionRelevant: book.checkup.sessionRelevant,
      hasCross: true,
      hasMc: Boolean(book.analytics.monteCarlo),
    })
    const ids = chapters.map((c) => c.id)
    expect(ids).toContain('why-structure')
    expect(ids).toContain('why-symbols')
    expect(ids).toContain('why-quality')
    expect(ids).toContain('why-behavior')
    expect(ids).toContain('why-trips')
    expect(chapters.every((c) => c.status.length > 0)).toBe(true)
    const explore = chapters.find((c) => c.role === 'explore')
    if (explore) {
      expect(explore.status).toMatch(/事实|归因|探索性|样本有限/)
    }
    const luck = chapters.find((c) => c.id === 'why-luck')
    if (luck) expect(luck.status).toBe('路径结论高｜策略归因低')
    const quality = chapters.find((c) => c.id === 'why-quality')!
    expect(quality.status === '存在异常' || quality.status === '可查看').toBe(true)
  })

  it('keeps the demotion banner copy stable', () => {
    expect(EXPLORE_BANNER).toBe('探索性观察｜当前样本不足，不纳入主要归因')
  })
})
