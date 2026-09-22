import { money, pctPlain } from '../lib/format.ts'
import { ColorScatter } from './charts.tsx'
import type { HowQueueRow } from '../engine/cover.ts'
import type { ExperimentEvaluation } from '../lib/experiments.ts'
import type { ReplayRule } from '../types.ts'
import { type SampleComposition, type SampleSlice, experimentResult, queueImpact } from './howViz.ts'

export function HowStatusBar(props: { verified: number; activeN: number; pendingN: number }) {
  const items: Array<{ k: string; v: string }> = [
    { k: '已验证改善', v: money(props.verified) },
    { k: '实验中', v: String(props.activeN) },
    { k: '待验证', v: String(props.pendingN) },
  ]
  return (
    <div className="how-status">
      {items.map((it) => (
        <span key={it.k} className="how-status-item">
          <b>{it.k}</b>
          <em>{it.v}</em>
        </span>
      ))}
    </div>
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
  const r = experimentResult(props.ev)
  const ci = props.ev.deltaCi
  return (
    <ul className="tiny plain-facts how-pair-sum">
      <li>
        帮助 {r.better} 笔｜伤害 {r.worse} 笔{r.neutral ? `｜无影响 ${r.neutral} 笔` : ''}
      </li>
      <li>中位改善 {r.medianDelta == null ? '—' : money(r.medianDelta)}</li>
      <li>累计改善 {money(r.total)}</li>
      <li>最大单笔伤害 {r.maxHarm == null ? '—' : money(r.maxHarm)}</li>
      <li>平均改善 {props.ev.delta == null ? '—' : money(props.ev.delta)}</li>
      <li>被截断盈利 {props.ev.guards?.winTruncation == null ? '本样本无法算' : money(props.ev.guards.winTruncation)}</li>
      <li>
        80% 区间 {ci ? `${money(ci.lo)} ~ ${money(ci.hi)}` : '样本不足'}
        {ci ? '（探索性，非高置信）' : ''}
      </li>
      <li>
        当前结论：{r.n < 5 ? '样本不足，暂不下结论。' : '样本有限，优先看中位数与伤害笔数，不只看累计金额。'}
      </li>
      <li>费用已含在单笔盈亏中；机会成本本样本无法从影子回放单独拆出。</li>
    </ul>
  )
}

function kindWord(row: HowQueueRow) {
  if (row.status === 'verified') return '已验证改善'
  if (row.recoverableKind === 'theoretical') return '历史机会金额（非可实现收益）'
  if (row.recoverableKind === 'mechanical') return '历史损失暴露（机械上限）'
  if (row.historical != null) return '历史实际金额'
  return '影响金额未知'
}

function statusWord(s: HowQueueRow['status']) {
  if (s === 'verified') return '已验证'
  if (s === 'running') return '实验中'
  if (s === 'pending') return '待验证'
  if (s === 'blocked') return '数据受阻'
  if (s === 'rejected') return '暂不采用'
  return '参考'
}

function evidenceAnchorOf(id: string): string | null {
  if (id === 'giveback') return 'giveback-scatter'
  if (id === 'hold-h3') return 'hold-scatter'
  if (id === 'stops') return 'stop-scan'
  if (id === 'replay') return 'rule-replay'
  return null
}

export function QueueImpactBar(props: { row: HowQueueRow; maxAbs: number }) {
  const hit = queueImpact(props.row)
  const w = hit.amount == null || props.maxAbs <= 0 ? 0 : Math.min(100, (Math.abs(hit.amount) / props.maxAbs) * 100)
  return (
    <div className="how-q-impact">
      <span className="how-q-amt">
        {kindWord(props.row)}：{hit.amount == null ? '未知' : money(hit.amount)}
      </span>
      <span className="how-q-track">
        <i className={`how-q-fill how-q-${hit.kind}`} style={{ width: `${w}%` }} />
      </span>
    </div>
  )
}

export function QueueList(props: { rows: HowQueueRow[] }) {
  const maxAbs = Math.max(1, ...props.rows.map((r) => Math.abs(queueImpact(r).amount ?? 0)))
  return (
    <div className="how-q-list">
      {props.rows.map((r) => (
        <CandidateCard key={r.id} row={r} maxAbs={maxAbs} />
      ))}
    </div>
  )
}

function actionLabelOf(r: HowQueueRow): string {
  if (r.status === 'verified') return '如何优化'
  if (r.stage === '观察阶段') return '下一步验证'
  return '候选改法'
}

function CandidateCard(props: { row: HowQueueRow; maxAbs: number }) {
  const r = props.row
  const anchor = evidenceAnchorOf(r.id)
  const stage = r.stage ?? statusWord(r.status)
  const conc = r.concentrationShare
  const highConc = conc != null && conc >= 0.7
  const isIntraday = r.id === 'intraday'

  const header = (
    <div className="how-q-l1">
      <b>{r.title}</b>
      <span className={`how-chip how-chip-${r.status}`}>{stage}</span>
    </div>
  )

  const fields = (
    <dl className="how-q-fields">
      {r.problem ? (
        <div className="how-q-field">
          <dt>哪里做得不好</dt>
          <dd>{r.problem}</dd>
        </div>
      ) : null}
      {r.scope ? (
        <div className="how-q-field">
          <dt>发生范围</dt>
          <dd>{r.scope}</dd>
        </div>
      ) : null}
      {r.conclusion ? (
        <div className="how-q-field">
          <dt>当前结论</dt>
          <dd>{r.conclusion}</dd>
        </div>
      ) : null}
      {r.action ? (
        <div className="how-q-field">
          <dt>{actionLabelOf(r)}</dt>
          <dd>{r.action}</dd>
        </div>
      ) : null}
      {r.excludes ? (
        <div className="how-q-field">
          <dt>不适用于</dt>
          <dd>{r.excludes}</dd>
        </div>
      ) : null}
      {r.risk ? (
        <div className="how-q-field">
          <dt>潜在副作用</dt>
          <dd>{r.risk}</dd>
        </div>
      ) : null}
    </dl>
  )

  const meta = (
    <div className="how-q-meta">
      {isIntraday ? (
        r.historical != null ? <span className="how-q-conc">日内交易历史合计 {money(r.historical)}</span> : null
      ) : (
        <QueueImpactBar row={r} maxAbs={props.maxAbs} />
      )}
      {conc != null ? (
        <span className={`how-q-conc${highConc ? ' warn' : ''}`}>
          前 5 笔占 {pctPlain(conc, 0)}
          {highConc ? ' · 主要由少数极端交易驱动，不代表普遍问题' : ''}
        </span>
      ) : null}
      {anchor ? (
        <a className="link how-q-evidence" href={`#${anchor}`}>
          查看实验依据
        </a>
      ) : null}
    </div>
  )

  if (isIntraday) {
    return (
      <details className={`how-q-card how-st-${r.status} how-q-collapsed`}>
        <summary>
          {header}
          <p className="tiny">当前证据：不足以支持改为日内平仓。</p>
        </summary>
        {fields}
        {r.finding ? <p className="tiny how-q-l2">{r.finding}</p> : null}
        {meta}
      </details>
    )
  }

  return (
    <article className={`how-q-card how-st-${r.status}`}>
      {header}
      {fields}
      {r.finding ? <p className="tiny how-q-l2">{r.finding}</p> : null}
      {meta}
    </article>
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
  points: Array<{ id: string; x: number; y: number; up: boolean; label?: string; size?: number; color?: string }>
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
          color: p.color ?? (p.up ? 'var(--est)' : 'var(--down)'),
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

export function GivebackLegend() {
  return (
    <ul className="how-scatter-legend">
      <li>
        <i className="partial" /> 部分回吐
      </li>
      <li>
        <i className="full" /> 全部回吐
      </li>
      <li>
        <i className="loss" /> 回吐后转亏
      </li>
    </ul>
  )
}
