import { describe, expect, it } from 'vitest'
import { bhFdr } from '../lib/stats.ts'
import { buildSpace, counterfactualStopPnl, exitEfficiency, kellyFraction, replayHold, replayTrail } from './space.ts'
import type { Bar, RoundTrip } from '../types.ts'

function t(over: Partial<RoundTrip> & { id: string }): RoundTrip {
  return {
    status: 'closed',
    tags: [],
    pathQuality: 'daily_estimate',
    pathAnomaly: false,
    splitSuspect: false,
    sameDay: false,
    side: 'long',
    symbol: 'AAA',
    openPrice: 100,
    qty: 1,
    fees: 0,
    realizedPnl: 0,
    maePct: -0.05,
    mfePct: 0.1,
    maeDollar: -5,
    mfeDollar: 10,
    openTime: new Date('2024-01-02T15:00:00Z'),
    closeTime: new Date('2024-01-10T21:00:00Z'),
    holdMinutes: 3 * 1440,
    ...over,
  } as RoundTrip
}

describe('exitEfficiency', () => {
  it('is 1 at MFE and 0 at MAE', () => {
    expect(exitEfficiency(t({ id: 'a', realizedPnl: 10, maeDollar: -5, mfeDollar: 10 }))).toBeCloseTo(1)
    expect(exitEfficiency(t({ id: 'b', realizedPnl: -5, maeDollar: -5, mfeDollar: 10 }))).toBeCloseTo(0)
    expect(exitEfficiency(t({ id: 'c', realizedPnl: 2.5, maeDollar: -5, mfeDollar: 10 }))).toBeCloseTo(0.5)
  })
  it('is null for same-day / missing path', () => {
    expect(exitEfficiency(t({ id: 'd', pathQuality: 'same_day_na' }))).toBeNull()
  })
})

describe('giveback', () => {
  it('sums MFE minus realized only on trades that floated', () => {
    const space = buildSpace([
      t({ id: 'w', realizedPnl: 4, mfeDollar: 10, maeDollar: -2, maePct: -0.02 }),
      t({ id: 'l', realizedPnl: -8, mfeDollar: 0, maeDollar: -8, maePct: -0.08 }),
    ])
    expect(space.giveback.nFloated).toBe(1)
    expect(space.giveback.sumDollar).toBeCloseTo(6)
    expect(space.giveback.meanRate).toBeCloseTo(0.6)
    expect(space.giveback.note).toMatch(/理论上界/)
    expect(space.giveback.note).not.toMatch(/能多赚/)
  })
  it('clamps giveback rate at 100% when a floated trade ends in a loss', () => {
    const space = buildSpace([
      t({ id: 'red', realizedPnl: -8, mfeDollar: 10, maeDollar: -12, maePct: -0.12 }),
    ])
    expect(space.giveback.meanRate).toBe(1)
    expect(space.giveback.sumDollar).toBeCloseTo(18)
  })
})

describe('counterfactualStopPnl', () => {
  it('stops at the line when MAE reached it, otherwise keeps realized', () => {
    const hit = t({ id: 'h', maePct: -0.1, realizedPnl: -15, openPrice: 100, qty: 1, fees: 0 })
    expect(counterfactualStopPnl(hit, 0.05).stopped).toBe(true)
    expect(counterfactualStopPnl(hit, 0.05).pnl).toBeCloseTo(-5)
    const miss = t({ id: 'm', maePct: -0.02, realizedPnl: 8, openPrice: 100, qty: 1, fees: 0 })
    expect(counterfactualStopPnl(miss, 0.05).stopped).toBe(false)
    expect(counterfactualStopPnl(miss, 0.05).pnl).toBe(8)
  })
})

describe('stop scan', () => {
  it('does not treat the best of 20 scan points as a verified preset', () => {
    const trips = Array.from({ length: 12 }, (_, i) =>
      t({
        id: `x${i}`,
        openTime: new Date(Date.UTC(2024, 0, 2 + i)),
        maePct: -0.12,
        realizedPnl: i % 2 === 0 ? -14 : 3,
        maeDollar: -12,
        mfeDollar: i % 2 === 0 ? 1 : 6,
      }),
    )
    const space = buildSpace(trips)
    expect(space.stopScan).toBeTruthy()
    expect(space.stopScan!.note).toMatch(/FDR/)
    expect(space.stopScan!.note).toMatch(/不是出在最高点/)
    if (space.stopScan!.bestPreset) expect(space.stopScan!.bestPreset.preset).toBe(true)
  })
})

