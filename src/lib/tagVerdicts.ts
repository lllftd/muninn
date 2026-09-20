export type TagVerdict = 'confirm' | 'deny'

const KEY = 'muninn.tagVerdicts.v1'

function readAll(): Record<string, TagVerdict> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, TagVerdict>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function keyOf(tripId: string, tag: string) {
  return `${tripId}:${tag}`
}

export function getTagVerdict(tripId: string, tag: string): TagVerdict | null {
  return readAll()[keyOf(tripId, tag)] ?? null
}

export function setTagVerdict(tripId: string, tag: string, verdict: TagVerdict | null) {
  const all = readAll()
  const k = keyOf(tripId, tag)
  if (verdict == null) delete all[k]
  else all[k] = verdict
  localStorage.setItem(KEY, JSON.stringify(all))
}
