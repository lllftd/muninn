export type Tab = 'ledger' | 'quality' | 'bench' | 'risk' | 'behavior' | 'trust'
export type TabTone = 'ok' | 'watch' | 'fail'

export const TABS: Array<{
  id: Tab
  label: string
  question: string
  view: string
}> = [
  { id: 'ledger', label: '核算', question: '赚没赚', view: 'ledger' },
  { id: 'quality', label: '交易质量', question: '交易质量如何', view: 'quality' },
  { id: 'bench', label: '基准比较', question: '值不值得', view: 'benchmark' },
  { id: 'risk', label: '风险', question: '承担了什么', view: 'risk' },
  { id: 'behavior', label: '行为', question: '做了什么', view: 'behavior' },
  { id: 'trust', label: '可信度', question: '现在能不能信', view: 'trust' },
]

export function tabFromView(raw: string | null): Tab {
  const hit = TABS.find((t) => t.view === raw || t.id === raw)
  return hit?.id ?? 'ledger'
}

export function viewOf(tab: Tab): string {
  return TABS.find((t) => t.id === tab)?.view ?? tab
}

export function neighbor(tab: Tab, dir: -1 | 1): Tab | null {
  const i = TABS.findIndex((t) => t.id === tab)
  return TABS[i + dir]?.id ?? null
}