describe('ev levers', () => {
  it('ranks a 10% relative shock on each EV lever', () => {
    const trips = [
      ...Array.from({ length: 6 }, (_, i) => t({ id: `w${i}`, realizedPnl: 20, mfeDollar: 25, maeDollar: -4 })),
      ...Array.from({ length: 6 }, (_, i) => t({ id: `l${i}`, realizedPnl: -10, mfeDollar: 2, maeDollar: -12 })),
    ].map((x, i) => ({ ...x, openTime: new Date(Date.UTC(2024, 0, 2 + i)) }))
    const space = buildSpace(trips)
    expect(space.evLevers.length).toBe(4)
    expect(space.evLevers[0].delta).not.toBe(0)
  })
})

describe('bhFdr', () => {
  it('does not pass a wall of noise at q=0.1', () => {
    const noise = Array.from({ length: 20 }, () => 0.4)
    expect(bhFdr(noise, 0.1).some(Boolean)).toBe(false)
  })
  it('passes a clearly small p among noise', () => {
    const ps = [0.001, ...Array.from({ length: 19 }, () => 0.8)]
    const flags = bhFdr(ps, 0.1)
    expect(flags[0]).toBe(true)
    expect(flags.slice(1).some(Boolean)).toBe(false)
  })
})

function bar(date: string, o: number, h: number, l: number, c: number): Bar {
  return { date, open: o, high: h, low: l, close: c, volume: 1 }
}

describe('replayTrail', () => {
  it('does not assume the same bar printed the high before the low', () => {
    const trip = t({
      id: 'trail',
      openPrice: 100,
      qty: 1,
      fees: 0,
      realizedPnl: -5,
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-02T21:00:00Z'),
    })
    const hit = replayTrail(trip, [bar('2024-01-02', 100, 120, 89, 95)], 0.1)
    expect(hit.triggered).toBe(true)
    expect(hit.pnl).toBeCloseTo(-10)
  })
  it('trails from the prior-day peak', () => {
    const trip = t({
      id: 'trail2',
      openPrice: 100,
      qty: 1,
      fees: 0,
      realizedPnl: -8,
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-03T21:00:00Z'),
    })
    const bars = [bar('2024-01-02', 100, 112, 99, 110), bar('2024-01-03', 110, 111, 98, 99)]
    const hit = replayTrail(trip, bars, 0.1)
    expect(hit.triggered).toBe(true)
    expect(hit.pnl).toBeCloseTo(0.8)
  })
})

describe('replayHold', () => {
  it('exits at the Nth session close when the trade ran longer', () => {
    const trip = t({
      id: 'hold',
      openPrice: 100,
      qty: 1,
      fees: 0,
      realizedPnl: -20,
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-08T21:00:00Z'),
    })
    const bars = [
      bar('2024-01-02', 100, 101, 99, 100),
      bar('2024-01-03', 100, 104, 100, 103),
      bar('2024-01-04', 103, 103, 90, 91),
      bar('2024-01-08', 91, 92, 80, 80),
    ]
    const early = replayHold(trip, bars, 2)
    expect(early.triggered).toBe(true)
    expect(early.pnl).toBeCloseTo(3)
    const keep = replayHold(trip, bars, 10)
    expect(keep.triggered).toBe(false)
    expect(keep.pnl).toBe(-20)
  })
})

describe('rule replay spectrum', () => {
  it('marks open-30 as not computable and does not claim the best of the scan', () => {
    const trips = Array.from({ length: 8 }, (_, i) =>
      t({
        id: `r${i}`,
        openTime: new Date(Date.UTC(2024, 0, 2 + i)),
        closeTime: new Date(Date.UTC(2024, 0, 8 + i)),
        realizedPnl: i % 2 ? 4 : -9,
      }),
    )
    const space = buildSpace(trips, {})
    const open30 = space.ruleReplay.rules.find((r) => r.id === 'open-30')
    expect(open30?.computable).toBe(false)
    expect(space.ruleReplay.note).toMatch(/FDR/)
    expect(space.ruleReplay.note).toMatch(/分时/)
    if (space.ruleReplay.bestPreset) expect(space.ruleReplay.bestPreset.computable).toBe(true)
  })

  it('attaches tail loss CVaR and improvement probability to computable rules', () => {
    const trips = Array.from({ length: 20 }, (_, i) =>
      t({
        id: `r${i}`,
        openTime: new Date(Date.UTC(2024, 0, 2 + i)),
        closeTime: new Date(Date.UTC(2024, 0, 8 + i)),
        realizedPnl: i % 2 ? 4 : -9,
      }),
    )
    const space = buildSpace(trips, {})
    const hold5 = space.ruleReplay.rules.find((r) => r.id === 'hold-5')
    expect(hold5).toBeTruthy()
    expect(hold5?.cvar95 ?? -1).toBeGreaterThanOrEqual(0)
    expect(space.ruleReplay.actualCvar95 ?? -1).toBeGreaterThanOrEqual(0)
    if (hold5?.improveProb != null) {
      expect(hold5.improveProb).toBeGreaterThanOrEqual(0)
      expect(hold5.improveProb).toBeLessThanOrEqual(1)
    }
  })
})

