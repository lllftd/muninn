import type { Bar, QuotePack, QuoteStatus } from '../types.ts'

const CHUNK = 6

function computeStatus(symbols: string[], bars: Record<string, Bar[]>): QuoteStatus {
  const required = [...new Set([...symbols, 'SPY'])].filter(Boolean)
  const covered = required.filter((s) => bars[s]?.length).length
  if (covered === 0) return 'unavailable'
  if (covered === required.length) return 'ok'
  return 'partial'
}

export async function fetchQuotes(symbols: string[], start: string, end: string): Promise<QuotePack> {
  const uniq = [...new Set([...symbols, 'SPY', '^GSPC', '^VIX', '^IRX'])].filter(Boolean)
  const bars: QuotePack['bars'] = {}
  const splits: QuotePack['splits'] = {}
  const meta: NonNullable<QuotePack['meta']> = {}
  // 分块请求：部署环境走兜底源时单块不能超时。
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const part = uniq.slice(i, i + CHUNK)
    const params = new URLSearchParams({
      symbols: part.join(','),
      start,
      end,
    })
    const res = await fetch(`/api/quotes?${params.toString()}`)
    if (!res.ok) throw new Error(`行情代理失败 ${res.status}`)
    const data = (await res.json()) as QuotePack
    Object.assign(bars, data.bars || {})
    Object.assign(splits, data.splits || {})
    Object.assign(meta, data.meta || {})
  }
  return { bars, splits, meta, status: computeStatus(symbols, bars) }
}
