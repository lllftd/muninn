import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleQuotes } from '../server/quote-fetcher'

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleQuotes(req, res)
}
