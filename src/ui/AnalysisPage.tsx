import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { money } from '../lib/format.ts'
import type { CrossReport } from '../engine/cross.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import type { GroupRow } from '../types.ts'
import { type ProPrefs } from '../lib/proPrefs.ts'
import { WhyLead } from './ReviewHome.tsx'
import { EXPLORE_BANNER, type WhyChapterMeta, type WhyRole } from './whyNav.ts'
import type { WhyLeadFacts } from './whyViz.ts'

type FoldCtl = {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  register: (memberId: string, foldId: string) => void
  open: (id: string) => void
}
const FoldContext = createContext<FoldCtl | null>(null)

export function LayerFold(props: {
  id: string
  title: string
  summary: string
  anchors?: string[]
  children: ReactNode
}) {
  const ctl = useContext(FoldContext)
  const open = ctl?.isOpen(props.id) ?? true
  useEffect(() => {
    if (!ctl) return
    ctl.register(props.id, props.id)
    for (const a of props.anchors ?? []) ctl.register(a, props.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <section className={`layer-fold ${open ? 'open' : ''}`} id={props.id}>
      <button type="button" className="layer-fold-hd" aria-expanded={open} onClick={() => ctl?.toggle(props.id)}>
        <span className={`layer-caret ${open ? 'down' : ''}`} aria-hidden>
          ▸
        </span>
        <span className="layer-fold-title">{props.title}</span>
        <span className="layer-fold-sum">{props.summary}</span>
      </button>
      {open ? <div className="layer-fold-body">{props.children}</div> : null}
    </section>
  )
}

export function WhyChapter(props: {
  id: string
  title: string
  status: string
  role: WhyRole
  children: ReactNode
}) {
  return (
    <section id={props.id} className={`why-chapter role-${props.role}`}>
      <header className="why-ch-hd">
        <h2>{props.title}</h2>
        <span className={`why-st why-st-${props.role}`}>{props.status}</span>
      </header>
      {props.role === 'explore' ? <p className="why-explore-banner">{EXPLORE_BANNER}</p> : null}
      <div className="why-ch-body">{props.children}</div>
    </section>
  )
}

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

function tabsOffset() {
  const el = document.querySelector('.sticky-tabs')
  return (el instanceof HTMLElement ? el.getBoundingClientRect().height : 48) + 10
}

const DEFAULT_FOLDS: Record<string, boolean> = {
  'fold-trips': false,
}

export function AnalysisPage(props: {
  prefs: ProPrefs
  onPrefs: (next: ProPrefs) => void
  onExportCsv: () => void
  highlight?: string | null
  cross: CrossReport
  diagnoses: Diagnosis[]
  onEvidence: (anchor: string) => void
  whyLead: string
  leadFacts: WhyLeadFacts
  coverage: string
  nLine: string
  chapters: WhyChapterMeta[]
  children: ReactNode
}) {
  const toc = props.chapters
  const [on, setOn] = useState(toc[0]?.id ?? '')
  const [progress, setProgress] = useState(0)
  const hold = useRef(false)
  const mainRef = useRef<HTMLDivElement>(null)

  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>(() => {
    const base = { ...DEFAULT_FOLDS }
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.hash.replace(/^#/, '').split('&').slice(1).join('&'))
      const openList = (q.get('open') || '').split(',').filter(Boolean)
      for (const id of openList) if (id in base) base[id] = true
    }
    return base
  })
  const anchorFold = useRef<Record<string, string>>({})
  const fold: FoldCtl = useMemo(
    () => ({
      isOpen: (id) => openFolds[id] ?? true,
      toggle: (id) => setOpenFolds((s) => ({ ...s, [id]: !(s[id] ?? true) })),
      open: (id) => setOpenFolds((s) => (s[id] ? s : { ...s, [id]: true })),
      register: (memberId, foldId) => {
        anchorFold.current[memberId] = foldId
      },
    }),
    [openFolds],
  )

  const flash = (id: string) => {
    const foldId = anchorFold.current[id]
    if (foldId) setOpenFolds((s) => (s[foldId] ? s : { ...s, [foldId]: true }))
    const doScroll = () => {
      const el = document.getElementById(id)
      if (!el) return
      hold.current = true
      setOn(id)
      const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - tabsOffset())
      document.scrollingElement?.scrollTo({ top, behavior: 'smooth' })
      el.classList.add('anchor-flash')
      window.setTimeout(() => el.classList.remove('anchor-flash'), 1600)
      window.setTimeout(() => {
        hold.current = false
      }, 900)
    }
    if (foldId && !(openFolds[foldId] ?? true)) window.setTimeout(doScroll, 60)
    else doScroll()
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const opened = Object.keys(openFolds).filter((k) => openFolds[k])
    const base = window.location.hash.replace(/^#/, '').split('&')[0] || ''
    const nextHash = opened.length ? `#${base}&open=${opened.join(',')}` : base ? `#${base}` : ''
    const cur = window.location.hash
    if (nextHash !== cur) window.history.replaceState(null, '', nextHash || window.location.pathname + window.location.search)
  }, [openFolds])

  useEffect(() => {
    const hash = props.highlight || (typeof window !== 'undefined' ? window.location.hash.slice(1).split('&')[0] : '')
    if (!hash) return
    flash(hash)
  }, [props.highlight])

  useEffect(() => {
    const ids = toc.map((item) => item.id)
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el))
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
      { rootMargin: `-${tabsOffset()}px 0px -70% 0px`, threshold: 0 },
    )
    for (const el of els) obs.observe(el)
    return () => obs.disconnect()
  }, [toc])

  useEffect(() => {
    const onScroll = () => {
      const main = mainRef.current
      if (!main) return
      const start = main.offsetTop
      const span = Math.max(main.scrollHeight - window.innerHeight, 1)
      const p = Math.min(1, Math.max(0, (window.scrollY - start) / span))
      setProgress(p)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const idx = Math.max(0, toc.findIndex((c) => c.id === on))
  const prev = toc[idx - 1]
  const nextCh = toc[idx + 1]

  return (
    <FoldContext.Provider value={fold}>
      <div className="analysis-page">
        <nav className="why-toc print-hide" aria-label="为什么目录">
          <div className="why-progress" aria-hidden>
            <b>
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </b>
            <span>阅读进度 {Math.round(progress * 100)}%</span>
          </div>
          {toc.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`${on === item.id ? 'on' : ''} toc-${item.role}`}
              onClick={() => flash(item.id)}
            >
              <b>{item.label}</b>
              <em className={`why-st why-st-${item.role}`}>{item.status}</em>
            </button>
          ))}
          <div className="why-toc-nav">
            <button type="button" disabled={!prev} onClick={() => prev && flash(prev.id)}>
              上一章
            </button>
            <button type="button" disabled={!nextCh} onClick={() => nextCh && flash(nextCh.id)}>
              下一章
            </button>
          </div>
        </nav>
        <div className="analysis-main" ref={mainRef}>
          <WhyLead text={props.whyLead} facts={props.leadFacts} coverage={props.coverage} nLine={props.nLine} />
          {props.children}
          <div className="why-fab print-hide">
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              回顶部
            </button>
            <button type="button" onClick={() => on && flash(on)}>
              回本章结论
            </button>
          </div>
        </div>
      </div>
    </FoldContext.Provider>
  )
}

export function CrossPanel(props: { cross: CrossReport }) {
  const crossOk = props.cross.symbolHold.some((r) => r.n >= 5) || props.cross.weekdayRegime.some((r) => r.n >= 5)
  return (
    <>
      <p className="tiny">
        {crossOk ? '只列出 n≥5 的格子。其余交叉太薄，不报均值。' : '样本太薄，交叉格子说不出可引用的均值。'}
      </p>
      <div className="grid-2">
        <CrossTable title="标的 × 持仓档" rows={props.cross.symbolHold} />
        <CrossTable title="星期 × 频率" rows={props.cross.weekdayRegime} />
      </div>
    </>
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
