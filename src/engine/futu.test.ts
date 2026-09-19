import { describe, expect, it } from 'vitest'
import { importFutu, isFundName, isOptionSymbol, matchFees, parseFills, parseOrders } from './futu.ts'

const fills = `Symbol,Name,Side,Fill Qty,Fill Price,Fill Amount,Fill Time,Markets,Currency,Counterparty
AAPL,Apple,Buy,10,190.00,1900.00,"Jan 8, 2026 10:12:14 ET",US,USD,
AAPL250509C185000,AAPL 250509 185.00 C,Buy,1,2.50,250.00,"Jan 8, 2026 10:13:00 ET",US,USD,
00020,SENSETIME-W,Buy,"1,000",1.435,"1,435.00","Aug 31, 2026 14:49:17 HKT",HK,HKD,6087
AAPL,Apple,Buy,0.0014,305.26,0.43,"Aug 13, 2026 00:00:00 ET",US,USD,
NVDA,NVIDIA,Buy,0.0001,192.53,0.02,"Jun 26, 2026 00:00:00 ET",US,USD,
MRAL,GraniteShares 2X Long MARA Daily ETF,Buy,101,5.03,508.03,"Apr 28, 2026 22:17:06 ET",US,USD,
AMZN,Amazon,Sell,3,261.60,784.80,"Apr 28, 2026 05:11:48 ET",US,USD,
AMZN,Amazon,Sell,1,261.69,261.69,"Apr 28, 2026 05:10:09 ET",US,USD,
F,Ford Motor,Buy,1,14.88,14.88,"May 26, 2026 09:31:09 ET",US,USD,
`

const orders = `Side,Symbol,Name,Order Price,Order Qty,Order Amount,Status,Filled@Avg Price,Order Time,Markets,Currency,Commission,Platform Fees,SEC Fees,Trading Activity Fees,Settlement Fees,Total
Sell,AMZN,Amazon,Market Price,4,1046.49,Filled,4@261.6225,"Apr 28, 2026 05:09:47 ET",US,USD,0.99,1,0.03,0.02,0.01,2.05
Buy,F,Ford Motor,14.88,1,14.88,Filled,1@14.88,"May 26, 2026 05:43:11 ET",US,USD,0.99,1,,,0,1.99
Buy,AAPL,Apple,190.00,10,1900.00,Cancelled,0@0.00,"Jan 8, 2026 10:00:00 ET",US,USD,,,,,,,,
`

describe('futu import', () => {
  it('detects option roots', () => {
    expect(isOptionSymbol('AAPL250509C185000')).toBe(true)
    expect(isOptionSymbol('AAPL')).toBe(false)
    expect(isFundName('GraniteShares 2X Long MARA Daily ETF', 'MRAL')).toBe(true)
  })

  it('keeps US common stock and drops the rest', () => {
    const res = importFutu(fills, orders)
    const symbols = res.fills.map((f) => f.symbol).sort()
    expect(symbols).toContain('AAPL')
    expect(symbols).toContain('F')
    expect(symbols).toContain('AMZN')
    expect(symbols).not.toContain('00020')
    expect(symbols).not.toContain('AAPL250509C185000')
    expect(symbols).not.toContain('MRAL')
    expect(res.dropped.options).toBeGreaterThan(0)
    expect(res.dropped.nonUs).toBeGreaterThan(0)
    expect(res.dropped.funds).toBeGreaterThan(0)
    expect(res.dripKept).toBeGreaterThan(0)
    expect(res.fills.some((f) => f.kind === 'drip')).toBe(true)
    expect(res.excludedRows.length).toBeGreaterThan(0)
  })

  it('maps short sell to sell', () => {
    const text = `Symbol,Name,Side,Fill Qty,Fill Price,Fill Amount,Fill Time,Markets,Currency
NVDA,NVIDIA,Short Sell,20,178.00,3560.00,"Aug 4, 2026 10:40:00 ET",US,USD
`
    const parsed = parseFills(text)
    expect(parsed[0].side).toBe('sell')
    expect(parsed[0].rawSide).toBe('Short Sell')
  })

  it('matches split fills to one order and rolls fees', () => {
    const raw = parseFills(fills).filter((f) => f.symbol === 'AMZN')
    const ords = parseOrders(orders)
    const matched = matchFees(raw, ords)
    expect(matched.unmatched).toBe(0)
    const feeSum = matched.fills.reduce((s, f) => s + f.fees, 0)
    expect(feeSum).toBeCloseTo(2.05, 2)
  })
})
