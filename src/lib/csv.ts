export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
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
    if (ch === ',') {
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

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? ''
    })
    return obj
  })
}

export function detectKind(text: string): 'fills' | 'orders' | 'cash' | 'unknown' {
  const head = text.slice(0, 400).toLowerCase()
  if (head.includes('fill qty') || head.includes('fill price') || head.includes('fill time')) return 'fills'
  if (head.includes('order qty') || head.includes('commission') || head.includes('filled@avg')) return 'orders'
  if (head.includes('deposit') || (head.includes('type') && head.includes('amount') && head.includes('time'))) {
    return 'cash'
  }
  return 'unknown'
}
