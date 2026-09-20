const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function nthWeekday(year: number, month0: number, weekday: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay()
  const first = 1 + ((weekday - firstDow + 7) % 7)
  return first + (n - 1) * 7
}

export function isUsDst(year: number, month0: number, day: number, hour: number): boolean {
  const startDay = nthWeekday(year, 2, 0, 2)
  const endDay = nthWeekday(year, 10, 0, 1)
  const start = Date.UTC(year, 2, startDay, 7)
  const end = Date.UTC(year, 10, endDay, 6)
  const utcGuess = Date.UTC(year, month0, day, hour + 4)
  return utcGuess >= start && utcGuess < end
}

function fromYmd(
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tzRaw?: string,
): Date {
  const month = month1 - 1
  const tz = (tzRaw || 'ET').toUpperCase()
  let offsetHours = 0
  if (tz === 'HKT' || tz === 'CST') offsetHours = 8
  else if (tz === 'JST') offsetHours = 9
  else if (tz === 'UTC' || tz === 'GMT') offsetHours = 0
  else if (tz === 'EST') offsetHours = -5
  else if (tz === 'EDT') offsetHours = -4
  else offsetHours = isUsDst(year, month, day, hour) ? -4 : -5
  return new Date(Date.UTC(year, month, day, hour, minute, second) - offsetHours * 3600 * 1000)
}

export function parseBrokerTime(raw: string): Date {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const isoTry = Date.parse(s)
    if (Number.isFinite(isoTry)) return new Date(isoTry)
  }

  const compact = s.match(/^(\d{8})(?:[;,\s]+(\d{4,6}))?(?:\s+([A-Z]{2,4}))?$/)
  if (compact) {
    const d = compact[1]
    const t = (compact[2] || '093000').padEnd(6, '0')
    return fromYmd(
      Number(d.slice(0, 4)),
      Number(d.slice(4, 6)),
      Number(d.slice(6, 8)),
      Number(t.slice(0, 2)),
      Number(t.slice(2, 4)),
      Number(t.slice(4, 6)),
      compact[3],
    )
  }

  const cn = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (cn) {
    return fromYmd(Number(cn[1]), Number(cn[2]), Number(cn[3]), Number(cn[4] || 0), Number(cn[5] || 0), Number(cn[6] || 0))
  }

  const ymd = s
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([A-Z]{2,4}))?/)
  if (ymd) {
    return fromYmd(
      Number(ymd[1]),
      Number(ymd[2]),
      Number(ymd[3]),
      Number(ymd[4] || 0),
      Number(ymd[5] || 0),
      Number(ymd[6] || 0),
      ymd[7],
    )
  }

  const slash = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([A-Z]{2,4}))?/,
  )
  if (slash) {
    let year = Number(slash[3])
    if (year < 100) year += 2000
    const a = Number(slash[1])
    const b = Number(slash[2])
    const month = a > 12 ? b : a
    const day = a > 12 ? a : b
    return fromYmd(year, month, day, Number(slash[4] || 0), Number(slash[5] || 0), Number(slash[6] || 0), slash[7])
  }

  const withTime = s.match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s+([A-Z]{2,4}))?$/,
  )
  const dateOnly = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})(?:\s+([A-Z]{2,4}))?$/)
  const m = withTime || (dateOnly
    ? [dateOnly[0], dateOnly[1], dateOnly[2], dateOnly[3], '0', '0', '0', dateOnly[4]]
    : null)
  if (!m) {
    const fallback = Date.parse(s)
    if (Number.isFinite(fallback)) return new Date(fallback)
    throw new Error(`无法解析时间: ${raw}`)
  }
  const month = MONTHS[m[1]]
  if (month == null) {
    const fallback = Date.parse(s)
    if (Number.isFinite(fallback)) return new Date(fallback)
    throw new Error(`无法解析时间: ${raw}`)
  }
  return fromYmd(Number(m[3]), month + 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6]), m[7])
}

export function etParts(date: Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

export function etDateKey(date: Date): string {
  const p = etParts(date)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function etClock(date: Date): number {
  const p = etParts(date)
  return p.hour + p.minute / 60 + p.second / 3600
}

export function parseIsoLike(raw: string): Date {
  if (raw.includes('T')) return new Date(raw)
  if (/^\d{4}-\d{2}-\d{2} /.test(raw)) return parseBrokerTime(toBrokerEt(raw))
  return new Date(raw)
}

function toBrokerEt(raw: string): string {
  const [d, t] = raw.split(' ')
  const [y, m, day] = d.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${day}, ${y} ${t || '09:30:00'} ET`
}

export function eachWeekday(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cur <= last) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600 * 1000)
}
