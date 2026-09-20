import { Fragment, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { moneyK } from '../lib/format.ts'
import { etDateKey } from '../lib/time.ts'

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
  /** 盈亏这类跨零数据用符号感填充:零线以上一色、以下一色,比单色描边可读得多。 */
  signedFill?: { up: string; down: string }
  /** 分位带(如蒙特卡洛扇形):在 lo~hi 之间填一层实色半透明区域,画在线之下。 */
  bands?: Array<{ lo: number[]; hi: number[]; fill: string }>
}) {
  const uid = useId().replace(/:/g, '')
  const w = 640
  const h = props.height
  const n = props.series[0]?.values.length ?? 0
  const all = [...props.series.flatMap((s) => s.values), ...(props.bands || []).flatMap((b) => [...b.lo, ...b.hi])]
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
  const bandPath = (lo: number[], hi: number[]) => {
    const m = Math.min(lo.length, hi.length)
    let d = ''
    for (let i = 0; i < m; i++) d += `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yPx(hi[i]).toFixed(1)} `
    for (let i = m - 1; i >= 0; i--) d += `L${xAt(i).toFixed(1)},${yPx(lo[i]).toFixed(1)} `
    return `${d}Z`
  }
  const labels: Array<{ key: string; text: string; left: string; top: number; className: string }> = []
  const lastI = Math.max(n - 1, 0)
  for (const m of props.markers || []) {
    if (m.i === lastI) continue
    const nearRight = n > 1 && m.i / (n - 1) > 0.72
    // 峰在上、谷在下:标签放在数据点远离曲线的一侧,不再压在线上。
    const below = m.tone === 'down'
    labels.push({
      key: `m-${m.i}`,
      text: m.text,
      left: nearRight ? `calc(${xPct(m.i)} - 8px)` : xPct(m.i),
      top: yPx(m.value),
      className: `ml-mark ${m.tone || ''} ${nearRight ? 'near-right' : ''} ${below ? 'below' : ''}`,
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
  // 光标处主序列的 y 值,用来画水平准星线 + 读数。
  const cursorVal = props.cursor != null ? props.series[0]?.values[props.cursor] ?? null : null
  const cursorY = cursorVal != null && Number.isFinite(cursorVal) ? yPx(cursorVal) : null
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
          {(props.bands || []).map((b, bi) => (
            <path key={`band-${bi}`} d={bandPath(b.lo, b.hi)} fill={b.fill} />
          ))}
          {props.series.map((s, i) => {
            const d = pathFor(s.values)
            const baseY = yPx(baseline)
            const signed = props.signedFill && i === 0
            const lw = s.width ?? 1.8
            return (
              <g key={i}>
                {signed ? (
                  <>
                    <clipPath id={`${uid}-up`}>
                      <rect x={pad.l} y={pad.t} width={innerW} height={Math.max(0, baseY - pad.t)} />
                    </clipPath>
                    <clipPath id={`${uid}-dn`}>
                      <rect x={pad.l} y={baseY} width={innerW} height={Math.max(0, pad.t + innerH - baseY)} />
                    </clipPath>
                    <path d={areaFor(s.values, baseline)} fill={props.signedFill!.up} clipPath={`url(#${uid}-up)`} />
                    <path d={areaFor(s.values, baseline)} fill={props.signedFill!.down} clipPath={`url(#${uid}-dn)`} />
                  </>
                ) : s.fill ? (
                  <path d={areaFor(s.values, baseline)} fill={s.fill} />
                ) : null}
                {lw >= 2 && !s.dash ? (
                  <path
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={lw + 5}
                    opacity={0.12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="nonScalingStroke"
                  />
                ) : null}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={lw}
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
          {cursorY != null && props.cursor != null ? (
            <line x1={pad.l} x2={w - pad.r} y1={cursorY} y2={cursorY} className="cursor-line" />
          ) : null}
        </svg>
        {(props.markers || []).map((m) =>
          m.i === lastI ? null : (
            <span
              key={`dot-${m.i}`}
              className={`ml-dot ${m.tone || 'up'}`}
              style={{ left: xPct(m.i), top: `${(yPx(m.value) / h) * 100}%` }}
            />
          ),
        )}
        {cursorY != null && props.cursor != null ? (
          <>
            <span className="ml-cursor-dot" style={{ left: xPct(props.cursor), top: `${(cursorY / h) * 100}%` }} />
            <span className="ml-cursor-y" style={{ top: `${(cursorY / h) * 100}%` }}>
              {fmtTick(cursorVal as number)}
            </span>
          </>
        ) : null}
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
  const pctL = (v: number) => `${Math.round(v * 100)}%`
  const L = (x: number) => `${(x / w) * 100}%`
  const T = (y: number) => `${(y / h) * 100}%`
  return (
    <div>
      <div className="svg-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} className="chart scatter">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={px(t)} x2={px(t)} y1={pad.t} y2={pad.t + innerH} className="grid" />
              <line x1={pad.l} x2={pad.l + innerW} y1={py(t)} y2={py(t)} className={t === 0 ? 'base-line' : 'grid'} />
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
        </svg>
        <div className="svg-lbls" aria-hidden>
          {ticks.map((t) => (
            <Fragment key={t}>
              <span style={{ left: L(px(t)), top: T(h - 18), transform: 'translate(-50%,-50%)' }}>{pctL(t)}</span>
              {t > 0 ? (
                <span style={{ left: L(pad.l - 8), top: T(py(t)), transform: 'translate(-100%,-50%)' }}>{pctL(t)}</span>
              ) : null}
            </Fragment>
          ))}
          <span style={{ left: L(pad.l + innerW / 2), top: T(h - 4), transform: 'translate(-50%,-50%)' }}>MAE（不利）</span>
          <span style={{ left: L(12), top: '50%', transform: 'translate(-50%,-50%) rotate(-90deg)' }}>MFE（有利）</span>
        </div>
      </div>
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

export function ColorScatter(props: {
  points: Array<{ x: number; y: number; color: string; id: string; label?: string }>
  height?: number
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
  logX?: boolean
  onPick?: (id: string) => void
}) {
  if (!props.points.length) return null
  const w = 640
  const h = props.height ?? 240
  const pad = { l: 48, r: 14, t: 14, b: 30 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const tx = (v: number) => (props.logX ? Math.log10(Math.max(v, 1e-6)) : v)
  const txs = props.points.map((p) => tx(p.x))
  const ys = props.points.map((p) => p.y)
  const xmin = Math.min(...txs)
  const xmax = Math.max(...txs)
  const ymin = Math.min(...ys, 0)
  const ymax = Math.max(...ys, 0)
  const xspan = xmax - xmin || 1
  const yspan = ymax - ymin || 1
  const px = (v: number) => pad.l + ((tx(v) - xmin) / xspan) * innerW
  const py = (v: number) => pad.t + (1 - (v - ymin) / yspan) * innerH
  const yTicks = niceTicks(ymin, ymax, 4, 0)
  const xf = props.xFormat ?? ((v: number) => `${v}`)
  const yf = props.yFormat ?? ((v: number) => `${v}`)
  const xTickVals = props.logX
    ? [0.02, 0.1, 1, 10, 100, 1000].filter((v) => tx(v) >= xmin - 1e-9 && tx(v) <= xmax + 1e-9)
    : niceTicks(Math.min(...props.points.map((p) => p.x)), Math.max(...props.points.map((p) => p.x)), 4, 0)
  const L = (x: number) => `${(x / w) * 100}%`
  const T = (y: number) => `${(y / h) * 100}%`
  return (
    <div className="svg-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart scatter" preserveAspectRatio="none">
        {yTicks.map((t) => (
          <line key={t} x1={pad.l} x2={w - pad.r} y1={py(t)} y2={py(t)} className={Math.abs(t) < 1e-9 ? 'base-line' : 'grid'} />
        ))}
      </svg>
      {props.points.map((p) => (
        <button
          key={p.id}
          type="button"
          className="scatter-dot"
          style={{ left: L(px(p.x)), top: T(py(p.y)), background: p.color }}
          title={p.label}
          onClick={() => props.onPick?.(p.id)}
        />
      ))}
      <div className="svg-lbls" aria-hidden>
        {yTicks.map((t) => (
          <span key={`y${t}`} style={{ left: L(pad.l - 6), top: T(py(t)), transform: 'translate(-100%,-50%)' }}>
            {yf(t)}
          </span>
        ))}
        {xTickVals.map((t) => (
          <span key={`x${t}`} style={{ left: L(px(t)), top: T(h - 14), transform: 'translate(-50%,-50%)' }}>
            {xf(t)}
          </span>
        ))}
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
  const digits = props.n < 10 ? 0 : 1
  return (
    <div className="capture-split">
      <div className="capture-track" aria-hidden>
        <span className="cap" style={{ width: `${cap * 100}%` }} />
        <span className="give" style={{ width: `${(1 - cap) * 100}%` }} />
      </div>
      <div className="tiny">
        日线粗估｜盈利样本 {props.n} 笔｜约 {(cap * 100).toFixed(digits)}% 捕获、{((1 - cap) * 100).toFixed(digits)}% 回吐
        ｜不知盘中先后，不用于精确执行评价
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
  dim?: boolean
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
              <span className="div-amt muted">
                {item.n === 0 ? '无样本' : item.n != null && item.n < 5 ? `${item.n}笔·不排名` : '—'}
              </span>
            </div>
          )
        }
        const width = `${(Math.abs(item.value) / maxAbs) * 50}%`
        const up = item.value >= 0
        const row = (
          <>
            <span className="div-label wide">{item.label}</span>
            <div className="div-track">
              <div className={`div-bar ${up ? 'win' : 'loss'}${item.dim ? ' dim' : ''}`} style={{ width }} />
            </div>
            <span className={`div-amt ${item.dim ? 'muted' : up ? 'up' : 'down'}`}>
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
  const L = (x: number) => `${(x / w) * 100}%`
  const T = (y: number) => `${(y / h) * 100}%`
  return (
    <div className="svg-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart vbars" preserveAspectRatio="none">
        {ticks.map((t) => (
          <line
            key={t}
            x1={pad.l}
            x2={w - pad.r}
            y1={yPx(t)}
            y2={yPx(t)}
            className={Math.abs(t) < 1e-9 ? 'base-line' : 'grid'}
          />
        ))}
        {props.items.map((d, i) => {
          const x = pad.l + (i + 0.5) * gap - bw / 2
          const y = Math.min(yPx(d.value), zero)
          const bh = Math.max(1, Math.abs(yPx(d.value) - zero))
          return (
            <rect
              key={`${d.label}-${i}`}
              className="cbar"
              x={x}
              y={y}
              width={bw}
              height={bh}
              rx={2}
              fill={d.value >= 0 ? 'var(--up)' : 'var(--down)'}
            >
              <title>{`${d.label} ${fmt(d.value)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="svg-lbls" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: L(pad.l - 6), top: T(yPx(t)), transform: 'translate(-100%,-50%)' }}>
            {fmt(t)}
          </span>
        ))}
        {props.items.map((d, i) =>
          i % step === 0 || i === props.items.length - 1 ? (
            <span
              key={`${d.label}-${i}`}
              style={{ left: L(pad.l + (i + 0.5) * gap), top: T(h - 8), transform: 'translate(-50%,-50%)' }}
            >
              {d.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}

export function Histogram(props: {
  values: number[]
  format?: (v: number) => string
  bins?: number
  height?: number
  /** 在分布上标出一个参考位置(如"你在这里"),画一条竖线 + 标签。 */
  markerValue?: number
  markerLabel?: string
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
    <div className="hist-wrap" style={{ height: h }}>
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
              className="cbar"
              x={x}
              y={pad.t + innerH - bh}
              width={bw}
              height={Math.max(c ? 2 : 0, bh)}
              rx={2}
              fill={mid >= 0 ? 'var(--up)' : 'var(--down)'}
              opacity={c ? 0.92 : 0.18}
            >
              <title>{`${fmt(lo)} ~ ${fmt(hi)} · ${c} 日`}</title>
            </rect>
          )
        })}
      </svg>
      {/* 轴标签走 HTML 覆盖层,不放进被横向拉伸的 SVG,否则数字会被拉宽。 */}
      <div className="hist-x" aria-hidden>
        <span style={{ left: `${(pad.l / w) * 100}%` }}>{fmt(min)}</span>
        {min < 0 && max > 0 ? (
          <span className="mid" style={{ left: `${(xAt(0) / w) * 100}%` }}>
            0
          </span>
        ) : null}
        <span className="end" style={{ left: `${((w - pad.r) / w) * 100}%` }}>
          {fmt(max)}
        </span>
      </div>
      {props.markerValue != null ? (
        (() => {
          const mv = Math.max(min, Math.min(max, props.markerValue as number))
          const left = `${(xAt(mv) / w) * 100}%`
          return (
            <>
              <span className="hist-marker" style={{ left }} aria-hidden />
              <span className="hist-marker-lbl" style={{ left }}>
                {props.markerLabel ?? '你在这里'} {fmt(props.markerValue as number)}
              </span>
            </>
          )
        })()
      ) : null}
    </div>
  )
}

/** 蜂群:重叠的点按固定间距上下错开,避免随机抖动看起来疏密不一。 */
function beeswarmOffsets(
  values: number[],
  xPct: (v: number) => number,
  widthPx: number,
  radiusPx: number,
  maxAbsY: number,
): number[] {
  const n = values.length
  const ys = Array.from({ length: n }, () => 0)
  if (widthPx <= 0 || n === 0) return ys
  const minDist = radiusPx * 2 + 2
  const minDist2 = minDist * minDist
  const xs = values.map((v) => (xPct(v) / 100) * widthPx)
  const placed: Array<{ x: number; y: number }> = []
  const maxK = Math.max(1, Math.floor(maxAbsY / minDist))
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const candidates = [0]
    for (let k = 1; k <= maxK; k++) {
      candidates.push(k * minDist, -k * minDist)
    }
    let chosen = 0
    for (const cy of candidates) {
      let ok = true
      for (let j = 0; j < placed.length; j++) {
        const dx = placed[j].x - x
        const dy = placed[j].y - cy
        if (dx * dx + dy * dy < minDist2) {
          ok = false
          break
        }
      }
      if (ok) {
        chosen = cy
        break
      }
    }
    ys[i] = chosen
    placed.push({ x, y: chosen })
  }
  return ys
}

/**
 * 箱线 + 散点:箱=中间 50%(Q1–Q3),竖线=中位,须=正常范围,每笔一个点。
 * 极端离群值不拉伸坐标轴,而是钉在两端做成"‹N / N›"角标 —— 抗离群、信息量高。
 */
export function BoxStrip(props: { values: number[]; format?: (v: number) => string; height?: number }) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotW, setPlotW] = useState(0)
  const xs = props.values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const hasPlot = xs.length >= 4
  useLayoutEffect(() => {
    if (!hasPlot) return
    const el = plotRef.current
    if (!el) return
    const apply = () => setPlotW(el.clientWidth)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasPlot])
  if (!hasPlot) return <p className="tiny">样本太少,不画分布。</p>
  const fmt = props.format ?? ((v: number) => String(v))
  const q = (p: number) => {
    const i = (xs.length - 1) * p
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    return lo === hi ? xs[lo] : xs[lo] * (hi - i) + xs[hi] * (i - lo)
  }
  const q1 = q(0.25)
  const med = q(0.5)
  const q3 = q(0.75)
  const iqr = q3 - q1
  const wLo = Math.max(xs[0], q1 - 1.5 * iqr)
  const wHi = Math.min(xs[xs.length - 1], q3 + 1.5 * iqr)
  let domLo = Math.min(wLo, 0)
  let domHi = Math.max(wHi, 0)
  const dp = (domHi - domLo || 1) * 0.06
  domLo -= dp
  domHi += dp
  const dom = domHi - domLo || 1
  const P = 3
  const at = (v: number) => P + ((Math.max(domLo, Math.min(domHi, v)) - domLo) / dom) * (100 - 2 * P)
  const outLo = xs.filter((v) => v < domLo).length
  const outHi = xs.filter((v) => v > domHi).length
  const visible = xs.filter((v) => v >= domLo && v <= domHi)
  const swarmY = beeswarmOffsets(visible, at, plotW, 4, 38)
  const zeroIn = 0 >= domLo && 0 <= domHi
  return (
    <div className="boxstrip" style={{ height: props.height ?? 118 }}>
      <div className="bx-plot" ref={plotRef}>
        {zeroIn ? <span className="bx-zero" style={{ left: `${at(0)}%` }} /> : null}
        <span className="bx-whisker" style={{ left: `${at(wLo)}%`, width: `${at(wHi) - at(wLo)}%` }} />
        <span className="bx-cap" style={{ left: `${at(wLo)}%` }} />
        <span className="bx-cap" style={{ left: `${at(wHi)}%` }} />
        <span className="bx-box" style={{ left: `${at(q1)}%`, width: `${Math.max(0.5, at(q3) - at(q1))}%` }} />
        <span className="bx-med" style={{ left: `${at(med)}%` }} title={`中位 ${fmt(med)}`} />
        {visible.map((v, i) => (
          <span
            key={i}
            className={`bx-dot ${v >= 0 ? 'up' : 'down'}`}
            style={{ left: `${at(v)}%`, top: `calc(50% + ${swarmY[i] ?? 0}px)` }}
            title={fmt(v)}
          />
        ))}
        {outLo ? (
          <span className="bx-out left" title={`${outLo} 笔比 ${fmt(domLo)} 还差(最极端 ${fmt(xs[0])})`}>
            ‹ {outLo} 个极端
          </span>
        ) : null}
        {outHi ? (
          <span className="bx-out right" title={`${outHi} 笔比 ${fmt(domHi)} 还高(最极端 ${fmt(xs[xs.length - 1])})`}>
            {outHi} 个极端 ›
          </span>
        ) : null}
      </div>
      <div className="bx-axis" aria-hidden>
        <span style={{ left: `${at(domLo)}%` }}>{fmt(domLo)}</span>
        {zeroIn ? <span style={{ left: `${at(0)}%` }}>{fmt(0)}</span> : null}
        <span style={{ left: `${at(domHi)}%` }}>{fmt(domHi)}</span>
      </div>
    </div>
  )
}

// ---- 子弹图:一根条 + 差/中/好定性区间 + 值标记 + 可选基准线 ----
export function BulletRow(props: {
  label: string
  value: number | null
  valueText?: string
  domain: [number, number]
  bands: Array<{ to: number; tone: 'bad' | 'mid' | 'good' }>
  refMark?: number
  naText?: string
  hint?: string
}) {
  const [lo, hi] = props.domain
  const span = hi - lo || 1
  const pos = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / span) * 100}%`
  return (
    <div className="bullet">
      <span className="bullet-label" title={props.hint}>
        {props.label}
      </span>
      <div className="bullet-track">
        {props.value == null
          ? null
          : props.bands.map((b, i) => {
              const from = i === 0 ? lo : props.bands[i - 1].to
              const left = Math.max(lo, from)
              const right = Math.min(hi, b.to)
              return (
                <span
                  key={i}
                  className={`bullet-band ${b.tone}`}
                  style={{ left: pos(left), width: `${((right - left) / span) * 100}%` }}
                />
              )
            })}
        {props.value != null && props.refMark != null ? (
          <span className="bullet-ref" style={{ left: pos(props.refMark) }} />
        ) : null}
        {props.value != null ? <span className="bullet-mark" style={{ left: pos(props.value) }} /> : null}
      </div>
      <span className="bullet-val">{props.value == null ? (props.naText ?? '—') : (props.valueText ?? String(props.value))}</span>
    </div>
  )
}

// ---- 区间条(哑铃):bootstrap 置信区间 lo..hi + 点 + 基准线,直接看跨不跨基准 ----
export function RangeBar(props: {
  label: string
  lo: number | null
  hi: number | null
  value: number | null
  domain: [number, number]
  refMark: number
  format: (v: number) => string
}) {
  const [dlo, dhi] = props.domain
  const span = dhi - dlo || 1
  const pos = (v: number) => `${((Math.max(dlo, Math.min(dhi, v)) - dlo) / span) * 100}%`
  const crosses = props.lo != null && props.hi != null && props.lo <= props.refMark && props.hi >= props.refMark
  const tone = crosses ? 'warn' : props.value != null && props.value > props.refMark ? 'good' : 'bad'
  return (
    <div className="rangebar">
      <span className="rb-label">{props.label}</span>
      <div className="rb-track">
        <span className="rb-ref" style={{ left: pos(props.refMark) }} />
        {props.lo != null && props.hi != null ? (
          <span className={`rb-range ${tone}`} style={{ left: pos(props.lo), width: `${((props.hi - props.lo) / span) * 100}%` }} />
        ) : null}
        {props.value != null ? <span className="rb-dot" style={{ left: pos(props.value) }} /> : null}
      </div>
      <span className="rb-val">
        {props.value == null ? '—' : props.format(props.value)}
        {props.lo != null && props.hi != null ? (
          <i className="rb-ci">
            {' '}
            [{props.format(props.lo)}, {props.format(props.hi)}]
          </i>
        ) : null}
      </span>
    </div>
  )
}

// ---- 斜率图:A→B 两点一线,看方向 ----
export function SlopeChart(props: { a: { label: string; value: number }; b: { label: string; value: number }; format: (v: number) => string; height?: number }) {
  const h = props.height ?? 120
  const vals = [props.a.value, props.b.value, 0]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const y = (v: number) => 14 + (1 - (v - min) / span) * (h - 44)
  const up = props.b.value >= props.a.value
  return (
    <div className="slope" style={{ height: h }}>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="slope-svg">
        <line x1={22} x2={78} y1={y(props.a.value)} y2={y(props.b.value)} stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth={2} vectorEffect="nonScalingStroke" />
      </svg>
      <span className={`slope-dot ${props.a.value >= 0 ? 'up' : 'down'}`} style={{ left: '22%', top: y(props.a.value) }} />
      <span className={`slope-dot ${props.b.value >= 0 ? 'up' : 'down'}`} style={{ left: '78%', top: y(props.b.value) }} />
      <span className="slope-lbl" style={{ left: '22%', top: y(props.a.value) }}>
        {props.a.label} {props.format(props.a.value)}
      </span>
      <span className="slope-lbl right" style={{ left: '78%', top: y(props.b.value) }}>
        {props.b.label} {props.format(props.b.value)}
      </span>
    </div>
  )
}

// ---- 日历热力:每天一格,按盈亏深浅上色(GitHub 贡献图式) ----
export function CalendarHeatmap(props: { days: Array<{ date: string; value: number }>; format?: (v: number) => string }) {
  if (props.days.length < 5) return null
  const fmt = props.format ?? ((v: number) => String(v))
  const map = new Map(props.days.map((d) => [d.date, d.value]))
  const maxAbs = Math.max(...props.days.map((d) => Math.abs(d.value)), 1)
  const first = new Date(`${props.days[0].date}T00:00:00Z`)
  const last = new Date(`${props.days[props.days.length - 1].date}T00:00:00Z`)
  const s = new Date(first)
  s.setUTCDate(s.getUTCDate() - s.getUTCDay())
  const weeks: Array<Array<{ date: string; v: number | null }>> = []
  const cur = new Date(s)
  while (cur <= last) {
    const col: Array<{ date: string; v: number | null }> = []
    for (let d = 0; d < 7; d++) {
      const key = cur.toISOString().slice(0, 10)
      col.push({ date: key, v: map.has(key) ? (map.get(key) as number) : null })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    weeks.push(col)
  }
  const cellBg = (v: number | null) => {
    if (v == null || v === 0) return 'var(--panel2)'
    const pctv = Math.round((0.2 + 0.8 * Math.min(1, Math.abs(v) / maxAbs)) * 100)
    return `color-mix(in srgb, var(${v > 0 ? '--up' : '--down'}) ${pctv}%, transparent)`
  }
  const PITCH = 15 // cell 12px + gap 3px
  const monthMarks: Array<{ week: number; label: string }> = []
  const yearMarks: Array<{ week: number; label: string }> = []
  let prevMonth = ''
  let prevYear = ''
  weeks.forEach((col, wi) => {
    const hit = col.find((c) => c.v != null) ?? col[0]
    const year = hit.date.slice(0, 4)
    const mo = hit.date.slice(5, 7)
    if (year !== prevYear) {
      yearMarks.push({ week: wi, label: `${year}年` })
      prevYear = year
    }
    if (mo !== prevMonth) {
      monthMarks.push({ week: wi, label: `${Number(mo)}月` })
      prevMonth = mo
    }
  })
  const wdays = ['', '一', '', '三', '', '五', '']
  return (
    <div className="cal-heat">
      <div className="cal-grid">
        <div className="cal-years">
          {yearMarks.map((y) => (
            <span key={y.week} style={{ left: y.week * PITCH }}>
              {y.label}
            </span>
          ))}
        </div>
        <div className="cal-months">
          {monthMarks.map((m) => (
            <span key={m.week} style={{ left: m.week * PITCH }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="cal-body">
          <div className="cal-wdays">
            {wdays.map((d, i) => (d ? <span key={i} style={{ top: i * PITCH }}>{d}</span> : null))}
          </div>
          <div className="cal-weeks">
            {weeks.map((col, wi) => (
              <div key={wi} className="cal-col">
                {col.map((c) => (
                  <span key={c.date} className="cal-cell" style={{ background: cellBg(c.v) }} title={c.v == null ? c.date : `${c.date} · ${fmt(c.v)}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cal-legend">
        <span>亏</span>
        <span className="cal-cell" style={{ background: 'color-mix(in srgb, var(--down) 85%, transparent)' }} />
        <span className="cal-cell" style={{ background: 'color-mix(in srgb, var(--down) 40%, transparent)' }} />
        <span className="cal-cell" style={{ background: 'var(--panel2)' }} />
        <span className="cal-cell" style={{ background: 'color-mix(in srgb, var(--up) 40%, transparent)' }} />
        <span className="cal-cell" style={{ background: 'color-mix(in srgb, var(--up) 85%, transparent)' }} />
        <span>赚</span>
      </div>
    </div>
  )
}

function ymLabel(isoYm: string) {
  const [y, m] = isoYm.split('-')
  if (!y || !m) return isoYm
  return `${y.slice(2)}年${Number(m)}月`
}

/** 按平仓顺序等宽画每一笔,叠累计已实现。日历空档不再把图拉稀。 */
export function PnlSequence(props: {
  points: Array<{ id: string; t: number; v: number; label?: string }>
  format?: (v: number) => string
  height?: number
  onPick?: (id: string) => void
}) {
  if (!props.points.length) return null
  const rows = [...props.points].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
  let run = 0
  const series = rows.map((p) => {
    run += p.v
    return { ...p, cum: run }
  })
  const w = 640
  const h = props.height ?? 168
  const pad = { l: 44, r: 40, t: 10, b: 28 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const maxAbs = Math.max(...series.flatMap((p) => [Math.abs(p.v), Math.abs(p.cum)]), 1)
  const yPx = (v: number) => pad.t + (1 - (v + maxAbs) / (2 * maxAbs)) * innerH
  const zero = yPx(0)
  const gap = innerW / series.length
  const bw = Math.max(3, Math.min(16, gap * 0.72))
  const xAt = (i: number) => pad.l + (i + 0.5) * gap
  const fmt = props.format ?? moneyK
  const ticks = niceTicks(-maxAbs, maxAbs, 4, 0)
  const dates = series.map((p) => etDateKey(new Date(p.t)))
  let xLabels = dateTickLabels(dates, series.length).map((x) => ({ i: x.i, label: ymLabel(x.label) }))
  if (xLabels.length <= 1 && series.length > 1) {
    xLabels = [
      { i: 0, label: dates[0].slice(5).replace('-', '/') },
      { i: series.length - 1, label: dates[series.length - 1].slice(5).replace('-', '/') },
    ]
  }
  const cumPath = series.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yPx(p.cum).toFixed(1)}`).join(' ')
  const last = series[series.length - 1]
  const L = (x: number) => `${(x / w) * 100}%`
  const T = (y: number) => `${(y / h) * 100}%`
  return (
    <div className="svg-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart vbars" preserveAspectRatio="none">
        {ticks.map((t) => (
          <line
            key={t}
            x1={pad.l}
            x2={w - pad.r}
            y1={yPx(t)}
            y2={yPx(t)}
            className={Math.abs(t) < 1e-9 ? 'base-line' : 'grid'}
          />
        ))}
        {series.map((p, i) => {
          const x = xAt(i) - bw / 2
          const y = Math.min(yPx(p.v), zero)
          const bh = Math.max(2, Math.abs(yPx(p.v) - zero))
          return (
            <g key={p.id}>
              <rect
                x={pad.l + i * gap}
                y={pad.t}
                width={gap}
                height={innerH}
                fill="transparent"
                className="seq-hit"
                onClick={() => props.onPick?.(p.id)}
              >
                <title>{p.label || fmt(p.v)}</title>
              </rect>
              <rect
                className="cbar"
                x={x}
                y={y}
                width={bw}
                height={bh}
                rx={2}
                fill={p.v >= 0 ? 'var(--up)' : 'var(--down)'}
                pointerEvents="none"
              />
            </g>
          )
        })}
        {series.length > 1 ? (
          <path
            d={cumPath}
            fill="none"
            stroke="var(--gold)"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="nonScalingStroke"
            pointerEvents="none"
          />
        ) : null}
      </svg>
      <div className="svg-lbls" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: L(pad.l - 6), top: T(yPx(t)), transform: 'translate(-100%,-50%)' }}>
            {fmt(t)}
          </span>
        ))}
        {xLabels.map((x) => (
          <span key={x.i} style={{ left: L(xAt(x.i)), top: T(h - 8), transform: 'translate(-50%,-50%)' }}>
            {x.label}
          </span>
        ))}
        <span className="ml-end" style={{ left: L(xAt(series.length - 1)), top: T(yPx(last.cum)) }}>
          {fmt(last.cum)}
        </span>
      </div>
    </div>
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
