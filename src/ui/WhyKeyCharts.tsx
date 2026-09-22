import { useMemo, useState } from 'react'
import { money, moneyK, pctPlain } from '../lib/format.ts'
import type { EquityPoint, RoundTrip } from '../types.ts'
import { BoxStrip, ExitScatter, MultiLine, Waterfall, type PathMarker } from './charts.tsx'
import {
  attrWaterfall,
  cumPath,
  dimOf,
  exitPoints,
  holdUiRows,
  maeQuadrants,
  type WfDim,
} from './whyViz.ts'

export type WhyHl = { symbol?: string; tripId?: string } | null

function equityDdShade(dd: number[]) {
  if (dd.length < 2) return undefined
  const troughI = dd.reduce((b, v, i) => (v < dd[b] ? i : b), 0)
  let peakI = 0
  for (let i = 0; i <= troughI; i++) if (dd[i] >= -1e-9) peakI = i
  if (troughI <= peakI) return undefined
  return { lo: peakI, hi: troughI, fill: 'color-mix(in srgb, var(--down) 16%, transparent)' }
}

const WF_DIMS: Array<{ id: WfDim; label: string }> = [
  { id: 'symbol', label: '按标的' },
  { id: 'trip', label: '按单笔' },
  { id: 'side', label: '按多空' },
  { id: 'hold', label: '按持仓' },
  { id: 'session', label: '按入场时段' },
]

export function AttrWaterfallBlock(props: {
  trips: RoundTrip[]
  hl: WhyHl
  onPick: (next: { symbol?: string; tripId?: string }) => void
}) {
  const [dim, setDim] = useState<WfDim>('symbol')
  const steps = useMemo(() => attrWaterfall(props.trips, dim), [props.trips, dim])
  return (
    <div className="why-chart">
      <p className="tiny">
        各分组已实现盈亏贡献（每根从 0 起，红负绿正）。n={props.trips.length}
      </p>
      <div className="sorts">
        {WF_DIMS.map((d) => (
          <button type="button" key={d.id} className={dim === d.id ? 'on' : ''} onClick={() => setDim(d.id)}>
            {d.label}
          </button>
        ))}
      </div>
      <Waterfall
        flat
        height={280}
        steps={steps.map((s) => ({
          ...s,
          dim: !s.total && dimOf(props.hl, s.symbol, s.tripId),
        }))}
        onPick={(id) => {
          const hit = steps.find((s) => s.id === id)
          if (hit?.tripId) props.onPick({ tripId: hit.tripId, symbol: hit.symbol })
          else if (hit?.symbol) props.onPick({ symbol: hit.symbol })
        }}
      />
    </div>
  )
}

export function CumPathBlock(props: {
  trips: RoundTrip[]
  equity: EquityPoint[]
  hl: WhyHl
  onPickTrip: (id: string) => void
}) {
  const path = useMemo(() => cumPath(props.trips), [props.trips])
  if (!path) return null
  const hlI = path.tripIds.findIndex((id) => id === props.hl?.tripId)
  const markers: PathMarker[] = path.marks.map((m) => ({
    i: m.i,
    value: path.actual[m.i],
    kicker: m.label,
    tone: m.kind === 'maxWin' ? 'up' : 'down',
  }))
  if (hlI >= 0) {
    markers.push({ i: hlI, value: path.actual[hlI], kicker: '高亮', tone: 'now' })
  }
  const dd = props.equity.map((e) => e.drawdown)
  return (
    <div className="why-chart">
      <p className="tiny">
        累计净盈亏：亏损是持续发生还是集中在少数几笔。去最大盈利后的线看是否靠极少数大盈撑着。n={props.trips.length}
      </p>
      <MultiLine
        height={240}
        baseline={0}
        tickFormat={moneyK}
        dates={path.dates}
        markers={markers}
        series={[
          { values: path.actual, color: 'var(--t1)', width: 1.8 },
          { values: path.exMaxWin, color: 'var(--warn, #c47a1a)', width: 1.4, dash: '5 3' },
        ]}
        onPick={(i) => {
          const id = path.tripIds[i]
          if (id) props.onPickTrip(id)
        }}
      />
      <div className="scatter-legend">
        <span>实线：累计已实现</span>
        <span>虚线：去掉最大盈利后</span>
      </div>
      {dd.length > 2 ? (
        <>
          <p className="tiny">账户净值最大回撤（含样本外持仓、未实现和其他资金变化）。不进入本期交易归因。</p>
          <MultiLine
            height={120}
            baseline={0}
            tickFormat={moneyK}
            dates={props.equity.map((e) => e.date)}
            areaFill
            series={[{ values: dd, color: 'var(--down)', width: 1.3 }]}
            shadeRange={equityDdShade(dd)}
          />
        </>
      ) : (
        <>
          <p className="tiny">无账户路径时，用交易序列回撤代替。</p>
          <MultiLine
            height={120}
            baseline={0}
            tickFormat={moneyK}
            dates={path.dates}
            areaFill
            series={[{ values: path.seqDd, color: 'var(--down)', width: 1.3 }]}
            shadeRange={{ lo: path.ddPeakI, hi: path.ddTroughI, fill: 'color-mix(in srgb, var(--down) 16%, transparent)' }}
          />
        </>
      )}
    </div>
  )
}

