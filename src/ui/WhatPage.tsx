import { useRef, type ReactNode } from 'react'
import { money, moneyAbs, pct } from '../lib/format.ts'
import type { CoverGap, CoverReport } from '../engine/cover.ts'
import { formatBe, waterfallOf } from '../engine/cover.ts'
import type { Book, RoundTrip } from '../types.ts'
import { BoxStrip, ForestPlot, TimePnlBars, WaterfallFlow } from './charts.tsx'
import { PageToc, type TocItem } from './tocNav.tsx'

export function CapabilityMatrix(props: {
  gaps: CoverGap[]
  onFillAccount: () => void
  onGuide: () => void
}) {
  return (
    <table className="cap-grid">
      <thead>
        <tr>
          <th>数据</th>
          <th>状态</th>
          <th>解锁</th>
          <th>动作</th>
        </tr>
      </thead>
      <tbody>
        {props.gaps.map((g) => (
          <tr key={g.id} className={`cap-${g.tone}`}>
            <td>{g.title}</td>
            <td>
              <span className={`cap-dot ${g.tone}`} title={g.statusLabel}>
                {g.done ? '●' : g.tone === 'fail' ? '✕' : '!'}
              </span>
              <span className="tiny"> {g.statusLabel}</span>
            </td>
            <td className="tiny">{g.unlocks}</td>
            <td>
              {g.action === 'account' ? (
                <button type="button" className="ghost sm print-hide" onClick={props.onFillAccount}>
                  去补
                </button>
              ) : g.action === 'guide' ? (
                <button type="button" className="ghost sm print-hide" onClick={props.onGuide}>
                  去补
                </button>
              ) : (
                <span className="tiny">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WhatPage(props: {
  book: Book
  cover: CoverReport
  pathVisual: ReactNode
  trips: RoundTrip[]
  onWhy: () => void
  onOpenHealth: () => void
  onFillAccount: () => void
  onPickTrip: (id: string) => void
}) {
  const { book, cover } = props
  const p = book.performance
  const dd = p.maxDrawdownUsd ? money(-Math.abs(p.maxDrawdownUsd)) : p.maxDrawdown != null ? pct(p.maxDrawdown) : '—'
  const basisLabel = p.pathKind === 'account' ? '账户盯市盈亏' : '正股盯市盈亏'
  const wf = waterfallOf(book)
  const wins = props.trips.filter((t) => t.realizedPnl > 0).length
  const losses = props.trips.filter((t) => t.realizedPnl <= 0).length
  const longs = props.trips.filter((t) => t.side === 'long').length
  const shorts = props.trips.filter((t) => t.side === 'short').length
  const be = cover.be ? formatBe(cover.be) : null
  // 时间柱用稳健量程(Tukey 上须),让多数小额单可见、极端单笔钳顶带溢出三角;不用整段极值当轴。
  const pnls = [...props.trips.map((t) => t.realizedPnl)].sort((a, b) => a - b)
  const qAt = (q: number) => {
    if (!pnls.length) return 0
    const i = (pnls.length - 1) * q
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    return lo === hi ? pnls[lo] : pnls[lo] * (hi - i) + pnls[hi] * (i - lo)
  }
  const iqr = qAt(0.75) - qAt(0.25)
  const bound = Math.max(Math.abs(qAt(0.25) - 1.5 * iqr), Math.abs(qAt(0.75) + 1.5 * iqr), 1)
  const mainRef = useRef<HTMLDivElement>(null)
  const whatToc: TocItem[] = [
    { id: 'cover', label: '结论' },
    { id: 'path', label: '路径与回撤' },
    { id: 'trade-bars', label: '逐笔 · 按时间' },
    { id: 'pnl-swarm', label: '逐笔 · 按金额' },
    { id: 'forest', label: '单笔期望' },
    { id: 'health', label: '可信吗' },
  ]
  return (
    <div className="analysis-page">
      <PageToc items={whatToc} ariaLabel="是什么目录" mainRef={mainRef} />
      <div className="analysis-main what-page print-section" ref={mainRef}>
      <section className="cover-verdict" id="cover">
        <p className="cover-scan">
          <span>
            {`回撤 ${dd}`}
            {be ? ` · ${be.scan}` : ''}
            {cover.coverageLabel ? ` · ${cover.coverageLabel}` : ''}
          </span>
          <button type="button" className="btn-primary print-hide" onClick={props.onWhy}>
            亏在哪、是不是运气 → 为什么
          </button>
        </p>
        <p className="cover-basis">{basisLabel} · 未平仓按最新价</p>
        <p className={`cover-net ${p.netPnl >= 0 ? 'up' : 'down'}`}>{money(p.netPnl)}</p>
        <h2>{cover.verdict}</h2>
      </section>

      <div className="review-top">
        <div>
          <span>
            {book.accountName || '未命名账本'} · {p.sampleStart} 至 {p.sampleEnd} · {p.closedCount} 笔
            {` · 胜 ${wins} 负 ${losses} · 多 ${longs} 空 ${shorts}`}
          </span>
        </div>
      </div>

      <article className="panel wide path-panel" id="path">
        <div className="path-hd">
          <h3>{p.pathKind === 'account' ? '资金路径与回撤' : '正股盯市路径与金额回落'}</h3>
          {cover.benchChip ? <span className="path-chip">{cover.benchChip}</span> : null}
          <span
            className="path-info"
            title={
              (p.pathKind === 'account'
                ? '回撤与路径共用同一时间轴。没有把基准叠在路径上。'
                : '没有期初净资产时只画正股盯市盈亏，不叠 SPY，也不把金额回落写成账户回撤率。') +
              (cover.benchLine ? ` ${cover.benchLine}` : '')
            }
          >
            ⓘ
          </span>
        </div>
        {props.pathVisual}
      </article>

      <article className="panel wide" id="trade-bars">
        <h3>逐笔盈亏 · 按时间</h3>
        <TimePnlBars
          points={props.trips
            .filter((t) => t.closeTime)
            .map((t) => ({
              id: t.id,
              t: t.closeTime!.getTime(),
              v: t.realizedPnl,
              label: `${t.symbol} · ${money(t.realizedPnl)}`,
            }))}
          bound={bound}
          height={160}
          format={money}
          onPick={props.onPickTrip}
        />
      </article>

      <article className="panel wide" id="pnl-swarm">
        <h3>逐笔盈亏 · 按金额分布</h3>
        {(() => {
          // 分布形状判词 + 游程结论,原在「为什么·运气检验」区,与这张分布图重复,合并到此。
          const s = p.tradeShape
          const shape =
            s.skew != null && s.skew > 0.5
              ? '你的盈亏是「多数小额 + 少数大赢」的形状'
              : s.skew != null && s.skew < -0.5
                ? '你的盈亏是「多数小赢 + 偶发巨亏」的形状'
                : '你的盈亏大致对称'
          const fat = s.kurtosis != null && s.kurtosis > 3 ? '，尾部偏肥 —— 极端单笔比常态更常出现' : ''
          return (
            <p className="verdict">
              {shape}
              {fat}。最惨的 5% 交易，平均每笔亏 {s.cvar95 == null ? '—' : moneyAbs(s.cvar95)}。
            </p>
          )
        })()}
        <BoxStrip
          points={props.trips.map((t) => ({ id: t.id, v: t.realizedPnl, label: `${t.symbol} · ${money(t.realizedPnl)}` }))}
          format={money}
          height={150}
          onPick={props.onPickTrip}
        />
        {book.analytics.runs.note ? <p className="tiny">{book.analytics.runs.note}</p> : null}
      </article>

      <div className="grid-2 even">
      <article className="panel">
        <h3>盈亏怎么来的</h3>
        <WaterfallFlow steps={wf.steps} format={money} />
      </article>

      <article className="panel" id="forest">
        <div className="path-hd">
          <h3>单笔期望稳不稳</h3>
          <span
            className="path-info"
            title="点是点估计。须是区间：整体为开仓日 cluster bootstrap 95%，切片为 80%。须穿过虚线 = 还锁不住正负。n<5 不画须。不是预测。"
          >
            ⓘ
          </span>
        </div>
        <ForestPlot
          items={[
            {
              id: 'all',
              label: '全部',
              lead: true,
              value: p.expectancy.value,
              lo: p.expectancy.ci?.lo,
              hi: p.expectancy.ci?.hi,
              unboundedHi: p.expectancy.ci?.unboundedHi,
              n: p.expectancy.n,
            },
            ...book.checkup.sides.map((r) => ({
              id: r.id,
              label: r.label,
              value: r.n >= 5 ? r.expectancy : null,
              lo: r.expectancyCi?.lo,
              hi: r.expectancyCi?.hi,
              unboundedHi: r.expectancyCi?.unboundedHi,
              n: r.n,
              dim: r.n < 10,
            })),
            ...book.checkup.holdBuckets.map((r) => ({
              id: r.id,
              label: r.label,
              value: r.n >= 5 ? r.expectancy : null,
              lo: r.expectancyCi?.lo,
              hi: r.expectancyCi?.hi,
              unboundedHi: r.expectancyCi?.unboundedHi,
              n: r.n,
              dim: r.n < 10,
            })),
          ]}
          format={money}
        />
      </article>
      </div>

      <article className="panel" id="health">
        <div className="drawer-k">可信吗</div>
        <p className="tiny">{cover.nLine}</p>
        <CapabilityMatrix gaps={cover.gaps} onFillAccount={props.onFillAccount} onGuide={props.onOpenHealth} />
      </article>

      <p className="cover-bridge">
        <button type="button" className="btn-primary" onClick={props.onWhy}>
          亏在哪、是不是运气 → 为什么
        </button>
      </p>
      </div>
    </div>
  )
}
