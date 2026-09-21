import { ExperimentCard } from './ExperimentCard.tsx'
import type { ExperimentRecord } from '../lib/experiments.ts'

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
        props.active.map((row) => <ExperimentCard key={row.id} row={row} onChange={props.onChange} />)
      ) : (
        <ol className="lab-steps tiny">
          <li>在「怎么办」认领一条有行为变量的诊断。</li>
          <li>影子实验不要求改真实退出。</li>
          <li>下次导入后自动更新对照。</li>
        </ol>
      )}
      <h3 className="review-sec">历史</h3>
      {props.archived.length ? (
        props.archived.map((row) => <ExperimentCard key={row.id} row={row} kicker="已结案" />)
      ) : (
        <p className="tiny">结案后会出现在这里。</p>
      )}
    </div>
  )
}
