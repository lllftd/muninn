import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchQuotePack } from './providers.ts'

export { fetchQuotePack }
export type { ProxyBar } from './providers.ts'

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export async function handleQuotes(req: IncomingMessage, res: ServerResponse) {
  const raw = req.url || '/'
  const url = new URL(raw, 'http://127.0.0.1')
  const symbols = (url.searchParams.get('symbols') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const start = url.searchParams.get('start') || '2019-01-01'
  const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10)
  if (!symbols.length) {
    json(res, 200, { bars: {}, splits: {}, meta: {} })
    return
  }
  const pack = await fetchQuotePack(symbols, start, end)
  json(res, 200, pack)
}
