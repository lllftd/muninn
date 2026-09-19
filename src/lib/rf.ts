import { DTB3_BUNDLE } from '../data/dtb3.ts'
import type { Bar, RfStatus } from '../types.ts'

function dailyFromAnnualPct(pct: number): number {
  return pct / 100 / 252
}

export function alignRf(dates: string[], irxBars?: Bar[]): { daily: number[]; status: RfStatus } {
  if (irxBars?.length && dates.length) {
    let last = irxBars[0].close
    const byDate = new Map(irxBars.map((b) => [b.date, b.close]))
    const daily: number[] = []
    let used = 0
    for (const date of dates) {
      const hit = byDate.get(date)
      if (hit != null && Number.isFinite(hit)) {
        last = hit
        used += 1
      }
      daily.push(dailyFromAnnualPct(last))
    }
    if (used > 0) {
      return {
        daily,
        status: {
          source: 'irx-quotes',
          version: 'yahoo-irx',
          asOf: irxBars.at(-1)?.date ?? null,
          lastDate: irxBars.at(-1)?.date ?? null,
          warning: '无风险日收益由短期国债报价近似换算，不是已确认的有效日利率。',
          approx: 'quoted',
        },
      }
    }
  }

  if (DTB3_BUNDLE.observations.length && dates.length) {
    const obs = [...DTB3_BUNDLE.observations].sort((a, b) => a[0].localeCompare(b[0]))
    let j = 0
    let last = obs[0][1]
    const daily: number[] = []
    for (const date of dates) {
      while (j < obs.length && obs[j][0] <= date) {
        last = obs[j][1]
        j += 1
      }
      daily.push(dailyFromAnnualPct(last))
    }
    const lastObs = obs[obs.length - 1]
    const stale = dates.at(-1) && lastObs[0] < dates[dates.length - 1]
    return {
      daily,
      status: {
        source: 'dtb3-bundle',
        version: DTB3_BUNDLE.version,
        asOf: DTB3_BUNDLE.asOf,
        lastDate: lastObs[0],
        warning: stale
          ? `无风险利率序列截止 ${lastObs[0]}，之后按最后有效值前推。报价已近似换算为日收益。`
          : '无风险日收益由短期国债报价近似换算。',
        approx: 'quoted',
      },
    }
  }

  return {
    daily: dates.map(() => 0),
    status: {
      source: 'zero-fallback',
      version: 'rf0',
      asOf: null,
      lastDate: null,
      warning: '无风险数据缺失，使用 0 近似。这不等于已确认无风险收益接近 0。',
      approx: 'missing-zero',
    },
  }
}

export function compoundCashIndex(dailyRf: number[]): number[] {
  let v = 100
  return dailyRf.map((r, i) => {
    if (i) v *= 1 + r
    return v
  })
}
