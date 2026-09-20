import { describe, expect, it } from 'vitest'
import { detectKind } from '../lib/csv.ts'
import { parseBrokerTime } from '../lib/time.ts'
import { importFutu, parseFills } from './futu.ts'

const ibFlex = `Statement,Header,Field Name,Field Value
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Buy/Sell,Code
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-08, 10:12:14",10,190,-1900,-1.03,BUY,O
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-09, 14:54:14",-10,196.5,1965,-1.03,SELL,C
Trades,Data,ClosedLot,Stocks,USD,AAPL,"2026-01-09, 14:54:14",-10,196.5,1965,0,SELL,C
Trades,Data,Order,Stocks,HKD,00020,"2026-08-31, 14:49:17",1000,1.435,-1435,-8,BUY,O
Trades,Data,SubTotal,Stocks,USD,,,,,,,
`

const ibPortal = `Trade Date,Settle Date,Exchange,Symbol,Asset Class,Buy/Sell,Quantity,Price,Proceeds,Comm,Fee,Code
05/26/2026,05/28/2026,NASDAQ,F,Stocks,BUY,1,14.88,-14.88,-0.35,0,O
05/26/2026,05/28/2026,NYSE,F,Stocks,SELL,-1,15.10,15.10,-0.35,-0.01,C
`

const tiger = `成交时间,代码,名称,方向,成交数量,成交价格,成交金额,市场,币种,佣金
2026-01-08 10:12:14,AAPL,Apple,买入,10,190.00,1900.00,美股,USD,0.99
2026-01-09 14:54:14,AAPL,Apple,卖出,10,196.50,1965.00,美股,USD,0.99
2026-04-28 22:17:06,00700,腾讯,买入,100,320.00,32000.00,港股,HKD,5.00
`

const generic = `Ticker,Action,Qty,Price,Date
NVDA,Buy,20,178.00,08/04/2026 10:40:00
NVDA,Sell,20,190.00,08/05/2026 11:00:00
`

describe('multi-broker import', () => {
  it('parses IB Flex trades and skips ClosedLot / SubTotal', () => {
    const res = importFutu(ibFlex)
    expect(res.broker).toBe('ib')
    expect(detectKind(ibFlex)).toBe('fills')
    expect(res.fills.map((f) => f.symbol).sort()).toEqual(['AAPL', 'AAPL'])
    expect(res.fills[0].side).toBe('buy')
    expect(res.fills[1].side).toBe('sell')
    expect(res.fills[0].fees).toBeCloseTo(1.03, 2)
    expect(res.dropped.nonUs).toBeGreaterThan(0)
    expect(res.fills.every((f) => f.qty > 0)).toBe(true)
  })

  it('parses IB activity CSV with split date and signed qty', () => {
    const res = importFutu(ibPortal)
    expect(res.broker).toBe('ib')
    expect(res.fills).toHaveLength(2)
    expect(res.fills[0].symbol).toBe('F')
    expect(res.fills[0].side).toBe('buy')
    expect(res.fills[1].side).toBe('sell')
    expect(res.fills[0].fees).toBeCloseTo(0.35, 2)
  })

  it('parses Tiger Chinese fills and keeps US names', () => {
    const res = importFutu(tiger)
    expect(res.broker).toBe('tiger')
    expect(res.fills).toHaveLength(2)
    expect(res.fills[0].side).toBe('buy')
    expect(res.fills[1].side).toBe('sell')
    expect(res.fills[0].fees).toBeCloseTo(0.99, 2)
    expect(res.dropped.nonUs).toBe(1)
  })

  it('parses generic ticker/action/qty/price/date exports', () => {
    const res = importFutu(generic)
    expect(res.broker).toBe('generic')
    expect(res.fills).toHaveLength(2)
    expect(res.fills[0].symbol).toBe('NVDA')
    expect(res.fills[0].side).toBe('buy')
  })

  it('does not treat IB commission columns as order history', () => {
    expect(detectKind(ibFlex)).toBe('fills')
    expect(detectKind(ibPortal)).toBe('fills')
    expect(detectKind(tiger)).toBe('fills')
  })

  it('rejects files without trade columns', () => {
    expect(() => importFutu('foo,bar\n1,2\n')).toThrow(/无法识别/)
  })

  it('maps IB Date/Time with comma to a real timestamp', () => {
    const d = parseBrokerTime('2026-01-08, 10:12:14')
    expect(d.getTime()).toBeGreaterThan(0)
    expect(parseFills(ibFlex)[0].time.getTime()).toBe(d.getTime())
  })
})
