import type { GroupRow, RoundTrip } from '../types.ts'
import { REGIME_LABELS, REGIME_ORDER } from './regime.ts'
import { group, holdBucketOf, HOLD_BUCKET_LABELS, weekdayEt, WEEKDAY_LABELS } from './checkup.ts'

export type CrossReport = {
  symbolHold: GroupRow[]
  weekdayRegime: GroupRow[]
}

export function buildCross(trips: RoundTrip[]): CrossReport {
  const closed = trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  const total = closed.length
  const symbols = [...new Set(closed.map((t) => t.symbol))]
  const buckets = ['h1', 'h2', 'h3'] as const

  const symbolHold: GroupRow[] = []
  for (const sym of symbols) {
    for (const b of buckets) {
      const list = closed.filter((t) => t.symbol === sym && holdBucketOf(t.holdMinutes) === b)
      if (list.length) symbolHold.push(group(`${sym}-${b}`, `${sym} · ${HOLD_BUCKET_LABELS[b]}`, list, total))
    }
  }
  symbolHold.sort((a, b) => b.n - a.n || Math.abs(b.pnl) - Math.abs(a.pnl))

  const weekdayRegime: GroupRow[] = []
  for (const d of [1, 2, 3, 4, 5]) {
    for (const rg of REGIME_ORDER) {
      const list = closed.filter((t) => weekdayEt(t.openTime) === d && t.regime === rg)
      if (list.length) {
        weekdayRegime.push(group(`wd${d}-${rg}`, `${WEEKDAY_LABELS[d]} · ${REGIME_LABELS[rg]}`, list, total))
      }
    }
  }
  weekdayRegime.sort((a, b) => b.n - a.n || Math.abs(b.pnl) - Math.abs(a.pnl))

  return {
    symbolHold: symbolHold.slice(0, 30),
    weekdayRegime: weekdayRegime.slice(0, 30),
  }
}
