import { useRef, type CSSProperties, type ReactNode } from 'react'

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

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((n) => n * mag).find((n) => n >= raw) || raw
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(8)))
  if (!ticks.includes(100) && min <= 100 && max >= 100) ticks.push(100)
  return [...new Set(ticks)].sort((a, b) => a - b)
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
}) {
  const w = 640
  const h = props.height
  const n = props.series[0]?.values.length ?? 0
  const all = props.series.flatMap((s) => s.values)
  const baseline = props.baseline ?? 100
  const dataMin = Math.min(...all, baseline)
  const dataMax = Math.max(...all, baseline)
  const padAmt = Math.max((dataMax - dataMin) * 0.18, 1.2)
  const yMin = dataMin - padAmt
  const yMax = dataMax + padAmt
  const span = yMax - yMin || 1
  const pad = { l: 2, r: 8, t: 10, b: 18 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const xAt = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * innerW
  const yPx = (v: number) => pad.t + (1 - (v - yMin) / span) * innerH
  const yPct = (v: number) => `${((v - yMin) / span) * 100}%`
  const origin = useRef<number | null>(null)
  const ticks = niceTicks(yMin + padAmt * 0.15, yMax - padAmt * 0.15)
  const pathFor = (values: number[]) => {
    const xs = values.map((_, i) => xAt(i))
    return xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yPx(values[i]).toFixed(1)}`).join(' ')
  }
  return (
    <div className="ml-chart">
      <div className="ml-y" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ bottom: yPct(t) }}>
            {(t / 100).toFixed(2)}
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
          const baseY = yPx(baseline)
          const area = `${d} L${xAt(Math.max(s.values.length - 1, 0))},${baseY} L${xAt(0)},${baseY} Z`
          return (
            <g key={i}>
              {s.fill ? <path d={area} fill={s.fill} /> : null}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width ?? 1.6}
                strokeDasharray={s.dash}
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
      </svg>
    </div>
  )
}

export function AreaDrawdown(props: {
  points: number[]
  height: number
  cursor?: number | null
  range?: { lo: number; hi: number } | null
  trough?: number | null
  onCursor?: (i: number | null) => void
  onPick?: (i: number) => void
}) {
  const w = 420
  const h = props.height
  const n = props.points.length
  const min = Math.min(...props.points, 0)
  const max = Math.max(...props.points, 0.01)
  const span = max - min || 1
  const xAt = (i: number) => (i / Math.max(n - 1, 1)) * w
  const ys = props.points.map((p) => (1 - (p - min) / span) * (h - 16) + 4)
  const d = props.points.map((_, i) => `${i ? 'L' : 'M'}${xAt(i)},${ys[i]}`).join(' ')
  const area = `${d} L${w},${h - 4} L0,${h - 4} Z`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="chart interactive"
      preserveAspectRatio="none"
      onPointerLeave={() => props.onCursor?.(null)}
      onPointerMove={(e) => {
        if (!n) return
        props.onCursor?.(cursorIndex(e.clientX, e.currentTarget.getBoundingClientRect(), n, 0, w, w))
      }}
      onClick={(e) => {
        if (!n) return
        props.onPick?.(cursorIndex(e.clientX, e.currentTarget.getBoundingClientRect(), n, 0, w, w))
      }}
    >
      {props.range && props.range.hi !== props.range.lo ? (
        <rect
          x={xAt(props.range.lo)}
          y={4}
          width={Math.max(1, xAt(props.range.hi) - xAt(props.range.lo))}
          height={h - 8}
          fill="var(--gold-fill)"
        />
      ) : null}
      <path d={area} fill="var(--down-fill)" />
      <path d={d} fill="none" stroke="var(--down)" strokeWidth={1.5} />
      {props.trough != null ? <circle cx={xAt(props.trough)} cy={ys[props.trough]} r={4} fill="var(--down)" /> : null}
      {props.cursor != null && n ? <line x1={xAt(props.cursor)} x2={xAt(props.cursor)} y1={4} y2={h - 4} className="cursor-line" /> : null}
    </svg>
  )
}

export function Scatter(props: {
  points: Array<{ x: number; y: number; up: boolean; id: string }>
  onPick: (id: string) => void
  height?: number
}) {
  const w = 900
  const h = props.height ?? 240
  const xs = props.points.map((p) => p.x)
  const ys = props.points.map((p) => p.y)
  const minX = Math.min(...xs, -0.05)
  const maxX = Math.max(...xs, 0)
  const minY = Math.min(0, ...ys)
  const maxY = Math.max(...ys, 0.05)
  const xSpan = maxX - minX || 1
  const ySpan = maxY - minY || 1
  const px = (x: number) => ((x - minX) / xSpan) * (w - 40) + 28
  const py = (y: number) => (1 - (y - minY) / ySpan) * (h - 36) + 12
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart scatter">
      <line x1={px(minX)} x2={px(maxX)} y1={py(0)} y2={py(0)} className="grid" />
      <line x1={px(0)} x2={px(0)} y1={12} y2={h - 24} className="grid" />
      {props.points.map((p) => (
        <circle
          key={p.id}
          cx={px(p.x)}
          cy={py(p.y)}
          r={5}
          fill={p.up ? 'var(--up)' : 'var(--down)'}
          className="dot"
          onClick={() => props.onPick(p.id)}
        />
      ))}
    </svg>
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
