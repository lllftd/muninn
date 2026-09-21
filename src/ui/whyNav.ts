import type { Diagnosis } from '../engine/diagnose.ts'
import type { HealthReport } from '../engine/health.ts'
import type { GroupRow } from '../types.ts'

export type WhyRole = 'core' | 'candidate' | 'explore' | 'quality' | 'ledger'

export type WhyChapterMeta = {
  id: string
  label: string
  status: string
  role: WhyRole
}

export const EXPLORE_BANNER = '探索性观察｜当前样本不足，不纳入主要归因'

const STRUCT_IDS = new Set(['structure-max-win', 'risk-concentrate', 'payoff-highlight'])
const GIVEBACK_IDS = new Set(['space-giveback', 'execution-capture'])
const LUCK_IDS = new Set(['luck-loss-mass', 'luck-lucky', 'luck-unlucky'])

export function structDx(items: Diagnosis[]) {
  return items.find((d) => STRUCT_IDS.has(d.id))
}

export function givebackDx(items: Diagnosis[]) {
  return items.find((d) => GIVEBACK_IDS.has(d.id))
}

export function sideDx(items: Diagnosis[]) {
  return items.find((d) => d.kind === 'side')
}

export function weekdayDx(items: Diagnosis[]) {
  return items.find((d) => d.kind === 'time' && d.id.startsWith('time-wd-'))
}

export function holdDx(items: Diagnosis[]) {
  return items.find((d) => d.kind === 'time' && d.id.startsWith('time-hold-')) ?? items.find((d) => d.kind === 'frequency')
}

export function luckDx(items: Diagnosis[]) {
  return items.find((d) => LUCK_IDS.has(d.id)) ?? items.find((d) => d.kind === 'luck')
}

export function trendDx(items: Diagnosis[]) {
  return items.find((d) => d.kind === 'trend')
}

function groupN(rows: GroupRow[] | undefined) {
  if (!rows?.length) return 0
  return Math.max(...rows.map((r) => r.n), 0)
}

function confWord(c: 'low' | 'mid' | 'high') {
  return c === 'high' ? '高' : c === 'mid' ? '中' : '低'
}

function fromDx(d: Diagnosis | undefined, n: number, prefer: WhyRole): { status: string; role: WhyRole } {
  if (prefer === 'quality') return { status: '存在异常', role: 'quality' }
  if (prefer === 'ledger') return { status: '查账', role: 'ledger' }
  if (!d) {
    if (n > 0 && n < 10) return { status: '事实低｜归因低', role: 'explore' }
    if (n > 0 && n < 30) return { status: '事实中｜归因低', role: 'explore' }
    return { status: '可查看', role: prefer }
  }
  const explore = d.section === 'observe' || d.extrapolationConfidence === 'low' || d.n < 10
  const attr: 'low' | 'mid' | 'high' = explore ? 'low' : d.extrapolationConfidence
  const status = `事实${confWord(d.factConfidence)}｜归因${confWord(attr)}`
  if (explore) return { status, role: d.n < 10 ? 'explore' : 'explore' }
  if (d.factConfidence === 'high' && d.tone === 'problem' && attr !== 'low') {
    return { status, role: attr === 'high' ? 'core' : 'candidate' }
  }
  if (d.factConfidence === 'high' && attr === 'high') return { status, role: 'core' }
  if (attr === 'mid') return { status, role: 'candidate' }
  return { status, role: 'candidate' }
}

export function buildWhyChapters(args: {
  diagnoses: Diagnosis[]
  health: HealthReport
  closedN: number
  sides?: GroupRow[]
  weekdays?: GroupRow[]
  holds?: GroupRow[]
  sessionRelevant: boolean
  hasCross: boolean
  hasMc: boolean
}): WhyChapterMeta[] {
  const d = args.diagnoses
  const out: WhyChapterMeta[] = []
  const push = (id: string, label: string, st: { status: string; role: WhyRole }) => {
    out.push({ id, label, ...st })
  }

  push('why-structure', '盈亏结构', fromDx(structDx(d), args.closedN, 'core'))
  if (givebackDx(d) || args.closedN) {
    push('why-giveback', '持有与退出', fromDx(givebackDx(d), givebackDx(d)?.n ?? args.closedN, 'candidate'))
  }
  push('why-symbols', '标的贡献', fromDx(structDx(d), args.closedN, 'core'))
  if (args.sides?.some((r) => r.n > 0)) {
    push('why-sides', '多空方向', fromDx(sideDx(d), groupN(args.sides), 'explore'))
  }
  if (args.weekdays?.some((r) => r.n > 0)) {
    push('why-weekdays', '星期表现', fromDx(weekdayDx(d), groupN(args.weekdays), 'explore'))
  }
  if (args.holds?.some((r) => r.n > 0) || holdDx(d)) {
    push('why-freq', '持仓与频率', fromDx(holdDx(d), groupN(args.holds), 'candidate'))
  }
  push('why-behavior', '其他行为', {
    status: args.sessionRelevant ? '事实中｜归因低' : '事实低｜归因低',
    role: 'explore',
  })
  if (args.hasMc || luckDx(d) || trendDx(d)) {
    push('why-luck', '实力还是运气', { status: '路径结论高｜策略归因低', role: 'candidate' })
  }
  if (args.hasCross) push('why-cross', '交叉归因', { status: '事实低｜归因低', role: 'explore' })
  push(
    'why-quality',
    '数据质量',
    args.health.tone === 'ok' ? { status: '可查看', role: 'quality' } : { status: '存在异常', role: 'quality' },
  )
  if (args.closedN) push('why-trips', '逐笔明细', { status: '查账', role: 'ledger' })
  return out
}
