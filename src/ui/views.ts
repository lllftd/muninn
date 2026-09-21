export type Tab = 'what' | 'why' | 'how'

export const TABS: Array<{
  id: Tab
  label: string
  question: string
  view: string
}> = [
  { id: 'what', label: '是什么', question: '这段数据说什么、可信吗、总体怎么样', view: 'what' },
  { id: 'why', label: '为什么', question: '钱怎么亏的、是实力还是运气', view: 'why' },
  { id: 'how', label: '怎么办', question: '我能在哪改进、然后呢', view: 'how' },
]

/** 旧 view 名映射到新 tab，保证书签和分享链接不失效。 */
const VIEW_ALIAS: Record<string, Tab> = {
  review: 'what',
  trust: 'what',
  analysis: 'why',
  ledger: 'why',
  trades: 'why',
  riskbench: 'why',
  risk: 'what',
  quality: 'why',
  behavior: 'why',
  benchmark: 'what',
  bench: 'what',
  lab: 'how',
  space: 'how',
}

/** 旧一级页面对应锚点。 */
export const ANALYSIS_HASH_FROM_VIEW: Record<string, string> = {
  ledger: 'path',
  trades: 'sec-behavior',
  quality: 'mae',
  behavior: 'weekdays',
  risk: 'path',
  riskbench: 'path',
  benchmark: 'path',
  bench: 'path',
  space: 'space',
  lab: 'action',
}

export function tabFromView(raw: string | null): Tab {
  if (!raw) return 'what'
  const hit = TABS.find((t) => t.view === raw || t.id === raw)
  if (hit) return hit.id
  return VIEW_ALIAS[raw] ?? 'what'
}

export function viewOf(tab: Tab): string {
  return TABS.find((t) => t.id === tab)?.view ?? tab
}

export function neighbor(tab: Tab, dir: -1 | 1): Tab | null {
  const i = TABS.findIndex((t) => t.id === tab)
  return TABS[i + dir]?.id ?? null
}

export function hashFromView(raw: string | null): string {
  if (!raw) return ''
  if (typeof window !== 'undefined' && window.location.hash.length > 1) {
    return window.location.hash.slice(1)
  }
  return ANALYSIS_HASH_FROM_VIEW[raw] ?? ''
}

const HOW_ANCHORS = new Set([
  'space',
  'giveback',
  'stop-scan',
  'rule-replay',
  'opp-cost',
  'psm',
  'kelly',
  'ev-levers',
  'action',
  'fill-data',
])
const WHAT_ANCHORS = new Set(['path', 'equity', 'dd', 'cover', 'health', 'be', 'forest', 'pnl-swarm', 'trade-bars'])

export function tabForAnchor(anchor: string): Tab {
  if (HOW_ANCHORS.has(anchor)) return 'how'
  if (WHAT_ANCHORS.has(anchor)) return 'what'
  return 'why'
}
