import type { Direction, Fill, RoundTrip } from '../types.ts'

function sessionOf(time: Date): RoundTrip['session'] {
  const h = time.getHours() + time.getMinutes() / 60
  if (h < 10) return 'open30'
  if (h >= 15) return 'close'
  return 'midday'
}

function emptyEpisode(fill: Fill, side: Direction, id: string): RoundTrip {
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

function finalize(ep: RoundTrip): RoundTrip {
  const openQty = ep.opens.reduce((s, f) => s + f.qty, 0)
  const closeQty = ep.closes.reduce((s, f) => s + f.qty, 0)
  const openNotional = ep.opens.reduce((s, f) => s + f.qty * f.price, 0)
  const closeNotional = ep.closes.reduce((s, f) => s + f.qty * f.price, 0)
  const fees = [...ep.opens, ...ep.closes].reduce((s, f) => s + f.fees, 0)
  const qty = closeQty > 0 ? closeQty : openQty
  const openPrice = openQty ? openNotional / openQty : 0
  const closePrice = closeQty ? closeNotional / closeQty : null
  const dir = ep.side === 'long' ? 1 : -1
  const realized =
    closePrice != null && qty ? (closePrice - openPrice) * qty * dir - fees : 0
  const end = ep.closeTime || ep.opens[ep.opens.length - 1]?.time || ep.openTime
  return {
    ...ep,
    qty,
    openPrice,
    closePrice,
    fees,
    realizedPnl: closeQty ? realized : 0,
    holdMinutes: Math.max(1, (end.getTime() - ep.openTime.getTime()) / 60000),
    status: closeQty && Math.abs(openQty - closeQty) < 1e-6 ? 'closed' : 'open',
    session: sessionOf(ep.openTime),
    tags: [...ep.tags, 'episode'],
  }
}

/** Flat-to-flat position episode. Accounting still uses FIFO lots. */
export function buildEpisodes(fills: Fill[]): RoundTrip[] {
  const bySymbol = new Map<string, Fill[]>()
  for (const fill of fills) {
    const arr = bySymbol.get(fill.symbol) || []
    arr.push(fill)
    bySymbol.set(fill.symbol, arr)
  }
  const episodes: RoundTrip[] = []
  let seq = 1
  for (const list of bySymbol.values()) {
    const ordered = [...list].sort((a, b) => a.time.getTime() - b.time.getTime() || a.id.localeCompare(b.id))
    let signed = 0
    let box: RoundTrip | null = null
    const pushFill = (fill: Fill, kind: 'open' | 'close') => {
      if (!box) {
        const side: Direction = fill.side === 'buy' ? 'long' : 'short'
        box = emptyEpisode(fill, side, `ep${seq++}`)
      }
      if (kind === 'open') box.opens.push(fill)
      else box.closes.push(fill)
    }
    for (const fill of ordered) {
      const delta = fill.side === 'buy' ? fill.qty : -fill.qty
      const next = signed + delta
      if (Math.abs(signed) < 1e-10) {
        pushFill(fill, 'open')
        signed = next
        continue
      }
      const reducing = signed > 0 ? delta < 0 : delta > 0
      if (reducing) {
        const closeQty = Math.min(Math.abs(signed), fill.qty)
        const closeFill = { ...fill, qty: closeQty, amount: closeQty * fill.price, fees: fill.fees * (closeQty / fill.qty) }
        pushFill(closeFill, 'close')
        const leftover = fill.qty - closeQty
        signed = next
        if (Math.abs(signed) < 1e-8) {
          box!.closeTime = fill.time
          episodes.push(finalize(box!))
          box = null
          signed = 0
          if (leftover > 1e-10) {
            const flip: Fill = { ...fill, qty: leftover, amount: leftover * fill.price, fees: fill.fees * (leftover / fill.qty) }
            pushFill(flip, 'open')
            signed = flip.side === 'buy' ? leftover : -leftover
          }
        }
      } else {
        pushFill(fill, 'open')
        signed = next
      }
    }
    if (box) episodes.push(finalize(box))
  }
  episodes.sort((a, b) => a.openTime.getTime() - b.openTime.getTime())
  return episodes
}
