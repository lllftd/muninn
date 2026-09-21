import { describe, expect, it } from 'vitest'
import { loadSampleBook } from '../fixtures/sampleBook.ts'
import { diagnose, hasForbiddenCopy, pickMain, type Diagnosis } from './diagnose.ts'
import { DEFAULT_PRO_PREFS, type ProPrefs } from '../lib/proPrefs.ts'
import type { Book, GroupRow, MetricPoint, RoundTrip, Sensitivity } from '../types.ts'

function mp(value: number | null, n: number, lo?: number, hi?: number): MetricPoint {
  return {
    value,
    n,
    eligible: n,
    excluded: 0,
    ci: value == null || lo == null || hi == null ? null : { lo, hi, method: 'wilson' },
    basis: 'test',
  }
}

function row(over: Partial<GroupRow> & Pick<GroupRow, 'id' | 'label' | 'n'>): GroupRow {
  return {
    winRate: 0.5,
    winCi: null,
    medianAtrR: null,
    expectancy: over.n >= 5 ? (over.expectancy ?? 0) : null,
    expectancyCi: over.expectancyCi ?? null,
    expectancyExMax: over.n >= 5 ? (over.expectancy ?? 0) : null,
    pf: over.n >= 5 ? 1 : null,
    pnl: over.pnl ?? 0,
    status: over.n < 5 ? 'raw' : over.n < 10 ? 'observe' : over.n < 30 ? 'weak' : 'ok',
    fact: '',
    ...over,
  }
}

function trip(i: number, pnl: number): RoundTrip {
  return {
    id: `t${i}`,
    status: 'closed',
    tags: [],
    realizedPnl: pnl,
    openTime: new Date(Date.UTC(2024, 0, 1 + i)),
  } as RoundTrip
}

function stub(over: {
  n: number
  days?: number
  expectancy?: number
  expLo?: number
  expHi?: number
  sides?: GroupRow[]
  weekdays?: GroupRow[]
  hold?: GroupRow[]
  regimes?: GroupRow[]
  sensitivity?: Partial<Sensitivity>
  capture?: number
  captureN?: number
  payoff?: number
  winRate?: number
  episodes?: RoundTrip[]
  mcLose?: number
  mcN?: number
}): Book {
  const n = over.n
  const days = over.days ?? Math.max(1, Math.floor(n / 2))
  const emptyG: GroupRow[] = []
  const terminals = over.mcLose != null
    ? Array.from({ length: 100 }, (_, i) => (i < over.mcLose * 100 ? -10 : 10))
    : null
  return {
    performance: {
      closedCount: n,
      uniqueOpenDays: days,
      expectancy: mp(over.expectancy ?? 1, n, over.expLo ?? -2, over.expHi ?? 4),
      profitFactor: mp(1.1, n, 0.8, 1.4),
      winRate: mp(over.winRate ?? 0.5, n, 0.3, 0.7),
      payoff: mp(over.payoff ?? 1.2, n),
      capture: mp(over.capture ?? 0.3, over.captureN ?? Math.min(n, 8)),
      giveback: mp(0.5, over.captureN ?? Math.min(n, 8)),
    },
    checkup: {
      sides: over.sides ?? emptyG,
      weekdays: over.weekdays ?? emptyG,
      holdBuckets: over.hold ?? emptyG,
      regimes: over.regimes ?? emptyG,
      sessions: emptyG,
    },
    sensitivity: {
      n,
      openDays: days,
      expectancy: over.expectancy ?? 1,
      expectancyDropMaxTrade: null,
      expectancyDropMaxDay: null,
      maxTradePnlShare: null,
      maxDayPnlShare: null,
      maxWinShareGrossProfit: over.sensitivity?.maxWinShareGrossProfit ?? null,
      maxLossShareGrossLoss: null,
      maxAbsShareTotalAbs: null,
      expectancyDropMaxWin: over.sensitivity?.expectancyDropMaxWin ?? null,
      top1Share: over.sensitivity?.top1Share ?? null,
      top3Share: null,
      top5Share: null,
      meanPnl: over.sensitivity?.meanPnl ?? over.expectancy ?? 1,
      medianPnl: null,
      trimmedMean: null,
      firstHalfExpectancy: over.sensitivity?.firstHalfExpectancy ?? null,
      secondHalfExpectancy: over.sensitivity?.secondHalfExpectancy ?? null,
      cost: [],
      fifoVsEpisode: { fifoN: n, episodeN: n, fifoExp: 1, episodeExp: 1 },
      sensitive: over.sensitivity?.sensitive ?? false,
      note: over.sensitivity?.note ?? '',
    },
    analytics: {
      monteCarlo: terminals
        ? {
            method: 'cluster-bootstrap',
            nTrades: over.mcN ?? n,
            rounds: 100,
            steps: n,
            bands: { p5: [], p25: [], p50: [], p75: [], p95: [] },
            realizedPath: [],
            terminals,
            realizedTerminal: -200,
            terminalPctile: 0.4,
            maxDDs: [],
            realizedMaxDD: 0,
            maxDDPctile: 0.5,
            ddProb: [],
            note: '',
          }
        : null,
      runs: { n, wins: 0, runs: 0, expected: 0, z: null, pValue: null, note: '' },
      regimeCum: { dates: [], series: [] },
    },
    credibility: { maeMfeComputableShare: 0.8 },
    episodes: over.episodes ?? [],
  } as Book
}

