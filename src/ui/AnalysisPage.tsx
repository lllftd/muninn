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
import { WhyDiagnoses } from './ReviewHome.tsx'

/**
 * L1/L2 折叠层。用受控 fold 而非原生 <details>,因为规范要求"深链可展开":
 * flash(anchor) 命中折叠区内部锚点时,要能先把折叠区打开再滚动。原生 <details>
 * 在 scrollIntoView 时不会自动打开。默认态:L1/L2 全部折叠(折叠 ≠ 删除)。
 */
type FoldCtl = {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  /** 注册"锚点 → 所属折叠区",供 flash 深链时反查并展开。 */
  register: (memberId: string, foldId: string) => void
  open: (id: string) => void
}
const FoldContext = createContext<FoldCtl | null>(null)

export function LayerFold(props: {
  id: string
  /** 折叠区标题——折叠态也带摘要,让人知道里面有什么。 */
  title: string
  summary: string
  /** 折叠区内可被深链命中的锚点 id,用于 flash 反查展开。 */
  anchors?: string[]
  children: ReactNode
}) {
  const ctl = useContext(FoldContext)
  const open = ctl?.isOpen(props.id) ?? true
  useEffect(() => {
    if (!ctl) return
    ctl.register(props.id, props.id)
    for (const a of props.anchors ?? []) ctl.register(a, props.id)
    // anchors 是稳定字面量数组,注册一次即可
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

type TocItem = { id: string; label: string; level: 0 | 1; group: TocGroup }
type TocGroup = '结论' | '切面' | '查账'

const CONC_IDS = new Set(['structure-max-win', 'risk-concentrate'])
const QUALITY_IDS = new Set(['payoff-highlight'])

/** L1/L2 折叠区默认全部折叠。key = LayerFold id。 */
const DEFAULT_FOLDS: Record<string, boolean> = {
  'fold-freq': false,
  'fold-behavior': false,
  'fold-luck': false,
  'fold-trips': false,
  'cross-fold': false,
}

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
    // 结论:默认全展开
    { id: 'why-impact', label: '主因', level: 0, group: '结论' },
  ]
  // 低置信观察实际渲染在主因卡区(结论组),导航归属跟随实际位置。
  if (observe) items.push({ id: 'why-observe', label: '低置信观察', level: 1, group: '结论' })
  items.push(
    // 交易质量、实力还是运气 与主因平级(都是结论),用 level 0;只有低置信观察嵌在主因下用 level 1。
    { id: 'quality', label: '交易质量', level: 0, group: '结论' },
    // 「实力还是运气」结论条即运气检验的入口:点它滚到结论,往下就是运气检验详图。
    // 不再单列切面组的「运气检验」,避免同一件事(结论+证据)在 TOC 里出现两次。
    { id: 'luck-zone', label: '实力还是运气', level: 0, group: '结论' },
  )
  // 切面:默认折叠
  items.push(
    { id: 'fold-freq', label: '持仓与频率', level: 0, group: '切面' },
    { id: 'fold-behavior', label: '行为', level: 0, group: '切面' },
    // 交叉归因也是切面的顶级项,平级于持仓与频率/行为。
    { id: 'cross', label: '交叉归因', level: 0, group: '切面' },
  )
  // 查账:默认折叠
  items.push(
    { id: 'fold-trips', label: '逐笔明细', level: 0, group: '查账' },
    { id: 'sec-ledger', label: '核算 · 对账与覆盖', level: 0, group: '查账' },
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
  /** 透传给主因卡的内嵌证据图工厂(证据就地)。 */
  chartFor?: (d: Diagnosis) => ReactNode
  children: ReactNode
}) {
  const toc = useMemo(() => whyToc(props.diagnoses), [props.diagnoses])
  const [on, setOn] = useState(toc[0]?.id ?? '')
  const hold = useRef(false)

  // 折叠区开合状态。默认按 DEFAULT_FOLDS(L1/L2 全折叠),并从 URL hash 恢复分享的展开态。
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>(() => {
    const base = { ...DEFAULT_FOLDS }
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.hash.replace(/^#/, '').split('&').slice(1).join('&'))
      const openList = (q.get('open') || '').split(',').filter(Boolean)
      for (const id of openList) if (id in base) base[id] = true
    }
    return base
  })
  // 锚点 → 所属折叠区,LayerFold 挂载时登记,供深链反查展开。
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
    // 深链命中折叠区内部锚点时,先展开其所属折叠区,再滚动——原生 <details> 做不到这点。
    const foldId = anchorFold.current[id]
    if (foldId) setOpenFolds((s) => (s[foldId] ? s : { ...s, [foldId]: true }))
    const doScroll = () => {
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
    // 折叠区展开后 DOM 才挂载目标元素,等一帧再滚。
    if (foldId && !(openFolds[foldId] ?? true)) window.setTimeout(doScroll, 60)
    else doScroll()
  }

  // 展开态写入 URL hash(?open=a,b),满足"折叠状态可分享、可深链"。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const opened = Object.keys(openFolds).filter((k) => openFolds[k])
    const base = window.location.hash.replace(/^#/, '').split('&')[0] || ''
    const next = opened.length ? `#${base}&open=${opened.join(',')}` : base ? `#${base}` : ''
    const cur = window.location.hash
    if (next !== cur) window.history.replaceState(null, '', next || window.location.pathname + window.location.search)
  }, [openFolds])

  useEffect(() => {
    const hash = props.highlight || (typeof window !== 'undefined' ? window.location.hash.slice(1).split('&')[0] : '')
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
  const groups: TocGroup[] = ['结论', '切面', '查账']
  const cross = (
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
  return (
    <FoldContext.Provider value={fold}>
      <div className="analysis-page">
        <nav className="why-toc print-hide" aria-label="为什么目录">
          {groups.map((g) => {
            const items = toc.filter((t) => t.group === g)
            if (!items.length) return null
            return (
              <div className="toc-group" key={g}>
                <p className="toc-group-hd">{g}</p>
                {items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`${on === item.id ? 'on' : ''} ${item.level ? 'sub' : ''}`}
                    onClick={() => flash(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="analysis-main">
          <WhyDiagnoses diagnoses={props.diagnoses} onEvidence={props.onEvidence} chartFor={props.chartFor} />
          {/* cross 交叉归因作为一个可复用节点传给 children 布局(Dashboard 通过 slot 决定位置)。
              这里直接放在行为切面之后。 */}
          <div id="why-a">{props.children}</div>
          <LayerFold id="cross-fold" title="交叉归因" summary="标的×持仓档 · 星期×频率" anchors={['cross']}>
            <section className="analysis-block" id="cross">
              {cross}
            </section>
          </LayerFold>
        </div>
      </div>
    </FoldContext.Provider>
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
