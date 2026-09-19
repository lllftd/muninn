import type { QuotePack } from '../types.ts'

export async function fetchQuotes(symbols: string[], start: string, end: string): Promise<QuotePack> {
  const uniq = [...new Set([...symbols, 'SPY', '^GSPC', '^VIX', '^IRX'])].filter(Boolean)
  const params = new URLSearchParams({
    symbols: uniq.join(','),
    start,
    end,
  })
  const res = await fetch(`/api/quotes?${params.toString()}`)
  if (!res.ok) throw new Error(`行情代理失败 ${res.status}`)
  const data = (await res.json()) as QuotePack
  return { bars: data.bars || {}, splits: data.splits || {} }
}
