export type ProPrefs = {
  minN: number
  minGroupN: number
  concentration: number
}

export const DEFAULT_PRO_PREFS: ProPrefs = {
  minN: 15,
  minGroupN: 10,
  concentration: 0.4,
}

const KEY = 'muninn.proPrefs.v1'

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

export function loadProPrefs(): ProPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PRO_PREFS }
    const parsed = JSON.parse(raw) as Partial<ProPrefs>
    return {
      minN: clamp(Number(parsed.minN ?? DEFAULT_PRO_PREFS.minN), 5, 80),
      minGroupN: clamp(Number(parsed.minGroupN ?? DEFAULT_PRO_PREFS.minGroupN), 5, 40),
      concentration: clamp(Number(parsed.concentration ?? DEFAULT_PRO_PREFS.concentration), 0.15, 0.9),
    }
  } catch {
    return { ...DEFAULT_PRO_PREFS }
  }
}

export function saveProPrefs(prefs: ProPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}
