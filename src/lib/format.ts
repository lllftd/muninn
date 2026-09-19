export function num(raw: string | number | undefined | null): number {
  if (typeof raw === 'number') return raw
  if (!raw) return 0
  const n = Number(String(raw).replace(/,/g, '').replace(/%/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

export function finiteNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return n > 0 ? '+∞' : '−∞'
  return n.toFixed(digits)
}

export function money(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return n > 0 ? '+∞' : '−∞'
  if (Math.abs(n) < 5 / 10 ** (digits + 1)) {
    return `$${Number(0).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}`
  }
  const abs = Math.abs(n)
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  if (n > 0) return `+$${s}`
  return `-$${s}`
}

export function moneyAbs(n: number, digits = 0): string {
  return `$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

export function pct(n: number, digits = 1): string {
  const s = `${Math.abs(n * 100).toFixed(digits)}%`
  if (n > 0) return `+${s}`
  if (n < 0) return `-${s}`
  return s
}

export function pctPlain(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`
}

export function ciText(
  ci: { lo: number; hi: number | null; unboundedHi?: boolean } | null,
  kind: 'pct' | 'money' | 'num' = 'num',
  digits = 1,
): string {
  if (!ci) return '—'
  const fmt = (v: number) => {
    if (!Number.isFinite(v)) return v > 0 ? '+∞' : '−∞'
    if (kind === 'pct') return pctPlain(v, digits)
    if (kind === 'money') return money(v, digits)
    return v.toFixed(digits)
  }
  const hi = ci.unboundedHi || ci.hi == null ? '不可估' : fmt(ci.hi)
  return `${fmt(ci.lo)}–${hi}`
}

export function signed(n: number, digits = 2): string {
  const s = Math.abs(n).toFixed(digits)
  if (n > 0) return `+${s}`
  if (n < 0) return `-${s}`
  return s
}

export function holdLabel(minutes: number): string {
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} 小时`
  return `${(minutes / (60 * 24)).toFixed(1)} 天`
}

export function clsPnl(n: number): string {
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return ''
}
