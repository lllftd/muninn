import { Fragment, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { money, moneyK } from '../lib/format.ts'
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

function steppedTicks(min: number, max: number, step: number, pin?: number): number[] {
  if (!(step > 0)) return niceTicks(min, max, 4, pin)
  const ticks: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(8)))
  if (pin != null && min <= pin && max >= pin && !ticks.some((t) => Math.abs(t - pin) < step * 1e-6)) ticks.push(pin)
  return ticks.sort((a, b) => a - b)
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

export type PathMarker = {
  i: number
  value: number
  text?: string
  kicker?: string
  amount?: string
  tone?: 'up' | 'down' | 'now'
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
  tickStep?: number
  dates?: string[]
  hideDates?: boolean
  tight?: boolean
  axisReadout?: boolean
  markerDots?: boolean
  endLabel?: { value: number; text: string }
  markers?: PathMarker[]
  /** 盈亏这类跨零数据用符号感填充:零线以上一色、以下一色,比单色描边可读得多。 */
  signedFill?: { up: string; down: string }
  /** 从 baseline 向下的面积填充（回撤图）。 */
  areaFill?: boolean
  /** 分位带(如蒙特卡洛扇形):在 lo~hi 之间填一层实色半透明区域,画在线之下。 */
  bands?: Array<{ lo: number[]; hi: number[]; fill: string }>
  /** 区间阴影，如最大回撤从峰到谷。 */
  shadeRange?: { lo: number; hi: number; fill: string }
  /** 水位线与曲线之间的回撤伤口，仅窗口内。 */
  wound?: { lo: number; hi: number }
  /** 曲线上的胜负点，r 为像素半径。 */
  dots?: Array<{ i: number; value: number; up: boolean; r: number; label?: string }>
  /** 竖向参考线，如「参数越紧越好 = 过拟合」。 */
  vRef?: { i: number; label: string }
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
  const pad = { l: 2, r: props.tight ? 10 : 96, t: 18, b: props.vRef ? 28 : props.tight ? 8 : 18 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const xAt = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * innerW
  const yPx = (v: number) => pad.t + (1 - (v - yMin) / span) * innerH
  const yPct = (v: number) => `${((v - yMin) / span) * 100}%`
  const xPct = (i: number) => `${(xAt(i) / w) * 100}%`
  const fmtTick = props.tickFormat ?? ((t: number) => (t / 100).toFixed(2))
  const origin = useRef<number | null>(null)
  const ticks = props.tickStep
    ? steppedTicks(yMin + padAmt * 0.08, yMax - padAmt * 0.08, props.tickStep, baseline)
    : niceTicks(yMin + padAmt * 0.15, yMax - padAmt * 0.15, 4, baseline)
  const dates = !props.hideDates && props.dates && props.dates.length === n ? dateTickLabels(props.dates, n) : []
  const axisReadout = props.axisReadout !== false
  const markerDots = props.markerDots !== false
  const values0 = props.series[0]?.values ?? []
  const woundD = (() => {
    const wn = props.wound
    if (!wn || !values0.length || wn.hi <= wn.lo) return null
    const lo = Math.max(0, Math.min(wn.lo, values0.length - 1))
    const hi = Math.max(lo, Math.min(wn.hi, values0.length - 1))
    const peak = values0[lo]
    let d = `M${xAt(lo).toFixed(1)},${yPx(peak).toFixed(1)}`
    for (let i = lo; i <= hi; i++) d += ` L${xAt(i).toFixed(1)},${yPx(Math.min(values0[i], peak)).toFixed(1)}`
    d += ` L${xAt(hi).toFixed(1)},${yPx(peak).toFixed(1)} Z`
    return d
  })()
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
  const labels: Array<{
    key: string
    kicker?: string
    amount?: string
    text?: string
    left: string
    top: number
    className: string
    i: number
    value: number
    below: boolean
  }> = []
  const lastI = Math.max(n - 1, 0)
  for (const m of props.markers || []) {
    if (m.i === lastI && props.endLabel) continue
    const nearRight = n > 1 && m.i / Math.max(n - 1, 1) > 0.72
    const below = m.tone === 'down'
    labels.push({
      key: `m-${m.i}-${m.kicker || m.text || ''}`,
      kicker: m.kicker,
      amount: m.amount,
      text: m.text,
      left: nearRight ? `calc(${xPct(m.i)} - 6px)` : xPct(m.i),
      top: yPx(m.value) + (below ? 18 : -18),
      className: `ml-mark ${m.tone || ''} ${nearRight ? 'near-right' : ''} ${below ? 'below' : ''}`,
      i: m.i,
      value: m.value,
      below,
    })
  }
  if (props.endLabel && n) {
    labels.push({
      key: 'end',
      text: props.endLabel.text,
      left: `calc(${xPct(lastI)} + 10px)`,
      top: yPx(props.endLabel.value),
      className: 'ml-end',
      i: lastI,
      value: props.endLabel.value,
      below: false,
    })
  }
  labels.sort((a, b) => a.top - b.top)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].top - labels[i - 1].top < 14) labels[i].top = labels[i - 1].top + 14
  }
  const cursorVal = props.cursor != null ? props.series[0]?.values[props.cursor] ?? null : null
  const cursorY = cursorVal != null && Number.isFinite(cursorVal) ? yPx(cursorVal) : null
  return (
    <div className={`ml-chart${props.tight ? ' tight' : ''}`}>
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
          {props.areaFill ? (
            <defs>
              <linearGradient id={`${uid}-area`} x1="0" y1={yPx(baseline)} x2="0" y2={yPx(dataMin)} gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="var(--down)" stopOpacity="0.05" />
                <stop offset="100%" stopColor="var(--down)" stopOpacity="0.34" />
              </linearGradient>
            </defs>
          ) : null}
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
          {woundD ? <path d={woundD} className="ml-wound" style={{ fill: 'var(--wound-fill)' }} /> : null}
          {props.shadeRange && !woundD && props.shadeRange.hi > props.shadeRange.lo ? (
            <rect
              x={xAt(props.shadeRange.lo)}
              y={pad.t}
              width={Math.max(1, xAt(props.shadeRange.hi) - xAt(props.shadeRange.lo))}
              height={innerH}
              fill={props.shadeRange.fill}
              opacity={0.55}
            />
          ) : null}
          {(props.bands || []).map((b, bi) => (
            <path key={`band-${bi}`} d={bandPath(b.lo, b.hi)} fill={b.fill} />
          ))}
          {props.series.map((s, i) => {
            const d = pathFor(s.values)
            const baseY = yPx(baseline)
            const signed = props.signedFill && i === 0 && !props.areaFill
            const lw = s.width ?? 1.8
            return (
              <g key={i}>
                {props.areaFill && i === 0 ? (
                  <path d={areaFor(s.values, baseline)} fill={`url(#${uid}-area)`} />
                ) : signed ? (
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
                {lw >= 2 && !s.dash && !props.tight ? (
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
          {props.vRef ? (
            <line
              x1={xAt(props.vRef.i)}
              x2={xAt(props.vRef.i)}
              y1={pad.t}
              y2={pad.t + innerH}
              className="vref-line"
              vectorEffect="nonScalingStroke"
            />
          ) : null}
          {(props.dots || []).map((d, di) => (
            <circle
              key={`dot-${d.i}-${di}`}
              cx={xAt(d.i)}
              cy={yPx(d.value)}
              r={d.r}
              fill={d.up ? 'var(--up)' : 'var(--down)'}
              opacity={0.85}
            >
              {d.label ? <title>{d.label}</title> : null}
            </circle>
          ))}
          {labels
            .filter((lab) => lab.className.includes('ml-mark'))
            .map((lab) => (
              <line
                key={`ld-${lab.key}`}
                x1={xAt(lab.i)}
                x2={xAt(lab.i)}
                y1={yPx(lab.value)}
                y2={lab.top}
                className="ml-leader"
                vectorEffect="nonScalingStroke"
              />
            ))}
          {props.cursor != null && n ? (
            <line
              x1={xAt(props.cursor)}
              x2={xAt(props.cursor)}
              y1={pad.t}
              y2={pad.t + innerH}
              className="cursor-line"
              vectorEffect="nonScalingStroke"
            />
          ) : null}
          {cursorY != null && props.cursor != null ? (
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={cursorY}
              y2={cursorY}
              className="cursor-line"
              vectorEffect="nonScalingStroke"
            />
          ) : null}
        </svg>
        {markerDots
          ? (props.markers || []).map((m) =>
              m.i === lastI && props.endLabel ? null : (
                <span
                  key={`dot-${m.i}-${m.kicker || ''}`}
                  className={`ml-dot ${m.tone || 'up'}`}
                  style={{ left: xPct(m.i), top: `${(yPx(m.value) / h) * 100}%` }}
                />
              ),
            )
          : null}
        {axisReadout && cursorY != null && props.cursor != null ? (
          <>
            <span className="ml-cursor-dot" style={{ left: xPct(props.cursor), top: `${(cursorY / h) * 100}%` }} />
            <span className="ml-cursor-y" style={{ top: `${(cursorY / h) * 100}%` }}>
              {fmtTick(cursorVal as number)}
            </span>
          </>
        ) : null}
        {labels.map((lab) => (
          <span key={lab.key} className={lab.className} style={{ left: lab.left, top: `${(lab.top / h) * 100}%` }}>
            {lab.kicker ? <em>{lab.kicker}</em> : null}
            {lab.amount || lab.text ? (
              <>
                {lab.kicker ? ' ' : null}
                <b>{lab.amount || lab.text}</b>
              </>
            ) : null}
          </span>
        ))}
        {props.vRef ? (
          <span className="vref-lbl" style={{ left: xPct(props.vRef.i) }}>
            {props.vRef.label}
          </span>
        ) : null}
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

export type ForestItem = {
  id: string
  label: string
  value: number | null
  lo?: number | null
  hi?: number | null
  unboundedHi?: boolean
  n?: number
  dim?: boolean
  lead?: boolean
  note?: string
}

function forestTone(item: ForestItem, ref: number): 'up' | 'down' | 'unsure' {
  if (item.value == null || !Number.isFinite(item.value)) return 'unsure'
  const lo = item.lo != null && Number.isFinite(item.lo) ? item.lo : null
  const hi = item.unboundedHi ? Number.POSITIVE_INFINITY : item.hi != null && Number.isFinite(item.hi) ? item.hi : null
  if (lo == null || hi == null) {
    if (item.value > ref) return 'up'
    if (item.value < ref) return 'down'
    return 'unsure'
  }
  if (lo > ref) return 'up'
  if (hi < ref) return 'down'
  return 'unsure'
}

export function ForestPlot(props: {
  items: ForestItem[]
  refMark?: number
  format?: (v: number) => string
  onPick?: (id: string) => void
}) {
  const ref = props.refMark ?? 0
  const fmt = props.format ?? ((v: number) => String(v))
  const nums: number[] = [ref]
  for (const item of props.items) {
    if (item.value != null && Number.isFinite(item.value)) nums.push(item.value)
    if (item.lo != null && Number.isFinite(item.lo)) nums.push(item.lo)
    if (!item.unboundedHi && item.hi != null && Number.isFinite(item.hi)) nums.push(item.hi)
  }
  if (nums.length < 2 && nums[0] === ref) {
    const any = props.items.some((x) => x.n != null)
    if (!any && props.items.every((x) => x.value == null)) return <p className="tiny">没有可画的数据。</p>
  }
  let min = Math.min(...nums)
  let max = Math.max(...nums)
  if (max - min < 1e-9) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.18
  min -= pad
  max += pad
  const span = max - min
  const xPct = (v: number) => `${((v - min) / span) * 100}%`
  const ticks = niceTicks(min, max, 4, ref)

  return (
    <div className="forest">
      <div className="forest-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t} className={`forest-tick${t === ref ? ' ref' : ''}`} style={{ left: xPct(t) }}>
            {fmt(t)}
          </span>
        ))}
      </div>
      {props.items.map((item) => {
        const tone = forestTone(item, ref)
        const hasVal = item.value != null && Number.isFinite(item.value)
        const rawLo = item.lo != null && Number.isFinite(item.lo) ? item.lo : null
        const rawHi = item.unboundedHi ? max : item.hi != null && Number.isFinite(item.hi) ? item.hi : null
        const hasWhisker = rawLo != null && rawHi != null && rawHi - rawLo > 1e-9
        const clipLo = hasWhisker && rawLo! < min + span * 0.008
        const clipHi = hasWhisker && !item.unboundedHi && rawHi! > max - span * 0.008
        const lo = hasWhisker ? Math.max(rawLo!, min) : null
        const hi = hasWhisker ? Math.min(rawHi!, max) : null
        const mid = hasWhisker ? (lo! + hi!) / 2 : 0
        const cross = hasWhisker && tone === 'unsure'
        const note = item.note
        const body = (
          <>
            <span className="forest-label">{item.label}</span>
            <div className="forest-track">
              <i className="forest-ref" style={{ left: xPct(ref) }} />
              {hasWhisker && lo != null && hi != null ? (
                <i
                  className={`forest-whisker${item.unboundedHi ? ' open-hi' : ''}${clipLo ? ' clip-lo' : ''}${clipHi ? ' clip-hi' : ''}`}
                  title={rawLo != null && rawHi != null ? `${fmt(rawLo)} 至 ${fmt(rawHi)}` : undefined}
                  style={{
                    left: xPct(mid),
                    // 极窄区间(如全是 -$4~-$6 的小额单)在宽轴上只有 1-2px,会被圆点吞掉;
                    // 给一个 22px 地板宽,让端帽露出圆点之外,读成"区间很紧",而不是"没有须"。
                    width: `max(22px, calc(${xPct(hi)} - ${xPct(lo)}))`,
                  }}
                />
              ) : null}
              {hasVal ? <i className="forest-dot" style={{ left: xPct(item.value!)} } /> : null}
            </div>
            <span className="forest-amt">
              {hasVal ? fmt(item.value!) : item.n === 0 ? '无样本' : item.n != null && item.n < 5 ? `${item.n}笔·不画须` : '—'}
              {item.n != null && hasVal ? <i className="bar-n">n={item.n}</i> : null}
              {cross ? (
                <i className="forest-badge" title="须穿过 0，还锁不住正负">
                  ⊗
                </i>
              ) : null}
              {note ? <em className="forest-note">{note}</em> : null}
            </span>
          </>
        )
        const cls = `forest-row ${tone}${item.dim ? ' dim' : ''}${item.lead || item.id === 'all' ? ' lead' : ''}`
        if (props.onPick) {
          return (
            <button type="button" key={item.id} className={`${cls} as-btn`} onClick={() => props.onPick?.(item.id)}>
              {body}
            </button>
          )
        }
        return (
          <div key={item.id} className={cls}>
            {body}
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
function niceCeil(v: number): number {
  const a = Math.abs(v)
  if (!(a > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(a))
  const n = a / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * mag
}

/** 对称盈亏轴：用数据峰值向上取整到 1–2–2.5–5–8–10。 */
export function signedBound(values: number[]): number {
  const peak = Math.max(...values.filter((v) => Number.isFinite(v)).map((v) => Math.abs(v)), 1)
  return niceCeil(peak)
}

function hexOffsets(maxRings: number, dist: number): Array<{ dx: number; dy: number }> {
  const out: Array<{ dx: number; dy: number }> = []
  for (let q = -maxRings; q <= maxRings; q++) {
    for (let r = -maxRings; r <= maxRings; r++) {
      if (Math.abs(q + r) > maxRings) continue
      out.push({ dx: dist * (q + r / 2), dy: dist * r * 0.86602540378 })
    }
  }
  out.sort((a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy))
  return out
}

function beeswarmPack(
  values: number[],
  xPct: (v: number) => number,
  widthPx: number,
  radiusPx: number,
  maxRings: number,
): { dx: Array<number | null>; ys: Array<number | null>; leftover: number[] } {
  const n = values.length
  const dxs: Array<number | null> = Array.from({ length: n }, () => 0)
  const ys: Array<number | null> = Array.from({ length: n }, () => 0)
  const leftover: number[] = []
  if (widthPx <= 0 || n === 0) return { dx: dxs, ys, leftover }
  const minDist = radiusPx * 2 + 2
  const minDist2 = minDist * minDist
  const xs = values.map((v) => (xPct(v) / 100) * widthPx)
  const slots = hexOffsets(maxRings, minDist)
  const placed: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const x0 = xs[i]
    let chosen: { dx: number; dy: number } | null = null
    for (const slot of slots) {
      const x = x0 + slot.dx
      const y = slot.dy
      let ok = true
      for (let j = 0; j < placed.length; j++) {
        const ddx = placed[j].x - x
        const ddy = placed[j].y - y
        if (ddx * ddx + ddy * ddy < minDist2) {
          ok = false
          break
        }
      }
      if (ok) {
        chosen = slot
        break
      }
    }
    if (!chosen) {
      dxs[i] = null
      ys[i] = null
      leftover.push(i)
    } else {
      dxs[i] = chosen.dx
      ys[i] = chosen.dy
      placed.push({ x: x0 + chosen.dx, y: chosen.dy })
    }
  }
  return { dx: dxs, ys, leftover }
}

function beeswarmOffsets(
  values: number[],
  xPct: (v: number) => number,
  widthPx: number,
  radiusPx: number,
  maxAbsY: number,
  side: 'both' | 'up' = 'both',
): number[] {
  const n = values.length
  const ys = Array.from({ length: n }, () => 0)
  if (widthPx <= 0 || n === 0) return ys
  const minDist = radiusPx * 2 + 2
  const minDist2 = minDist * minDist
  const xs = values.map((v) => (xPct(v) / 100) * widthPx)
  const placed: Array<{ x: number; y: number }> = []
  const maxK = Math.max(1, Math.floor(maxAbsY / minDist))
  const oneSided = side === 'up'
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const candidates = [0]
    for (let k = 1; k <= maxK; k++) {
      if (oneSided) candidates.push(k * minDist)
      else candidates.push(k * minDist, -k * minDist)
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
export function BoxStrip(props: {
  values?: number[]
  points?: Array<{ id: string; v: number; label?: string }>
  format?: (v: number) => string
  height?: number
  onPick?: (id: string) => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotW, setPlotW] = useState(0)
  // 支持两种入参:纯数值 or 带 id 的点(带 id 才能点击跳明细)。统一排序后保留 id 关联。
  const pts = (props.points ?? (props.values ?? []).map((v, i) => ({ id: String(i), v, label: undefined })))
    .filter((p) => Number.isFinite(p.v))
    .sort((a, b) => a.v - b.v)
  const xs = pts.map((p) => p.v)
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
  const visiblePts = pts.filter((p) => p.v >= domLo && p.v <= domHi)
  const visible = visiblePts.map((p) => p.v)
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
        {visiblePts.map((pt, i) => {
          const style = { left: `${at(pt.v)}%`, top: `calc(50% + ${swarmY[i] ?? 0}px)` }
          const cls = `bx-dot ${pt.v >= 0 ? 'up' : 'down'}`
          const title = pt.label || fmt(pt.v)
          return props.onPick ? (
            <button key={pt.id} type="button" className={cls} style={style} title={title} onClick={() => props.onPick?.(pt.id)} />
          ) : (
            <span key={pt.id} className={cls} style={style} title={title} />
          )
        })}
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
  ticks?: Array<{ at: number; text: string }>
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
      <div className="bullet-plot">
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
        {props.ticks?.length ? (
          <div className="bullet-ticks">
            {props.ticks.map((t) => (
              <span key={t.at} style={{ left: pos(t.at) }}>
                {t.text}
              </span>
            ))}
          </div>
        ) : null}
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

export function PnlSwarm(props: {
  points: Array<{ id: string; v: number; label?: string }>
  format?: (v: number) => string
  bound?: number
  onPick?: (id: string) => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotW, setPlotW] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const rows = props.points.filter((p) => Number.isFinite(p.v))
  useLayoutEffect(() => {
    const el = plotRef.current
    if (!el) return
    const apply = () => setPlotW(el.clientWidth)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows.length])
  if (!rows.length) return null
  const fmt = props.format ?? money
  const sorted = [...rows].sort((a, b) => a.v - b.v || a.id.localeCompare(b.id))
  // 蜂群用 Tukey 上须(Q3+1.5·IQR 的绝对值)当稳健量程:主体铺满宽度、不挤成一坨,
  // 只有真正离群的极端单笔(如 ±$6k)才钳到边缘并单独标注。比"绝对值分位"更抗"多数都是小额"的场景。
  const qOf = (arr: number[], q: number) => {
    if (!arr.length) return 0
    const i = (arr.length - 1) * q
    const loI = Math.floor(i)
    const hiI = Math.ceil(i)
    return loI === hiI ? arr[loI] : arr[loI] * (hiI - i) + arr[hiI] * (i - loI)
  }
  const asc = sorted.map((p) => p.v)
  const q1 = qOf(asc, 0.25)
  const q3 = qOf(asc, 0.75)
  const iqr = q3 - q1
  const fence = Math.max(Math.abs(q1 - 1.5 * iqr), Math.abs(q3 + 1.5 * iqr))
  const bound = Math.max(fence, 1)
  const padAmt = bound * 0.06
  const lo = -bound - padAmt
  const hi = bound + padAmt
  const span = hi - lo || 1
  const at = (v: number) => ((Math.max(lo, Math.min(hi, v)) - lo) / span) * 100
  const outLo = sorted.filter((p) => p.v < lo)
  const outHi = sorted.filter((p) => p.v > hi)
  const r = 4
  const pitch = r * 2 + 2
  const maxRings = expanded ? 7 : 4
  const packed = beeswarmPack(
    sorted.map((p) => p.v),
    at,
    plotW,
    r,
    maxRings,
  )
  const placedYs = packed.ys.filter((y): y is number => y != null)
  const placedDx = packed.dx.filter((x): x is number => x != null)
  const placedH = Math.max(0, ...placedYs.map((y) => Math.abs(y)), ...placedDx.map((x) => Math.abs(x)))
  const leftover = packed.leftover
  const clusterOffset = leftover.length ? placedH + pitch + 6 : placedH
  const clusters = (() => {
    if (!leftover.length) return [] as Array<{ key: string; n: number; x: number; y: number; up: boolean; ids: string[] }>
    const bins = new Map<string, number[]>()
    const binW = 16
    for (const i of leftover) {
      const x = (at(sorted[i].v) / 100) * Math.max(plotW, 1)
      const up = sorted[i].v >= 0
      const key = `${up ? 'u' : 'd'}:${Math.round(x / binW)}`
      const arr = bins.get(key) || []
      arr.push(i)
      bins.set(key, arr)
    }
    return [...bins.entries()].map(([key, idxs]) => {
      const up = key.startsWith('u')
      const xs = idxs.map((i) => at(sorted[i].v))
      const x = xs.reduce((a, b) => a + b, 0) / xs.length
      return {
        key,
        n: idxs.length,
        x,
        y: up ? -clusterOffset : clusterOffset,
        up,
        ids: idxs.map((i) => sorted[i].id),
      }
    })
  })()
  const cloudH = Math.max(placedH, ...clusters.map((c) => Math.abs(c.y)))
  const stageH = Math.min(150, Math.max(72, cloudH * 2 + 24)) // 限高,不让密集堆叠拉出一根柱
  const ticks = [-bound, 0, bound]

  return (
    <div className="swarm">
      <div className="swarm-stage" ref={plotRef} style={{ height: stageH }}>
        <i className="swarm-zero" style={{ left: `${at(0)}%` }} />
        <i className="swarm-base" />
        {sorted.map((p, i) => {
          const y = packed.ys[i]
          const dx = packed.dx[i]
          if (y == null || dx == null) return null
          const cls = `swarm-dot ${p.v >= 0 ? 'up' : 'down'}`
          const style = { left: `calc(${at(p.v)}% + ${dx}px)`, top: `calc(50% + ${y}px)` }
          const title = p.label || fmt(p.v)
          if (props.onPick) {
            return (
              <button
                key={p.id}
                type="button"
                className={cls}
                style={style}
                title={title}
                onClick={() => props.onPick?.(p.id)}
              />
            )
          }
          return <span key={p.id} className={cls} style={style} title={title} />
        })}
        {clusters.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`swarm-cluster ${c.up ? 'up' : 'down'}`}
            style={{ left: `${c.x}%`, top: `calc(50% + ${c.y}px)` }}
            title={`还有 ${c.n} 笔挤在这里，点击展开`}
            onClick={() => setExpanded(true)}
          >
            ×{c.n}
          </button>
        ))}
        {expanded ? (
          <button type="button" className="swarm-fold" onClick={() => setExpanded(false)}>
            收起
          </button>
        ) : null}
        {outLo.length ? (
          <span className="swarm-out start" title={outLo.map((p) => p.label || fmt(p.v)).join('\n')}>
            ‹ {outLo.length} 笔更亏 · 最惨 {fmt(Math.min(...outLo.map((p) => p.v)))}
          </span>
        ) : null}
        {outHi.length ? (
          <span className="swarm-out end" title={outHi.map((p) => p.label || fmt(p.v)).join('\n')}>
            {outHi.length} 笔更赚 · 最高 {fmt(Math.max(...outHi.map((p) => p.v)))} ›
          </span>
        ) : null}
      </div>
      <div className="swarm-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${at(t)}%` }}>
            {fmt(t)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function TimePnlBars(props: {
  points: Array<{ id: string; t: number; v: number; label?: string }>
  height?: number
  format?: (v: number) => string
  bound?: number
  onPick?: (id: string) => void
}) {
  if (!props.points.length) return null
  const rows = [...props.points].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
  const w = 640
  const h = props.height ?? 72
  const pad = { l: 48, r: 12, t: 6, b: 16 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const tMin = rows[0].t
  const tMax = rows[rows.length - 1].t
  const maxAbs = props.bound ?? signedBound(rows.map((p) => p.v))
  const yPx = (v: number) => pad.t + (1 - (v + maxAbs) / (2 * maxAbs)) * innerH
  const zero = yPx(0)
  // 等距序列排布:每笔一个槽,按平仓时间先后排,不按真实时间距离 —— 密集期不再叠、稀疏期不再空。
  const slot = innerW / Math.max(rows.length, 1)
  const xAt = (i: number) => pad.l + (i + 0.5) * slot
  const bw = Math.max(2, Math.min(10, slot * 0.62))
  const fmt = props.format ?? money
  const ticks = [-maxAbs, 0, maxAbs]
  const L = (x: number) => `${(x / w) * 100}%`
  const T = (y: number) => `${(y / h) * 100}%`
  return (
    <div className="svg-wrap spark" style={{ height: h }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="chart vbars spark" preserveAspectRatio="none">
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
        {rows.map((p, i) => {
          const x = xAt(i) - bw / 2
          const clipped = Math.max(-maxAbs, Math.min(maxAbs, p.v))
          const overflow = Math.abs(p.v) > maxAbs + 1e-6
          const y = Math.min(yPx(clipped), zero)
          const bh = Math.max(2, Math.abs(yPx(clipped) - zero))
          return (
            <g key={p.id}>
              <rect
                x={x - 2}
                y={pad.t}
                width={bw + 4}
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
                rx={1}
                fill={p.v >= 0 ? 'var(--up)' : 'var(--down)'}
                pointerEvents="none"
              />
              {overflow ? (
                <polygon
                  points={
                    clipped >= 0
                      ? `${x + bw / 2},${pad.t} ${x},${pad.t + 5} ${x + bw},${pad.t + 5}`
                      : `${x + bw / 2},${pad.t + innerH} ${x},${pad.t + innerH - 5} ${x + bw},${pad.t + innerH - 5}`
                  }
                  fill={p.v >= 0 ? 'var(--up)' : 'var(--down)'}
                  pointerEvents="none"
                />
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className="svg-lbls" aria-hidden>
        {ticks.map((t) => (
          <span key={`y-${t}`} style={{ left: L(pad.l - 6), top: T(yPx(t)), transform: 'translate(-100%,-50%)' }}>
            {fmt(t)}
          </span>
        ))}
        <span style={{ left: L(xAt(0)), top: T(h - 8), transform: 'translate(-50%,-50%)' }}>
          {etDateKey(new Date(tMin)).slice(5)}
        </span>
        <span style={{ left: L(xAt(rows.length - 1)), top: T(h - 8), transform: 'translate(-50%,-50%)' }}>
          {etDateKey(new Date(tMax)).slice(5)}
        </span>
      </div>
    </div>
  )
}

// ---- 盈亏台账:右对齐数字 + 小计分隔线。对"某一项(如未实现)碾压其余"的极端结构,
//      台账比任何柱状/浮条都清楚 —— 不失真、可直接读出"已实现基本打平,亏在未实现"。 ----
export function WaterfallFlow(props: {
  steps: Array<{ id: string; label: string; delta: number; total?: boolean }>
  format?: (v: number) => string
}) {
  if (!props.steps.length) return null
  const fmt = props.format ?? money
  // 在"已实现类"(win/loss)之后插一条小计;total 行(净盈亏)前也是一条分隔线。
  const realizedIds = new Set(['win', 'loss'])
  const realizedSum = props.steps.filter((s) => realizedIds.has(s.id)).reduce((a, s) => a + s.delta, 0)
  const hasRealizedSplit = props.steps.some((s) => s.id === 'win') && props.steps.some((s) => !realizedIds.has(s.id) && !s.total)
  const toneOf = (v: number, total?: boolean) => (total ? 'total' : v >= 0 ? 'up' : 'down')
  const out: Array<{ key: string; label: string; value: number; tone: string; rule?: boolean; sub?: boolean }> = []
  for (const s of props.steps) {
    if (s.total) out.push({ key: s.id, label: s.label, value: s.delta, tone: 'total', rule: true })
    else out.push({ key: s.id, label: s.label, value: s.delta, tone: toneOf(s.delta) })
    if (hasRealizedSplit && s.id === 'loss') {
      out.push({ key: 'realized-sub', label: '已实现小计', value: realizedSum, tone: toneOf(realizedSum), sub: true })
    }
  }
  return (
    <div className="ledger">
      {out.map((r) => (
        <div key={r.key} className={`ledger-row${r.rule ? ' rule' : ''}${r.sub ? ' sub' : ''}`}>
          <span className="ledger-label">{r.label}</span>
          <span className={`ledger-amt ${r.tone}`}>{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function Waterfall(props: {
  steps: Array<{ id: string; label: string; delta: number; total?: boolean; note?: string }>
  format?: (v: number) => string
  height?: number
}) {
  if (!props.steps.length) return null
  const fmt = props.format ?? money
  const w = 640
  const h = props.height ?? 188
  const pad = { l: 44, r: 16, t: 22, b: 28 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  let run = 0
  const rows = props.steps.map((s) => {
    if (s.total) return { ...s, from: 0, to: s.delta }
    const from = run
    run += s.delta
    return { ...s, from, to: run }
  })
  const vals = rows.flatMap((r) => [r.from, r.to])
  const yMin = Math.min(0, ...vals)
  const yMax = Math.max(0, ...vals)
  const padAmt = Math.max((yMax - yMin) * 0.12, 1)
  const lo = yMin - padAmt
  const hi = yMax + padAmt
  const span = hi - lo || 1
  const yPx = (v: number) => pad.t + (1 - (v - lo) / span) * innerH
  const zero = yPx(0)
  const gap = innerW / rows.length
  const bw = Math.max(10, gap * 0.55)
  const ticks = niceTicks(lo + padAmt * 0.2, hi - padAmt * 0.2, 3, 0)
  const L = (x: number) => `${(x / w) * 100}%`
  const T = (y: number) => `${(y / h) * 100}%`
  return (
    <div className="svg-wrap wf">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart vbars wf" preserveAspectRatio="none">
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
        {rows.map((r, i) => {
          const x = pad.l + i * gap + (gap - bw) / 2
          const y1 = yPx(r.from)
          const y2 = yPx(r.to)
          const y = Math.min(y1, y2)
          const bh = Math.max(2, Math.abs(y2 - y1))
          const last = Boolean(r.total) || i === rows.length - 1
          const fill = last ? 'var(--gold)' : r.delta >= 0 ? 'var(--up)' : 'var(--down)'
          const bar = (
            <rect className="cbar" x={x} y={y} width={bw} height={bh} rx={2} fill={fill}>
              <title>{`${r.label} ${fmt(r.total ? r.to : r.delta)}`}</title>
            </rect>
          )
          if (i > 0) {
            const prevX = pad.l + (i - 1) * gap + (gap - bw) / 2 + bw
            const connectorY = yPx(r.total ? (rows[i - 1].total ? rows[i - 1].to : rows[i - 1].to) : r.from)
            return (
              <g key={r.id}>
                <line x1={prevX} x2={x} y1={connectorY} y2={connectorY} className="wf-connect" />
                {bar}
              </g>
            )
          }
          return <g key={r.id}>{bar}</g>
        })}
        <line x1={pad.l} x2={w - pad.r} y1={zero} y2={zero} className="base-line" />
      </svg>
      {rows.map((r, i) => {
        const x = pad.l + i * gap + gap / 2
        const y1 = yPx(r.from)
        const y2 = yPx(r.to)
        const tall = Math.abs(y2 - y1) > 28
        const y = tall ? (y1 + y2) / 2 : y2 + (r.to >= r.from ? -16 : 16)
        const last = Boolean(r.total) || i === rows.length - 1
        const tone = last ? 'gold' : r.delta >= 0 ? 'up' : 'down'
        return (
          <span
            key={`a-${r.id}`}
            className={`wf-amt ${tone}${tall ? ' in' : ''}`}
            style={{ left: L(x), top: T(y) }}
          >
            {fmt(r.total ? r.to : r.delta)}
          </span>
        )
      })}
      {rows.map((r, i) => (
        <span key={`c-${r.id}`} className="wf-label" style={{ left: L(pad.l + i * gap + gap / 2) }}>
          {r.label}
        </span>
      ))}
    </div>
  )
}

type TreeItem = { id: string; label: string; value: number; up: boolean; sub?: string }
type TreeRect = TreeItem & { x: number; y: number; w: number; h: number }

/**
 * Squarified treemap 布局。面积 ∝ value(已按 |盈亏| 传入),尽量让矩形接近正方形。
 * 参考 Bruls et al. 2000 的 squarify 算法,纯计算不引库。
 */
function squarify(items: TreeItem[], x: number, y: number, w: number, h: number): TreeRect[] {
  const total = items.reduce((s, it) => s + it.value, 0)
  if (total <= 0 || items.length === 0) return []
  const scale = (w * h) / total
  const scaled = items.map((it) => ({ it, area: it.value * scale }))
  const out: TreeRect[] = []
  let rest = scaled
  let rx = x
  let ry = y
  let rw = w
  let rh = h
  const worst = (row: number[], side: number) => {
    const sum = row.reduce((s, a) => s + a, 0)
    const max = Math.max(...row)
    const min = Math.min(...row)
    const s2 = sum * sum
    const side2 = side * side
    return Math.max((side2 * max) / s2, s2 / (side2 * min))
  }
  while (rest.length) {
    const vertical = rw < rh
    const side = vertical ? rw : rh
    const row: typeof rest = []
    const areas: number[] = []
    let i = 0
    for (; i < rest.length; i++) {
      const next = areas.concat(rest[i].area)
      if (row.length && worst(areas, side) < worst(next, side)) break
      areas.push(rest[i].area)
      row.push(rest[i])
    }
    const rowArea = areas.reduce((s, a) => s + a, 0)
    const thick = rowArea / side
    let along = vertical ? rx : ry
    for (const cell of row) {
      const len = cell.area / thick
      if (vertical) {
        out.push({ ...cell.it, x: along, y: ry, w: len, h: thick })
      } else {
        out.push({ ...cell.it, x: rx, y: along, w: thick, h: len })
      }
      along += len
    }
    if (vertical) {
      ry += thick
      rh -= thick
    } else {
      rx += thick
      rw -= thick
    }
    rest = rest.slice(row.length)
  }
  return out
}

/**
 * 矩形树图:每项一个矩形,面积编码大小、颜色编码盈亏正负。
 * 适合表达"极度集中"——最大一笔占满大半,其余缩成边角小块,一眼可见。
 */
export function Treemap(props: {
  items: TreeItem[]
  height?: number
  onPick?: (id: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const w = 640
  const h = props.height ?? 320
  const items = props.items.filter((it) => it.value > 0).sort((a, b) => b.value - a.value)
  if (!items.length) return <p className="tiny">没有可画的数据。</p>
  const rects = squarify(items, 0, 0, w, h)
  const maxV = items[0].value
  const active = rects.find((r) => r.id === hover) ?? null
  return (
    <div className="treemap-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="treemap" preserveAspectRatio="none" role="img">
        {rects.map((r) => {
          // 颜色越深 = 该笔越大,和参考热力图一致。
          const strength = 0.35 + 0.6 * (r.value / maxV)
          const showLabel = r.w > 46 && r.h > 24
          return (
            <g
              key={r.id}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover((v) => (v === r.id ? null : v))}
              onClick={() => props.onPick?.(r.id)}
              style={{ cursor: props.onPick ? 'pointer' : 'default' }}
            >
              <rect
                x={r.x + 0.5}
                y={r.y + 0.5}
                width={Math.max(0, r.w - 1)}
                height={Math.max(0, r.h - 1)}
                fill={r.up ? 'var(--up)' : 'var(--down)'}
                fillOpacity={strength}
                stroke="var(--bg)"
                strokeWidth={1}
              />
              {showLabel ? (
                <text x={r.x + 7} y={r.y + 18} className="treemap-label" fill="#fff">
                  {r.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      {active ? (
        <div className="treemap-tip">
          <b>{active.label}</b>
          {active.sub ? <span>{active.sub}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export function MixStack(props: { win: number; loss: number; long?: number; short?: number }) {
  const [mode, setMode] = useState<'result' | 'side'>('result')
  const sideOk = props.long != null && props.short != null && props.long + props.short > 0
  const a = mode === 'side' && sideOk ? props.long! : props.win
  const b = mode === 'side' && sideOk ? props.short! : props.loss
  const n = a + b
  if (n <= 0) return null
  const aPct = (a / n) * 100
  const bPct = 100 - aPct
  const aName = mode === 'side' ? '多' : '胜'
  const bName = mode === 'side' ? '空' : '负'
  const label = (name: string, count: number, pct: number) => {
    if (pct >= 22) return `${name} ${count} · ${Math.round(pct)}%`
    if (pct >= 10) return `${name} ${count}`
    return ''
  }
  return (
    <div className="mix-row">
      <div className="mix-stack" title={`${aName} ${a} · ${bName} ${b}（${Math.round(aPct)}% / ${Math.round(bPct)}%）`}>
        <span className="mix-win" style={{ width: `${aPct}%` }}>
          {label(aName, a, aPct)}
        </span>
        <span className="mix-loss" style={{ width: `${bPct}%` }}>
          {label(bName, b, bPct)}
        </span>
      </div>
      {sideOk ? (
        <div className="mix-toggles print-hide">
          <button type="button" className={mode === 'result' ? 'on' : ''} onClick={() => setMode('result')}>
            胜负
          </button>
          <button type="button" className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>
            多空
          </button>
        </div>
      ) : null}
    </div>
  )
}
