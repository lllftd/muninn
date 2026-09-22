import { useEffect, useRef, useState, type RefObject } from 'react'

export type TocItem = {
  id: string
  label: string
  status?: string
  role?: string
}

function tabsOffset() {
  const el = document.querySelector('.sticky-tabs')
  return (el instanceof HTMLElement ? el.getBoundingClientRect().height : 48) + 10
}

/** 侧栏目录：阅读进度 + 章节跳转 + 滚动高亮 + 上一节/下一节。与「为什么」页共用 .why-toc 样式。 */
export function PageToc(props: {
  items: TocItem[]
  ariaLabel: string
  mainRef: RefObject<HTMLDivElement | null>
}) {
  const { items, ariaLabel, mainRef } = props
  const [on, setOn] = useState(items[0]?.id ?? '')
  const [progress, setProgress] = useState(0)
  const hold = useRef(false)

  const flash = (id: string) => {
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

  useEffect(() => {
    const ids = items.map((i) => i.id)
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el))
    if (!els.length) return
    const seen = new Map<string, boolean>()
    const pick = () => {
      const hit = items.find((i) => seen.get(i.id))
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
  }, [items])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const idx = Math.max(0, items.findIndex((i) => i.id === on))
  const prev = items[idx - 1]
  const nextCh = items[idx + 1]

  return (
    <nav className="why-toc print-hide" aria-label={ariaLabel}>
      <div className="why-progress" aria-hidden>
        <b>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </b>
        <span>阅读进度 {Math.round(progress * 100)}%</span>
      </div>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`${on === item.id ? 'on' : ''}${item.role ? ` toc-${item.role}` : ''}`}
          onClick={() => flash(item.id)}
        >
          <b>{item.label}</b>
          {item.status ? <em className={`why-st${item.role ? ` why-st-${item.role}` : ''}`}>{item.status}</em> : null}
        </button>
      ))}
      <div className="why-toc-nav">
        <button type="button" disabled={!prev} onClick={() => prev && flash(prev.id)}>
          上一节
        </button>
        <button type="button" disabled={!nextCh} onClick={() => nextCh && flash(nextCh.id)}>
          下一节
        </button>
      </div>
    </nav>
  )
}
