import { describe, expect, it } from 'vitest'
import {
  buildCounterfactual,
  conditionalDeRiskCf,
  conditionalExitCf,
  looHoldThreshold,
  riskBudgetCf,
  survivalStats,
} from './counterfactual.ts'
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
    riskDollars: null,
    regime: 'swing',
    openTime: new Date('2024-01-02T15:00:00Z'),
    closeTime: new Date('2024-01-10T21:00:00Z'),
    holdMinutes: 6 * 1440,
    ...over,
  } as RoundTrip
}

function thr(...pairs: Array<[string, number | null]>): Map<string, number | null> {
  return new Map(pairs)
}

function bar(date: string, open: number, close: number, high = Math.max(open, close), low = Math.min(open, close)): Bar {
  return { date, open, high, low, close, volume: 1 }
}

describe('riskBudgetCf', () => {
  it('caps a loss beyond capR R-multiples', () => {
    const path = [t({ id: 'a', riskDollars: 100, realizedPnl: -500 })]
    const cf = riskBudgetCf(path, 1)
    expect(cf.get('a')).toBe(-100)
    const cf2 = riskBudgetCf(path, 3)
    expect(cf2.get('a')).toBe(-300)
  })

  it('leaves small losses untouched', () => {
    const path = [t({ id: 'a', riskDollars: 100, realizedPnl: -50 })]
    expect(riskBudgetCf(path, 1).get('a')).toBe(-50)
  })
})

describe('conditionalExitCf', () => {
  it('exits day 5 when underwater, keeps otherwise', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 99, 95),
        bar('2024-01-04', 95, 94),
        bar('2024-01-05', 94, 92),
        bar('2024-01-08', 92, 91),
        bar('2024-01-09', 91, 90),
        bar('2024-01-10', 90, 89),
      ],
    }
    const losing = t({ id: 'lose', realizedPnl: -30 })
    const cf = conditionalExitCf([losing], bars, 5)
    // day 5 = window[4] close 90 → underwater → exit at 90 → -10
    expect(cf.get('lose')).toBe(-10)
  })
})

describe('looHoldThreshold（阈值无前视）', () => {
  it('当前交易不参与计算自己的超期阈值', () => {
    const path = [
      t({ id: 'a', holdMinutes: 10 * 1440 }),
      t({ id: 'b', holdMinutes: 10 * 1440 }),
      t({ id: 'c', holdMinutes: 10 * 1440 }),
      t({ id: 'd', holdMinutes: 10 * 1440 }),
      t({ id: 'e', holdMinutes: 10 * 1440 }),
      t({ id: 'f', holdMinutes: 100 * 1440 }),
    ]
    const m = looHoldThreshold(path, 0.8)
    // 极端长持仓 f 的阈值由其它 5 笔（10 天）计算，不含自身 100 天。
    expect(m.get('f')).toBe(10)
    // 其它笔的阈值同样不含 f 的 100 天，保持 10。
    expect(m.get('a')).toBe(10)
  })
})

describe('survivalStats（竞争结局 · 删失 · 口径）', () => {
  it('删失：进入超期浮亏后既未恢复也未恶化，计入 censored', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 98),
        bar('2024-01-05', 98, 97),
        bar('2024-01-08', 97, 96),
        bar('2024-01-09', 96, 95),
      ],
    }
    const path = [t({ id: 's1', realizedPnl: -30, riskDollars: 20 })]
    const s = survivalStats(path, bars, thr(['s1', 2]))
    expect(s.eligible).toBe(1)
    expect(s.underwaterLong).toBe(1)
    expect(s.recovered).toBe(0)
    expect(s.deteriorated).toBe(0)
    expect(s.censored).toBe(1)
  })

  it('恢复：超期浮亏后回到盈亏平衡，计入 recovered', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 98),
        bar('2024-01-05', 98, 101),
      ],
    }
    const path = [t({ id: 's1', realizedPnl: 5, riskDollars: 20 })]
    const s = survivalStats(path, bars, thr(['s1', 2]))
    expect(s.underwaterLong).toBe(1)
    expect(s.recovered).toBe(1)
    expect(s.deteriorated).toBe(0)
    expect(s.censored).toBe(0)
  })

  it('恶化：亏损扩大超过一个风险单位，计入 deteriorated', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 98),
        bar('2024-01-05', 80, 75),
      ],
    }
    const path = [t({ id: 's1', realizedPnl: -40, riskDollars: 20 })]
    const s = survivalStats(path, bars, thr(['s1', 2]))
    expect(s.underwaterLong).toBe(1)
    expect(s.recovered).toBe(0)
    expect(s.deteriorated).toBe(1)
    expect(s.censored).toBe(0)
  })

  it('竞争事件互斥：恢复 + 恶化 + 删失 = 进入状态数，每笔只计一次', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 98),
        bar('2024-01-05', 98, 101),
      ],
      BBB: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 98),
        bar('2024-01-05', 80, 75),
      ],
      CCC: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 98),
        bar('2024-01-05', 97, 96),
      ],
    }
    const path = [
      t({ id: 'rec', symbol: 'AAA', realizedPnl: 5, riskDollars: 20 }),
      t({ id: 'det', symbol: 'BBB', realizedPnl: -40, riskDollars: 20 }),
      t({ id: 'cen', symbol: 'CCC', realizedPnl: -30, riskDollars: 20 }),
    ]
    const s = survivalStats(path, bars, thr(['rec', 2], ['det', 2], ['cen', 2]))
    expect(s.underwaterLong).toBe(3)
    expect(s.recovered).toBe(1)
    expect(s.deteriorated).toBe(1)
    expect(s.censored).toBe(1)
    expect(s.recovered + s.deteriorated + s.censored).toBe(s.underwaterLong)
  })

  it('有效样本口径：eligible ≠ 触发数 ≠ 结局数，互不混用', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 99, 101),
      ],
      BBB: [bar('2024-01-03', 101, 102)],
    }
    const path = [
      t({ id: 'rec', symbol: 'AAA', realizedPnl: 5, riskDollars: 20 }),
      t({ id: 'win', symbol: 'BBB', realizedPnl: 8, riskDollars: 20 }),
      t({ id: 'nopath', symbol: 'CCC', realizedPnl: 10, riskDollars: 20 }),
    ]
    const s = survivalStats(path, bars, thr(['rec', 1], ['win', 1], ['nopath', 1]))
    expect(s.eligible).toBe(2) // AAA + BBB；CCC 无日线路径
    expect(s.underwaterLong).toBe(1) // 只有 AAA 浮亏触发
    expect(s.recovered).toBe(1)
    expect(s.deteriorated).toBe(0)
    expect(s.censored).toBe(0)
  })

  it('盈利长持仓不触发：即使超过阈值，只要未浮亏就继续持有', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 101, 101),
        bar('2024-01-04', 101, 103),
      ],
    }
    const path = [t({ id: 'p1', realizedPnl: 3, riskDollars: 20 })]
    expect(survivalStats(path, bars, thr(['p1', 1])).underwaterLong).toBe(0)
    expect(conditionalDeRiskCf(path, bars, thr(['p1', 1]), 1).get('p1')).toBe(3)
  })
})

