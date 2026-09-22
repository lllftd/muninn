import { fetchQuotePack } from '../server/providers.ts'

// 固定 Node 运行时（providers 依赖 process.env 读 Alpaca key），并钉在美东节点。
export const config = { runtime: 'nodejs', regions: ['iad1'], maxDuration: 60 }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const symbols = (url.searchParams.get('symbols') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const start = url.searchParams.get('start') || '2019-01-01'
      const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10)

      if (!symbols.length) return json({ bars: {}, splits: {}, meta: {} })

      const pack = await fetchQuotePack(symbols, start, end)
      const body: unknown =
        url.searchParams.get('debug') === '1'
          ? { ...pack, debug: { empty: symbols.filter((s) => !pack.bars[s]?.length) } }
          : pack
      return json(body)
    } catch (err) {
      return json(
        {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        500,
      )
    }
  },
}