describe('diagnose', () => {
  it('blocks claim when extrapolation is low, but keeps concentration as a high-fact impact item', () => {
    const book = stub({
      n: 8,
      days: 4,
      expectancy: -12,
      expLo: -40,
      expHi: 20,
      sides: [
        row({ id: 'long', label: '多头', n: 5, expectancy: 8, pnl: 40 }),
        row({ id: 'short', label: '空头', n: 3, expectancy: -40, pnl: -120 }),
      ],
      weekdays: [row({ id: 'wd1', label: '周一', n: 8, expectancy: -12, pnl: -96 })],
      sensitivity: { maxWinShareGrossProfit: 0.7, expectancyDropMaxWin: -4, meanPnl: 10 },
    })
    const items = diagnose(book)
    expect(items.every((d) => d.canClaim === false)).toBe(true)
    const conc = items.find((d) => d.id === 'structure-max-win')
    expect(conc).toBeTruthy()
    expect(conc!.factConfidence).toBe('high')
    expect(conc!.extrapolationConfidence).toBe('low')
    expect(conc!.section).toBe('impact')
    expect(conc!.explanation).toMatch(/事实/)
    expect(conc!.explanation).not.toMatch(/撑不住这条结构/)
  })

  it('sorts by |impact| × fact-confidence weight', () => {
    const book = stub({
      n: 40,
      days: 20,
      expectancy: 5,
      expLo: 1,
      expHi: 9,
      sides: [
        row({ id: 'long', label: '多头', n: 22, expectancy: 20, pnl: 440 }),
        row({ id: 'short', label: '空头', n: 18, expectancy: -30, pnl: -540 }),
      ],
    })
    const items = diagnose(book)
    const scores = items.map((d) => d.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('never uses ban-list copy', () => {
    const book = loadSampleBook()
    const items = diagnose(book)
    for (const d of items) expect(hasForbiddenCopy(d)).toBe(false)
    const main = pickMain(items)
    expect(main?.tone).not.toBe('highlight')
    expect(main?.id).not.toBe('trend-better')
  })

  it('does not treat a top-1-driven second-half improvement as a highlight', () => {
    const early = Array.from({ length: 20 }, (_, i) => trip(i, -20))
    const late = Array.from({ length: 19 }, (_, i) => trip(20 + i, -20))
    late.push(trip(39, 800))
    const book = stub({
      n: 40,
      days: 20,
      expectancy: 8,
      expLo: 2,
      expHi: 14,
      episodes: [...early, ...late],
    })
    const items = diagnose(book)
    const trend = items.find((d) => d.id === 'trend-better')
    expect(trend).toBeTruthy()
    expect(trend!.tone).not.toBe('highlight')
    expect(trend!.explanation).toMatch(/单笔贡献/)
    expect(pickMain(items)?.id).not.toBe('trend-better')
  })

  it('keeps a second-half improvement as highlight when it survives dropping top-1', () => {
    const early = Array.from({ length: 20 }, (_, i) => trip(i, 2))
    const late = Array.from({ length: 20 }, (_, i) => trip(20 + i, 16))
    const book = stub({
      n: 40,
      days: 20,
      expectancy: 8,
      expLo: 2,
      expHi: 14,
      episodes: [...early, ...late],
    })
    const items = diagnose(book)
    expect(items.some((d: Diagnosis) => d.tone === 'highlight' && d.id === 'trend-better')).toBe(true)
  })

  it('picks the system-loss diagnosis as main over concentration or a highlight', () => {
    const book = stub({
      n: 40,
      days: 20,
      expectancy: -8,
      expLo: -20,
      expHi: 2,
      mcLose: 0.61,
      mcN: 40,
      sensitivity: { maxWinShareGrossProfit: 0.97, expectancyDropMaxWin: -12, meanPnl: 4 },
      payoff: 4.4,
      winRate: 0.15,
    })
    const items = diagnose(book)
    const main = pickMain(items)
    expect(main?.id).toBe('luck-loss-mass')
    expect(main?.factConfidence).toBe('high')
    expect(items.find((d) => d.id === 'structure-max-win')?.section).toBe('impact')
    expect(items.some((d) => d.id === 'payoff-highlight')).toBe(true)
  })

  it('does not offer an experiment for the system-loss diagnosis', () => {
    const book = stub({ n: 40, days: 20, mcLose: 0.61, mcN: 40 })
    const d = diagnose(book).find((x) => x.id === 'luck-loss-mass')!
    expect(d.canClaim).toBe(false)
    expect(d.next).toMatch(/暂无直接实验/)
  })

  it('reads custom concentration from prefs', () => {
    const book = stub({
      n: 40,
      days: 20,
      expectancy: 4,
      expLo: 1,
      expHi: 8,
      sensitivity: { maxWinShareGrossProfit: 0.35, expectancyDropMaxWin: 1, meanPnl: 4 },
    })
    const loose = diagnose(book, { ...DEFAULT_PRO_PREFS, concentration: 0.5 })
    const tight: ProPrefs = { ...DEFAULT_PRO_PREFS, concentration: 0.3 }
    expect(diagnose(book, tight).some((d) => d.id === 'structure-max-win')).toBe(true)
    expect(loose.some((d) => d.id === 'structure-max-win')).toBe(false)
  })

  it('does not offer a short-side experiment when matching says shorts are not worse', () => {
    const book = loadSampleBook()
    const side = diagnose(book).find((d) => d.id === 'side-short')
    if (!side) return
    if (book.space.psm.status === 'ok' && (book.space.psm.delta ?? 0) >= 0) {
      expect(side.canClaim).toBe(false)
      expect(side.explanation).toMatch(/混杂/)
    }
  })

  it('frames giveback as an upper bound, not reachable alpha', () => {
    const book = stub({ n: 20, days: 12, capture: 0.5, captureN: 12 })
    book.space = {
      exitEfficiency: { overall: 0.42, n: 12, groups: [] },
      giveback: {
        nFloated: 12,
        nClosed: 20,
        nPath: 15,
        meanRate: 0.63,
        sumDollar: 4200,
        sumCi: { lo: 1200, hi: 3800, method: 'bootstrap', level: 0.8 },
        meanRateCi: null,
        note: '这是理论上界',
      },
      stopScan: {
        actualPnl: -800,
        levels: [],
        presets: [],
        bestPreset: {
          pct: 0.08,
          preset: true,
          pnl: -200,
          delta: 600,
          deltaCi: { lo: 80, hi: 1100, method: 'bootstrap', level: 0.8 },
          pValue: 0.01,
          fdr: true,
          nStopped: 7,
        },
        note: 'FDR',
      },
      evLevers: [],
    } as typeof book.space
    const items = diagnose(book)
    const gb = items.find((d) => d.id === 'space-giveback')
    expect(gb).toBeTruthy()
    expect(gb!.phenomenon).toMatch(/理论上界/)
    expect(gb!.phenomenon).toMatch(/不是「能多赚/)
    expect(gb!.canClaim).toBe(false)
    expect(gb!.next).toMatch(/暂无直接实验/)
    expect(gb!.evidenceAnchor).toBe('mae')
    const stop = items.find((d) => d.id === 'space-stop')
    expect(stop).toBeTruthy()
    expect(stop!.explanation).toMatch(/不是出在最高点/)
    expect(stop!.evidenceAnchor).toBe('stop-scan')
    expect(items.some((d) => d.id === 'space-ev')).toBe(false)
    expect(items.some((d) => d.id === 'execution-capture')).toBe(false)
  })
})