describe('conditionalDeRiskCf（部分减仓 · 下一交易日执行）', () => {
  it('下一交易日执行：收盘确认触发后按次日开盘价成交，而非当日收盘价', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 101, 101),
        bar('2024-01-04', 100, 99),
        bar('2024-01-05', 95, 96),
      ],
    }
    const path = [t({ id: 'g1', realizedPnl: -20 })]
    const cf = conditionalDeRiskCf(path, bars, thr(['g1', 2]), 1)
    // 触发于第 2 日收盘 99（-1），但按次日开盘 95 成交 → pxPnl = -5，而非 -1。
    expect(cf.get('g1')).toBe(-5)
  })

  it('部分减仓守恒：25%/50%/75%/100% 按比例拆分退出与持有', () => {
    const bars: Record<string, Bar[]> = {
      AAA: [
        bar('2024-01-03', 100, 99),
        bar('2024-01-04', 94, 90),
      ],
    }
    const path = [t({ id: 'r1', realizedPnl: -30 })]
    // 触发于第 1 日收盘 99（-1），次日开盘 94 → 退出部分 PnL = -6。
    expect(conditionalDeRiskCf(path, bars, thr(['r1', 1]), 0.25).get('r1')).toBeCloseTo(0.25 * -6 + 0.75 * -30)
    expect(conditionalDeRiskCf(path, bars, thr(['r1', 1]), 0.5).get('r1')).toBeCloseTo(0.5 * -6 + 0.5 * -30)
    expect(conditionalDeRiskCf(path, bars, thr(['r1', 1]), 0.75).get('r1')).toBeCloseTo(0.75 * -6 + 0.25 * -30)
    expect(conditionalDeRiskCf(path, bars, thr(['r1', 1]), 1).get('r1')).toBeCloseTo(-6)
  })
})

describe('buildCounterfactual（零触发口径）', () => {
  it('零触发：无价格路径时条件化动作 triggered=0，净改善与改善概率均为 null', () => {
    const trips = Array.from({ length: 20 }, (_, i) =>
      t({ id: `z${i}`, realizedPnl: i % 2 ? 50 : -40, riskDollars: 100 }),
    )
    const rep = buildCounterfactual(trips, {})
    const cond = rep.actions.find((a) => a.id.startsWith('条件化'))
    expect(cond).toBeTruthy()
    expect(cond!.triggered).toBe(0)
    expect(cond!.delta).toBe(0)
    expect(cond!.improveProb).toBeNull()
    expect(cond!.cvar95).toBeNull()
    expect(cond!.ciLo).toBeNull()
    expect(cond!.ciHi).toBeNull()
  })

  it('produces actions and by-regime shrinkage', () => {
    const trips = Array.from({ length: 20 }, (_, i) =>
      t({
        id: `r${i}`,
        riskDollars: 100,
        realizedPnl: i % 3 === 0 ? -400 : i % 2 ? 80 : 40,
        regime: i % 2 ? 'swing' : 'intraday',
      }),
    )
    const rep = buildCounterfactual(trips, {})
    expect(rep.actions.length).toBeGreaterThanOrEqual(5)
    const rb = rep.actions.find((a) => a.id === '风险预算 ≤1R')
    expect(rb?.delta).toBeGreaterThan(0)
    expect(rep.actions.every((a) => a.n === 20)).toBe(true)
    expect(rep.survival.hold80).toBeGreaterThan(0)
    for (const a of rep.actions) {
      if (a.cvar95 != null) expect(a.cvar95).toBeGreaterThanOrEqual(0)
      if (a.improveProb != null) {
        expect(a.improveProb).toBeGreaterThanOrEqual(0)
        expect(a.improveProb).toBeLessThanOrEqual(1)
      }
    }
  })
})
