import { money } from '../lib/format.ts'
import { archiveExperiment, constraintLabel, type ExperimentRecord } from '../lib/experiments.ts'

function Progress(props: { k: number; n: number }) {
  const pct = props.n <= 0 ? 0 : Math.min(100, (props.k / props.n) * 100)
  return (
    <div>
      <div className="edge-track">
        <div className="edge-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="tiny">
        {props.k}/{props.n} 笔
      </p>
    </div>
  )
}

function Row(props: { row: ExperimentRecord; onArchive?: (id: string) => void }) {
  const { row } = props
  const ev = row.lastEvaluation
  const k = row.constraint.kind === 'observe' ? (ev?.newN ?? 0) : (ev?.matchN ?? 0)
  return (
    <article className="panel">
      <div className="drawer-k">{row.status === 'active' ? '进行中' : '已结案'}</div>
      <h3>{row.hypothesis}</h3>
      <p className="tiny">约束：{constraintLabel(row.constraint)} · 认领时 n={row.baselineN}、笔均 {row.baselineExpectancy == null ? '—' : money(row.baselineExpectancy)}</p>
      {row.status === 'active' ? <Progress k={k} n={row.targetN} /> : null}
      {ev ? (
        <ul className="tiny plain-facts">
          <li>改了没有：{ev.changedShare == null ? '还没有新的笔' : `符合约束 ${ev.matchN}/${ev.newN}`}</li>
          <li>
            好没好：
            {ev.verdict === 'insufficient'
              ? '样本不够，无法判断'
              : ev.verdict === 'improved'
                ? '新样本笔均高于基线'
                : ev.verdict === 'worse'
                  ? '新样本笔均低于基线'
                  : '和新基线差不多'}
          </li>
          <li>{ev.note}</li>
        </ul>
      ) : null}
      {row.status === 'active' && props.onArchive ? (
        <button
          type="button"
          className="ghost sm"
          onClick={() => {
            archiveExperiment(row.id)
            props.onArchive?.(row.id)
          }}
        >
          {k >= row.targetN ? '结案归档' : '提前结束'}
        </button>
      ) : null}
    </article>
  )
}

export function LabPage(props: {
  active: ExperimentRecord[]
  archived: ExperimentRecord[]
  onChange: () => void
}) {
  return (
    <div className="lab-page">
      <p className="muted">实验只验证假设：改了没有、好没好。不会下达禁令。</p>
      <h3 className="review-sec">进行中</h3>
      {props.active.length ? (
        props.active.map((row) => <Row key={row.id} row={row} onArchive={props.onChange} />)
      ) : (
        <ol className="lab-steps tiny">
          <li>在复盘卡片上认领一条有行为变量的诊断。</li>
          <li>按约束正常交易，不要为了实验去硬做。</li>
          <li>下次导入后，这里自动回答「改了没有、好没好」。</li>
        </ol>
      )}
      <h3 className="review-sec">历史</h3>
      {props.archived.length ? (
        props.archived.map((row) => <Row key={row.id} row={row} />)
      ) : (
        <p className="tiny">结案后会出现在这里。</p>
      )}
    </div>
  )
}
