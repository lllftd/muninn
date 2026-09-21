import { money } from '../lib/format.ts'
import { archiveExperiment, constraintLabel, type ExperimentRecord } from '../lib/experiments.ts'
import type { CoverReport } from '../engine/cover.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import type { SpaceReport } from '../types.ts'
import { SpaceEvidence, SpaceRef } from './SpacePanel.tsx'
import { CapabilityMatrix } from './WhatPage.tsx'

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

function ExpRow(props: { row: ExperimentRecord; onArchive?: (id: string) => void; kicker?: string }) {
  const { row } = props
  const ev = row.lastEvaluation
  const k = row.constraint.kind === 'observe' ? (ev?.newN ?? 0) : (ev?.matchN ?? 0)
  return (
    <article className="panel">
      <div className="drawer-k">{props.kicker ?? (row.status === 'active' ? '进行中' : '已结案')}</div>
      <h3>{row.hypothesis}</h3>
      <p className="tiny">
        约束：{constraintLabel(row.constraint)} · 认领时 n={row.baselineN}、笔均{' '}
        {row.baselineExpectancy == null ? '—' : money(row.baselineExpectancy)}
      </p>
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

function ImproveRow(props: { item: CoverReport['improve'][number]; onClaim?: () => void; claimed: boolean }) {
  const { item } = props
  return (
    <li className="improve-row">
      <div>
        <b>{item.title}</b>
        {item.amount != null ? <span className="improve-amt">{money(item.amount)}</span> : null}
        <p className="tiny">{item.finding}</p>
        <p className="tiny">{item.action}</p>
      </div>
      {item.canClaim && props.onClaim ? (
        props.claimed ? (
          <span className="tiny">已认领</span>
        ) : (
          <button type="button" className="ghost sm" onClick={props.onClaim}>
            认领
          </button>
        )
      ) : null}
    </li>
  )
}

export function HowPage(props: {
  cover: CoverReport
  space: SpaceReport
  diagnoses: Diagnosis[]
  claimedIds: string[]
  active: ExperimentRecord[]
  archived: ExperimentRecord[]
  onClaim: (d: Diagnosis) => void
  onChange: () => void
  onOpenHealth: () => void
  onFillAccount: () => void
  accountLimited?: boolean
}) {
  const { cover } = props
  const main = cover.mainAction
  const mainActive = main ? props.active.find((e) => e.diagnosisId === main.id) : undefined
  const mainArchived = main ? props.archived.find((e) => e.diagnosisId === main.id) : undefined
  const otherActive = props.active.filter((e) => e.diagnosisId !== main?.id)
  const claimedMain = Boolean(main && props.claimedIds.includes(main.id))

  return (
    <div className="how-page print-section">
      <section id="space">
        <h2 className="review-sec">按修复价值</h2>
        <ul className="improve-list">
          {cover.improve.map((item) => {
            const d = item.diagnosisId ? props.diagnoses.find((x) => x.id === item.diagnosisId) : undefined
            return (
              <ImproveRow
                key={item.id}
                item={item}
                claimed={item.diagnosisId ? props.claimedIds.includes(item.diagnosisId) : false}
                onClaim={d?.canClaim ? () => props.onClaim(d) : undefined}
              />
            )
          })}
        </ul>
        {props.accountLimited ? (
          <p className="tiny conc-ptr">
            <button type="button" className="link" onClick={() => {
              const box = document.getElementById('how-ref')
              if (box instanceof HTMLDetailsElement) box.open = true
              document.getElementById('fill-data')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}>
              账户级基准比较缺数据，见数据补齐 ↓
            </button>
          </p>
        ) : null}
      </section>

      <section id="action">
        <h2 className="review-sec">然后呢</h2>
        {mainActive ? (
          <ExpRow row={mainActive} onArchive={props.onChange} kicker="本期推荐 · 进行中" />
        ) : mainArchived ? (
          <ExpRow row={mainArchived} kicker="本期推荐 · 已完成" />
        ) : main && claimedMain ? (
          <p className="tiny">已认领，下次导入后这里出进度。</p>
        ) : main && main.canClaim ? (
          <article className="panel review-hero">
            <div className="drawer-k">本期推荐</div>
            <h3>认领「{main.headline}」</h3>
            <p className="tiny">{main.next}</p>
            <button type="button" className="btn-primary" onClick={() => props.onClaim(main)}>
              认领实验 · {main.experiment?.targetN ?? 20} 笔
            </button>
          </article>
        ) : (
          <div className="how-empty">
            <p>认领一条修复价值上的实验，下次导入后这里会回答改了没有、好没好。</p>
          </div>
        )}

        {otherActive.length ? (
          <>
            <h3 className="review-sec">进行中</h3>
            {otherActive.map((row) => (
              <ExpRow key={row.id} row={row} onArchive={props.onChange} />
            ))}
          </>
        ) : null}

        {props.archived.filter((e) => e.id !== mainArchived?.id).length ? (
          <>
            <h3 className="review-sec">已完成</h3>
            {props.archived
              .filter((e) => e.id !== mainArchived?.id)
              .map((row) => (
                <ExpRow key={row.id} row={row} />
              ))}
          </>
        ) : null}
      </section>

      <details className="fold-block how-block" id="space-evidence">
        <summary>反事实证据 · 杠杆 / 硬止损 / 规则回放 / 机会成本</summary>
        <SpaceEvidence space={props.space} />
      </details>

      <details className="fold-block how-block" id="how-ref">
        <summary>参考 · Kelly / 方向混杂 / 数据补齐</summary>
        <SpaceRef space={props.space} />
        <article className="panel" id="fill-data">
          <h3>数据补齐</h3>
          <CapabilityMatrix gaps={cover.gaps} onFillAccount={props.onFillAccount} onGuide={props.onOpenHealth} />
        </article>
      </details>
    </div>
  )
}
