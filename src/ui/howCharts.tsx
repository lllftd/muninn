import { money, pctPlain } from '../lib/format.ts'
import { ColorScatter } from './charts.tsx'
import type { HowQueueRow } from '../engine/cover.ts'
import type { ExperimentEvaluation } from '../lib/experiments.ts'
import type { ReplayRule } from '../types.ts'
import {
  type LadderStep,
  type SampleComposition,
  type SampleSlice,
  queueEvidenceLevel,
  queueImpact,
} from './howViz.ts'

export function HowMetricCards(props: {
  theory: number | null
  verified: number
  shadowN: number
  targetN: number
  floated: number
  nClosed: number
  waiting: boolean
  pendingReplace?: boolean
  idle?: boolean
}) {
  const rate = props.nClosed ? pctPlain(props.floated / props.nClosed, 0) : '—'
  const cards = [
    {
      id: 'theory',
      k: '理论回吐上限',
      v: props.theory == null ? '—' : money(props.theory),
      s: '非可实现收益',
      tone: 'gold',
    },
    {
      id: 'verified',
      k: '已验证改善',
      v: money(props.verified),
      s: props.verified > 0 ? '已通过验证' : '尚无规则通过',
      tone: props.verified > 0 ? 'up' : 'mute',
    },
    {
      id: 'exp',
      k: '当前实验',
      v: props.pendingReplace ? '待修正' : props.idle ? '未开始' : `${props.shadowN}/${props.targetN}`,
      s: props.pendingReplace ? '日内实验待替换' : props.idle ? '尚未认领实验' : props.waiting ? '等待首笔有效配对' : '影子配对进行中',
      tone: 'blue',
    },
    {
      id: 'path',
      k: '路径有效样本',
      v: `${props.floated}/${props.nClosed || '—'}`,
      s: `浮盈回吐有效率 ${rate}`,
      tone: 'warn',
    },
  ]
  return (
    <div className="how-metrics">
      {cards.map((c) => (
        <article key={c.id} className={`how-metric how-metric-${c.tone}`}>
          <p className="how-metric-k">{c.k}</p>
          <p className="how-metric-v">{c.v}</p>
          <p className="tiny">{c.s}</p>
        </article>
      ))}
    </div>
  )
}

export function EvidenceLadder(props: { steps: LadderStep[] }) {
  return (
    <ol className="how-ladder">
      {props.steps.map((s, i) => (
        <li key={s.id} className={`how-ladder-step is-${s.state}`}>
          {i ? <span className="how-ladder-line" aria-hidden /> : null}
          <span className="how-ladder-dot" aria-hidden>
            {s.state === 'current' ? '◎' : s.state === 'verified' ? '●' : s.state === 'done' ? '●' : '○'}
          </span>
          <b>{s.title}</b>
          <em>{s.detail}</em>
        </li>
      ))}
    </ol>
  )
}

