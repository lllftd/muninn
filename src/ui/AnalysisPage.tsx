import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { money } from '../lib/format.ts'
import type { CrossReport } from '../engine/cross.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import type { GroupRow } from '../types.ts'
import { type ProPrefs } from '../lib/proPrefs.ts'
import { WhyDiagnoses } from './ReviewHome.tsx'

function CrossTable(props: { title: string; rows: GroupRow[] }) {
  const shown = props.rows.filter((r) => r.n >= 5)
  return (
    <details className="fold-block">
      <summary>
        {props.title}
        {shown.length ? ` · ${shown.length} 格可报` : ' · 样本太薄'}
      </summary>
      {shown.length ? (
        <table className="grid trips">
          <thead>
            <tr>
              <th>分组</th>
              <th>n</th>
              <th>单笔均值</th>
              <th>合计</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.n < 10 ? 'low-n' : ''}>
                <td>{r.label}</td>
                <td>{r.n}</td>
                <td>{r.expectancy == null ? '—' : money(r.expectancy)}</td>
                <td>{money(r.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="tiny">n&lt;5 的交叉格子不报均值。样本太薄，交叉说不出可引用的均值。</p>
      )}
    </details>
  )
}

type TocItem = { id: string; label: string; level: 0 | 1 }

const CONC_IDS = new Set(['structure-max-win', 'risk-concentrate'])
const QUALITY_IDS = new Set(['payoff-highlight'])

function whyToc(diagnoses: Diagnosis[]) {
  const impactAll = diagnoses.filter(
    (d) =>
      d.section === 'impact' &&
      d.id !== 'luck-loss-mass' &&
      d.tone !== 'highlight' &&
      !CONC_IDS.has(d.id) &&
      !QUALITY_IDS.has(d.id),
  )
  const observe =
    impactAll.some((d) => !(d.factConfidence === 'high' || d.extrapolationConfidence !== 'low')) ||
    diagnoses.some((d) => d.section === 'observe' && !CONC_IDS.has(d.id) && !QUALITY_IDS.has(d.id))
  const items: TocItem[] = [
    { id: 'quality', label: '结构', level: 0 },
    { id: 'why-impact', label: '钱是怎么亏的', level: 0 },
  ]
  if (observe) items.push({ id: 'why-observe', label: '低置信观察', level: 1 })
  items.push(
    { id: 'cross', label: '交叉归因', level: 1 },
    { id: 'sec-behavior', label: '交易与行为', level: 0 },
    { id: 'freq', label: '频率', level: 1 },
    { id: 'trips', label: '往返明细', level: 1 },
    { id: 'luck-zone', label: '实力还是运气', level: 0 },
    { id: 'sec-checks', label: '检验', level: 0 },
    { id: 'sec-ledger', label: '核算', level: 0 },
  )
  return items
}

export function AnalysisPage(props: {
  prefs: ProPrefs
  onPrefs: (next: ProPrefs) => void
  onExportCsv: () => void
  highlight?: string | null
  cross: CrossReport
  diagnoses: Diagnosis[]
  onEvidence: (anchor: string) => void
  children: ReactNode
}) {
  const toc = useMemo(() => whyToc(props.diagnoses), [props.diagnoses])
  const [on, setOn] = useState(toc[0]?.id ?? '')
  const hold = useRef(false)

  const flash = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    hold.current = true
    setOn(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 64)
    const scroller = document.scrollingElement
    if (scroller && Math.abs(scroller.scrollTop - top) > 8) scroller.scrollTo({ top, behavior: 'smooth' })
    el.classList.add('anchor-flash')
    window.setTimeout(() => el.classList.remove('anchor-flash'), 1600)
    window.setTimeout(() => {
      hold.current = false
    }, 900)
  }

  useEffect(() => {
    const hash = props.highlight || (typeof window !== 'undefined' ? window.location.hash.slice(1) : '')
    if (!hash) return
    flash(hash)
  }, [props.highlight])

  useEffect(() => {
    const els = toc.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => Boolean(el))
    if (!els.length) return
    const seen = new Map<string, boolean>()
    const pick = () => {
      const hit = toc.find((item) => seen.get(item.id))
      if (hit) setOn(hit.id)
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        if (!hold.current) pick()
      },
      { rootMargin: '-18% 0px -68% 0px', threshold: 0 },
    )
    for (const el of els) obs.observe(el)
    return () => obs.disconnect()
  }, [toc])

  const crossOk = props.cross.symbolHold.some((r) => r.n >= 5) || props.cross.weekdayRegime.some((r) => r.n >= 5)
  return (
    <div className="analysis-page">
      <nav className="why-toc print-hide" aria-label="为什么目录">
        {toc.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`${on === item.id ? 'on' : ''} ${item.level ? 'sub' : ''}`}
            onClick={() => flash(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="analysis-main">
        <WhyDiagnoses diagnoses={props.diagnoses} onEvidence={props.onEvidence} />
        <section className="analysis-block" id="cross">
          <h2 className="review-sec">交叉归因</h2>
          <p className="tiny">
            {crossOk ? '只列出 n≥5 的格子。其余交叉太薄，不报均值。' : '样本太薄，交叉格子说不出可引用的均值。'}
          </p>
          <div className="grid-2">
            <CrossTable title="标的 × 持仓档" rows={props.cross.symbolHold} />
            <CrossTable title="星期 × 频率" rows={props.cross.weekdayRegime} />
          </div>
        </section>
        <div id="why-a">{props.children}</div>
      </div>
    </div>
  )
}

export function tripsCsv(trips: Array<{
  id: string
  symbol: string
  name: string
  side: string
  regime: string
  openTime: Date
  closeTime: Date | null
  holdMinutes: number
  realizedPnl: number
  rMultiple: number | null
  rPrice?: number | null
  rFee?: number | null
  maePct: number | null
  mfePct: number | null
  tags: string[]
}>): string {
  const header = [
    'id',
    'symbol',
    'name',
    'side',
    'regime',
    'openTime',
    'closeTime',
    'holdMinutes',
    'realizedPnl',
    'rMultiple',
    'rPrice',
    'rFee',
    'maePct',
    'mfePct',
    'tags',
  ]
  const rows = trips.map((t) =>
    [
      t.id,
      t.symbol,
      t.name,
      t.side,
      t.regime,
      t.openTime.toISOString(),
      t.closeTime ? t.closeTime.toISOString() : '',
      t.holdMinutes,
      t.realizedPnl,
      t.rMultiple ?? '',
      t.rPrice ?? '',
      t.rFee ?? '',
      t.maePct ?? '',
      t.mfePct ?? '',
      t.tags.join('|'),
    ].join(','),
  )
  return `${header.join(',')}\n${rows.join('\n')}\n`
}
