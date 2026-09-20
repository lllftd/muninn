import { describe, expect, it } from 'vitest'
import { parseBrokerTime } from '../lib/time.ts'

describe('parseBrokerTime', () => {
  it('parses date-only HKT stamps', () => {
    const d = parseBrokerTime('Mar 4, 2026 HKT')
    expect(d.getTime()).toBeGreaterThan(0)
  })

  it('parses IB and Tiger naive timestamps as ET', () => {
    const ib = parseBrokerTime('2026-01-08, 10:12:14')
    const tiger = parseBrokerTime('2026-01-08 10:12:14')
    const compact = parseBrokerTime('20260108;101214')
    expect(ib.getTime()).toBe(tiger.getTime())
    expect(compact.getTime()).toBe(ib.getTime())
  })
})