export function SampleShareBar(props: {
  comp: SampleComposition
  onPick: (slice: SampleSlice) => void
}) {
  const { comp } = props
  if (!comp.nClosed) return <p className="tiny">没有闭环交易。</p>
  const segs: Array<{ id: SampleSlice; n: number; pct: number; label: string }> = [
    { id: 'floated', n: comp.floated, pct: comp.floatedPct, label: '回吐分析有效' },
    { id: 'pathNoFloat', n: comp.pathNoFloat, pct: comp.pathNoFloatPct, label: '有路径但无浮盈' },
    { id: 'noPath', n: comp.noPath, pct: comp.noPathPct, label: '无法估计路径' },
  ]
  return (
    <div className="how-share">
      <p className="how-share-title">
        {comp.floated}/{comp.nClosed} 笔可用于浮盈回吐分析，{comp.noPath} 笔因同日或缺行情无法估计
      </p>
      <div className="how-share-track" role="img" aria-label="样本构成">
        {segs.map((s) =>
          s.n ? (
            <button
              key={s.id}
              type="button"
              className={`how-share-seg how-share-${s.id}`}
              style={{ flexGrow: s.n, flexBasis: 0 }}
              onClick={() => props.onPick(s.id)}
              title={`${s.label} ${s.n} 笔`}
            >
              {s.n}
            </button>
          ) : null,
        )}
      </div>
      <ul className="how-share-legend">
        {segs.map((s) => (
          <li key={s.id}>
            <button type="button" className="link" onClick={() => props.onPick(s.id)}>
              {s.label} {s.n} · {pctPlain(s.pct, 0)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SampleDots(props: { n: number; target: number }) {
  const target = Math.max(props.target, 1)
  return (
    <div className="how-dots" aria-label={`${props.n}/${target} 有效配对样本`}>
      {Array.from({ length: target }, (_, i) => (
        <i key={i} className={i < props.n ? 'on' : ''} />
      ))}
      <p className="tiny">
        {props.n}/{target} 有效配对样本
        {props.n === 0 ? '。等待首笔持仓至第 4 个交易日收盘的交易' : ''}
      </p>
    </div>
  )
}

export function SampleFunnel(props: { held: number; priced: number; closed: number; paired: number }) {
  const rows = [
    ['符合持仓条件', props.held],
    ['取得第 4 日收盘价', props.priced],
    ['完成实际退出', props.closed],
    ['有效配对样本', props.paired],
  ] as const
  return (
    <ol className="how-funnel">
      {rows.map(([k, v], i) => (
        <li key={k}>
          {i ? <span className="how-funnel-arrow" aria-hidden>↓</span> : null}
          <b>{k}</b> {v}
        </li>
      ))}
    </ol>
  )
}

export function PairDumbbells(props: {
  pairs: Array<{ id: string; symbol: string; actual: number; shadow: number }>
  onPick?: (id: string) => void
}) {
  if (!props.pairs.length) return null
  const shown = props.pairs.slice(0, 12)
  const nums = shown.flatMap((p) => [p.actual, p.shadow])
  let min = Math.min(...nums, 0)
  let max = Math.max(...nums, 0)
  const pad = (max - min) * 0.12 || 1
  min -= pad
  max += pad
  const x = (v: number) => `${((v - min) / (max - min)) * 100}%`
  return (
    <div className="how-pairs">
      {shown.map((p) => {
        const delta = p.shadow - p.actual
        const lo = Math.min(p.actual, p.shadow)
        const hi = Math.max(p.actual, p.shadow)
        return (
          <button key={p.id} type="button" className="how-pair" onClick={() => props.onPick?.(p.id)}>
            <span className="how-pair-k">{p.symbol}</span>
            <span className="how-pair-track">
              <i className="how-pair-line" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
              <i className="how-pair-dot a" style={{ left: x(p.actual) }} title={`实际 ${money(p.actual)}`} />
              <i className="how-pair-dot b" style={{ left: x(p.shadow) }} title={`第 4 日 ${money(p.shadow)}`} />
            </span>
            <span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '改善' : '截断'} {money(delta)}</span>
          </button>
        )
      })}
    </div>
  )
}

export function CumImprove(props: { pairs: Array<{ shadow: number; actual: number }> }) {
  if (props.pairs.length < 5) return null
  const series = props.pairs.reduce<Array<{ i: number; v: number }>>((acc, p, i) => {
    acc.push({ i: i + 1, v: (acc[i - 1]?.v ?? 0) + p.shadow - p.actual })
    return acc
  }, [])
  const vs = series.map((s) => s.v)
  const min = Math.min(0, ...vs)
  const max = Math.max(0, ...vs)
  const span = max - min || 1
  const y = (v: number) => (1 - (v - min) / span) * 40
  const x = (i: number) => ((i - 1) / Math.max(series.length - 1, 1)) * 100
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(s.i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ')
  const last = series.at(-1)?.v ?? 0
  return (
    <div className="how-cum">
      <p className="tiny">累计改善（满 5 笔后才画，判断是否由单笔驱动）</p>
      <svg viewBox="0 0 100 40" className="how-cum-svg" preserveAspectRatio="none">
        <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="how-cum-zero" />
        <path d={d} fill="none" stroke="var(--est)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="tiny">末笔累计 {money(last)}</p>
    </div>
  )
}

export function PairSummary(props: { ev: ExperimentEvaluation }) {
  const pairs = props.ev.pairs ?? []
  const better = pairs.filter((p) => p.shadow - p.actual > 0).length
  const worse = pairs.filter((p) => p.shadow - p.actual < 0).length
  const ci = props.ev.deltaCi
  return (
    <ul className="tiny plain-facts how-pair-sum">
      <li>平均改善 {props.ev.delta == null ? '—' : money(props.ev.delta)}</li>
      <li>
        改善 {better} / 恶化 {worse}
      </li>
      <li>被截断盈利 {props.ev.guards?.winTruncation == null ? '本样本无法算' : money(props.ev.guards.winTruncation)}</li>
      <li>
        80% 区间 {ci ? `${money(ci.lo)} ~ ${money(ci.hi)}` : '样本不足'}
        {ci ? '（探索性，非高置信）' : ''}
      </li>
      <li>费用已含在单笔盈亏中；机会成本本样本无法从影子回放单独拆出。</li>
    </ul>
  )
}

function kindWord(row: HowQueueRow) {
  if (row.status === 'verified') return '已验证改善'
  if (row.recoverableKind === 'theoretical') return '机械理论上限，斜纹不是进度'
  if (row.recoverableKind === 'mechanical') return '机械反事实上限，斜纹不是进度'
  if (row.historical != null) return '历史实际金额'
  return '影响金额未知'
}

export function QueueList(props: {
  rows: HowQueueRow[]
  claimedIds: string[]
  onClaim: (id: string) => void
}) {
  const maxAbs = Math.max(1, ...props.rows.map((r) => Math.abs(queueImpact(r).amount ?? 0)))
  return (
    <div className="how-q-list">
      {props.rows.map((r) => {
        const ev = queueEvidenceLevel(r)
        return (
          <article key={r.id} className={`how-q-card how-st-${r.status}`}>
            <div className="how-q-l1">
              <b>{r.title}</b>
              <QueueImpactBar row={r} maxAbs={maxAbs} />
              <span className={`how-chip how-chip-${r.status}`}>{statusWord(r.status)}</span>
            </div>
            <p className="tiny how-q-l2">
              {kindWord(r)}｜证据：{ev.note}｜下一步：{r.next}
            </p>
            {r.canClaim && r.diagnosisId && !props.claimedIds.includes(r.diagnosisId) ? (
              <button type="button" className="ghost sm" onClick={() => props.onClaim(r.diagnosisId!)}>
                开始影子实验
              </button>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function statusWord(s: HowQueueRow['status']) {
  if (s === 'verified') return '已验证'
  if (s === 'running') return '实验中'
  if (s === 'pending') return '待验证'
  if (s === 'blocked') return '数据受阻'
  if (s === 'rejected') return '暂不采用'
  return '参考'
}

export function QueueImpactBar(props: { row: HowQueueRow; maxAbs: number }) {
  const hit = queueImpact(props.row)
  const w = hit.amount == null || props.maxAbs <= 0 ? 0 : Math.min(100, (Math.abs(hit.amount) / props.maxAbs) * 100)
  return (
    <div className="how-q-impact">
      <span className="how-q-amt">{hit.amount == null ? '未知' : money(hit.amount)}</span>
      <span className="how-q-track">
        <i className={`how-q-fill how-q-${hit.kind}`} style={{ width: `${w}%` }} />
      </span>
    </div>
  )
}

export function EvidencePips(props: { row: HowQueueRow }) {
  const { filled, note } = queueEvidenceLevel(props.row)
  return (
    <div className="how-pips" title={note}>
      {Array.from({ length: 4 }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
      <span className="tiny">{note}</span>
    </div>
  )
}

export function RuleHeat(props: { rules: ReplayRule[] }) {
  return (
    <table className="how-heat">
      <thead>
        <tr>
          <th>规则</th>
          <th>净改善</th>
          <th>回放合计</th>
          <th>触及</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {props.rules.map((r) => {
          const tone = !r.computable ? 'na' : r.fdr && r.delta > 0 ? 'ok' : r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : 'na'
          return (
            <tr key={r.id} className={`how-heat-${tone}`}>
              <td>{r.label}</td>
              <td className="how-heat-num">{r.computable ? money(r.delta) : '—'}</td>
              <td className="how-heat-num">{r.computable ? money(r.pnl) : '无法计算'}</td>
              <td>{r.computable ? `${r.nTriggered}/${r.nEligible}` : '需要分时'}</td>
              <td>{!r.computable ? '证据不足' : r.fdr ? '通过验证' : '未通过'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function HowXyScatter(props: {
  points: Array<{ id: string; x: number; y: number; up: boolean; label?: string; size?: number }>
  vRef?: number
  vRefLabel?: string
  hRef?: number
  hRefLabel?: string
  xLabel: string
  yLabel: string
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
  logX?: boolean
  yMin?: number
  yMax?: number
  shadeFrom?: number
  shadeLabel?: string
  opacity?: number
  callouts?: Array<{ id: string; text: string }>
  onPick?: (id: string) => void
  height?: number
}) {
  return (
    <div className="how-xy" role="img" aria-label={`${props.yLabel} × ${props.xLabel}`}>
      <ColorScatter
        height={props.height ?? 220}
        xFormat={props.xFormat}
        yFormat={props.yFormat}
        logX={props.logX}
        vRef={props.vRef}
        vRefLabel={props.vRefLabel}
        hRef={props.hRef}
        hRefLabel={props.hRefLabel}
        yMin={props.yMin}
        yMax={props.yMax}
        shadeFrom={props.shadeFrom}
        shadeLabel={props.shadeLabel}
        opacity={props.opacity}
        callouts={props.callouts}
        onPick={props.onPick}
        points={props.points.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          r: p.size,
          label: p.label,
          color: p.up ? 'var(--est)' : 'var(--down)',
        }))}
      />
    </div>
  )
}

export function ScatterLegend() {
  return (
    <ul className="how-scatter-legend">
      <li>
        <i className="up" /> 最终盈利
      </li>
      <li>
        <i className="down" /> 最终亏损
      </li>
    </ul>
  )
}
