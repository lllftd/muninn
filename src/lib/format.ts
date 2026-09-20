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
  const abs = Math.abs(n)
  if (n !== 0 && abs < 5 / 10 ** (digits + 1)) {
    // 接近 0 但非 0：显示带符号的小数，避免同样的 $0 一会儿红一会儿绿
    return `${n > 0 ? '+' : '-'}$${abs.toFixed(2)}`
  }
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  if (n > 0) return `+$${s}`
  if (n < 0) return `-$${s}`
  return `$${s}`
}

export function moneyAbs(n: number, digits = 0): string {
  return `$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

export function moneyK(n: number): string {
  const abs = Math.abs(n)
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`
  if (abs >= 1e3) {
    const k = abs / 1e3
    return `${sign}$${Number.isInteger(k) || abs >= 1e5 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  if (abs === 0) return '$0'
  return `${sign}$${abs.toFixed(0)}`
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

export function coverageLabel(status: string, counted?: boolean): string {
  if (status === 'imported' && counted === false) return '已导入 · 未计入净收益'
  if (status === 'imported') return '已导入'
  if (status === 'not_provided') return '未提供'
  return '无法计算'
}
