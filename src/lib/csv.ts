import { headerFieldScore } from '../engine/columns.ts'

function detectDelim(text: string): string {
  const line = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) || ''
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 }
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch] += 1
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best && best[1] > 0 ? best[0] : ','
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  const delim = detectDelim(src)
  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === delim) {
      row.push(cell)
      cell = ''
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    cell += ch
    i += 1
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

export function findHeaderIndex(rows: string[][]): number {
  let best = 0
  let bestScore = -1
  const limit = Math.min(rows.length, 40)
  for (let i = 0; i < limit; i++) {
    const score = headerFieldScore(rows[i])
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return bestScore >= 3 ? best : 0
}

export function csvHeaders(text: string): string[] {
  const rows = parseCsv(text)
  if (!rows.length) return []
  return rows[findHeaderIndex(rows)].map((h) => h.trim())
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  if (!rows.length) return []
  const hi = findHeaderIndex(rows)
  const headers = rows[hi].map((h) => h.trim())
  return rows.slice(hi + 1).map((cols) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? ''
    })
    return obj
  })
}

export function detectKind(text: string): 'fills' | 'orders' | 'cash' | 'unknown' {
  const head = text.slice(0, 1200).toLowerCase()
  if (
    head.includes('fill qty') ||
    head.includes('fill price') ||
    head.includes('fill time') ||
    head.includes('成交数量') ||
    head.includes('成交时间') ||
    head.includes('t. price') ||
    head.includes('t price') ||
    head.includes('date/time') ||
    head.includes('asset category') ||
    head.includes('asset class') ||
    head.includes('data discriminator')
  ) {
    return 'fills'
  }
  if (head.includes('filled@avg') || head.includes('order qty') || head.includes('订单数量')) return 'orders'
  if (head.includes('deposit') || (head.includes('type') && head.includes('amount') && head.includes('time'))) {
    return 'cash'
  }
  if (head.includes('symbol') && (head.includes('quantity') || head.includes('qty')) && head.includes('price')) {
    return 'fills'
  }
  return 'unknown'
}
