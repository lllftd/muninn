import { etClock } from '../lib/time.ts'
import type { Direction, Fill, RoundTrip, SessionBucket, Warning } from '../types.ts'

type Lot = {
  qty: number
  price: number
  time: Date
  fees: number
  fill: Fill
}

function sessionOf(time: Date): SessionBucket {
  const t = etClock(time)
  if (t < 10) return 'open30'
  if (t >= 15) return 'close'
  return 'midday'
}

function emptyTrip(fill: Fill, side: Direction, id: string): RoundTrip {
  return {
    id,
    symbol: fill.symbol,
    name: fill.name,
    side,
    status: 'open',
    qty: 0,
    openTime: fill.time,
    closeTime: null,
    openPrice: 0,
    closePrice: null,
    realizedPnl: 0,
    fees: 0,
    holdMinutes: 0,
    opens: [],
    closes: [],
    sameDay: false,
    pathQuality: 'missing_bars',
    maePct: null,
    mfePct: null,
    maePrice: null,
    mfePrice: null,
    maeDollar: null,
    mfeDollar: null,
    captureRate: null,
    givebackRate: null,
    recoveryRate: null,
    pathAnomaly: false,
    splitSuspect: false,
    moneyLeft: null,
    lateStopCost: null,
    rMultiple: null,
    executionLocation: null,
    prevResult: 'none',
    prevGapHours: null,
    chasePercentile: null,
    chaseReturn: null,
    ma50Dist: null,
    ma200Dist: null,
    vix: null,
    session: sessionOf(fill.time),
    tags: [],
    setup: '',
    pathSource: 'none',
    splitWarning: false,
    atr: null,
    positionPct: null,
  }
}

function finalize(trip: RoundTrip): RoundTrip {
  const openQty = trip.opens.reduce((s, f) => s + f.qty, 0)
  const closeQty = trip.closes.reduce((s, f) => s + f.qty, 0)
  const openNotional = trip.opens.reduce((s, f) => s + f.qty * f.price, 0)
  const closeNotional = trip.closes.reduce((s, f) => s + f.qty * f.price, 0)
  const fees = [...trip.opens, ...trip.closes].reduce((s, f) => s + f.fees, 0)
  const qty = closeQty > 0 ? closeQty : openQty
  const openPrice = openQty ? openNotional / openQty : 0
  const closePrice = closeQty ? closeNotional / closeQty : null
  const dir = trip.side === 'long' ? 1 : -1
  const realized =
    closePrice != null && qty ? (closePrice - openPrice) * qty * dir - fees : 0 - fees * (closeQty ? 1 : 0)
  const end = trip.closeTime || trip.opens[trip.opens.length - 1]?.time || trip.openTime
  const holdMinutes = Math.max(1, (end.getTime() - trip.openTime.getTime()) / 60000)
  return {
    ...trip,
    qty,
    openPrice,
    closePrice,
    fees,
    realizedPnl: closeQty ? realized : 0,
    holdMinutes,
    status: closeQty && Math.abs(openQty - closeQty) < 1e-6 ? 'closed' : 'open',
    session: sessionOf(trip.openTime),
  }
}

