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

export function parseBrokerTime(raw: string): Date {
  const s = raw.trim()
  const isoTry = Date.parse(s)
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(isoTry)) return new Date(isoTry)

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
  const day = Number(m[2])
  const year = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])
  const tz = (m[7] || 'ET').toUpperCase()
  let offsetHours = 0
  if (tz === 'HKT' || tz === 'CST') offsetHours = 8
  else if (tz === 'JST') offsetHours = 9
  else if (tz === 'UTC' || tz === 'GMT') offsetHours = 0
  else if (tz === 'EST') offsetHours = -5
  else if (tz === 'EDT') offsetHours = -4
  else offsetHours = isUsDst(year, month, day, hour) ? -4 : -5
  const utcMs = Date.UTC(year, month, day, hour, minute, second) - offsetHours * 3600 * 1000
  return new Date(utcMs)
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
