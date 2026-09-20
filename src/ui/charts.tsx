import { useRef, type CSSProperties, type ReactNode } from 'react'
import { moneyK } from '../lib/format.ts'

export function LineChart(props: {
  width?: number
  height: number
  series: Array<{ x: number; y: number }>
  color?: string
  fill?: string
}) {
  const w = props.width ?? 640
  const h = props.height
  const ys = props.series.map((p) => p.y)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const padAmt = (max - min) * 0.08 || 1
  const yMin = min - padAmt
  const yMax = max + padAmt
  const span = yMax - yMin || 1
  const pad = { l: 8, r: 8, t: 10, b: 18 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const xs = props.series.map((_, i) => pad.l + (i / Math.max(props.series.length - 1, 1)) * innerW)
  const ysPx = props.series.map((p) => pad.t + (1 - (p.y - yMin) / span) * innerH)
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ysPx[i].toFixed(1)}`).join(' ')
  const area = `${d} L${xs.at(-1)},${pad.t + innerH} L${xs[0]},${pad.t + innerH} Z`
  const color = props.color || 'var(--gold)'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" preserveAspectRatio="none">
      <path d={area} fill={props.fill || 'transparent'} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} />
    </svg>
  )
}

function cursorIndex(clientX: number, rect: DOMRect, count: number, padL: number, innerW: number, viewW: number) {
  const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * viewW
  const i = Math.round(((x - padL) / Math.max(innerW, 1)) * Math.max(count - 1, 1))
  return Math.max(0, Math.min(count - 1, i))
}

function niceTicks(min: number, max: number, count = 4, pin?: number): number[] {
  const span = max - min || 1
  const raw = span / Math.max(count, 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10]
    .map((n) => n * mag)
    .reduce((best, n) => (Math.abs(n - raw) < Math.abs(best - raw) ? n : best))
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(8)))
  if (pin != null && min <= pin && max >= pin) ticks.push(pin)
  const uniq = [...new Set(ticks)].sort((a, b) => a - b)
  if (pin == null) return uniq
  const minGap = span * 0.12
  return uniq.filter((t) => t === pin || Math.abs(t - pin) >= minGap)
}

function dateTickLabels(dates: string[], n: number): Array<{ i: number; label: string }> {
  if (!n || !dates.length) return []
  const step = Math.max(1, Math.floor(n / 6))
  const out: Array<{ i: number; label: string }> = []
  let prev = ''
  for (let i = 0; i < n; i += step) {
    const label = (dates[i] || '').slice(0, 7)
    if (label && label !== prev) {
      out.push({ i, label })
      prev = label
    }
  }
  const lastI = n - 1
  const lastLabel = (dates[lastI] || '').slice(0, 7)
  if (lastLabel && out.length && out[out.length - 1].i !== lastI && lastLabel !== out[out.length - 1].label) {
    out.push({ i: lastI, label: lastLabel })
  }
  return out
}

export function MultiLine(props: {
  height: number
  series: Array<{ values: number[]; color: string; fill?: string; width?: number; dash?: string }>
  marks?: number[]
  cursor?: number | null
  range?: { lo: number; hi: number } | null
  baseline?: number
  onCursor?: (i: number | null) => void
  onRange?: (range: { lo: number; hi: number } | null) => void
  onPick?: (i: number) => void
  tickFormat?: (v: number) => string
  dates?: string[]
  endLabel?: { value: number; text: string }
  markers?: Array<{ i: number; value: number; text: string; tone?: 'up' | 'down' }>
}) {
  const w = 640
  const h = props.height
  const n = props.series[0]?.values.length ?? 0
  const all = props.series.flatMap((s) => s.values)
  const baseline = props.baseline ?? 100
  const dataMin = Math.min(...all, baseline)
  const dataMax = Math.max(...all, baseline)
  const padAmt = Math.max((dataMax - dataMin) * 0.12, Math.abs(baseline) * 0.04 + 1)
  const yMin = dataMin - padAmt
  const yMax = dataMax + padAmt
  const span = yMax - yMin || 1
  const pad = { l: 2, r: 96, t: 16, b: 18 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const xAt = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * innerW
  const yPx = (v: number) => pad.t + (1 - (v - yMin) / span) * innerH
  const yPct = (v: number) => `${((v - yMin) / span) * 100}%`
  const xPct = (i: number) => `${(xAt(i) / w) * 100}%`
  const fmtTick = props.tickFormat ?? ((t: number) => (t / 100).toFixed(2))
  const origin = useRef<number | null>(null)
  const ticks = niceTicks(yMin + padAmt * 0.15, yMax - padAmt * 0.15, 4, baseline)
  const dates = props.dates && props.dates.length === n ? dateTickLabels(props.dates, n) : []
  const pathFor = (values: number[]) => {
    const xs = values.map((_, i) => xAt(i))
    return xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yPx(values[i]).toFixed(1)}`).join(' ')
  }
  const areaFor = (values: number[], base: number) => {
    const d = pathFor(values)
    const baseY = yPx(base)
    return `${d} L${xAt(Math.max(values.length - 1, 0))},${baseY} L${xAt(0)},${baseY} Z`
  }
  const labels: Array<{ key: string; text: string; left: string; top: number; className: string }> = []
  const lastI = Math.max(n - 1, 0)
  for (const m of props.markers || []) {
    if (m.i === lastI) continue
    const nearRight = n > 1 && m.i / (n - 1) > 0.72
    const nearBottom = (m.value - yMin) / span < 0.22
    labels.push({
      key: `m-${m.i}`,
      text: m.text,
      left: nearRight ? `calc(${xPct(m.i)} - 8px)` : xPct(m.i),
      top: yPx(m.value),
      className: `ml-mark ${m.tone || ''} ${nearRight ? 'near-right' : ''} ${m.tone === 'down' && !nearBottom ? 'below' : ''}`,
    })
  }
  if (props.endLabel && n) {
    labels.push({
      key: 'end',
      text: props.endLabel.text,
      left: `calc(${xPct(lastI)} + 10px)`,
      top: yPx(props.endLabel.value),
      className: 'ml-end',
    })
  }
  labels.sort((a, b) => a.top - b.top)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].top - labels[i - 1].top < 16) labels[i].top = labels[i - 1].top + 16
  }
  return (
    <div className="ml-chart">
      <div className="ml-body">
        <div className="ml-y" aria-hidden>
          {ticks.map((t) => (
            <span key={t} style={{ bottom: yPct(t) }}>
              {fmtTick(t)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="chart interactive"
          preserveAspectRatio="none"
          onPointerLeave={() => {
            origin.current = null
            props.onCursor?.(null)
          }}
          onPointerUp={() => {
            origin.current = null
          }}
          onPointerMove={(e) => {
            if (!n) return
            const i = cursorIndex(e.clientX, e.currentTarget.getBoundingClientRect(), n, pad.l, innerW, w)
            props.onCursor?.(i)
            if (e.buttons === 1 && origin.current != null) {
              props.onRange?.({ lo: Math.min(origin.current, i), hi: Math.max(origin.current, i) })
            }
          }}
          onPointerDown={(e) => {
            if (!n) return
            const i = cursorIndex(e.clientX, e.currentTarget.getBoundingClientRect(), n, pad.l, innerW, w)
            origin.current = i
            props.onCursor?.(i)
          }}
          onClick={(e) => {
            if (!n || !props.onPick) return
            const i = cursorIndex(e.clientX, e.currentTarget.getBoundingClientRect(), n, pad.l, innerW, w)
            props.onPick(i)
          }}
        >
          {ticks.map((t) => (
            <line
              key={t}
              x1={pad.l}
              x2={w - pad.r}
              y1={yPx(t)}
              y2={yPx(t)}
              className={Math.abs(t - baseline) < 1e-6 ? 'base-line' : 'grid'}
            />
          ))}
          {props.range && props.range.hi !== props.range.lo ? (
            <rect
              x={xAt(props.range.lo)}
              y={pad.t}
              width={Math.max(1, xAt(props.range.hi) - xAt(props.range.lo))}
              height={innerH}
              fill="var(--gold-fill)"
            />
          ) : null}
          {props.series.map((s, i) => {
            const d = pathFor(s.values)
            return (
              <g key={i}>
                {s.fill ? <path d={areaFor(s.values, baseline)} fill={s.fill} /> : null}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width ?? 1.8}
                  strokeDasharray={s.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="nonScalingStroke"
                />
              </g>
            )
          })}
          {(props.marks || []).map((i) => (
            <line key={i} x1={xAt(i)} x2={xAt(i)} y1={pad.t} y2={pad.t + innerH} className="cf-mark" />
          ))}
          {props.cursor != null && n ? (
            <line x1={xAt(props.cursor)} x2={xAt(props.cursor)} y1={pad.t} y2={pad.t + innerH} className="cursor-line" />
          ) : null}
          {(props.markers || []).map((m) =>
            m.i === lastI ? null : (
              <circle
                key={`dot-${m.i}`}
                cx={xAt(m.i)}
                cy={yPx(m.value)}
                r={3.2}
                fill={m.tone === 'down' ? 'var(--down)' : 'var(--up)'}
                stroke="var(--bg)"
                strokeWidth={1.5}
              />
            ),
          )}
        </svg>
        {labels.map((lab) => (
          <span key={lab.key} className={lab.className} style={{ left: lab.left, top: `${(lab.top / h) * 100}%` }}>
            {lab.text}
          </span>
        ))}
      </div>
      {dates.length ? (
        <div className="ml-x" aria-hidden>
          {dates.map((d) => (
            <span key={d.i} style={{ left: xPct(d.i) }}>
              {d.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Scatter(props: {
  points: Array<{ x: number; y: number; up: boolean; id: string; label?: string }>
  onPick: (id: string) => void
  height?: number
}) {
  if (!props.points.length) return null
  const w = 640
  const h = props.height ?? 260
  const pad = { l: 44, r: 18, t: 14, b: 40 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const mae = props.points.map((p) => Math.abs(p.x))
  const mfe = props.points.map((p) => Math.max(0, p.y))
  const maxX = Math.max(0.1, ...mae)
  const maxY = Math.max(0.1, ...mfe)
  const max = Math.max(maxX, maxY)
  const px = (v: number) => pad.l + (v / max) * innerW
  const py = (v: number) => pad.t + (1 - v / max) * innerH
  const ticks = niceTicks(0, max, 4, 0).filter((t) => t >= 0 && t <= max * 1.02)
  const axis: CSSProperties = { fontSize: 11, fill: 'var(--t3)' }
  const pctL = (v: number) => `${Math.round(v * 100)}%`
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="chart scatter">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={px(t)} x2={px(t)} y1={pad.t} y2={pad.t + innerH} className="grid" />
            <line x1={pad.l} x2={pad.l + innerW} y1={py(t)} y2={py(t)} className={t === 0 ? 'base-line' : 'grid'} />
            <text x={px(t)} y={h - 18} textAnchor="middle" style={axis}>
              {pctL(t)}
            </text>
            {t > 0 ? (
              <text x={pad.l - 8} y={py(t) + 4} textAnchor="end" style={axis}>
                {pctL(t)}
              </text>
            ) : null}
          </g>
        ))}
        <line x1={px(0)} x2={px(max)} y1={py(0)} y2={py(max)} className="base-line" />
        {props.points.map((p) => (
          <circle
            key={p.id}
            cx={px(Math.abs(p.x))}
            cy={py(Math.max(0, p.y))}
            r={5}
            fill={p.up ? 'var(--up)' : 'var(--down)'}
            className="dot"
            onClick={() => props.onPick(p.id)}
          >
            {p.label ? <title>{p.label}</title> : null}
          </circle>
        ))}
        <text x={pad.l + innerW / 2} y={h - 4} textAnchor="middle" style={{ ...axis, fontSize: 11 }}>
          MAE（不利）
        </text>
        <text
          x={12}
          y={pad.t + innerH / 2}
          textAnchor="middle"
          style={{ ...axis, fontSize: 11 }}
          transform={`rotate(-90 12 ${pad.t + innerH / 2})`}
        >
          MFE（有利）
        </text>
      </svg>
      <div className="scatter-legend">
        <span>
          <i style={{ color: 'var(--up)' }}>●</i> 最终盈利
        </span>
        <span>
          <i style={{ color: 'var(--down)' }}>●</i> 最终亏损
        </span>
        <span>虚线：MFE = |MAE|</span>
      </div>
    </div>
  )
}

export function DualPath(props: {
  closes: Array<{ date: string; close: number; high: number; low: number }>
  openPx: number
  closePx: number | null
  mae?: number | null
  mfe?: number | null
}) {
  const w = 280
  const h = 150
  if (!props.closes.length) return <div className="muted">无路径</div>
  const vals = props.closes.flatMap((c) => [c.high, c.low, c.close, props.openPx, props.closePx || props.openPx])
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const x = (i: number) => 18 + (i / Math.max(props.closes.length - 1, 1)) * (w - 36)
  const y = (v: number) => 12 + (1 - (v - min) / span) * (h - 28)
  const d = props.closes.map((c, i) => `${i ? 'L' : 'M'}${x(i)},${y(c.close)}`).join(' ')
  const lastI = props.closes.length - 1
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="path-svg">
      {props.closes.map((c, i) => (
        <line key={c.date} x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke="var(--line2)" strokeWidth={4} />
      ))}
      <path d={d} fill="none" stroke="var(--gold)" strokeWidth={1.6} />
      <circle cx={x(0)} cy={y(props.openPx)} r={4} fill="var(--gold)" />
      {props.closePx != null ? <circle cx={x(lastI)} cy={y(props.closePx)} r={4} fill="var(--up)" /> : null}
      {props.mae != null ? <circle cx={x(Math.floor(lastI / 2))} cy={y(props.mae)} r={3.5} fill="var(--down)" /> : null}
      {props.mfe != null ? (
        <circle cx={x(Math.max(lastI - 1, 0))} cy={y(props.mfe)} r={3.5} fill="var(--up)" stroke="var(--bg)" />
      ) : null}
    </svg>
  )
}

export function MaeBar(props: { mae: number | null; mfe: number | null }) {
  const mae = Math.abs(props.mae ?? 0)
  const mfe = Math.abs(props.mfe ?? 0)
  const tot = mae + mfe || 1
  const style = { '--mae': `${(mae / tot) * 50}%`, '--mfe': `${(mfe / tot) * 50}%` } as CSSProperties
  return (
    <div className="mae-bar" style={style}>
      <span className="mae" />
      <i />
      <span className="mfe" />
    </div>
  )
}

export function CaptureBar(props: { capture: number; n: number }) {
  const cap = Math.max(0, Math.min(1, props.capture))
  return (
    <div className="capture-split">
      <div className="capture-track" aria-hidden>
        <span className="cap" style={{ width: `${cap * 100}%` }} />
        <span className="give" style={{ width: `${(1 - cap) * 100}%` }} />
      </div>
      <div className="tiny">
        已捕获 {(cap * 100).toFixed(1)}%　回吐 {((1 - cap) * 100).toFixed(1)}%　盈利交易 n={props.n}｜日线估算
      </div>
    </div>
  )
}

export function Stat(props: {
  k: ReactNode
  v: ReactNode
  sub?: ReactNode
  tone?: string
  tip?: string
  onClick?: () => void
}) {
  const inner = (
    <>
      <div className="k">{props.k}</div>
      <div className={`v ${props.tone || ''}`}>{props.v}</div>
      {props.sub ? <div className="sub">{props.sub}</div> : null}
      {props.tip ? <div className="stat-tip">{props.tip}</div> : null}
    </>
  )
  const cls = `stat${props.onClick ? ' clickable' : ''}${props.tip ? ' has-tip' : ''}`
  if (props.onClick) {
    return (
      <button type="button" className={cls} onClick={props.onClick}>
        {inner}
      </button>
    )
  }
  return <div className={cls}>{inner}</div>
}

export type BarItem = {
  id: string
  label: string
  value: number | null
  n?: number
}

export function SignedBars(props: {
  items: BarItem[]
  format?: (v: number) => string
  onPick?: (id: string) => void
}) {
  const present = props.items.filter((x) => x.value != null && Number.isFinite(x.value!))
  if (!present.length) return <p className="tiny">没有可画的数据。</p>
  const maxAbs = Math.max(...present.map((x) => Math.abs(x.value!)), 1)
  const fmt = props.format ?? ((v: number) => String(v))
  return (
    <div className="signed-bars">
      {props.items.map((item) => {
        if (item.value == null || !Number.isFinite(item.value)) {
          return (
            <div key={item.id} className="div-bar-row">
              <span className="div-label wide">{item.label}</span>
              <div className="div-track" />
              <span className="div-amt muted">{item.n === 0 ? '无样本' : '—'}</span>
            </div>
          )
        }
        const width = `${(Math.abs(item.value) / maxAbs) * 50}%`
        const up = item.value >= 0
        const row = (
          <>
            <span className="div-label wide">{item.label}</span>
            <div className="div-track">
              <div className={`div-bar ${up ? 'win' : 'loss'}`} style={{ width }} />
            </div>
            <span className={`div-amt ${up ? 'up' : 'down'}`}>
              {fmt(item.value)}
              {item.n != null ? <i className="bar-n">n={item.n}</i> : null}
            </span>
          </>
        )
        if (props.onPick) {
          return (
            <button type="button" key={item.id} className="div-bar-row as-btn" onClick={() => props.onPick?.(item.id)}>
              {row}
            </button>
          )
        }
        return (
          <div key={item.id} className="div-bar-row">
            {row}
          </div>
        )
      })}
    </div>
  )
}

export function MonthBars(props: {
  items: Array<{ label: string; value: number }>
  format?: (v: number) => string
  height?: number
}) {
  if (!props.items.length) return null
  const w = 640
  const h = props.height ?? 168
  const pad = { l: 44, r: 12, t: 10, b: 28 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const maxAbs = Math.max(...props.items.map((d) => Math.abs(d.value)), 1)
  const yPx = (v: number) => pad.t + (1 - (v + maxAbs) / (2 * maxAbs)) * innerH
  const zero = yPx(0)
  const gap = innerW / props.items.length
  const bw = Math.max(3, Math.min(18, gap * 0.62))
  const fmt = props.format ?? moneyK
  const ticks = niceTicks(-maxAbs, maxAbs, 4, 0)
  const step = props.items.length > 14 ? 2 : 1
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart vbars" preserveAspectRatio="none">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={yPx(t)} y2={yPx(t)} className={Math.abs(t) < 1e-9 ? 'base-line' : 'grid'} />
          <text x={pad.l - 6} y={yPx(t) + 3} textAnchor="end" className="chart-label">
            {fmt(t)}
          </text>
        </g>
      ))}
      {props.items.map((d, i) => {
        const x = pad.l + (i + 0.5) * gap - bw / 2
        const y = Math.min(yPx(d.value), zero)
        const bh = Math.max(1, Math.abs(yPx(d.value) - zero))
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={bw} height={bh} rx={1.5} fill={d.value >= 0 ? 'var(--up)' : 'var(--down)'}>
              <title>{`${d.label} ${fmt(d.value)}`}</title>
            </rect>
            {i % step === 0 || i === props.items.length - 1 ? (
              <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="chart-label">
                {d.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export function Histogram(props: {
  values: number[]
  format?: (v: number) => string
  bins?: number
  height?: number
}) {
  if (props.values.length < 3) return <p className="tiny">样本太少，不画分布。</p>
  const w = 640
  const h = props.height ?? 150
  const pad = { l: 36, r: 12, t: 10, b: 28 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  let min = Math.min(...props.values)
  let max = Math.max(...props.values)
  if (min === max) {
    min -= 1
    max += 1
  }
  if (min > 0) min = 0
  if (max < 0) max = 0
  const binCount = props.bins ?? 9
  const width = (max - min) / binCount
  const counts = Array.from({ length: binCount }, () => 0)
  for (const v of props.values) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / width)))
    counts[idx] += 1
  }
  const maxC = Math.max(...counts, 1)
  const gap = innerW / binCount
  const bw = Math.max(4, gap * 0.72)
  const fmt = props.format ?? ((v: number) => v.toFixed(0))
  const xAt = (edge: number) => pad.l + ((edge - min) / (max - min || 1)) * innerW
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart hist" preserveAspectRatio="none">
      <line x1={pad.l} x2={w - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} className="base-line" />
      {min < 0 && max > 0 ? <line x1={xAt(0)} x2={xAt(0)} y1={pad.t} y2={pad.t + innerH} className="base-line" /> : null}
      {counts.map((c, i) => {
        const lo = min + i * width
        const hi = lo + width
        const mid = (lo + hi) / 2
        const x = pad.l + i * gap + (gap - bw) / 2
        const bh = (c / maxC) * innerH
        return (
          <rect
            key={i}
            x={x}
            y={pad.t + innerH - bh}
            width={bw}
            height={Math.max(c ? 2 : 0, bh)}
            rx={1.5}
            fill={mid >= 0 ? 'var(--up)' : 'var(--down)'}
            opacity={c ? 0.9 : 0.2}
          >
            <title>{`${fmt(lo)} ~ ${fmt(hi)} · ${c} 日`}</title>
          </rect>
        )
      })}
      <text x={pad.l} y={h - 8} className="chart-label">
        {fmt(min)}
      </text>
      {min < 0 && max > 0 ? (
        <text x={xAt(0)} y={h - 8} textAnchor="middle" className="chart-label">
          0
        </text>
      ) : null}
      <text x={w - pad.r} y={h - 8} textAnchor="end" className="chart-label">
        {fmt(max)}
      </text>
    </svg>
  )
}

export function StemStrip(props: {
  points: Array<{ id: string; t: number; v: number; label?: string }>
  format?: (v: number) => string
  height?: number
  onPick?: (id: string) => void
}) {
  if (!props.points.length) return null
  const w = 640
  const h = props.height ?? 96
  const pad = { l: 44, r: 12, t: 8, b: 8 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const t0 = Math.min(...props.points.map((p) => p.t))
  const t1 = Math.max(...props.points.map((p) => p.t))
  const spanT = Math.max(t1 - t0, 1)
  const maxAbs = Math.max(...props.points.map((p) => Math.abs(p.v)), 1)
  const xAt = (t: number) => pad.l + ((t - t0) / spanT) * innerW
  const yPx = (v: number) => pad.t + (1 - (v + maxAbs) / (2 * maxAbs)) * innerH
  const zero = yPx(0)
  const fmt = props.format ?? moneyK
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart stem" preserveAspectRatio="none">
      <line x1={pad.l} x2={w - pad.r} y1={zero} y2={zero} className="base-line" />
      <text x={pad.l - 6} y={zero + 3} textAnchor="end" className="chart-label">
        {fmt(0)}
      </text>
      {props.points.map((p) => (
        <line
          key={p.id}
          x1={xAt(p.t)}
          x2={xAt(p.t)}
          y1={zero}
          y2={yPx(p.v)}
          stroke={p.v >= 0 ? 'var(--up)' : 'var(--down)'}
          strokeWidth={1.6}
          strokeLinecap="round"
          className="stem-line"
          onClick={() => props.onPick?.(p.id)}
        >
          <title>{p.label || fmt(p.v)}</title>
        </line>
      ))}
    </svg>
  )
}

export function CoverageMeter(props: { label: string; value: number; of?: number; note?: string }) {
  const pct = props.of != null && props.of > 0 ? Math.max(0, Math.min(1, props.value / props.of)) : Math.max(0, Math.min(1, props.value))
  const shown =
    props.of != null ? `${props.value}/${props.of}` : `${Math.round(pct * 100)}%`
  return (
    <div className="meter-row">
      <span className="meter-k">{props.label}</span>
      <div className="meter-track" aria-hidden>
        <span className="meter-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="meter-v">
        {shown}
        {props.note ? <i> {props.note}</i> : null}
      </span>
    </div>
  )
}
