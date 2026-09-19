import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleQuotes } from './quote-fetcher.ts'

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function onRequest(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const raw = req.url || '/'
  if (!raw.startsWith('/api/')) {
    next()
    return
  }
  const url = new URL(raw, 'http://127.0.0.1')
  if (url.pathname === '/api/quotes') {
    handleQuotes(req, res).catch((err: unknown) => {
      json(res, 500, { error: err instanceof Error ? err.message : 'quote failed' })
    })
    return
  }
  if (url.pathname === '/api/health') {
    json(res, 200, { ok: true, quote: 'yahoo', opend: false })
    return
  }
  next()
}

export function quoteProxyPlugin(): Plugin {
  return {
    name: 'muninn-quote-proxy',
    configureServer(server) {
      server.middlewares.use(onRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(onRequest)
    },
  }
}
