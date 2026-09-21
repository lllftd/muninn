import type { Book, CoverageRow } from '../types.ts'

export type HealthTone = 'ok' | 'watch' | 'fail'

export type HealthTask = {
  id: string
  title: string
  detail: string
  unlocks: string
  done: boolean
  action?: 'account'
}

export type HealthReport = {
  tone: HealthTone
  label: string
  score: number
  imported: number
  total: number
  tasks: HealthTask[]
  coverage: CoverageRow[]
}

export function buildHealth(book: Book): HealthReport {
  const p = book.performance
  const coverage = p.coverage
  const imported = coverage.filter((c) => c.status === 'imported').length
  const total = Math.max(1, coverage.length)
  const frac = imported / total
  const mae = book.credibility.maeMfeComputableShare
  const feeImported = coverage.some((c) => c.item.includes('佣金') && c.status === 'imported')
  const navRow = coverage.find((c) => c.item === '期初净资产')
  const cashRow = coverage.find((c) => c.item === '外部入出金')
  const navDone = p.hasNav && p.initialCapital != null
  const cashDone = p.cashflowComplete
  const pathFail = Boolean(p.pathAudit && !p.pathAudit.ok)

  const tasks: HealthTask[] = [
    {
      id: 'nav',
      title: '填入期初净资产',
      detail: navRow?.note || '分析起点的账户净资产。不能从成交额反推。',
      unlocks: '夏普 / Calmar / XIRR / 账户回撤 / 相对基准',
      done: navDone,
      action: 'account',
    },
    {
      id: 'cash',
      title: '确认外部入出金',
      detail: cashRow?.note || '上传出入金，或确认这段期间没有外部入出金。',
      unlocks: 'XIRR（资金加权）',
      done: cashDone,
      action: 'account',
    },
    {
      id: 'fee',
      title: '费用匹配到订单',
      detail: feeImported ? '佣金已从订单历史计入。' : '补充 Filled 订单费用，缺的不当成 0。',
      unlocks: '费用后净盈亏更接近真实',
      done: feeImported,
    },
    {
      id: 'mae',
      title: '日线路程覆盖 MAE / MFE',
      detail: `当前可计算份额 ${Math.round(mae * 100)}%。同日单和缺行情的不估。`,
      unlocks: '捕获率 / 回吐 / 日线估算退出质量',
      done: mae >= 0.7,
    },
    {
      id: 'scope',
      title: '分析窗口等于该账户全部资产',
      detail: p.equitySubsetOnly ? '当前文件只含美股正股，账户级收益率不可用。' : '未标记为正股子集。',
      unlocks: '账户 TWR 与基准对比',
      done: !p.equitySubsetOnly && p.pathKind === 'account',
    },
  ]

  let tone: HealthTone = 'ok'
  if (pathFail) tone = 'fail'
  else if (!navDone || !cashDone || mae < 0.7 || !feeImported || p.equitySubsetOnly || frac < 0.7) tone = 'watch'

  const score = Math.max(
    0,
    Math.min(
      1,
      frac * 0.45 + (navDone ? 0.2 : 0) + (cashDone ? 0.1 : 0) + Math.min(mae, 1) * 0.15 + (feeImported ? 0.1 : 0),
    ),
  )

  const label = `覆盖 ${Math.round(score * 100)}%`

  return { tone, label, score, imported, total, tasks, coverage }
}
