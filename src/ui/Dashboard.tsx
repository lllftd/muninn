import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Brand, ThemeToggle } from './chrome.tsx'
import { BoxStrip, CalendarHeatmap, CaptureBar, ColorScatter, CoverageMeter, ForestPlot, Histogram, MaeBar, MonthBars, MultiLine, Scatter, SignedBars, Treemap, type PathMarker } from './charts.tsx'
import { InsightDrawer, type Insight } from './InsightDrawer.tsx'
import { PathDrawer } from './PathDrawer.tsx'
import { AnalysisPage, CrossPanel, LayerFold, WhyChapter, tripsCsv } from './AnalysisPage.tsx'
import { HowPage } from './HowPage.tsx'
import { WhatPage } from './WhatPage.tsx'
import { WhyFinding, WhyLuck, type WhyEvidenceExtra } from './ReviewHome.tsx'
import { HealthBadge, HealthDrawer } from './HealthDrawer.tsx'
import { AttrWaterfallBlock, CumPathBlock, ExitEfficiencyBlock, HoldUiStrip, MaeQuadStrip, type WhyHl } from './WhyKeyCharts.tsx'
import { dimOf, symbolPareto, whyLeadFacts } from './whyViz.ts'
import { buildWhyChapters, givebackDx, holdDx, sideDx, structDx, trendDx, weekdayDx } from './whyNav.ts'
import { ANALYSIS_HASH_FROM_VIEW, TABS, tabForAnchor, tabFromView, viewOf, type Tab } from './views.ts'
import { buildCover, formatBe, pathCoverLine } from '../engine/cover.ts'
import { ciText, clsPnl, coverageLabel, finiteNum, holdLabel, money, moneyAbs, moneyK, pct, pctPlain, signed } from '../lib/format.ts'
import { etDateKey, etParts } from '../lib/time.ts'
import { getTagVerdict } from '../lib/tagVerdicts.ts'
import { REGIME_BOUND_TEXT, REGIME_LABELS } from '../engine/regime.ts'
import { diagnose } from '../engine/diagnose.ts'
import { buildHealth } from '../engine/health.ts'
import { buildCross } from '../engine/cross.ts'
import { buildSpace } from '../engine/space.ts'
import { loadProPrefs, saveProPrefs, type ProPrefs } from '../lib/proPrefs.ts'
import type { Bar, Book, Checkup, CoverageRow, EquityPoint, GroupRow, MetricPoint, QuoteStatus, RoundTrip } from '../types.ts'

type SortKey = 'time' | 'pnl' | 'r' | 'hold'
type SideFilter = 'all' | 'long' | 'short'

function suspectedTagLabel(trip: RoundTrip, tag: string): { text: string; title: string; kind: 'fact' | 'suspected' | 'denied' | 'confirmed' } {
  if (tag === 'episode' || tag === 'DRIP' || tag === '同日' || tag === '开盘') {
    return { text: tag, title: tag, kind: 'fact' }
  }
  const hint = trip.tagHints?.find((h) => h.tag === tag)
  const verdict = getTagVerdict(trip.id, tag)
  const conf = hint?.confidence === 'high' ? '高' : hint?.confidence === 'mid' ? '中' : '低'
  const title = hint ? `${hint.definition}\n${hint.evidence}` : tag
  if (verdict === 'deny') return { text: `已否认·${tag}`, title, kind: 'denied' }
  if (verdict === 'confirm') return { text: tag, title, kind: 'confirmed' }
  if (hint) return { text: `疑似${tag}｜置信度${conf}`, title, kind: 'suspected' }
  return { text: tag, title, kind: 'fact' }
}

function sessionLabel(trip: RoundTrip): string {
  if (trip.holdMinutes >= 48 * 60) return '跨日'
  if (trip.session === 'open30') return '开盘'
  if (trip.session === 'close') return '尾盘'
  return '盘中'
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function signedPct(v: number | null | undefined) {
  if (v == null) return 'N/A'
  return <span className={clsPnl(v)}>{pct(v)}</span>
}

function signedMoney(v: number | null | undefined, digits = 0) {
  if (v == null) return 'N/A'
  return <span className={clsPnl(v)}>{money(v, digits)}</span>
}

function Hint(props: { term: string; def: string }) {
  return (
    <abbr className="hint" title={props.def}>
      {props.term}
    </abbr>
  )
}

const GLOSSARY: Array<[string, string]> = [
  ['盯市', '未平仓持仓按最新价估算的盈亏，会随价格波动，不等于已落袋。'],
  ['已实现', '已平仓往返交易的实际盈亏。'],
  ['TWR', '时间加权收益，剥离外部入出金影响后的账户复合增长。'],
  ['XIRR', '资金加权内部收益率，通常年化表达，会被中途出入金改变。'],
  ['MAE', '持仓期间按日线估算的最大不利浮亏（路径最低点相对开仓）。'],
  ['MFE', '持仓期间按日线估算的最大有利浮盈（路径最高点相对开仓）。'],
  ['ATR-R', '盈亏除以「开仓前 ATR × 数量」得到的风险单位，用于跨标的比较。'],
  ['胜率', '盈利往返笔数 ÷ 已平仓往返总笔数。'],
  ['期望', '每笔往返交易的平均盈亏。'],
  ['PF / 盈亏比', '总盈利 ÷ 总亏损（Profit Factor）。'],
  ['夏普 Sharpe', '单位波动风险所承担的超额收益。'],
  ['Sortino', '只对下行波动惩罚的风险调整收益。'],
  ['Calmar', '年化收益 ÷ 最大回撤。'],
  ['Bootstrap', '对样本重复重抽样以估计置信区间，判断结论是否统计上站得住。'],
  ['置信区间', '样本随机波动下结果的可能范围；区间跨零 = 正负方向还锁不住。'],
]

function VChip(props: { label: string; tone?: 'ok' | 'watch' | 'fail' | 'na'; onClick?: () => void }) {
  const cls = `vchip ${props.tone || 'na'}${props.onClick ? ' clickable' : ''}`
  if (props.onClick) {
    return (
      <button type="button" className={cls} onClick={props.onClick}>
        {props.label}
      </button>
    )
  }
  return <span className={cls}>{props.label}</span>
}

function MetricLine(props: {
  k: ReactNode
  m: MetricPoint
  kind?: 'pct' | 'money' | 'num'
  digits?: number
  onClick?: () => void
  filtered?: boolean
  plain?: boolean
}) {
  const kind = props.kind ?? 'num'
  const digits = props.digits ?? (kind === 'money' ? 0 : kind === 'pct' ? 1 : 2)
  const v = props.m.value
  const shown =
    v == null
      ? 'N/A'
      : !Number.isFinite(v)
        ? finiteNum(v, digits)
        : kind === 'pct'
          ? props.plain
            ? pctPlain(v, digits)
            : pct(v, digits)
          : kind === 'money'
            ? money(v, digits)
            : v.toFixed(digits)
  const innerValue = (
    <b className={v != null && kind !== 'num' && props.m.n >= 10 && !props.plain ? clsPnl(v) : ''}>
      {shown}
      <div className="tiny">
        n={props.m.n}
        {props.m.eligible !== props.m.n ? ` · 有效 ${props.m.n}/${props.m.eligible}` : ''}
        {props.m.excluded ? ` · 排除 ${props.m.excluded}` : ''}
        {props.m.ci && !props.filtered ? ` · 95% ${ciText(props.m.ci, kind, digits)}` : ''}
        {props.filtered ? ' · 按所选交易' : ''}
      </div>
    </b>
  )
  return (
    <>
      <span className={props.onClick ? 'kv-link' : undefined} onClick={props.onClick}>
        {props.k}
      </span>
      {props.onClick ? (
        <b className={v != null && kind !== 'num' && props.m.n >= 10 && !props.plain ? clsPnl(v) : ''}>
          <button type="button" className="link" onClick={props.onClick}>
            {shown}
          </button>
          <div className="tiny">
            n={props.m.n}
            {props.m.eligible !== props.m.n ? ` · 有效 ${props.m.n}/${props.m.eligible}` : ''}
            {props.m.excluded ? ` · 排除 ${props.m.excluded}` : ''}
            {props.m.ci && !props.filtered ? ` · 95% ${ciText(props.m.ci, kind, digits)}` : ''}
            {props.filtered ? ' · 按所选交易' : ''}
          </div>
        </b>
      ) : (
        innerValue
      )}
    </>
  )
}

function statusLabel(s: GroupRow): string {
  if (s.status === 'empty') return '无样本'
  if (s.status === 'raw') return '仅列表'
  if (s.status === 'observe') return '探索性'
  if (s.status === 'weak') return '弱结论'
  return '可验证'
}

function monthlyDeltas(equity: EquityPoint[]): Array<{ label: string; value: number }> {
  if (equity.length < 2) return []
  const lastByMonth = new Map<string, number>()
  for (const e of equity) lastByMonth.set(e.date.slice(0, 7), e.equity)
  const months = [...lastByMonth.keys()].sort()
  return months.map((m, i) => {
    const last = lastByMonth.get(m) ?? 0
    const prev = i === 0 ? equity[0].equity : (lastByMonth.get(months[i - 1]) ?? last)
    return { label: m.slice(2), value: last - prev }
  })
}

function monthlyIndexRets(equity: EquityPoint[]): Array<{ label: string; value: number }> {
  if (equity.length < 2) return []
  const lastByMonth = new Map<string, number>()
  for (const e of equity) lastByMonth.set(e.date.slice(0, 7), e.index)
  const months = [...lastByMonth.keys()].sort()
  return months.map((m, i) => {
    const last = lastByMonth.get(m) ?? 100
    const prev = i === 0 ? equity[0].index : (lastByMonth.get(months[i - 1]) ?? last)
    return { label: m.slice(2), value: prev ? last / prev - 1 : 0 }
  })
}

function dailyIndexRets(equity: EquityPoint[]): number[] {
  const out: number[] = []
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].index
    if (prev) out.push(equity[i].index / prev - 1)
  }
  return out
}

function dailyDeltas(equity: EquityPoint[]): number[] {
  const out: number[] = []
  for (let i = 1; i < equity.length; i++) out.push(equity[i].equity - equity[i - 1].equity)
  return out
}

const REGIME_COLORS: Record<string, string> = {
  intraday: 'hsl(8 66% 55%)',
  swing: 'hsl(35 60% 52%)',
  position: 'hsl(200 50% 50%)',
  investor: 'hsl(222 38% 56%)',
}

