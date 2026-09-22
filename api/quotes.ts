import { fetchQuotePack } from '../server/providers.ts'

// 固定在美东（离 Alpaca/Yahoo 最近、风控最松的节点）。
export const config = { regions: ['iad1'], maxDuration: 60 }

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const symbols = (url.searchParams.get('symbols') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const start = url.searchParams.get('start') || '2019-01-01'
    const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10)

    let body: unknown = { bars: {}, splits: {}, meta: {} }
    if (symbols.length) {
      const pack = await fetchQuotePack(symbols, start, end)
      body = pack
      if (url.searchParams.get('debug') === '1') {
        body = { ...pack, debug: { empty: symbols.filter((s) => !pack.bars[s]?.length), meta: pack.meta } }
      }
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  },
}
