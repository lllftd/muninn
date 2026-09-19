import { describe, expect, it } from 'vitest'
import { xirr } from '../lib/stats.ts'

describe('XIRR Brent solver', () => {
  it('solves a one-year 10% cashflow', () => {
    const solved = xirr([
      { date: new Date('2021-01-01T00:00:00Z'), amount: -1000 },
      { date: new Date('2022-01-01T00:00:00Z'), amount: 1100 },
    ])
    expect(solved.status).toBe('ok')
    expect(solved.value).toBeCloseTo(0.1, 4)
  })

  it('returns too-few when there is only one flow', () => {
    expect(xirr([{ date: new Date('2020-01-01T00:00:00Z'), amount: -1000 }]).status).toBe('too-few')
  })

  it('returns no-root when NPV does not change sign', () => {
    const solved = xirr([
      { date: new Date('2020-01-01T00:00:00Z'), amount: -1000 },
      { date: new Date('2021-01-01T00:00:00Z'), amount: -100 },
    ])
    expect(solved.status).toBe('no-root')
    expect(solved.value).toBeNull()
  })
})
