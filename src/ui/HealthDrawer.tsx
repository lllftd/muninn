import { coverageLabel, money, pctPlain } from '../lib/format.ts'
import type { Book, CoverageRow } from '../types.ts'
import type { HealthReport } from '../engine/health.ts'

function toneOf(row: CoverageRow): 'ok' | 'watch' | 'fail' | 'na' {
  if (row.status === 'imported') return 'ok'
  if (row.status === 'not_computable') return 'fail'
  return 'watch'
}

function handling(row: CoverageRow): string {
  if (row.status === 'imported') return row.countedInPnl ? '已计入' : '已导入 · 未计入'
  if (row.status === 'not_computable') return '无法计算'
  if (row.item === '期初净资产') return '账户收益率不可计算'
  if (row.item === '外部入出金') return 'XIRR 不可计算'
  return '未计入'
}

export function HealthDrawer(props: {
  book: Book
  health: HealthReport
  onClose: () => void
  onAccount: () => void
}) {
  const { book, health } = props
  const p = book.performance
  const pending = health.tasks.filter((t) => !t.done)
  return (
    <aside className="drawer wide-drawer health-drawer">
      <button type="button" className="drawer-close" onClick={props.onClose}>
        关闭
      </button>
      <div className="drawer-k">数据健康</div>
      <h3>
        {health.label}
        <span className={`health-dot ${health.tone}`} />
      </h3>
      <p className="tiny">
        覆盖 {health.imported}/{health.total} · MAE/MFE {pctPlain(book.credibility.maeMfeComputableShare, 0)} · 路径{' '}
        {p.pathKind === 'account' ? '账户级' : '正股子账本'}
      </p>

      <h4 className="tiny">补全任务</h4>
      <ul className="health-tasks">
        {health.tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <div>
              <strong>{t.done ? '已解锁' : '待补'} · {t.title}</strong>
              <p className="tiny">{t.detail}</p>
              <p className="tiny">解锁：{t.unlocks}</p>
            </div>
            {!t.done && t.action === 'account' ? (
              <button type="button" className="ghost sm" onClick={props.onAccount}>
                去填写
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {pending.length === 0 ? <p className="tiny">没有待补项。覆盖仍按行披露，不会把缺失当成 0。</p> : null}

      <h4 className="tiny">对账与完整性</h4>
      <div className="kv-grid">
        <span>FIFO 已实现</span>
        <b>{money(p.realizedPnl)}</b>
        <span>未实现</span>
        <b>{p.unrealizedPnl == null ? '—' : money(p.unrealizedPnl)}</b>
        <span>对账差额</span>
        <b>{money(p.reconDifference, 2)}</b>
        <span>排除行</span>
        <b>{book.excludedRows.length}</b>
        <span>费用拖累</span>
        <b>{money(p.feeDrag)}</b>
        <span>口径版本</span>
        <b>{book.credibility.metricVersion}</b>
      </div>
      <p className="tiny">{book.credibility.bannerText}</p>
      <p className="tiny">{book.credibility.minSampleNote}</p>

      <table className="grid trips">
        <thead>
          <tr>
            <th>项目</th>
            <th>状态</th>
            <th>当前处理</th>
          </tr>
        </thead>
        <tbody>
          {health.coverage.map((row) => (
            <tr key={row.item}>
              <td>
                {row.item}
                <div className="tiny">{row.note}</div>
              </td>
              <td>
                <span className={`vchip ${toneOf(row)}`}>{coverageLabel(row.status, row.countedInPnl)}</span>
              </td>
              <td>{handling(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
}

export function HealthBadge(props: { health: HealthReport; onClick: () => void }) {
  const { health } = props
  const strong = health.score < 0.4 && health.tone !== 'ok'
  return (
    <button
      type="button"
      className={`health-badge ${health.tone}${strong ? ' warn-strong' : ''}`}
      onClick={props.onClick}
      title="打开补全任务"
    >
      <span className={`health-dot ${health.tone}`} />
      {health.label}
    </button>
  )
}
