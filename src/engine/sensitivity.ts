import { etDateKey } from '../lib/time.ts'
import { mean, median } from '../lib/stats.ts'
import type { RoundTrip, Sensitivity } from '../types.ts'

function pfOf(trips: RoundTrip[]): number | null {
  const gp = trips.filter((t) => t.realizedPnl > 0).reduce((s, t) => s + t.realizedPnl, 0)
  const gl = Math.abs(trips.filter((t) => t.realizedPnl < 0).reduce((s, t) => s + t.realizedPnl, 0))
  if (gl < 1e-9) return gp > 0 ? Number.POSITIVE_INFINITY : 0
  return gp / gl
}

function withCost(trips: RoundTrip[], bps: number): RoundTrip[] {
  const k = bps / 10000
  return trips.map((t) => {
    const notion = [...t.opens, ...t.closes].reduce((s, f) => s + f.qty * f.price, 0)
    return { ...t, realizedPnl: t.realizedPnl - notion * k }
  })
}

export function buildSensitivity(fifo: RoundTrip[], episodes: RoundTrip[]): Sensitivity {
  const closed = episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  const fifoClosed = fifo.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  const pnls = closed.map((t) => t.realizedPnl)
  const total = pnls.reduce((s, x) => s + x, 0)
  const days = new Map<string, number>()
  for (const t of closed) {
    const k = etDateKey(t.openTime)
    days.set(k, (days.get(k) || 0) + t.realizedPnl)
  }
  const dayEntries = [...days.entries()]
  const maxTrade = pnls.length ? Math.max(...pnls) : 0
  const maxDay = dayEntries.length ? Math.max(...dayEntries.map(([, v]) => v)) : 0
  const dropTrade = pnls.filter((x) => x !== maxTrade || pnls.filter((y) => y === maxTrade).length > 1)
  const dropDayPnls = closed
    .filter((t) => etDateKey(t.openTime) !== dayEntries.find(([, v]) => v === maxDay)?.[0])
    .map((t) => t.realizedPnl)
  const sorted = [...pnls].sort((a, b) => b - a)
  const profit = sorted.filter((x) => x > 0)
  const profitSum = profit.reduce((s, x) => s + x, 0)
  const loss = sorted.filter((x) => x < 0)
  const lossSum = Math.abs(loss.reduce((s, x) => s + x, 0))
  const absSum = pnls.reduce((s, x) => s + Math.abs(x), 0)
  const share = (n: number) => (profitSum > 0 ? profit.slice(0, n).reduce((s, x) => s + x, 0) / profitSum : null)
  const mid = Math.floor(closed.length / 2)
  const byTime = [...closed].sort((a, b) => a.openTime.getTime() - b.openTime.getTime())
  const trim = [...pnls].sort((a, b) => a - b)
  const cut = Math.floor(trim.length * 0.1)
  const trimmed = trim.length > 4 ? trim.slice(cut, trim.length - cut) : trim
  const fifoExp = fifoClosed.length ? mean(fifoClosed.map((t) => t.realizedPnl)) : null
  const epExp = closed.length ? mean(pnls) : null
  const maxDayShare = total !== 0 ? maxDay / Math.abs(total) : null
  const sensitive = (maxDayShare != null && Math.abs(maxDayShare) >= 0.4) || (share(1) != null && share(1)! >= 0.4)
  const cost = [0, 2, 5, 10].map((bps) => {
    const priced = bps ? withCost(closed, bps) : closed
    return {
      bps,
      expectancy: priced.length ? mean(priced.map((t) => t.realizedPnl)) : null,
      pf: pfOf(priced),
    }
  })
  const maxWin = profit.length ? profit[0] : null
  const maxLoss = loss.length ? loss[loss.length - 1] : null
  const maxAbs = pnls.length ? Math.max(...pnls.map((x) => Math.abs(x))) : null
  const dropMaxWin = maxWin != null ? pnls.filter((x) => x !== maxWin || profit.filter((y) => y === maxWin).length > 1) : pnls
  return {
    n: closed.length,
    openDays: days.size,
    expectancy: epExp,
    expectancyDropMaxTrade: dropTrade.length ? mean(dropTrade) : null,
    expectancyDropMaxDay: dropDayPnls.length ? mean(dropDayPnls) : null,
    maxTradePnlShare: total !== 0 && maxTrade ? maxTrade / Math.abs(total) : null,
    maxDayPnlShare: maxDayShare,
    maxWinShareGrossProfit: maxWin != null && profitSum > 0 ? maxWin / profitSum : null,
    maxLossShareGrossLoss: maxLoss != null && lossSum > 0 ? Math.abs(maxLoss) / lossSum : null,
    maxAbsShareTotalAbs: maxAbs != null && absSum > 0 ? maxAbs / absSum : null,
    expectancyDropMaxWin: dropMaxWin.length ? mean(dropMaxWin) : null,
    top1Share: share(1),
    top3Share: share(3),
    top5Share: share(5),
    meanPnl: pnls.length ? mean(pnls) : null,
    medianPnl: median(pnls),
    trimmedMean: trimmed.length ? mean(trimmed) : null,
    firstHalfExpectancy: mid ? mean(byTime.slice(0, mid).map((t) => t.realizedPnl)) : null,
    secondHalfExpectancy: closed.length > mid ? mean(byTime.slice(mid).map((t) => t.realizedPnl)) : null,
    cost,
    fifoVsEpisode: {
      fifoN: fifoClosed.length,
      episodeN: closed.length,
      fifoExp,
      episodeExp: epExp,
    },
    sensitive,
    note: sensitive
      ? '当前观察对少数交易或复盘口径较敏感。'
      : closed.length
        ? '当前观察对单笔/单日的依赖不突出，仍受样本量限制。'
        : '没有可评估的复盘单元。',
  }
}