// 频率构成:每类一行,把混合摊开,每行自带大白话说明,不用行话。
function RegimeMixBar({ checkup }: { checkup: Checkup }) {
  const present = checkup.regimeMix.filter((m) => m.n > 0)
  const total = checkup.regimeMix.reduce((s, m) => s + m.n, 0)
  if (!total) return null
  const diag = checkup.holdDiagnostic
  return (
    <section className="panel" style={{ padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ fontSize: 13, margin: 0 }}>频率构成</h3>
        <span className="tiny muted">按持有时间分成四类 · 描述这段交易,不给人贴标签</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          columnGap: 14,
          rowGap: 8,
          alignItems: 'center',
          marginTop: 12,
        }}
      >
        {present.map((m) => (
          <Fragment key={m.regime}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <i style={{ width: 9, height: 9, borderRadius: 2, background: REGIME_COLORS[m.regime], display: 'inline-block' }} />
              <b style={{ fontSize: 13 }}>{REGIME_LABELS[m.regime]}</b>
              <span className="tiny muted">{REGIME_BOUND_TEXT[m.regime]}</span>
            </span>
            <span style={{ height: 8, background: 'var(--panel2)', borderRadius: 4, position: 'relative', minWidth: 48 }}>
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${m.share * 100}%`,
                  background: REGIME_COLORS[m.regime],
                  borderRadius: 4,
                }}
              />
            </span>
            <span className="tiny" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {m.n} 笔 · {Math.round(m.share * 100)}%
            </span>
          </Fragment>
        ))}
      </div>
      {diag.fitsDefaultBands != null ? (
        <p className="tiny muted" style={{ margin: '12px 0 0' }}>
          {diag.note}
        </p>
      ) : null}
    </section>
  )
}

function groupForestItems(rows: GroupRow[]) {
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.n >= 5 ? r.expectancy : null,
    lo: r.expectancyCi?.lo,
    hi: r.expectancyCi?.hi,
    unboundedHi: r.expectancyCi?.unboundedHi,
    n: r.n,
    dim: r.n < 10,
  }))
}

/**
 * 集中度矩形树图:每笔一个矩形,面积 = |已实现盈亏|,颜色 = 盈亏正负。
 * 最大一笔(TSLA)占满大半,其余缩成边角小块,一眼看出"靠一两单撑起来"——
 * 面积编码比条形更能表达集中,也避开了一排细条中间全是噪声的问题。数据现算,不碰引擎。
 */
function ConcentrationTreemap(props: {
  trips: Array<{ id: string; symbol: string; realizedPnl: number }>
  hl: WhyHl
  onPick?: (trip: { id: string; symbol: string }) => void
}) {
  const rows = props.trips.filter((t) => Number.isFinite(t.realizedPnl) && t.realizedPnl !== 0)
  if (rows.length < 2) return null
  const bySym = new Map<string, { pnl: number; n: number; max: number }>()
  for (const t of rows) {
    const cur = bySym.get(t.symbol) || { pnl: 0, n: 0, max: 0 }
    cur.pnl += t.realizedPnl
    cur.n += 1
    if (Math.abs(t.realizedPnl) > Math.abs(cur.max)) cur.max = t.realizedPnl
    bySym.set(t.symbol, cur)
  }
  const top = [...bySym.entries()].sort((a, b) => b[1].pnl - a[1].pnl)[0]
  const topWin = [...bySym.entries()].filter(([, v]) => v.pnl > 0).sort((a, b) => b[1].pnl - a[1].pnl)[0]
  const grossWin = [...bySym.values()].filter((v) => v.pnl > 0).reduce((s, v) => s + v.pnl, 0)
  const winShare = topWin && grossWin > 0 ? topWin[1].pnl / grossWin : null
  const maxShare = top && top[1].pnl !== 0 ? Math.abs(top[1].max) / Math.abs(top[1].pnl) : null
  const overNet = maxShare != null && maxShare > 1
  const kind = top && top[1].n <= 2 && (maxShare ?? 0) >= 0.8 ? '单笔异常贡献' : '多笔持续贡献'
  return (
    <>
      <p className="tiny">
        Treemap：只表达集中度（面积=|金额|）。n={rows.length}
        {topWin && winShare != null ? (
          <>
            {' '}
            {topWin[0]} 占毛利 {pctPlain(winShare, 0)}
          </>
        ) : null}
        {top ? (
          <>
            {' '}
            ｜{top[0]} {money(top[1].pnl)}｜{top[1].n} 笔｜最大一笔占该标的 {maxShare == null ? '—' : pctPlain(maxShare, 0)}
            （{kind}）
            {overNet ? '。其他交易小额亏损，故单笔超过该标的净盈利。' : ''}
          </>
        ) : null}
      </p>
      <Treemap
        height={180}
        items={rows.map((t) => ({
          id: t.id,
          label: t.symbol,
          value: Math.abs(t.realizedPnl),
          up: t.realizedPnl >= 0,
          sub: money(t.realizedPnl),
          dim: dimOf(props.hl, t.symbol, t.id),
        }))}
        onPick={(id) => {
          const t = rows.find((x) => x.id === id)
          if (t) props.onPick?.(t)
        }}
      />
    </>
  )
}

function Ch(props: {
  meta?: { id: string; label: string; status: string; role: 'core' | 'candidate' | 'explore' | 'quality' | 'ledger' }
  children: ReactNode
}) {
  if (!props.meta) return null
  const m = props.meta
  return (
    <WhyChapter id={m.id} title={m.label} status={m.status} role={m.role}>
      {props.children}
    </WhyChapter>
  )
}

function worstGroupExtra(rows: GroupRow[]): WhyEvidenceExtra {
  const ranked = rows.filter((r) => r.n > 0)
  const worst = [...ranked].sort((a, b) => a.pnl - b.pnl)[0]
  if (!worst) return {}
  return {
    scope: `${worst.label} · n=${worst.n}`,
    realized: worst.pnl,
    counterfactual: -worst.pnl,
    metric: worst.expectancy == null ? '—' : `单笔均值 ${money(worst.expectancy)}`,
    limit: '机械反事实只是样本内加减，不代表该规则未来有效',
  }
}

function GroupViz(props: { title: string; rows: GroupRow[]; onPick: (row: GroupRow) => void; id?: string }) {
  const items = groupForestItems(props.rows)
  const exRows = props.rows.filter((r) => r.n >= 2 && (r.expectancy != null || r.expectancyExMax != null))
  return (
    <article className="panel" id={props.id}>
      <h3>{props.title}</h3>
      {exRows.length ? (
        <ul className="tiny why-exmax">
          {exRows.map((r) => (
            <li key={r.id}>
              {r.label}：原始均值 {r.expectancy == null ? '—' : money(r.expectancy)} / 剔除最大一笔后{' '}
              {r.expectancyExMax == null ? '—' : money(r.expectancyExMax)} / n={r.n}
            </li>
          ))}
        </ul>
      ) : null}
      <ForestPlot
        items={items}
        format={money}
        onPick={(id) => {
          const row = props.rows.find((r) => r.id === id)
          if (row && row.n > 0) props.onPick(row)
        }}
      />
      <details className="fold-block">
        <summary>明细表</summary>
        <GroupTable rows={props.rows} onPick={props.onPick} />
      </details>
    </article>
  )
}

function GroupTable(props: { rows: GroupRow[]; onPick: (row: GroupRow) => void }) {
  const ranked = props.rows.filter((s) => s.n >= 5)
  const low = props.rows.filter((s) => s.n > 0 && s.n < 5)
  const empty = props.rows.filter((s) => s.n === 0)
  const total = props.rows.find((s) => s.total != null)?.total
  const covered = total != null ? props.rows.reduce((sum, s) => sum + s.n, 0) : null
  const render = (s: GroupRow) => (
    <tr
      key={s.id}
      className={`${s.n < 10 ? 'low-n' : ''} clickable-row`}
      onClick={() => props.onPick(s)}
      role="button"
      tabIndex={0}
    >
      <td>
        {s.label}
        <div className="tiny">{s.fact}</div>
      </td>
      <td>{s.n}</td>
      <td>
        {s.winRate == null ? '—' : pctPlain(s.winRate, 0)}
        {s.winCi ? <div className="tiny">{ciText(s.winCi, 'pct', 0)}</div> : null}
      </td>
      <td>{s.medianAtrR != null ? s.medianAtrR.toFixed(2) : '—'}</td>
      <td className={s.n >= 10 && s.expectancy != null ? clsPnl(s.expectancy) : ''}>
        {s.expectancy == null ? '—' : money(s.expectancy)}
        {s.expectancyExMax != null ? <div className="tiny">去掉最大一笔 {money(s.expectancyExMax)}</div> : null}
      </td>
      <td>{s.pf == null ? 'N/A' : !Number.isFinite(s.pf) ? '+∞' : s.pf > 20 ? '> 20' : s.pf.toFixed(2)}</td>
      <td>{statusLabel(s)}</td>
    </tr>
  )
  return (
    <div>
      {total != null && covered != null ? (
        <p className="tiny muted">
          有效 {covered}/{total}
          {total - covered > 0 ? `｜缺失 ${total - covered}` : '｜全覆盖'}
        </p>
      ) : null}
      <table className="grid trips">
        <thead>
          <tr>
            <th>分组</th>
            <th>n</th>
            <th>胜率</th>
            <th>中位 ATR-R</th>
            <th>历史单笔均值</th>
            <th>PF</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>{ranked.map((s) => render(s))}</tbody>
      </table>
      {low.length ? (
        <details className="fold-block">
          <summary>低样本分组（n&lt;5，不参与排序与自动总结）</summary>
          <table className="grid trips">
            <tbody>{low.map((s) => render(s))}</tbody>
          </table>
        </details>
      ) : null}
      {empty.length ? (
        <p className="tiny">无样本：{empty.map((s) => s.label).join('、')}（胜率 / 期望 / PF 不显示为 0）</p>
      ) : null}
    </div>
  )
}

function tripsForGroup(id: string, trips: RoundTrip[]): RoundTrip[] {
  const closed = trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
  if (id === 'open30' || id === 'midday' || id === 'close') return closed.filter((t) => t.session === id)
  if (id === 'long' || id === 'short') return closed.filter((t) => t.side === id)
  if (id.startsWith('wd')) {
    const d = Number(id.slice(2))
    return closed.filter((t) => {
      const p = etParts(t.openTime)
      return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === d
    })
  }
  if (id === 'h1') return closed.filter((t) => t.holdMinutes < 24 * 60)
  if (id === 'h2') return closed.filter((t) => t.holdMinutes >= 24 * 60 && t.holdMinutes < 5 * 24 * 60)
  if (id === 'h3') return closed.filter((t) => t.holdMinutes >= 5 * 24 * 60)
  return []
}

type TradeBenchRow = {
  trip: RoundTrip
  stockRet: number
  spxRet: number | null
  excess: number | null
}

function tradeBenchComparison(episodes: RoundTrip[], benchBars: Bar[]) {
  const benchMap = new Map<string, number>()
  for (const b of benchBars) if (b.close > 0) benchMap.set(b.date, b.close)
  const rows: TradeBenchRow[] = []
  for (const t of episodes) {
    if (t.status !== 'closed' || t.tags.includes('DRIP')) continue
    if (!t.openPrice || !t.closePrice || !t.closeTime) continue
    const stockRet = t.side === 'long' ? t.closePrice / t.openPrice - 1 : t.openPrice / t.closePrice - 1
    const openDate = etDateKey(t.openTime)
    const closeDate = etDateKey(t.closeTime)
    const bo = benchMap.get(openDate)
    const bc = benchMap.get(closeDate)
    const spxRet = bo != null && bc != null && bo > 0 ? bc / bo - 1 : null
    rows.push({ trip: t, stockRet, spxRet, excess: spxRet != null ? stockRet - spxRet : null })
  }
  const withExcess = rows.filter((r) => r.excess != null)
  const excesses = withExcess.map((r) => r.excess as number).sort((a, b) => a - b)
  const mid = (arr: number[]) => {
    if (!arr.length) return null
    const m = Math.floor(arr.length / 2)
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2
  }
  return {
    rows,
    n: rows.length,
    beat: withExcess.filter((r) => (r.excess as number) > 0).length,
    medianExcess: mid(excesses),
    meanExcess: excesses.length ? excesses.reduce((s, v) => s + v, 0) / excesses.length : null,
  }
}

type ChartRange = { lo: number; hi: number } | null

function BookPathChart(props: {
  mode: 'account' | 'sleeve'
  equity: EquityPoint[]
  cursor: number | null
  range: ChartRange
  marks: number[]
  markers?: PathMarker[]
  onCursor: (i: number | null) => void
  onRange: (range: { lo: number; hi: number } | null) => void
}) {
  const sleeve = props.mode === 'sleeve'
  return (
    <div className="chart-wrap tall cover-path">
      <MultiLine
        height={208}
        baseline={sleeve ? 0 : 100}
        tickFormat={sleeve ? moneyK : undefined}
        dates={props.equity.map((e) => e.date)}
        hideDates
        tight
        axisReadout={false}
        markerDots={false}
        markers={props.markers}
        cursor={props.cursor}
        range={props.range}
        marks={props.marks}
        onCursor={props.onCursor}
        onRange={props.onRange}
        series={[
          {
            values: props.equity.map((e) => (sleeve ? e.equity : e.index)),
            color: 'var(--path-line)',
            width: 1.6,
          },
        ]}
      />
    </div>
  )
}

function CoverDrawdown(props: {
  accountOk: boolean
  sleeveOk: boolean
  fail: boolean
  book: Book
  p: Book['performance']
  cursor: number | null
  range: ChartRange
  ddSeries: number[] | null
  naReason: string
  onCursor: (i: number | null) => void
  onRange: (range: { lo: number; hi: number } | null) => void
  onPickDay: (i: number) => void
}) {
  const { accountOk, sleeveOk, fail, book, p, cursor, range, ddSeries } = props
  if (fail) return <p className="tiny">路径异常，回撤图禁用。</p>
  if (accountOk && book.equity.length) {
    return (
      <div className="chart-wrap cover-dd" id="dd">
        <MultiLine
          height={132}
          baseline={0}
          tight
          axisReadout={false}
          markerDots={false}
          tickFormat={(v) => pct(v)}
          tickStep={0.05}
          dates={book.equity.map((e) => e.date)}
          cursor={cursor}
          range={range}
          areaFill
          onCursor={props.onCursor}
          onRange={props.onRange}
          onPick={props.onPickDay}
          series={[{ values: book.equity.map((e) => e.drawdown), color: 'var(--down)', width: 1.3 }]}
        />
        <p className="tiny path-foot">
          最大回撤 {p.maxDrawdown == null ? 'N/A' : pct(p.maxDrawdown)}
          {p.ddTrough ? ` · 谷底 ${p.ddTrough}` : ''}
          {p.ddRecover ? ` · 恢复 ${p.ddRecover}` : p.currentlyUnderwater ? ' · 尚未恢复' : ''}
        </p>
      </div>
    )
  }
  if (sleeveOk && ddSeries) {
    return (
      <div className="chart-wrap cover-dd" id="dd">
        <MultiLine
          height={132}
          baseline={0}
          tight
          axisReadout={false}
          markerDots={false}
          tickFormat={moneyK}
          tickStep={25000}
          dates={book.equity.map((e) => e.date)}
          cursor={cursor}
          range={range}
          areaFill
          onCursor={props.onCursor}
          onRange={props.onRange}
          onPick={props.onPickDay}
          series={[{ values: ddSeries, color: 'var(--down)', width: 1.3 }]}
        />
        <p className="tiny path-foot">
          最大回落 {p.maxDrawdownUsd ? `−${moneyAbs(p.maxDrawdownUsd)}` : 'N/A'}
          {p.ddTrough ? ` · 谷底 ${p.ddTrough}` : ''}
        </p>
      </div>
    )
  }
  return <p className="tiny">{props.naReason}</p>
}

function TradeBenchPanel(props: {
  rows: TradeBenchRow[]
  n: number
  beat: number
  medianExcess: number | null
  meanExcess: number | null
  onOpenTrip: (trip: RoundTrip) => void
}) {
  const sorted = [...props.rows].sort((a, b) => (b.excess ?? -Infinity) - (a.excess ?? -Infinity))
  const allMissing = props.rows.length > 0 && props.rows.every((r) => r.spxRet == null)
  const excesses = props.rows.map((r) => r.excess).filter((x): x is number => x != null)
  return (
    <article className="panel wide">
      <h3>持有期相对 SPY（机会成本）</h3>
      <p className="muted">
        每笔从入场到出场期间，标的收益率 − SPY 同期收益率。空头已翻转标的收益。这是持有期超额，不是账户满仓对照，也不是亏损原因。
      </p>
      {allMissing ? (
        <div className="banner cannot-prove">
          <strong>SPY 同期价格不可用，暂停计算超额收益。</strong>
          <div>请检查行情源或稍后重试。</div>
        </div>
      ) : (
        <>
          <div className="kv-grid">
            <span>持有期跑赢 SPY 的笔数</span>
            <b>
              {props.beat} / {props.n} 笔
            </b>
            <span>中位超额收益</span>
            <b>{props.medianExcess == null ? '—' : <span className={clsPnl(props.medianExcess)}>{pct(props.medianExcess)}</span>}</b>
            <span>平均超额收益</span>
            <b>{props.meanExcess == null ? '—' : <span className={clsPnl(props.meanExcess)}>{pct(props.meanExcess)}</span>}</b>
          </div>
          {excesses.length >= 3 ? <Histogram values={excesses} bins={17} format={pct} /> : null}
          {sorted.length ? (
            <details className="fold-block">
              <summary>逐笔对照表 · {sorted.length} 行</summary>
              <table className="grid trips">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>方向</th>
                    <th>股票持有期</th>
                    <th>SPY 同期</th>
                    <th>超额</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.trip.id} onClick={() => props.onOpenTrip(r.trip)} role="button" tabIndex={0}>
                      <td>
                        <b>{r.trip.symbol}</b>
                        <div className="muted">{r.trip.name}</div>
                      </td>
                      <td>{r.trip.side === 'long' ? '多' : '空'}</td>
                      <td className={clsPnl(r.stockRet)}>{pct(r.stockRet)}</td>
                      <td>{r.spxRet == null ? 'SPY 同期不可用' : <span className={clsPnl(r.spxRet)}>{pct(r.spxRet)}</span>}</td>
                      <td>{r.excess == null ? '—' : <span className={clsPnl(r.excess)}>{pct(r.excess)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : (
            <p className="tiny">没有可对拍的闭环交易（缺少基准行情或平仓价格）。</p>
          )}
        </>
      )}
    </article>
  )
}

function AccountDrawer(props: {
  initialCapital: number | null
  busy?: boolean
  onClose: () => void
  onSubmit: (args: { initialCapital: number | null; cashText: string; cashflowComplete: boolean }) => void
}) {
  const [capital, setCapital] = useState(props.initialCapital != null ? String(props.initialCapital) : '')
  const [cashText, setCashText] = useState('')
  const [noCf, setNoCf] = useState(false)
  const initial = capital.trim() ? Number(capital.replace(/,/g, '')) : null
  return (
    <aside className="drawer wide-drawer">
      <button type="button" className="drawer-close" onClick={props.onClose}>
        关闭
      </button>
      <h3>补充账户数据</h3>
      <p className="tiny">
        补填期初净资产与外部入出金后，即可计算账户 TWR、XIRR 与相对基准。文件仍在浏览器本地处理。
      </p>
      <label>
        期初净资产（USD）
        <input
          value={capital}
          onChange={(e) => setCapital(e.target.value)}
          placeholder="例如 80000"
          inputMode="decimal"
        />
        <span className="field-note">留空则继续只算正股盯市盈亏，不和 SPY 对拍。</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={noCf}
          onChange={(e) => {
            setNoCf(e.target.checked)
            if (e.target.checked) setCashText('')
          }}
        />
        分析期间确认没有外部入出金
      </label>
      {!noCf ? (
        <label className="cash">
          或粘贴出入金 CSV
          <textarea
            rows={3}
            value={cashText}
            onChange={(e) => setCashText(e.target.value)}
            placeholder="time,type,amount&#10;2024-03-01T09:00:00,deposit,25000"
          />
        </label>
      ) : null}
      <button
        type="button"
        className="btn-primary"
        disabled={props.busy}
        onClick={() =>
          props.onSubmit({
            initialCapital: initial && initial > 0 ? initial : null,
            cashText: noCf ? '' : cashText,
            cashflowComplete: noCf || Boolean(cashText.trim()),
          })
        }
      >
        {props.busy ? '正在重算…' : '保存并重算'}
      </button>
    </aside>
  )
}

function tradeMetrics(trips: RoundTrip[]): { winRate: MetricPoint; expectancy: MetricPoint; profitFactor: MetricPoint } {
  const n = trips.length
  const wins = trips.filter((t) => t.realizedPnl > 0)
  const losses = trips.filter((t) => t.realizedPnl < 0)
  const gp = wins.reduce((s, t) => s + t.realizedPnl, 0)
  const gl = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0))
  return {
    winRate: {
      value: n ? wins.length / n : null,
      n,
      eligible: n,
      excluded: 0,
      ci: null,
      basis: '当前筛选下的闭环往返',
    },
    expectancy: {
      value: n ? trips.reduce((s, t) => s + t.realizedPnl, 0) / n : null,
      n,
      eligible: n,
      excluded: 0,
      ci: null,
      basis: '当前筛选下的单笔平均盈亏',
    },
    profitFactor: {
      value: gl > 1e-9 ? gp / gl : gp > 0 ? Number.POSITIVE_INFINITY : 0,
      n,
      eligible: n,
      excluded: 0,
      ci: null,
      basis: '当前筛选下的毛利/毛亏',
      naReason: gl <= 1e-9 && gp > 0 ? '没有亏损，PF 为 +∞' : undefined,
    },
  }
}

function ciSide(ci: MetricPoint['ci'], ref: number): 'above' | 'below' | 'unsure' {
  if (!ci) return 'unsure'
  if (ci.lo > ref) return 'above'
  if (ci.hi != null && !ci.unboundedHi && ci.hi < ref) return 'below'
  return 'unsure'
}

function QualityRead(props: {
  trips: RoundTrip[]
  winRate: MetricPoint
  expectancy: MetricPoint
  profitFactor: MetricPoint
  payoff: MetricPoint
  filtered?: boolean
  onWinRate?: () => void
  onExpectancy?: () => void
}) {
  const n = props.trips.length
  const winN = props.trips.filter((t) => t.realizedPnl > 0).length
  const lossN = n - winN
  const wr = props.winRate.value
  const exp = props.expectancy.value
  const pf = props.profitFactor.value
  const payoff = props.payoff.value
  const wrSide = ciSide(props.winRate.ci, 0.5)
  const expSide = ciSide(props.expectancy.ci, 0)
  const pfSide = ciSide(props.profitFactor.ci, 1)

  let headline = `这 ${n} 笔的质量还没看清。`
  if (n > 0 && n < 20) headline = `只有 ${n} 笔，数字会跳。下面当观察，不当已经证实的优势。`
  else if (exp != null && expSide === 'unsure') {
    headline = `平均每笔是 ${money(exp)}，但样本锁不住正负：换一批类似交易，大亏或小赚都可能。`
  } else if (exp != null && expSide === 'below') {
    headline = `平均每笔亏钱（${money(exp)}）。按现在的样本，这不太像纯运气。`
  } else if (exp != null && expSide === 'above') {
    headline = `平均每笔赚钱（${money(exp)}）。按现在的样本，正向期望比较站得住。`
  }

  const wrNote =
    wr == null
      ? '算不出胜率。'
      : `一共 ${n} 笔，大约 ${winN} 笔赚、${lossN} 笔没赚。${
          wrSide === 'below'
            ? '胜率偏低这件事比较清楚。'
            : wrSide === 'above'
              ? '胜率过半这件事比较清楚。'
              : `大概落在 ${ciText(props.winRate.ci, 'pct', 0)}，过没过一半还说不准。`
        }`

  const expNote =
    exp == null
      ? '算不出平均。'
      : expSide === 'unsure'
        ? `这是这 ${n} 笔加起来再平均。误差大约 ${ciText(props.expectancy.ci, 'money', 0)}，连赚还是亏都锁不住。`
        : `误差大约 ${ciText(props.expectancy.ci, 'money', 0)}，没有跨过 0。`

  const pfShown = pf == null ? '—' : !Number.isFinite(pf) ? '无亏损' : pf.toFixed(2)
  const payText = payoff != null && Number.isFinite(payoff) ? payoff.toFixed(1) : null
  const be = wr != null && payoff != null && payoff > 0 ? formatBe({ wr, need: 1 / (1 + payoff) }) : null
  let pfNote = '把所有赢的钱加总，除以所有亏的钱。大于 1 才整体赚钱。'
  if (pf == null) pfNote = '算不出。'
  else if (!Number.isFinite(pf)) pfNote = '这段没有亏损单，这个倍数没有意义。'
  else {
    pfNote = `毛利 ÷ 毛亏。大于 1 才整体赚钱，现在是 ${pfShown}，合计${pf < 1 ? '还在亏' : '是赚的'}。`
    if (payText && pf < 1) {
      pfNote += ` 赢的时候平均是亏的 ${payText} 倍，但赢的次数少，所以盈亏比看起来很高，合计仍补不满。`
    } else if (payText) {
      pfNote += ` 平均来看，赢的那笔大约是亏的 ${payText} 倍。`
    }
    if (pfSide === 'unsure') pfNote += ` 误差大约 ${ciText(props.profitFactor.ci, 'num', 2)}，过没过 1 还说不准。`
  }

  const beNote = be
    ? `胜率 ${be.wrText}，盈亏平衡需 ${be.needText}。${be.gapPp >= 0 ? '已经站在线的这边。' : '还没到线。'}和「是什么」同一套取整。`
    : '算不出盈亏平衡。'

  const row = (q: string, v: ReactNode, note: string, onAsk?: () => void) => (
    <div className="quality-row">
      {onAsk ? (
        <button type="button" className="quality-q" onClick={onAsk}>
          {q}
        </button>
      ) : (
        <span className="quality-q">{q}</span>
      )}
      <b className="quality-v">{v}</b>
      <p className="quality-note">{note}</p>
    </div>
  )

  return (
    <>
      <p className="muted">三个问题：赢得多不多、平均每笔怎样、总账打不打得平。</p>
      {props.filtered ? <p className="tiny">按你现在选中的交易重算。</p> : null}
      <p className="verdict" style={{ marginTop: 8 }}>
        {headline}
      </p>
      <div className="quality-rows">
        {row('赚钱的笔数够不够？', wr == null ? '—' : be?.wrText ?? pctPlain(wr, 0), wrNote, props.onWinRate)}
        {row(
          '离盈亏平衡还有多远？',
          be ? be.scan.replace(/^距盈亏平衡/, '') : '—',
          beNote,
        )}
        {row(
          '平均每笔赚还是亏？',
          exp == null ? '—' : <span className={clsPnl(exp)}>{money(exp)}</span>,
          expNote,
          props.onExpectancy,
        )}
        {row('赢的总额够不够补亏的？', pfShown, pfNote)}
      </div>
    </>
  )
}

function PnLBySymbol(props: { trips: RoundTrip[]; hl: WhyHl; onPick: (symbol: string) => void }) {
  const rows = symbolPareto(props.trips)
  if (!rows.length) return null
  const overNet = rows.filter((r) => r.maxShare != null && r.maxShare > 1)
  return (
    <>
      <p className="tiny">条形图：按标的精确贡献排序（金额）。n={props.trips.length}</p>
      {overNet.length ? (
        <p className="tiny">
          {overNet.map((r) => r.symbol).join('、')} 最大单笔超过该标的净盈利：其他交易小额亏损，故单笔占比大于 100%。
        </p>
      ) : null}
      <SignedBars
        items={rows.map((r) => ({
          id: r.symbol,
          label: r.symbol,
          value: r.pnl,
          n: r.n,
          dim: dimOf(props.hl, r.symbol),
        }))}
        format={money}
        onPick={props.onPick}
      />
      <details className="fold-block">
        <summary>按标的明细</summary>
        <table className="grid trips">
          <thead>
            <tr>
              <th>代码</th>
              <th>n</th>
              <th>合计</th>
              <th>均笔</th>
              <th>最大单笔占比</th>
              <th>亏损累计贡献</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.symbol}
                className={dimOf(props.hl, r.symbol) ? 'dim' : ''}
                onClick={() => props.onPick(r.symbol)}
                role="button"
                tabIndex={0}
              >
                <td>{r.symbol}</td>
                <td>{r.n}</td>
                <td className={clsPnl(r.pnl)}>{money(r.pnl)}</td>
                <td>{money(r.mean)}</td>
                <td>{r.maxShare == null ? '—' : pctPlain(r.maxShare, 0)}</td>
                <td>{r.lossCumShare == null ? '—' : pctPlain(r.lossCumShare, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}

function RDistribution(props: { trips: RoundTrip[] }) {
  const flagged = props.trips.filter((t) => (t.rFlags ?? []).length > 0)
  const clean = props.trips.filter((t) => t.rMultiple != null && Number.isFinite(t.rMultiple) && !(t.rFlags ?? []).length)
  const rs = clean.map((t) => t.rMultiple as number)
  return (
    <div className="why-r-compact" style={{ marginTop: 10 }}>
      <p className="tiny">仅 {clean.length} 笔有效，不参与主要归因。其余 {flagged.length} 笔缺少可靠的初始风险或止损数据。</p>
      {rs.length >= 4 ? (
        <BoxStrip values={rs} height={160} format={(v) => `${v.toFixed(1)}R`} />
      ) : (
        <p className="tiny">有效样本不足，不画 R 分布、不报平均 R。</p>
      )}
      <p className="tiny">
        有效 n={clean.length} / {props.trips.length}。口径异常见下方数据质量。
      </p>
    </div>
  )
}

function coverageTone(row: CoverageRow): 'ok' | 'watch' | 'fail' | 'na' {
  if (row.status === 'imported') return 'ok'
  if (row.status === 'not_computable') return 'fail'
  return 'watch'
}

function coverageHandling(row: CoverageRow): string {
  if (row.status === 'imported') return row.countedInPnl ? '已计入' : '已导入 · 未计入'
  if (row.status === 'not_computable') return '无法计算'
  if (row.item === '期初净资产') return '账户收益率不可计算'
  if (row.item === '外部入出金') return 'XIRR 不可计算'
  return '未计入'
}

function currentView(): Tab {
  return tabFromView(new URLSearchParams(window.location.search).get('view'))
}

function initialHash(): string {
  const raw = new URLSearchParams(window.location.search).get('view')
  if (window.location.hash.length > 1) return window.location.hash.slice(1)
  return (raw && ANALYSIS_HASH_FROM_VIEW[raw]) || ''
}

function writeView(tab: Tab, hash?: string) {
  const next = new URL(window.location.href)
  next.searchParams.set('view', viewOf(tab))
  if (hash) next.hash = hash
  else next.hash = ''
  history.replaceState(null, '', next)
}

export function Dashboard(props: {
  book: Book
  stage?: string | null
  progress?: number | null
  updating?: boolean
  quoteStatus?: QuoteStatus
  onRetryQuotes?: () => void
  onReset: () => void
  onSample: () => void
  onUpdateAccount?: (args: { initialCapital: number | null; cashText: string; cashflowComplete: boolean }) => void
}) {
  const { book } = props
  const p = book.performance
  const [tab, setTab] = useState<Tab>(() => currentView())
  const [sort, setSort] = useState<SortKey>('time')
  const [showAccountDrawer, setShowAccountDrawer] = useState(false)
  const [showHealth, setShowHealth] = useState(false)
  const [prefs, setPrefs] = useState<ProPrefs>(() => (typeof window === 'undefined' ? { minN: 15, minGroupN: 10, concentration: 0.4 } : loadProPrefs()))
  const [focusAnchor, setFocusAnchor] = useState<string | null>(() => initialHash() || null)
  const [selected, setSelected] = useState<RoundTrip | null>(null)
  const [insight, setInsight] = useState<Insight | null>(null)
  const [groupReturn, setGroupReturn] = useState<Insight | null>(null)
  const [showFills, setShowFills] = useState(false)
  const [sideFilter, setSideFilter] = useState<SideFilter>('all')
  const [symbolFilter, setSymbolFilter] = useState<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [range, setRange] = useState<{ lo: number; hi: number } | null>(null)
  const [showAllTrips, setShowAllTrips] = useState(false)
  const [focusTrip, setFocusTrip] = useState<string | null>(null)
  const [whyHl, setWhyHl] = useState<WhyHl>(null)
  const [showAllLenses, setShowAllLenses] = useState(false) // 入场时机面板的逃生口:判错也只花一次点击

  useEffect(() => {
    writeView(tab, focusAnchor || undefined)
  }, [tab, focusAnchor])

  const go = (next: Tab, hash?: string) => {
    setTab(next)
    if (hash) setFocusAnchor(hash)
    writeView(next, hash)
  }

  const goEvidence = (anchor: string) => {
    setShowHealth(false)
    setInsight(null)
    go(tabForAnchor(anchor), anchor)
  }

  const goWhyTrip = (id: string) => {
    setFocusTrip(id)
    setShowAllTrips(true)
    go('why', 'why-trips')
  }

  const persistPrefs = (next: ProPrefs) => {
    setPrefs(next)
    saveProPrefs(next)
  }

  const closedAll = useMemo(
    () => book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP')),
    [book.episodes],
  )

  useEffect(() => {
    if (tab !== 'why' || !focusTrip) return
    const t = window.setTimeout(() => {
      document.getElementById(`trip-${focusTrip}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [tab, focusTrip])
  const symbols = useMemo(() => [...new Set(closedAll.map((t) => t.symbol))].sort(), [closedAll])
  const rangeDates = useMemo(
    () =>
      range && book.equity[range.lo] && book.equity[range.hi]
        ? { start: book.equity[range.lo].date, end: book.equity[range.hi].date }
        : null,
    [range, book.equity],
  )
  const filtered = Boolean(rangeDates) || sideFilter !== 'all' || symbolFilter.length > 0
  const scoped = useMemo(() => {
    let list = closedAll
    if (sideFilter !== 'all') list = list.filter((t) => t.side === sideFilter)
    if (symbolFilter.length) list = list.filter((t) => symbolFilter.includes(t.symbol))
    if (rangeDates) {
      list = list.filter((t) => {
        const d = etDateKey(t.openTime)
        return d >= rangeDates.start && d <= rangeDates.end
      })
    }
    return list
  }, [closedAll, sideFilter, symbolFilter, rangeDates])

  const closed = useMemo(() => {
    const copy = [...scoped]
    copy.sort((a, b) => {
      if (sort === 'pnl') return b.realizedPnl - a.realizedPnl
      if (sort === 'r') return (b.rMultiple || 0) - (a.rMultiple || 0)
      if (sort === 'hold') return b.holdMinutes - a.holdMinutes
      return b.openTime.getTime() - a.openTime.getTime()
    })
    return copy
  }, [scoped, sort])

  const scopedMetrics = useMemo(() => (filtered ? tradeMetrics(scoped) : null), [filtered, scoped])
  const winRate = scopedMetrics?.winRate ?? p.winRate
  const expectancy = scopedMetrics?.expectancy ?? p.expectancy
  const profitFactor = scopedMetrics?.profitFactor ?? p.profitFactor
  const health = useMemo(() => buildHealth(book), [book])
  const diagnoses = useMemo(() => diagnose(book, prefs), [book, prefs])
  const cross = useMemo(() => buildCross(book.episodes), [book.episodes])
  const space = useMemo(() => (filtered ? buildSpace(scoped, book.bars) : book.space), [filtered, scoped, book.space, book.bars])
  const cover = useMemo(
    () => buildCover(book, diagnoses, health),
    [book, diagnoses, health],
  )
  const leadFacts = useMemo(() => whyLeadFacts(book), [book])
  const pickWhy = (next: { symbol?: string; tripId?: string }) => {
    setWhyHl((cur) => {
      if (next.tripId && cur?.tripId === next.tripId) return null
      if (!next.tripId && next.symbol && cur?.symbol === next.symbol && !cur.tripId) return null
      return next
    })
  }
  const pickWhyTrip = (id: string) => {
    const t = closedAll.find((x) => x.id === id)
    if (t) {
      pickWhy({ tripId: t.id, symbol: t.symbol })
      setFocusTrip(t.id)
    }
  }
  const whyChapters = useMemo(
    () =>
      buildWhyChapters({
        diagnoses,
        health,
        closedN: closedAll.length,
        sides: book.checkup.sides,
        weekdays: book.checkup.weekdays,
        holds: book.checkup.holdBuckets,
        sessionRelevant: book.checkup.sessionRelevant || showAllLenses,
        hasCross: cross.symbolHold.some((r) => r.n >= 5) || cross.weekdayRegime.some((r) => r.n >= 5),
        hasMc: Boolean(book.analytics.monteCarlo),
      }),
    [diagnoses, health, closedAll.length, book.checkup, showAllLenses, cross, book.analytics.monteCarlo],
  )
  const whyCh = (id: string) => whyChapters.find((c) => c.id === id)
  const exportTrips = () => {
    const rows = book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
    download(`muninn-trips-${book.accountName || 'book'}.csv`, tripsCsv(rows))
  }

  const scatter = closed.filter((t) => t.maePct != null && t.mfePct != null)
  const accountOk = p.pathKind === 'account'
  const sleeveOk = p.pathKind === 'sleeve' && book.equity.length > 0
  const naReason = p.accountReturnReason || '缺少账户收益率所需数据'
  const fail = p.pathAudit && !p.pathAudit.ok
  const hover = cursor != null ? book.equity[cursor] : null
  const cfMarks = useMemo(
    () => book.equity.map((e, i) => (e.cashflow ? i : -1)).filter((i) => i >= 0),
    [book.equity],
  )
  const ddSeries = useMemo(() => {
    if (!sleeveOk || !book.equity.length) return null
    let peak = -Infinity
    return book.equity.map((e) => {
      if (e.equity > peak) peak = e.equity
      return e.equity - peak
    })
  }, [sleeveOk, book.equity])
  const tradeBench = useMemo(() => tradeBenchComparison(book.episodes, book.bars.SPY || book.bars['^GSPC'] || []), [book.episodes, book.bars])
  const pathMarkers = useMemo((): PathMarker[] => {
    if (!book.equity.length || (!sleeveOk && !accountOk)) return []
    const valueOf = (e: EquityPoint) => (accountOk ? e.index : e.equity)
    const fmt = (e: EquityPoint) => (accountOk ? (e.index / 100).toFixed(3) : money(e.equity))
    const peakIdx = book.equity.reduce((best, e, i) => (valueOf(e) > valueOf(book.equity[best]) ? i : best), 0)
    const troughIdx = book.equity.reduce((best, e, i) => (valueOf(e) < valueOf(book.equity[best]) ? i : best), 0)
    const lastI = book.equity.length - 1
    const out: PathMarker[] = [
      { i: peakIdx, value: valueOf(book.equity[peakIdx]), kicker: '峰值', amount: fmt(book.equity[peakIdx]), tone: 'up' },
      { i: troughIdx, value: valueOf(book.equity[troughIdx]), kicker: '谷底', amount: fmt(book.equity[troughIdx]), tone: 'down' },
      { i: lastI, value: valueOf(book.equity[lastI]), kicker: '当前', tone: 'now' },
    ]
    return out.filter((m, i, arr) => arr.findIndex((x) => x.i === m.i) === i)
  }, [accountOk, sleeveOk, book.equity])
  const drawerOpen = Boolean(selected || insight || showAccountDrawer || showHealth)
  const openInsight = (nextInsight: Insight) => {
    setSelected(null)
    setGroupReturn(null)
    setInsight(nextInsight)
  }
  const openTrip = (trip: RoundTrip) => {
    if (insight) setGroupReturn(insight)
    setSelected(trip)
  }
  const closeTrip = () => {
    setSelected(null)
    if (groupReturn) {
      setInsight(groupReturn)
      setGroupReturn(null)
    }
  }
  const pickCoverage = (row: CoverageRow) => openInsight({ kind: 'coverage', row })
  const openAccountSupplement = () => {
    setSelected(null)
    setInsight(null)
    setGroupReturn(null)
    setShowAccountDrawer(true)
  }
  const clearFilters = () => {
    setSideFilter('all')
    setSymbolFilter([])
    setRange(null)
  }

  return (
    <div className={`dash ${drawerOpen ? 'with-drawer' : ''} ${props.updating ? 'is-updating' : ''}`}>
      {props.updating ? (
        <div className="recalc-veil">
          正在更新 · {props.stage}
          {props.progress != null ? (
            <div className="load-progress" aria-hidden>
              <b>
                <i style={{ width: `${Math.round(props.progress * 100)}%` }} />
              </b>
            </div>
          ) : null}
        </div>
      ) : null}

      {book.isSample ? (
        <div className="sample-bar">
          <strong>示例数据</strong>
          <span>真实成交，未填期初净资产</span>
          <button type="button" className="ghost sm" onClick={props.onReset}>
            导入我的账本
          </button>
          <button type="button" className="ghost sm" onClick={props.onSample}>
            重置示例
          </button>
          <button type="button" className="ghost sm" onClick={props.onReset}>
            退出样本模式
          </button>
        </div>
      ) : null}

      <header className="dash-hd">
        <div>
          <Brand small tagline="美股正股复盘台" />
          <h1>{book.isSample ? '示例账本' : book.accountName}</h1>
          <p className="scope-line">
            {book.isSample ? props.stage || '' : `${book.accountName}${props.stage ? ` ｜ ${props.stage}` : ''}`}
          </p>
        </div>
        <div className="hd-right">
          <HealthBadge health={health} onClick={() => setShowHealth(true)} />
          <ThemeToggle />
          <span className="pill print-hide">US Equities · Common stock</span>
          {!book.isSample ? (
            <button type="button" className="ghost sm print-hide" onClick={props.onReset}>
              上传另一份
            </button>
          ) : null}
        </div>
      </header>

      {fail ? (
        <div className="banner fail">
          <strong>收益路径异常，账户级结果不可用</strong>
          <div>{p.pathAudit?.issues.join('；')}</div>
        </div>
      ) : null}

      {props.quoteStatus === 'unavailable' ? (
        <div className="banner">
          <strong>行情数据暂不可用</strong>
          <div>当前仅展示基于已导入成交记录的复盘。收益曲线、基准对比及依赖行情的指标可能不可用。</div>
          {props.onRetryQuotes ? (
            <button type="button" className="ghost sm" style={{ marginTop: 8 }} onClick={props.onRetryQuotes}>
              重试拉取行情
            </button>
          ) : null}
        </div>
      ) : props.quoteStatus === 'partial' ? (
        <div className="banner">
          <strong>部分行情缺失</strong>
          <div>部分标的或日期的行情缺失，依赖行情的指标可能不完整（缺失按缺失处理，不当作零）。</div>
        </div>
      ) : null}

      <details className="warn">
        <summary>范围与口径说明（{book.warnings.length + 2}）</summary>
        <ul>
          <li>本期 = 这份导入覆盖的全部已平仓往返，不是自然月。</li>
          <li>数据新鲜度：{book.isSample ? '示例账本内置成交' : '本机刚才这次分析'}。成交仍留在本机。</li>
          {book.warnings.map((w) => (
            <li key={w.code + w.message}>{w.message}</li>
          ))}
        </ul>
      </details>

      <details className="warn glossary">
        <summary>术语表（{GLOSSARY.length}）</summary>
        <ul>
          {GLOSSARY.map(([term, def]) => (
            <li key={term}>
              <b>{term}</b>：{def}
            </li>
          ))}
        </ul>
      </details>

      {filtered && tab === 'why' ? (
        <div className="filter-bar">
          <div>
            正在只看
            {sideFilter === 'long' ? ' 多头' : sideFilter === 'short' ? ' 空头' : ''}
            {symbolFilter.length ? ` ${symbolFilter.join('、')}` : ''}
            {rangeDates ? ` ${rangeDates.start} 至 ${rangeDates.end}` : ''}
            的交易
          </div>
          <p>下面的胜率、期望会按这些交易重算。上面的 TWR、回撤仍是整本账，不会假装变成这一部分的收益。</p>
          <button type="button" className="ghost sm" onClick={clearFilters}>
            清除筛选
          </button>
        </div>
      ) : null}

      <nav className="tabs sticky-tabs print-hide">
        {TABS.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? 'on' : ''} onClick={() => go(item.id)}>
            <b>{item.label}</b>
            <span className="tab-answer">{cover.summaries[item.id]}</span>
          </button>
        ))}
      </nav>

      <div className={`tab-panel ${tab === 'what' ? 'on' : ''}`}>
        <WhatPage
          book={book}
          cover={cover}
          trips={closedAll}
          onWhy={() => go('why')}
          onOpenHealth={() => setShowHealth(true)}
          onFillAccount={openAccountSupplement}
          onPickTrip={goWhyTrip}
          pathVisual={
            fail ? (
              <p className="tiny">路径校验未通过，本图禁用，避免把错误路径当成账户收益。</p>
            ) : !book.equity.length ? (
              <p className="tiny">还没有可画的正股路径。</p>
            ) : (
              <div className="path-stack">
                {accountOk || sleeveOk ? (
                  <BookPathChart
                    mode={accountOk ? 'account' : 'sleeve'}
                    equity={book.equity}
                    cursor={cursor}
                    range={range}
                    marks={cfMarks}
                    markers={pathMarkers}
                    onCursor={setCursor}
                    onRange={setRange}
                  />
                ) : (
                  <p className="tiny">还没有可画的正股路径。</p>
                )}
                {range && range.hi !== range.lo ? (
                  <p className="tiny path-foot">
                    已框选 {book.equity[range.lo]?.date} 至 {book.equity[range.hi]?.date}。
                    <button type="button" className="link" onClick={() => setRange(null)}>
                      重置范围
                    </button>
                  </p>
                ) : null}
                <CoverDrawdown
                  accountOk={accountOk}
                  sleeveOk={sleeveOk}
                  fail={!!fail}
                  book={book}
                  p={p}
                  cursor={cursor}
                  range={range}
                  ddSeries={ddSeries}
                  naReason={naReason}
                  onCursor={setCursor}
                  onRange={setRange}
                  onPickDay={(i) => openInsight({ kind: 'day', point: book.equity[i] })}
                />
                {hover && cursor != null ? (
                  <div
                    className={`path-tip${cursor / Math.max(book.equity.length - 1, 1) > 0.72 ? ' right' : ''}`}
                    style={{
                      left: `calc(52px + ${cursor / Math.max(book.equity.length - 1, 1)} * (100% - 64px))`,
                    }}
                  >
                    <b>{hover.date}</b>
                    {accountOk ? (
                      <span>账户财富 {(hover.index / 100).toFixed(3)}</span>
                    ) : (
                      <span>盯市盈亏 {money(hover.equity)}</span>
                    )}
                    <span>
                      距高点{' '}
                      {accountOk
                        ? pct(hover.drawdown)
                        : ddSeries && ddSeries[cursor] != null
                          ? money(ddSeries[cursor])
                          : '—'}
                    </span>
                  </div>
                ) : null}
              </div>
            )
          }
        />
      </div>

      <div className={`tab-panel ${tab === 'why' ? 'on' : ''}`}>
      <AnalysisPage
        prefs={prefs}
        onPrefs={persistPrefs}
        onExportCsv={exportTrips}
        highlight={tab === 'why' ? focusAnchor : null}
        cross={cross}
        diagnoses={diagnoses}
        onEvidence={goEvidence}
        whyLead={cover.whyLead}
        leadFacts={leadFacts}
        coverage={health.label}
        nLine={cover.nLine}
        chapters={whyChapters}
      >
        <div className="filter-row">
            <span className="filter-k">看哪些交易</span>
            <div className="sorts">
              {(['all', 'long', 'short'] as const).map((side) => (
                <button type="button" key={side} className={sideFilter === side ? 'on' : ''} onClick={() => setSideFilter(side)}>
                  {side === 'all' ? '全部' : side === 'long' ? '多头' : '空头'}
                </button>
              ))}
            </div>
            <label className="filter-select">
              股票
              <select
                value={symbolFilter[0] || ''}
                onChange={(e) => setSymbolFilter(e.target.value ? [e.target.value] : [])}
              >
                <option value="">全部股票</option>
                {symbols.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {filtered ? (
            <p className="tiny">胜率和期望已按上面选中的交易重算。TWR 仍用整本账。</p>
          ) : null}
          {whyHl ? (
            <button type="button" className="link" onClick={() => setWhyHl(null)}>
              清除高亮{whyHl.symbol ? ` · ${whyHl.symbol}` : ''}
            </button>
          ) : null}

          <Ch meta={whyCh('why-structure')}>
            <WhyFinding
              d={structDx(diagnoses)}
              extra={{
                scope: `n=${scoped.length}`,
                realized: leadFacts.net,
                metric: leadFacts.maxWinShare == null ? '—' : `最大标的占毛利 ${pctPlain(leadFacts.maxWinShare, 0)}`,
                limit: cover.nLine,
              }}
            />
            <AttrWaterfallBlock trips={scoped} hl={whyHl} onPick={pickWhy} />
            <CumPathBlock trips={scoped} equity={book.equity} hl={whyHl} onPickTrip={pickWhyTrip} />
            <ConcentrationTreemap trips={scoped} hl={whyHl} onPick={(t) => pickWhy({ tripId: t.id, symbol: t.symbol })} />
          </Ch>

<Ch meta={whyCh('why-giveback')}>
            <WhyFinding
              d={givebackDx(diagnoses)}
              extra={{
                scope: pathCoverLine(book.space.giveback) ?? `${leadFacts.floatedToLoss}/${scoped.length} 笔曾浮盈转亏`,
                mfeCap: book.space.giveback.nPath > 0 ? book.space.giveback.sumDollar : null,
                metric: '日线估算回吐，不是可达收益',
                limit: `可计算路径 n=${p.pathComputable}；同日排除 ${p.pathSameDayExcluded}；缺行情 ${p.pathMissingExcluded}`,
              }}
            />
            <ExitEfficiencyBlock trips={scoped} hl={whyHl} onPick={pickWhyTrip} />
            <p className="tiny">MAE×MFE：看路径形状。象限是观察，不升级成主因。有效 n={scatter.length}</p>
            {scatter.length ? (
              <Scatter
                height={220}
                points={scatter.map((t) => ({
                  id: t.id,
                  x: t.maePct || 0,
                  y: t.mfePct || 0,
                  up: t.realizedPnl >= 0,
                  dim: dimOf(whyHl, t.symbol, t.id),
                  label: `${t.symbol} · ${money(t.realizedPnl)} · MAE ${t.maePct != null ? pctPlain(t.maePct, 1) : 'N/A'} · MFE ${t.mfePct != null ? pctPlain(t.mfePct, 1) : 'N/A'}`,
                }))}
                onPick={(id) => pickWhyTrip(id)}
              />
            ) : (
              <p className="tiny">没有可画的日线 MAE/MFE。</p>
            )}
            <MaeQuadStrip trips={scoped} />
            <article className="panel" id="mae">
              <h3>日线估算退出质量</h3>
              <div className="metric-strip">
                <span>
                  捕获 <b>{p.capture.value == null ? '—' : pctPlain(p.capture.value, 0)}</b>
                </span>
                <span>
                  恢复 <b>{p.recovery.value == null ? '—' : pctPlain(p.recovery.value, 0)}</b>
                </span>
                <span>
                  可计算 <b>{p.pathComputable}</b>
                </span>
                <span>
                  同日排除 <b>{p.pathSameDayExcluded}</b>
                </span>
                <span>
                  缺行情 <b>{p.pathMissingExcluded}</b>
                </span>
              </div>
              <details className="fold-block">
                <summary>退出质量明细</summary>
              <p className="muted">只用日线 OHLC 粗估，不知道盘中先后，也看不到同日路径。盈利样本很少时数字会显得过精，不当执行评价。</p>
              <div className="kv-grid">
                {p.capture.value != null ? (
                  <>
                    <span>盈利路径分解</span>
                    <b>
                      <CaptureBar capture={p.capture.value} n={p.capture.n} />
                    </b>
                  </>
                ) : (
                  <MetricLine k="盈利捕获率" m={p.capture} kind="pct" />
                )}
                <MetricLine k="亏损恢复率" m={p.recovery} kind="pct" />
                <span>可计算 / 同日排除 / 缺行情</span>
                <b>
                  {p.pathComputable} / {p.pathSameDayExcluded} / {p.pathMissingExcluded}
                </b>
                <span>同日 MAE / MFE</span>
                <b>
                  <VChip label="不适用" tone="na" />
                </b>
                <span>滑点</span>
                <b>
                  <VChip
                    label="无法计算"
                    tone="fail"
                    onClick={() => {
                      const row = p.coverage.find((c) => c.item === '滑点')
                      if (row) pickCoverage(row)
                    }}
                  />
                </b>
                <span>路径异常</span>
                <b>{p.captureAnomalies} 笔退出超过日线估算 MFE</b>
              </div>
              </details>
            </article>
            <article className="panel wide why-r-compact" id="atr-r">
              <h3>
                ATR 标准化盈亏 <span className="n-chip">仅 {Math.max(0, scoped.length - p.atrR.flagged)} 笔有效，不参与主要归因</span>
              </h3>
              {p.atrR.n === 0 ? (
                <p className="tiny">
                  没有足够日线，ATR-R 记为缺失，不用 2% 代替。可计算 {p.pathComputable} · 同日排除 {p.pathSameDayExcluded} · 缺行情{' '}
                  {p.pathMissingExcluded}
                </p>
              ) : (
                <>
                  <p className="muted">
                    R 单位 = 开仓前 ATR × 数量。净 R 含费用。没有足够日线记为缺失，不用 2% 代替。平均 R 在口径异常时不作为主要数字。
                  </p>
                  <div className="kv-grid">
                    <span>有效 / 口径异常</span>
                    <b>
                      {Math.max(0, scoped.length - p.atrR.flagged)} / {p.atrR.flagged}
                    </b>
                    <span>
                      <a href="#why-quality">数据质量</a>
                    </span>
                    <b>修复口径需补初始风险或止损，本轮无法自动修复</b>
                  </div>
                  <RDistribution trips={scoped} />
                </>
              )}
            </article>
        <TradeBenchPanel
          rows={tradeBench.rows}
          n={tradeBench.n}
          beat={tradeBench.beat}
          medianExcess={tradeBench.medianExcess}
          meanExcess={tradeBench.meanExcess}
          onOpenTrip={openTrip}
        />
          </Ch>

<Ch meta={whyCh('why-symbols')}>
            <PnLBySymbol trips={scoped} hl={whyHl} onPick={(symbol) => pickWhy({ symbol })} />
          </Ch>

<Ch meta={whyCh('why-sides')}>
          <WhyFinding d={sideDx(diagnoses)} extra={worstGroupExtra(book.checkup.sides)} />
          <p className="tiny">点须：多空期望稳不稳。</p>
          <GroupViz
            id="sides"
            title="多头 / 空头"
            rows={book.checkup.sides}
            onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
          />
        </Ch>

<Ch meta={whyCh('why-weekdays')}>
          <WhyFinding d={weekdayDx(diagnoses)} extra={worstGroupExtra(book.checkup.weekdays)} />
          <p className="tiny">点须：星期期望稳不稳。小样本不当日历规律。</p>
          <GroupViz
            id="weekdays"
            title="星期"
            rows={book.checkup.weekdays}
            onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
          />
        </Ch>

<Ch meta={whyCh('why-freq')}>
            <WhyFinding
              d={holdDx(diagnoses)}
              extra={{
                ...worstGroupExtra(book.checkup.holdBuckets),
                limit: '细档持仓图仅观察，不改诊断分组。机械反事实只是样本内加减，不代表该规则未来有效',
              }}
            />
            <p className="tiny">点须：分组期望稳不稳。明细表在各组下面。</p>
            <HoldUiStrip trips={scoped} onPick={pickWhyTrip} />
        <section id="freq" className="freq-block">
          <RegimeMixBar checkup={book.checkup} />
          <article className="panel" style={{ marginTop: 24 }}>
            <h3>各频率累计盈亏</h3>
            <MultiLine
              height={220}
              baseline={0}
              tickFormat={moneyK}
              dates={book.analytics.regimeCum.dates}
              series={book.analytics.regimeCum.series.map((s) => ({
                values: s.values,
                color: REGIME_COLORS[s.regime],
                width: 1.9,
              }))}
            />
            <div className="scatter-legend">
              {book.analytics.regimeCum.series.map((s) => (
                <span key={s.regime}>
                  <i style={{ color: REGIME_COLORS[s.regime] }}>●</i> {s.label}
                </span>
              ))}
            </div>
          </article>

          <div className="grid-2" style={{ marginTop: 24 }}>
            <GroupViz
              id="regimes"
              title="按频率(regime)"
              rows={book.checkup.regimes}
              onPick={(row) => openInsight({ kind: 'group', row, trips: book.episodes.filter((t) => t.regime === row.id) })}
            />
            <article className="panel">
              <h3>收益率 × 持仓时长</h3>
              <ColorScatter
                height={240}
                logX
                xFormat={(v) => (v < 1 ? `${Math.round(v * 24)}h` : `${Math.round(v)}d`)}
                yFormat={(v) => pct(v)}
                onPick={(id) => openTrip(book.episodes.find((t) => t.id === id)!)}
                points={book.episodes
                  .filter((t) => t.status === 'closed' && t.holdMinutes > 0 && t.openPrice * t.qty > 0)
                  .map((t) => ({
                    id: t.id,
                    x: t.holdMinutes / 1440,
                    y: t.realizedPnl / (t.openPrice * t.qty),
                    color: REGIME_COLORS[t.regime],
                    label: `${t.symbol} · ${pct(t.realizedPnl / (t.openPrice * t.qty))} · ${holdLabel(t.holdMinutes)}`,
                  }))}
              />
            </article>
          </div>
        </section>
        <GroupViz
          id="hold"
          title="持仓时间"
          rows={book.checkup.holdBuckets}
          onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
        />
        </Ch>

<Ch meta={whyCh('why-behavior')}>
        <div>
          <p className="muted" style={{ marginBottom: 12 }}>
                        行为观察按持仓片段。n&lt;5 只列交易；5–9 探索性；10–29 弱结论；≥30 才谈规律。点一条打开该组。
          </p>
          {!book.checkup.sessionRelevant ? (
            <p className="muted" style={{ marginBottom: 12 }}>
              入场时段面板已隐藏:日内+短线仅 {book.checkup.sessionCohortN} 笔,样本太小,时段胜率是噪声。判错了?
              <button
                type="button"
                className="ghost sm"
                style={{ marginLeft: 8 }}
                onClick={() => setShowAllLenses((v) => !v)}
              >
                {showAllLenses ? '收起' : '仍要展开全部镜头'}
              </button>
            </p>
          ) : null}
          <div className="grid-2">
            {book.checkup.sessionRelevant || showAllLenses ? (
              <GroupViz
                id="sessions"
                title={`开盘 / 盘中 / 尾盘 · 仅 ${book.checkup.sessionCohortN} 笔日内+短线`}
                rows={book.checkup.sessions}
                onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
              />
            ) : null}
            <article className="panel">
              <h3>处置效应与加仓</h3>
              <p className="tiny">{book.checkup.disposition.fact}</p>
              <SignedBars
                items={[
                  {
                    id: 'disp',
                    label: '盈亏持仓比',
                    value: book.checkup.disposition.ratio,
                    n: book.checkup.disposition.n,
                  },
                ]}
                format={(v) => `${v.toFixed(2)}×`}
              />
              <p className="tiny">{book.checkup.tilt.fact}</p>
              {book.checkup.tilt.nAfterLoss > 0 ? (
                <CoverageMeter
                  label="亏后再开仓"
                  value={book.checkup.tilt.nTilt}
                  of={book.checkup.tilt.nAfterLoss}
                  note={book.checkup.tilt.sizeMultiple != null ? `${book.checkup.tilt.sizeMultiple.toFixed(2)}×` : undefined}
                />
              ) : (
                <p className="tiny">没有「亏损后再开仓」样本。</p>
              )}
            </article>
            <article className="panel">
              <h3>追高覆盖</h3>
              <p className="tiny">{book.checkup.chase.fact}</p>
              {book.checkup.chase.total > 0 ? (
                <CoverageMeter label="20 日窗口" value={book.checkup.chase.covered} of={book.checkup.chase.total} />
              ) : (
                <p className="tiny">没有可评估的开仓。</p>
              )}
              <div className="kv-grid">
                <span>分位均值</span>
                <b>{book.checkup.chase.mean != null ? book.checkup.chase.mean.toFixed(0) : 'N/A'}</b>
                <span>分位≥80 盈亏</span>
                <b className={book.checkup.chase.highN >= 10 ? clsPnl(book.checkup.chase.highPnl) : ''}>
                  {money(book.checkup.chase.highPnl)}
                </b>
              </div>
            </article>
          </div>
        </div>
        </Ch>

<Ch meta={whyCh('why-luck')}>
          <WhyLuck
            line={cover.luckLine}
            losePct={
              book.analytics.monteCarlo
                ? Math.round(
                    (book.analytics.monteCarlo.terminals.filter((v) => v <= 0).length /
                      book.analytics.monteCarlo.terminals.length) *
                      100,
                  )
                : null
            }
            cleared={cover.cleared}
          />
          <WhyFinding d={trendDx(diagnoses)} />
          <article className="panel wide" id="mc">
            <h3>蒙特卡洛：有放回抽样看运气</h3>
            {book.analytics.monteCarlo ? (
              (() => {
                const mc = book.analytics.monteCarlo!
                const pctile = Math.round(mc.terminalPctile * 100)
                const lose = Math.round((mc.terminals.filter((v) => v <= 0).length / mc.terminals.length) * 100)
                const ddPct = Math.round(mc.maxDDPctile * 100)
                const verdict =
                  pctile >= 70
                    ? `偏走运 —— 有放回抽样里，约 ${pctile}% 的终值不如你这次。这次抽到的交易组合偏好运，别全记在方法上。`
                    : pctile <= 30
                      ? `偏背运 —— 约 ${100 - pctile}% 的抽样终值比你这次好。方法未必这么糟。`
                      : `运气大致中性 —— 你的终值排在抽样结果中间（约第 ${pctile} 名 / 100）。`
                return (
                  <>
                    <p className="verdict">
                      {verdict}{' '}
                      <span
                        className="path-info"
                        title={`从历史开仓日有放回抽取，凑满 ${mc.nTrades} 笔，重复 ${mc.rounds} 次。同一笔大赢可能被抽到多次。若只打乱顺序，总盈亏不变。回撤是交易序列回撤，不是账户净值回撤。`}
                      >
                        ⓘ
                      </span>
                    </p>
                    <h4 className="tiny" style={{ margin: '8px 0 4px' }}>抽样终值</h4>
                    <Histogram
                      values={mc.terminals}
                      bins={29}
                      format={moneyK}
                      markerValue={mc.realizedTerminal}
                      markerLabel="你在这里"
                    />
                    <h4 className="tiny" style={{ margin: '16px 0 4px' }}>交易序列最大回撤（路径风险）</h4>
                    <Histogram
                      values={mc.maxDDs.map((v) => -v)}
                      bins={21}
                      format={moneyK}
                      markerValue={-mc.realizedMaxDD}
                      markerLabel="你的序列回撤"
                    />
                    <p className="tiny">{mc.note}</p>
                    <details className="fold-block">
                      <summary>方法说明</summary>
                      <p className="tiny">
                        从历史开仓日里有放回抽取，凑满 {mc.nTrades} 笔，重复 {mc.rounds} 次。同一笔大赢可能被抽到多次，所以最终盈亏会变。
                        若只打乱这 {mc.nTrades} 笔的顺序，总盈亏不变，只会改回撤路径。这里的回撤是交易序列回撤（累计已实现的高峰回落），不是账户净值回撤。
                      </p>
                      <ul className="tiny plain-facts">
                        <li>
                          <b>{lose}%</b> 的抽样最终是亏钱的。这不能单独证明策略长期负期望。
                        </li>
                        <li>
                          你实际的交易序列最大回撤 <b>{moneyAbs(mc.realizedMaxDD)}</b>,比约 {ddPct}% 的抽样更深
                          {ddPct >= 60 ? '（算偏难受的一档）' : ''}。
                        </li>
                        {mc.ddProb.slice(1).map((d, i) => (
                          <li key={i}>
                            还有约 <b>{Math.round(d.prob * 100)}%</b> 的可能,序列回撤会比 {moneyAbs(d.dd)} 更深。
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                )
              })()
            ) : (
              <p className="tiny">闭环不足 30 笔或开仓日过少,不跑蒙特卡洛。</p>
            )}
          </article>

          {/* 「单笔盈亏分布」图与「是什么」页 #pnl-swarm 重复,已删;其判词+游程结论已并入该处。 */}
          <article className="panel" id="sensitivity">
            <h3>敏感性:结果稳不稳</h3>
            <p className="muted">{book.sensitivity.note}</p>
            {(() => {
              const sv = book.sensitivity
              const conc = sv.top1Share
              const dropWin = sv.expectancyDropMaxWin
              const concVerdict =
                conc != null && conc >= 0.5
                  ? `当前样本的正向结果高度依赖少数交易：毛利的 ${pctPlain(conc, 0)} 来自最大一笔。去掉它，历史单笔均值就从 ${money(sv.meanPnl ?? 0)} 掉到 ${dropWin == null ? '—' : money(dropWin)}。尚不足以证明存在稳定 edge。`
                  : conc != null
                    ? `盈利没有过度集中:最大一笔占毛利 ${pctPlain(conc, 0)},拿掉后单笔均值 ${dropWin == null ? '—' : money(dropWin)}。`
                    : '没有毛利样本,不评估集中度。'
              const c0 = sv.cost.find((c) => c.bps === 0)?.expectancy
              const cHi = [...sv.cost].reverse().find((c) => c.expectancy != null)
              const costText =
                c0 != null && cHi && cHi.expectancy != null
                  ? `把成本从 0 加到 ${cHi.bps}bp,单笔均值 ${money(c0)} → ${money(cHi.expectancy)},几乎不动 —— 结果对成本不敏感。`
                  : null
              const h1 = sv.firstHalfExpectancy
              const h2 = sv.secondHalfExpectancy
              return (
                <>
                  <p className="verdict">{concVerdict}</p>
                  {/* 集中度可视化(帕累托曲线)已上提到「结构」区的集中度卡内,此处不再重复画,
                      只保留本区独有的结论文字:集中度判词 + 前后半程 + 成本敏感。 */}
                  {h1 != null && h2 != null ? (
                    <p className="tiny">
                      分两半看:前半 {money(h1)} → 后半 {money(h2)}({h2 > h1 ? '在变好' : h2 < h1 ? '在变差' : '基本持平'})。
                    </p>
                  ) : null}
                  {costText ? <p className="tiny">{costText}</p> : null}
                </>
              )
            })()}
            <details className="fold-block">
              <summary>更多细节</summary>
            <div className="kv-grid">
              <span>去掉最大盈利单后的历史单笔均值</span>
              <b>{book.sensitivity.expectancyDropMaxWin == null ? '—' : money(book.sensitivity.expectancyDropMaxWin)}</b>
              <span>去掉最大单日后的历史单笔均值</span>
              <b>{book.sensitivity.expectancyDropMaxDay == null ? '—' : money(book.sensitivity.expectancyDropMaxDay)}</b>
              <span>最大盈利单占总毛利</span>
              <b>{book.sensitivity.maxWinShareGrossProfit == null ? '—' : pctPlain(book.sensitivity.maxWinShareGrossProfit, 0)}</b>
              <span>最大亏损单占总毛亏</span>
              <b>{book.sensitivity.maxLossShareGrossLoss == null ? '—' : pctPlain(book.sensitivity.maxLossShareGrossLoss, 0)}</b>
              <span>最大单笔绝对盈亏占总绝对盈亏</span>
              <b>{book.sensitivity.maxAbsShareTotalAbs == null ? '—' : pctPlain(book.sensitivity.maxAbsShareTotalAbs, 0)}</b>
              <span>前 1 / 3 / 5 笔盈利占总毛利</span>
              <b>
                {[book.sensitivity.top1Share, book.sensitivity.top3Share, book.sensitivity.top5Share]
                  .map((v) => (v == null ? '—' : pctPlain(v, 0)))
                  .join(' / ')}
              </b>
              <span>均值 / 中位 / 截尾均值</span>
              <b>
                {[book.sensitivity.meanPnl, book.sensitivity.medianPnl, book.sensitivity.trimmedMean]
                  .map((v) => (v == null ? '—' : money(v)))
                  .join(' / ')}
              </b>
              <span>前半 / 后半历史单笔均值</span>
              <b>
                {book.sensitivity.firstHalfExpectancy == null ? '—' : money(book.sensitivity.firstHalfExpectancy)}
                {' / '}
                {book.sensitivity.secondHalfExpectancy == null ? '—' : money(book.sensitivity.secondHalfExpectancy)}
              </b>
              <span>FIFO vs 持仓片段</span>
              <b>
                {book.sensitivity.fifoVsEpisode.fifoN} / {book.sensitivity.fifoVsEpisode.episodeN} 笔 · 历史单笔均值{' '}
                {book.sensitivity.fifoVsEpisode.fifoExp == null ? '—' : money(book.sensitivity.fifoVsEpisode.fifoExp)}
                {' vs '}
                {book.sensitivity.fifoVsEpisode.episodeExp == null ? '—' : money(book.sensitivity.fifoVsEpisode.episodeExp)}
              </b>
            </div>
            <table className="grid trips">
              <thead>
                <tr>
                  <th>额外成本</th>
                  <th>历史单笔均值</th>
                  <th>PF</th>
                </tr>
              </thead>
              <tbody>
                {book.sensitivity.cost.map((row) => (
                  <tr key={row.bps}>
                    <td>{row.bps} bps</td>
                    <td>{row.expectancy == null ? '—' : money(row.expectancy)}</td>
                    <td>{row.pf == null ? 'N/A' : finiteNum(row.pf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </details>
          </article>
          </Ch>

<Ch meta={whyCh('why-cross')}>
            <CrossPanel cross={cross} />
          </Ch>

<Ch meta={whyCh('why-quality')}>
            <article className="panel" id="quality">
              <h3>交易质量</h3>
              <QualityRead
                trips={scoped}
                winRate={winRate}
                expectancy={expectancy}
                profitFactor={profitFactor}
                payoff={p.payoff}
                filtered={filtered}
                onWinRate={() => openInsight({ kind: 'winRate' })}
                onExpectancy={() => openInsight({ kind: 'expectancy' })}
              />
              <p className="why-limit">{cover.nLine}</p>
            </article>
        <details className="fold-block ledger-fold" id="sec-ledger">
          <summary>核算 · 对账与覆盖（与「是什么 · 可信吗」同源）</summary>
        <article className="panel" id="equity">
          <p className="tiny">资金路径与回撤在「是什么」。这里只留月度、日历和对账。</p>
          {book.equity.length > 2 && (accountOk || sleeveOk) ? (
            <div className="grid-2" style={{ marginTop: 16 }}>
              <div>
                <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>{accountOk ? '月度 TWR' : '月度盯市变动'}</h3>
                <p className="tiny">{accountOk ? '当月财富指数相对上月末。已剥离出入金。' : '子账本月末盯市相对上月末的差额，不是账户月收益。'}</p>
                <MonthBars
                  items={accountOk ? monthlyIndexRets(book.equity) : monthlyDeltas(book.equity)}
                  format={accountOk ? (v) => pct(v) : moneyK}
                />
              </div>
              <div>
                <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>{accountOk ? '日收益分布' : '日变动分布'}</h3>
                <p className="tiny">{accountOk ? '账户日收益。缺失日不补 0。' : '相邻交易日盯市差额。缺行情日不补 0。'}</p>
                <Histogram
                  values={accountOk ? dailyIndexRets(book.equity) : dailyDeltas(book.equity)}
                  bins={21}
                  format={accountOk ? (v) => pct(v) : moneyK}
                />
              </div>
            </div>
          ) : null}

          {book.equity.length > 8 && (accountOk || sleeveOk) ? (
            <details className="fold-block" style={{ marginTop: 16 }}>
              <summary>每日盈亏日历</summary>
              <p className="muted">每格一个交易日,越绿当天赚得越多、越红亏得越多。一眼看整段哪几周在赚、哪几周在漏。</p>
              <CalendarHeatmap
                days={book.equity.slice(1).map((e, i) => ({ date: e.date, value: e.equity - book.equity[i].equity }))}
                format={money}
              />
            </details>
          ) : null}

          <div className="grid-2" style={{ marginTop: 8 }}>
          <details className="fold-block">
            <summary>对账明细</summary>
            <p className="muted">
              {accountOk
                ? '日收益把当日现金流当作开盘已入账（权重 1）。XIRR 不根据成交猜测现金流。'
                : sleeveOk
                  ? '没有期初净资产时，不猜账户规模。下面是美股正股成交还原的盯市盈亏：现金从 0 记，买入减现金、卖出加现金，持仓按最近成交价或日线收盘计价。费用只计入已匹配到的订单，缺的不估成 0。'
                  : naReason}
            </p>
            <div className="kv-grid">
              <span>期初净资产</span>
              <b>
                {p.initialCapital == null ? (
                  <VChip
                    label="未提供"
                    tone="watch"
                    onClick={() => {
                      const row = p.coverage.find((c) => c.item === '期初净资产')
                      if (row) pickCoverage(row)
                    }}
                  />
                ) : (
                  moneyAbs(p.initialCapital)
                )}
              </b>
              <span>{accountOk ? '期末净值' : '子账本重建余额'}</span>
              <b>
                {p.finalEquity == null ? (
                  <VChip label="无法计算" tone="fail" />
                ) : (
                  <>
                    {moneyAbs(p.finalEquity)}
                    {!accountOk ? <VChip label="重建值" tone="watch" /> : null}
                  </>
                )}
              </b>
              <span>净入金</span>
              <b>
                {p.cashflowsProvided ? (
                  moneyAbs(p.deposits)
                ) : (
                  <VChip
                    label="未提供"
                    tone="watch"
                    onClick={() => {
                      const row = p.coverage.find((c) => c.item === '外部入出金')
                      if (row) pickCoverage(row)
                    }}
                  />
                )}
              </b>
              <span>出金</span>
              <b>
                {p.cashflowsProvided ? (
                  moneyAbs(p.withdrawals)
                ) : (
                  <VChip
                    label="未提供"
                    tone="watch"
                    onClick={() => {
                      const row = p.coverage.find((c) => c.item === '外部入出金')
                      if (row) pickCoverage(row)
                    }}
                  />
                )}
              </b>
              <span>{accountOk ? 'TWR' : '累计盯市盈亏'}</span>
              <b>
                {accountOk ? (
                  <button type="button" className="link" onClick={() => openInsight({ kind: 'twr' })}>
                    {p.twr == null ? '无法计算' : signedPct(p.twr)}
                  </button>
                ) : (
                  signedMoney(p.netPnl)
                )}
              </b>
              <span>TWR 年化</span>
              <b>{signedPct(p.twrAnnualized)}</b>
              <span>
                <Hint term="XIRR（年化）" def="资金加权内部收益率，通常以年化形式表达。" />
              </span>
              <b>
                <button type="button" className="link" onClick={() => openInsight({ kind: 'xirr' })}>
                  {p.xirr == null ? '无法计算' : signedPct(p.xirr)}
                </button>
                {p.xirrStatus && p.xirrStatus !== 'ok' ? <div className="tiny">{p.xirrStatus}</div> : null}
              </b>
              <span>已实现 FIFO</span>
              <b className={clsPnl(p.realizedPnl)}>{money(p.realizedPnl)}</b>
              <span>未实现</span>
              <b>{signedMoney(p.unrealizedPnl)}</b>
              <span>已知费用</span>
              <b>
                {p.coverage.find((c) => c.item === '佣金')?.status === 'imported' ? (
                  `${moneyAbs(p.feeDrag, 2)} · 已确认`
                ) : (
                  <VChip
                    label="未提供"
                    tone="watch"
                    onClick={() => {
                      const row = p.coverage.find((c) => c.item === '佣金')
                      if (row) pickCoverage(row)
                    }}
                  />
                )}
              </b>
              <span>勾稽差额</span>
              <b>
                {p.unrealizedPnl == null ? (
                  <VChip label="无法计算" tone="fail" />
                ) : (
                  money(p.reconDifference, 2)
                )}
              </b>
            </div>
            {p.xirrReason ? <p className="tiny">{p.xirrReason}</p> : null}
            {accountOk ? (
              <details className="explain">
                <summary>为什么 TWR 和 XIRR 差很多？</summary>
                <p>
                  TWR 衡量账户资产自己的复合增长，出入金被剥离。XIRR 是年化的资金加权回报，会被中途出金改变。这个样本若 TWR 明显高于
                  XIRR，通常是因为期间有大额出金，而不是两个公式算错了。
                </p>
              </details>
            ) : sleeveOk ? (
              <p className="tiny">这不是账户收益率。要算 TWR / 相对基准，需要你填这段分析起点的账户净资产，而且文件最好只含该账户全部资产。</p>
            ) : null}
            <p className="tiny">
              已实现 FIFO 为费用后净额；佣金和 SEC/TAF 已计入往返，不对账再扣一次。费用金额只作覆盖披露。
            </p>
            {p.unrealizedPnl != null ? (
              <p className="tiny">
                勾稽：已实现 {money(p.realizedPnl)} + 未实现 {signedMoney(p.unrealizedPnl)} + 勾稽差额 {money(p.reconDifference, 2)} = 盯市盈亏 {signedMoney(p.netPnl)}。差额主要来自分红再投资与未匹配费用等未提供项。
              </p>
            ) : null}
            <p className="tiny">
              期初来源：{p.hasNav ? '用户填写' : '未提供，无法从成交额可靠推断'}
              {p.equitySubsetOnly ? ' · 以下仅覆盖美股正股子账本' : ''}
              {book.dripKept ? ` · 保留 ${book.dripKept} 笔分红再投资` : ''}
            </p>
            {book.excludedRows.length ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  const rows = ['time,symbol,name,reason,qty']
                  for (const row of book.excludedRows) {
                    rows.push(`${row.time},${row.symbol},${JSON.stringify(row.name)},${row.reason},${row.qty}`)
                  }
                  download('excluded_rows.csv', `${rows.join('\n')}\n`)
                }}
              >
                下载排除明细（{book.excludedRows.length}）
              </button>
            ) : null}
          </details>

          <details className="fold-block">
            <summary>数据覆盖</summary>
            <p className="muted">缺失不是零。0 只用于明确确认金额为零。点击状态查看原因。</p>
            <table className="grid trips">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>状态</th>
                  <th>当前处理</th>
                </tr>
              </thead>
              <tbody>
                {p.coverage.map((row) => (
                  <tr key={row.item} onClick={() => pickCoverage(row)} role="button" tabIndex={0}>
                    <td>
                      {row.item}
                      <div className="tiny">{row.note}</div>
                    </td>
                    <td>
                      <VChip label={coverageLabel(row.status, row.countedInPnl)} tone={coverageTone(row)} />
                    </td>
                    <td>{coverageHandling(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          </div>
        </article>

        </details>
          </Ch>

<Ch meta={whyCh('why-trips')}>
          <LayerFold
            id="fold-trips"
            title="逐笔明细"
            summary={`${closed.length} 笔往返 · 成交/往返可切换`}
            anchors={['trips', 'why-trips']}
          >
          <div className="table-hd" id="trips">
            <div className="sorts">
              {(['time', 'pnl', 'r', 'hold'] as const).map((k) => (
                <button type="button" key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                  {k === 'time' ? '时间' : k === 'pnl' ? '盈亏' : k === 'r' ? 'ATR标准化' : '持仓'}
                </button>
              ))}
            </div>
            <button type="button" className="link" onClick={() => setShowFills((v) => !v)}>
              {showFills ? '看往返' : '查看成交'}
            </button>
            <button type="button" className="link" onClick={exportTrips}>
              导出 CSV
            </button>
          </div>
          {showFills ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>代码</th>
                  <th>方向</th>
                  <th>数量</th>
                  <th>价格</th>
                  <th>费用</th>
                </tr>
              </thead>
              <tbody>
                {[...book.fills]
                  .sort((a, b) => b.time.getTime() - a.time.getTime())
                  .map((f) => (
                    <tr key={f.id}>
                      <td>{f.time.toLocaleString('zh-CN', { hour12: false })}</td>
                      <td>
                        {f.symbol}
                        {f.kind === 'drip' ? <div className="muted">分红再投资</div> : null}
                      </td>
                      <td>{f.side === 'buy' ? '买' : '卖'}</td>
                      <td>{f.qty}</td>
                      <td>{f.price.toFixed(2)}</td>
                      <td>{f.fees.toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <>
            <table className="grid trips">
              <thead>
                <tr>
                  <th>持仓片段</th>
                  <th>方向</th>
                  <th>数量</th>
                  <th>开 / 平</th>
                  <th>净盈亏</th>
                  <th>ATR标准化盈亏</th>
                  <th>日线估算 MAE / MFE</th>
                  <th>标记</th>
                </tr>
              </thead>
              <tbody>
                {closed.slice(0, showAllTrips ? undefined : 5).map((t) => (
                  <tr
                    key={t.id}
                    id={`trip-${t.id}`}
                    className={`${selected?.id === t.id || focusTrip === t.id || whyHl?.tripId === t.id ? 'on' : ''} ${dimOf(whyHl, t.symbol, t.id) ? 'is-dim' : ''}`}
                    onClick={() => {
                      pickWhy({ tripId: t.id, symbol: t.symbol })
                      openTrip(t)
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td>
                      <b>{t.symbol}</b>
                      <div className="muted">{t.name}</div>
                    </td>
                    <td>{t.side === 'long' ? '多' : '空'}</td>
                    <td>{t.qty}</td>
                    <td>
                      {t.openPrice.toFixed(2)} → {t.closePrice?.toFixed(2)}
                    </td>
                    <td className={clsPnl(t.realizedPnl)}>{money(t.realizedPnl)}</td>
                    <td>
                      {t.rMultiple != null ? `${signed(t.rMultiple)}R` : '—'}
                      {(t.rFlags ?? []).length ? <div className="tiny muted">R 口径异常</div> : null}
                      <div className="muted">
                        {holdLabel(t.holdMinutes)} {sessionLabel(t)}
                        {t.annualizedReturn != null && t.holdMinutes >= 10 * 1440
                          ? ` · 年化 ${t.annualizedReturn > 10 ? '>1000%' : pct(t.annualizedReturn)}`
                          : ''}
                      </div>
                    </td>
                    <td>
                      {t.maePct == null || t.mfePct == null ? (
                        <div className="muted">{t.sameDay ? '不适用 · 同日不计算' : '未提供 · 缺行情'}</div>
                      ) : (
                        <>
                          <MaeBar mae={t.maePct} mfe={t.mfePct} />
                          <div className="muted">
                            {pct(t.maePct)} · {pct(t.mfePct)} · 估算值
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      {t.tags
                        .filter((tag) => tag !== 'episode')
                        .map((tag) => {
                          const chip = suspectedTagLabel(t, tag)
                          return (
                            <em key={tag} className={`tag ${chip.kind}`} title={chip.title}>
                              {chip.text}
                            </em>
                          )
                        })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {closed.length > 5 ? (
              <button type="button" className="link" onClick={() => setShowAllTrips((v) => !v)}>
                {showAllTrips ? '收起' : `展开全部 ${closed.length} 笔`}
              </button>
            ) : null}
            </>
          )}
          </LayerFold>
          </Ch>
      </AnalysisPage>
      </div>

      <div className={`tab-panel ${tab === 'how' ? 'on' : ''}`}>
        <HowPage space={space} book={book} health={health} onGoWhy={() => go('why', 'hold')} />
      </div>

      {selected ? <PathDrawer trip={selected} bars={book.bars[selected.symbol]} onClose={closeTrip} /> : null}
      {!selected && insight ? (
        <InsightDrawer
          book={book}
          insight={insight}
          onClose={() => setInsight(null)}
          onOpenTrip={openTrip}
          onGo={(nextTab) => {
            go(nextTab)
            setInsight(null)
          }}
        />
      ) : null}
      {!selected && showHealth ? (
        <HealthDrawer
          book={book}
          health={health}
          onClose={() => setShowHealth(false)}
          onAccount={() => {
            setShowHealth(false)
            openAccountSupplement()
          }}
        />
      ) : null}
      {!selected && showAccountDrawer ? (
        <AccountDrawer
          initialCapital={p.initialCapital}
          busy={props.updating}
          onClose={() => setShowAccountDrawer(false)}
          onSubmit={(args) => {
            setShowAccountDrawer(false)
            props.onUpdateAccount?.(args)
          }}
        />
      ) : null}
    </div>
  )
}
