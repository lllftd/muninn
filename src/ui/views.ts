export type Tab = 'ledger' | 'trades' | 'riskbench' | 'trust'
export type TabTone = 'ok' | 'watch' | 'fail'

export const TABS: Array<{
  id: Tab
  label: string
  question: string
  view: string
}> = [
  { id: 'ledger', label: '核算', question: '赚没赚', view: 'ledger' },
  { id: 'trades', label: '交易与行为', question: '做了什么·好不好', view: 'trades' },
  { id: 'riskbench', label: '风险与基准', question: '承担了什么·值不值', view: 'risk' },
  { id: 'trust', label: '可信度', question: '能不能信', view: 'trust' },
]

// 旧 view 名(合并前的 6 个)映射到新 tab,保证旧链接不失效。
const VIEW_ALIAS: Record<string, Tab> = {
  quality: 'trades',
  behavior: 'trades',
  benchmark: 'riskbench',
  bench: 'riskbench',
  risk: 'riskbench',
}

export function tabFromView(raw: string | null): Tab {
  if (!raw) return 'ledger'
  const hit = TABS.find((t) => t.view === raw || t.id === raw)
  if (hit) return hit.id
  return VIEW_ALIAS[raw] ?? 'ledger'
}

export function viewOf(tab: Tab): string {
  return TABS.find((t) => t.id === tab)?.view ?? tab
}

export function neighbor(tab: Tab, dir: -1 | 1): Tab | null {
  const i = TABS.findIndex((t) => t.id === tab)
  return TABS[i + dir]?.id ?? null
}