export function buildRoundTrips(fills: Fill[]): { trips: RoundTrip[]; warnings: Warning[] } {
  const warnings: Warning[] = []
  const bySymbol = new Map<string, Fill[]>()
  for (const fill of fills) {
    const arr = bySymbol.get(fill.symbol) || []
    arr.push(fill)
    bySymbol.set(fill.symbol, arr)
  }

  const trips: RoundTrip[] = []
  let seq = 1

  for (const [symbol, list] of bySymbol) {
    const ordered = [...list].sort((a, b) => a.time.getTime() - b.time.getTime() || a.id.localeCompare(b.id))
    if (ordered[0]?.side === 'sell') {
      warnings.push({
        code: 'first-short',
        message: `${symbol} 第一笔是卖出。如果当时已有底仓，请先补上开仓记录，否则会被当成开空。`,
      })
    }
    let signed = 0
    const longLots: Lot[] = []
    const shortLots: Lot[] = []
    const box: { trip: RoundTrip | null } = { trip: null }

    const ensure = (fill: Fill, side: Direction): RoundTrip => {
      if (!box.trip) box.trip = emptyTrip(fill, side, `rt${seq++}`)
      return box.trip
    }

    const closeLots = (lots: Lot[], fill: Fill, dir: Direction) => {
      let left = fill.qty
      let used = 0
      while (left > 1e-10 && lots.length) {
        const lot = lots[0]
        const take = Math.min(lot.qty, left)
        const lotFee = lot.fees * (take / lot.qty)
        lot.qty -= take
        lot.fees -= lotFee
        left -= take
        used += take
        signed += dir === 'long' ? -take : take
        if (lot.qty <= 1e-10) lots.shift()
      }
      if (box.trip && used > 0) {
        box.trip.closes.push({ ...fill, qty: used, amount: used * fill.price, fees: fill.fees * (used / fill.qty) })
      }
      return left
    }

    const closeCurrent = (time: Date) => {
      if (!box.trip) return
      box.trip.closeTime = time
      trips.push(finalize(box.trip))
      box.trip = null
    }

    for (const fill of ordered) {
      if (fill.side === 'buy') {
        if (signed < 0) {
          ensure(fill, 'short')
          const leftover = closeLots(shortLots, fill, 'short')
          if (Math.abs(signed) < 1e-8) {
            closeCurrent(fill.time)
            signed = 0
          }
          if (leftover > 1e-10) {
            ensure({ ...fill, qty: leftover }, 'long').opens.push({
              ...fill,
              qty: leftover,
              amount: leftover * fill.price,
              fees: fill.fees * (leftover / fill.qty),
            })
            longLots.push({
              qty: leftover,
              price: fill.price,
              time: fill.time,
              fees: fill.fees * (leftover / fill.qty),
              fill,
            })
            signed += leftover
          }
        } else {
          ensure(fill, 'long').opens.push(fill)
          longLots.push({ qty: fill.qty, price: fill.price, time: fill.time, fees: fill.fees, fill })
          signed += fill.qty
        }
      } else if (signed > 0) {
        ensure(fill, 'long')
        const leftover = closeLots(longLots, fill, 'long')
        if (Math.abs(signed) < 1e-8) {
          closeCurrent(fill.time)
          signed = 0
        }
        if (leftover > 1e-10) {
          ensure({ ...fill, qty: leftover }, 'short').opens.push({
            ...fill,
            qty: leftover,
            amount: leftover * fill.price,
            fees: fill.fees * (leftover / fill.qty),
          })
          shortLots.push({
            qty: leftover,
            price: fill.price,
            time: fill.time,
            fees: fill.fees * (leftover / fill.qty),
            fill,
          })
          signed -= leftover
        }
      } else {
        ensure(fill, 'short').opens.push(fill)
        shortLots.push({ qty: fill.qty, price: fill.price, time: fill.time, fees: fill.fees, fill })
        signed -= fill.qty
      }
    }
    if (box.trip) trips.push(finalize(box.trip))
  }

  trips.sort((a, b) => a.openTime.getTime() - b.openTime.getTime())
  return { trips, warnings }
}

export function attachSequence(trips: RoundTrip[]): RoundTrip[] {
  const closed = trips.filter((t) => t.status === 'closed')
  return trips.map((trip) => {
    const prev = [...closed]
      .filter((t) => t.closeTime && t.closeTime.getTime() <= trip.openTime.getTime() && t.id !== trip.id)
      .sort((a, b) => (b.closeTime?.getTime() || 0) - (a.closeTime?.getTime() || 0))[0]
    if (!prev?.closeTime) return { ...trip, prevResult: 'none' as const, prevGapHours: null }
    const gap = (trip.openTime.getTime() - prev.closeTime.getTime()) / 3600000
    return {
      ...trip,
      prevResult: prev.realizedPnl >= 0 ? 'win' : 'loss',
      prevGapHours: gap,
    }
  })
}
