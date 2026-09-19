import { describe, expect, it } from 'vitest'
import { parseBrokerTime } from '../lib/time.ts'

describe('parseBrokerTime', () => {
  it('parses date-only HKT stamps', () => {
    const d = parseBrokerTime('Mar 4, 2026 HKT')
    expect(d.getTime()).toBeGreaterThan(0)
  })
})
