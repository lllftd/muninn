import { money, pctPlain } from '../lib/format.ts'
import {
  archiveExperiment,
  DAY4_SHADOW_RULE,
  DAY4_SHADOW_TITLE,
  isDay4Shadow,
  isMisalignedHoldExperiment,
  realignToDay4Shadow,
  type ExperimentRecord,
} from '../lib/experiments.ts'
import { CumImprove, PairDumbbells, PairSummary, SampleDots, SampleFunnel } from './howCharts.tsx'
import { funnelOf } from './howViz.ts'

export function ExperimentCard(props: {
  row: ExperimentRecord
  kicker?: string
  diagnosisId?: string
  onChange?: () => void
  onOpenTrip?: (id: string) => void
  compact?: boolean
}) {
  const { row } = props
  const ev = row.lastEvaluation
  const aligned = isDay4Shadow(row.constraint)
  const misaligned = isMisalignedHoldExperiment(row.constraint)
  const shadowN = aligned ? (ev?.shadowN ?? 0) : 0
  const targetN = row.targetN || 20
  const zeroSample = (aligned ? shadowN : ev?.matchN ?? ev?.newN ?? 0) === 0
  const started = new Date(row.createdAt)
  const days = Math.max(0, Math.round((Date.now() - started.getTime()) / 86400000))

  const notify = () => props.onChange?.()

  const archive = (kind: 'cancel' | 'early' | 'complete') => {
    if (!props.onChange) return
    if (kind === 'early') {
      const reason = window.prompt('提前结束原因（必填）')
      if (!reason || !reason.trim()) return
      archiveExperiment(row.id, { kind, reason: reason.trim() })
    } else {
      archiveExperiment(row.id, { kind })
    }
    notify()
  }

  const realign = () => {
    if (!props.onChange) return
    realignToDay4Shadow(row, props.diagnosisId)
    notify()
  }

  const design = (
    <details className="fold-block">
      <summary>查看完整实验设计</summary>
      <dl className="exp-dl">
        <dt>明确规则</dt>
        <dd>{DAY4_SHADOW_RULE}</dd>
        <dt>适用范围</dt>
        <dd>
          有日线路径、且持仓至第 4 个交易日收盘仍未平仓的新闭环才计入有效配对。不含同日或缺行情交易。美股日内交易受 PDT
          约束，请先确认账户资格；这不是让你改成日内策略。
        </dd>
        <dt>对照方式</dt>
        <dd>同一笔交易的影子结果与实际结果配对比较。</dd>
        <dt>主指标</dt>
        <dd>
          模拟第 4 日退出盈亏 − 实际最终盈亏。差值大于 0，表示提前退出更好；小于 0，表示提前退出损失了后续收益。
          {aligned && ev?.delta != null ? ` 当前 ${money(ev.delta)}` : ''}
        </dd>
        <dt>护栏</dt>
        <dd>
          {aligned && ev?.guards ? (
            <ul className="tiny plain-facts">
              <li>
                胜率 实际 {ev.guards.winRateActual == null ? '本样本无法算' : pctPlain(ev.guards.winRateActual, 0)} → 影子{' '}
                {ev.guards.winRateShadow == null ? '—' : pctPlain(ev.guards.winRateShadow, 0)}
              </li>
              <li>
                平均盈利 实际 {ev.guards.avgWinActual == null ? '本样本无法算' : money(ev.guards.avgWinActual)} → 影子{' '}
                {ev.guards.avgWinShadow == null ? '—' : money(ev.guards.avgWinShadow)}
              </li>
              <li>
                最大单笔亏损 实际 {ev.guards.maxLossActual == null ? '本样本无法算' : money(ev.guards.maxLossActual)} → 影子{' '}
                {ev.guards.maxLossShadow == null ? '—' : money(ev.guards.maxLossShadow)}
              </li>
              <li>
                盈利截断合计 {ev.guards.winTruncation == null ? '本样本无法算' : money(ev.guards.winTruncation)}
                。提前退出导致的盈利截断金额不能过大。
              </li>
              <li>交易费用 / 机会成本：本样本无法从影子回放单独拆出。</li>
            </ul>
          ) : (
            '本样本无法算。提前退出导致的盈利截断金额不能过大。'
          )}
        </dd>
        <dt>通过标准</dt>
        <dd>
          至少 {targetN} 笔有效配对样本，平均改善为正，且区间不显示明显负效应。若使用 80% CI，仅作为探索性通过，不等同于高置信验证。
        </dd>
        <dt>停止标准</dt>
        <dd>连续明显劣于实际管理；路径可计算占比（执行率）低于 80%；盈利截断过大；或你选择提前结束并填写原因。</dd>
      </dl>
      <p className="tiny">
        开始 {row.createdAt.slice(0, 10)} · 已运行 {days} 天
        {aligned && ev?.note ? ` · ${ev.note}` : ''}
      </p>
    </details>
  )

  if (misaligned && row.status === 'active') {
    return (
      <article className="panel exp-card exp-replace">
        <div className="drawer-k">{props.kicker ?? '当前生效｜待替换'}</div>
        <h3>日内平仓实验｜待替换</h3>
        <p className="tiny">与「持仓 ≥5 日亏损」的历史发现不一致，尚未产生有效样本。</p>
        <div className="exp-suggest">
          <p className="tiny exp-suggest-k">建议修正为</p>
          <h3>{DAY4_SHADOW_TITLE}</h3>
          <p className="tiny">{DAY4_SHADOW_RULE}</p>
          <dl className="exp-dl exp-dl-console">
            <dt>预计样本</dt>
            <dd>0/{targetN}</dd>
            <dt>主指标</dt>
            <dd>模拟第 4 日退出盈亏 − 实际最终盈亏</dd>
            <dt>通过条件</dt>
            <dd>平均改善为正，且未明显截断盈利</dd>
          </dl>
        </div>
        {props.onChange ? (
          <div className="exp-actions">
            <button type="button" className="btn-primary" onClick={realign}>
              修正并继续实验
            </button>
            <button type="button" className="ghost sm" onClick={() => archive('cancel')}>
              取消实验
            </button>
          </div>
        ) : null}
        {design}
      </article>
    )
  }

  const kicker =
    props.kicker ??
    (row.status === 'archived' ? (row.closeKind === 'cancel' ? '已取消' : '已结案') : null)

  return (
    <article className="panel exp-card">
      {kicker ? <div className="drawer-k">{kicker}</div> : null}
      <h3>{DAY4_SHADOW_TITLE}</h3>
      {row.status === 'archived' && row.closeReason ? <p className="tiny">已取消：{row.closeReason}</p> : null}

      {row.status === 'active' ? (
        <>
          <p className="tiny">
            状态：{shadowN === 0 ? '等待首笔符合条件的交易' : `已有 ${shadowN} 笔有效配对`}
          </p>
          <SampleDots n={shadowN} target={targetN} />
          <SampleFunnel {...funnelOf(ev)} />
          {ev && shadowN > 0 ? <PairSummary ev={ev} /> : null}
          {ev?.pairs?.length ? <PairDumbbells pairs={ev.pairs} onPick={props.onOpenTrip} /> : null}
          {ev?.pairs ? <CumImprove pairs={ev.pairs} /> : null}
        </>
      ) : null}

      {row.status === 'active' && props.onChange ? (
        <div className="exp-actions">
          <button
            type="button"
            className="ghost sm"
            onClick={() => archive(shadowN >= targetN && aligned ? 'complete' : zeroSample ? 'cancel' : 'early')}
          >
            {shadowN >= targetN && aligned ? '结案归档' : '取消实验'}
          </button>
        </div>
      ) : null}

      {design}
    </article>
  )
}