describe('opportunity cost', () => {
  it('compares actual pnl with unmanaged open-to-close of the same name', () => {
    const trip = t({
      id: 'oc',
      openPrice: 100,
      qty: 1,
      fees: 0,
      realizedPnl: 2,
      openTime: new Date('2024-01-02T15:00:00Z'),
      closeTime: new Date('2024-01-04T21:00:00Z'),
    })
    const trips = Array.from({ length: 6 }, (_, i) =>
      t({
        ...trip,
        id: `oc${i}`,
        openTime: new Date(Date.UTC(2024, 0, 2 + i * 3, 15)),
        closeTime: new Date(Date.UTC(2024, 0, 4 + i * 3, 21)),
      }),
    )
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-02', 100, 101, 99, 100),
        bar('2024-01-04', 104, 109, 103, 108),
        bar('2024-01-05', 100, 101, 99, 100),
        bar('2024-01-07', 104, 109, 103, 108),
        bar('2024-01-08', 100, 101, 99, 100),
        bar('2024-01-10', 104, 109, 103, 108),
        bar('2024-01-11', 100, 101, 99, 100),
        bar('2024-01-13', 104, 109, 103, 108),
        bar('2024-01-14', 100, 101, 99, 100),
        bar('2024-01-16', 104, 109, 103, 108),
        bar('2024-01-17', 100, 101, 99, 100),
        bar('2024-01-19', 104, 109, 103, 108),
      ],
    }
    const space = buildSpace(trips, bars)
    expect(space.oppCost.symbolBh).toBeTruthy()
    expect(space.oppCost.symbolBh!.bench).toBeGreaterThan(space.oppCost.symbolBh!.actual)
    expect(space.oppCost.note).toMatch(/不是「你该一直拿着」/)
    expect(space.oppCost.note).not.toMatch(/能多赚/)
  })
})

describe('psm exact match', () => {
  it('matches shorts to longs on the same symbol and hold bucket', () => {
    const shorts = Array.from({ length: 6 }, (_, i) =>
      t({
        id: `s${i}`,
        side: 'short',
        symbol: 'MSTR',
        realizedPnl: -80,
        holdMinutes: 6 * 1440,
        openTime: new Date(Date.UTC(2024, 0, 2 + i)),
      }),
    )
    const longs = Array.from({ length: 6 }, (_, i) =>
      t({
        id: `l${i}`,
        side: 'long',
        symbol: 'MSTR',
        realizedPnl: 20,
        holdMinutes: 6 * 1440,
        openTime: new Date(Date.UTC(2024, 0, 12 + i)),
      }),
    )
    const space = buildSpace([...shorts, ...longs], {})
    expect(space.psm.status).toBe('ok')
    expect(space.psm.nMatched).toBe(6)
    expect(space.psm.delta).toBeCloseTo(-100)
  })
  it('refuses to unconfound when shorts and longs do not share a cell', () => {
    const shorts = Array.from({ length: 6 }, (_, i) =>
      t({ id: `s${i}`, side: 'short', symbol: 'MSTR', realizedPnl: -80, holdMinutes: 6 * 1440, openTime: new Date(Date.UTC(2024, 0, 2 + i)) }),
    )
    const longs = Array.from({ length: 6 }, (_, i) =>
      t({ id: `l${i}`, side: 'long', symbol: 'TSLA', realizedPnl: 20, holdMinutes: 6 * 1440, openTime: new Date(Date.UTC(2024, 0, 12 + i)) }),
    )
    const space = buildSpace([...shorts, ...longs], {})
    expect(space.psm.status).toBe('cannot-control')
    expect(space.psm.note).toMatch(/无法把方向/)
  })
})

describe('kelly', () => {
  it('uses quarter Kelly and clamps a negative edge to 0', () => {
    expect(kellyFraction(0.6, 2)).toBeCloseTo(0.4)
    expect(kellyFraction(0.15, 2)).toBe(0)
    const trips = [
      ...Array.from({ length: 6 }, (_, i) => t({ id: `w${i}`, realizedPnl: 20, openPrice: 100, qty: 1, openTime: new Date(Date.UTC(2024, 0, 2 + i)) })),
      ...Array.from({ length: 4 }, (_, i) => t({ id: `l${i}`, realizedPnl: -10, openPrice: 100, qty: 2, openTime: new Date(Date.UTC(2024, 0, 12 + i)) })),
    ]
    const space = buildSpace(trips, {})
    expect(space.kelly).toBeTruthy()
    expect(space.kelly!.quarter).toBeCloseTo((space.kelly!.full as number) / 4)
    expect(space.kelly!.note).toMatch(/不建议|只展示 1\/4/)
    expect(space.kelly!.note).toMatch(/不是仓位建议/)
  })
})
