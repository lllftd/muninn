import { fetchQuotePack } from '../../server/providers.ts'

export default async function handler(event) {
  const sp = event.url
    ? new URL(event.url).searchParams
    : new URLSearchParams(event.queryStringParameters || {})

  const symbols = (sp.get('symbols') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const start = sp.get('start') || '2019-01-01'
  const end = sp.get('end') || new Date().toISOString().slice(0, 10)

  let body = { bars: {}, splits: {}, meta: {} }
  if (symbols.length) {
    body = await fetchQuotePack(symbols, start, end)
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
