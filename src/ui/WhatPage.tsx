import type { ReactNode } from 'react'
import { money, pct } from '../lib/format.ts'
import type { CoverGap, CoverReport } from '../engine/cover.ts'
import { formatBe, waterfallOf } from '../engine/cover.ts'
import type { Book, RoundTrip } from '../types.ts'
import { BoxStrip, ForestPlot, TimePnlBars, WaterfallFlow } from './charts.tsx'

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
              <span className={`cap-dot ${g.tone}`} title={g.done ? '已有' : g.tone === 'fail' ? '缺失' : '待补'}>
                {g.done ? '●' : g.tone === 'fail' ? '✕' : '!'}
              </span>
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
  return (
    <div className="what-page print-section" id="cover">
      <section className="cover-verdict">
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
        <p className="tiny">每根一笔,按平仓时间排;绿盈红亏,越高金额越大。点一根跳到明细。</p>
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
        <p className="tiny">箱=中间一半的交易,竖线=中位,点=每一笔;两端极端单笔钉成角标,不拉伸主体。点一颗跳到明细。</p>
        <BoxStrip
          points={props.trips.map((t) => ({ id: t.id, v: t.realizedPnl, label: `${t.symbol} · ${money(t.realizedPnl)}` }))}
          format={money}
          height={150}
          onPick={props.onPickTrip}
        />
      </article>

      <div className="grid-2 even">
      <article className="panel">
        <h3>盈亏怎么来的</h3>
        <p className="tiny">{wf.feeNote || '毛盈亏加总到已实现；未实现与勾稽接到累计净额。'}</p>
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
        <p className="tiny">点是估计，须是区间。须穿过 0 线 = 还锁不住正负。</p>
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
  )
}