export function ExitEfficiencyBlock(props: {
  trips: RoundTrip[]
  hl: WhyHl
  onPick: (id: string) => void
}) {
  const pts = useMemo(() => exitPoints(props.trips), [props.trips])
  return (
    <div className="why-chart">
      <p className="tiny">
        退出效率：X=日线估算 MFE，Y=已实现。参考线不是可达收益。有效 n={pts.length} / {props.trips.length}
      </p>
      <ExitScatter
        height={260}
        points={pts.map((p) => ({
          id: p.id,
          x: p.mfe,
          y: p.pnl,
          r: p.notional,
          up: p.up,
          holdId: p.holdId,
          flags: p.flags,
          tag: p.symbol,
          dim: dimOf(props.hl, p.symbol, p.id),
          label: `${p.symbol} · 实现 ${money(p.pnl)} · MFE ${money(p.mfe)}${p.flags.length ? ` · ${p.flags.join(',')}` : ''}`,
        }))}
        onPick={props.onPick}
      />
    </div>
  )
}

export function MaeQuadStrip(props: { trips: RoundTrip[] }) {
  const quads = maeQuadrants(props.trips)
  if (!quads) return <p className="tiny">MAE/MFE 样本不足 4 笔，不划分象限。</p>
  return (
    <div className="why-quads">
      {quads.map((q) => (
        <div key={q.id} className="why-quad">
          <p className="tiny">{q.label}</p>
          <p>
            n={q.n} · {money(q.pnl)}
            {q.meanHoldMin != null ? ` · 均持仓 ${(q.meanHoldMin / 1440).toFixed(1)} 日` : ''}
          </p>
        </div>
      ))}
    </div>
  )
}

export function HoldUiStrip(props: {
  trips: RoundTrip[]
  onPick: (id: string) => void
}) {
  const rows = holdUiRows(props.trips)
  return (
    <div className="why-chart">
      <p className="tiny">细档仅观察，诊断仍用引擎的 &lt;1 / 1–5 / ≥5 日。n={props.trips.length}</p>
      {rows.map((r) => (
        <article key={r.id} className="why-hold-row">
          <h4>
            {r.label} <span className="n-chip">n={r.n}</span>
          </h4>
          {r.n ? (
            <>
              <p className="tiny">
                中位 {r.median == null ? '—' : money(r.median)} · 平均 {r.mean == null ? '—' : money(r.mean)} · 胜率{' '}
                {r.winRate == null ? '—' : pctPlain(r.winRate, 0)} · 合计 {money(r.pnl)}
              </p>
              {r.n >= 4 ? <BoxStrip points={r.points} height={160} format={money} onPick={props.onPick} /> : null}
            </>
          ) : (
            <p className="tiny">无样本</p>
          )}
        </article>
      ))}
    </div>
  )
}
