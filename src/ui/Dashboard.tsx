import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Brand, ThemeToggle } from './chrome.tsx'
import { AreaDrawdown, CaptureBar, MaeBar, MultiLine, Scatter, Stat } from './charts.tsx'
import { InsightDrawer, coverageLabel, type Insight } from './InsightDrawer.tsx'
import { PathDrawer } from './PathDrawer.tsx'
import { TABS, tabFromView, viewOf, type Tab } from './views.ts'
import { ciText, clsPnl, finiteNum, holdLabel, money, moneyAbs, moneyK, pct, pctPlain, signed } from '../lib/format.ts'
import { etDateKey, etParts } from '../lib/time.ts'
import type { Book, CoverageRow, EquityPoint, GroupRow, MetricPoint, RoundTrip } from '../types.ts'

type SortKey = 'time' | 'pnl' | 'r' | 'hold'
type SideFilter = 'all' | 'long' | 'short'

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
  if (s.status === 'raw') return '仅观察'
  if (s.status === 'observe') return '观察事实'
  return '可描述'
}

function GroupTable(props: { rows: GroupRow[]; onPick: (row: GroupRow) => void }) {
  const ranked = props.rows.filter((s) => s.n >= 5)
  const low = props.rows.filter((s) => s.n > 0 && s.n < 5)
  const empty = props.rows.filter((s) => s.n === 0)
  const render = (s: GroupRow, lowN: boolean) => (
    <tr
      key={s.id}
      className={`${lowN ? 'low-n' : ''} clickable-row`}
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
      <td className={!lowN && s.n >= 10 && s.expectancy != null ? clsPnl(s.expectancy) : ''}>
        {s.expectancy == null ? '—' : money(s.expectancy)}
      </td>
      <td>{s.pf == null ? 'N/A' : finiteNum(s.pf)}</td>
      <td>{statusLabel(s)}</td>
    </tr>
  )
  return (
    <div>
      <table className="grid trips">
        <thead>
          <tr>
            <th>分组</th>
            <th>n</th>
            <th>胜率</th>
            <th>中位 ATR-R</th>
            <th>期望</th>
            <th>PF</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>{ranked.map((s) => render(s, false))}</tbody>
      </table>
      {low.length ? (
        <details className="fold-block">
          <summary>低样本分组（n&lt;5，不参与排序与自动总结）</summary>
          <table className="grid trips">
            <tbody>{low.map((s) => render(s, true))}</tbody>
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

function dayRet(eq: EquityPoint[], i: number): number | null {
  if (i <= 0) return null
  const prev = eq[i - 1].index
  return prev ? eq[i].index / prev - 1 : null
}

type TradeBenchRow = {
  trip: RoundTrip
  stockRet: number
  spxRet: number | null
  excess: number | null
}

function tradeBenchComparison(episodes: RoundTrip[], equity: EquityPoint[]) {
  const benchMap = new Map<string, number>()
  for (const e of equity) if (e.benchIndex > 0) benchMap.set(e.date, e.benchIndex)
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

function BenchUnavailablePanel(props: { missing: string[]; onSupplement: () => void }) {
  const rows = [
    { item: '分析起点净资产', status: props.missing.includes('capital') ? '未提供' : '已提供' },
    { item: '外部入出金记录', status: props.missing.includes('cashflow') ? '完整性未确认' : '已确认' },
    { item: '账户资产覆盖范围', status: props.missing.includes('subset') ? '需要确认' : '仅美股正股' },
  ]
  return (
    <div className="banner cannot-prove bench-banner">
      <strong>暂时无法进行账户级基准比较</strong>
      <p className="tiny">
        要回答「有没有跑赢 SPY」，需要账户净资产和完整入出金。当前缺期初净资产与完整现金流，只有正股子账本的盯市盈亏可看，不与 SPY 对拍。
      </p>
      <table className="grid bench-missing">
        <thead>
          <tr>
            <th>所需数据</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item}>
              <td>{r.item}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny">补充后可以计算：账户 TWR、XIRR、组合与 SPY 财富曲线、超额收益、Alpha 与 Beta。</p>
      <button type="button" className="btn-primary sm" onClick={props.onSupplement}>
        补充账户数据，启用基准比较
      </button>
    </div>
  )
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
  return (
    <article className="panel wide">
      <h3>交易级基准比较</h3>
      <p className="muted">
        每笔闭环交易的持有期收益率 − SPY 同期收益率。这是交易级持有期比较，不是账户收益率，也不代表账户财富跑赢或跑输 SPY。
      </p>
      <div className="kv-grid">
        <span>跑赢 SPY</span>
        <b>
          {props.beat} / {props.n} 笔
        </b>
        <span>中位超额收益</span>
        <b>{props.medianExcess == null ? '—' : <span className={clsPnl(props.medianExcess)}>{pct(props.medianExcess)}</span>}</b>
        <span>平均超额收益</span>
        <b>{props.meanExcess == null ? '—' : <span className={clsPnl(props.meanExcess)}>{pct(props.meanExcess)}</span>}</b>
      </div>
      {sorted.length ? (
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
            {sorted.slice(0, 15).map((r) => (
              <tr key={r.trip.id} onClick={() => props.onOpenTrip(r.trip)} role="button" tabIndex={0}>
                <td>
                  <b>{r.trip.symbol}</b>
                  <div className="muted">{r.trip.name}</div>
                </td>
                <td>{r.trip.side === 'long' ? '多' : '空'}</td>
                <td className={clsPnl(r.stockRet)}>{pct(r.stockRet)}</td>
                <td>{r.spxRet == null ? '—' : <span className={clsPnl(r.spxRet)}>{pct(r.spxRet)}</span>}</td>
                <td>{r.excess == null ? '—' : <span className={clsPnl(r.excess)}>{pct(r.excess)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="tiny">没有可对拍的闭环交易（缺少基准行情或平仓价格）。</p>
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

function EdgePanel(props: {
  winRate: MetricPoint
  payoff: MetricPoint
  profitFactor: MetricPoint
  expectancy: MetricPoint
}) {
  const wr = props.winRate.value
  const payoff = props.payoff.value
  const pf = props.profitFactor.value
  const exp = props.expectancy.value
  if (wr == null || payoff == null || !(payoff > 0)) return null
  const be = 1 / (1 + payoff)
  const hasEdge = wr >= be
  const pfText = pf != null && Number.isFinite(pf) ? pf.toFixed(2) : '—'
  const expText = exp != null ? money(exp) : '—'
  return (
    <article className="panel">
      <h3>交易优势诊断</h3>
      <p style={{ margin: '2px 0 8px', fontWeight: 600, color: hasEdge ? 'var(--up)' : 'var(--down)' }}>
        {hasEdge ? '胜率高于盈亏平衡线，样本显示正向优势' : '当前样本尚未显示稳定的正向优势'}
      </p>
      <p className="tiny" style={{ marginBottom: 10 }}>
        实际胜率 {pctPlain(wr, 0)}，盈亏平衡胜率 {pctPlain(be, 1)}；Profit Factor {pfText}，单笔期望 {expText}。
      </p>
      <div style={{ position: 'relative', height: 18, background: 'var(--line2)', borderRadius: 9, marginBottom: 6 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: 18,
            width: `${Math.min(wr * 100, 100)}%`,
            background: 'var(--gold)',
            borderRadius: 9,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(be * 100, 100)}%`,
            top: -4,
            width: 2,
            height: 26,
            background: 'var(--down)',
          }}
          title={`盈亏平衡 ${pctPlain(be, 1)}`}
        />
      </div>
      <div className="tiny" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>实际胜率 {pctPlain(wr, 0)}</span>
        <span>盈亏平衡线 {pctPlain(be, 1)}</span>
      </div>
    </article>
  )
}

function PnLBySymbol(props: { trips: RoundTrip[] }) {
  const bySym = new Map<string, number>()
  for (const t of props.trips) bySym.set(t.symbol, (bySym.get(t.symbol) || 0) + t.realizedPnl)
  const rows = [...bySym.entries()].map(([symbol, pnl]) => ({ symbol, pnl })).sort((a, b) => b.pnl - a.pnl)
  if (!rows.length) return null
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1)
  const wins = rows.filter((r) => r.pnl > 0)
  const losses = rows.filter((r) => r.pnl < 0).reverse()
  const bar = (r: { symbol: string; pnl: number }) => (
    <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
      <span style={{ width: 52, textAlign: 'right', fontSize: 12 }}>{r.symbol}</span>
      <div style={{ flex: 1, position: 'relative', height: 10, background: 'var(--line2)', borderRadius: 5 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: 10,
            width: `${(Math.abs(r.pnl) / maxAbs) * 100}%`,
            background: r.pnl >= 0 ? 'var(--up)' : 'var(--down)',
            borderRadius: 5,
          }}
        />
      </div>
      <span style={{ width: 88, textAlign: 'right', fontSize: 12 }} className={clsPnl(r.pnl)}>
        {money(r.pnl)}
      </span>
    </div>
  )
  return (
    <div>
      {wins.map(bar)}
      {wins.length && losses.length ? <div style={{ height: 1, background: 'var(--line2)', margin: '6px 0' }} /> : null}
      {losses.map(bar)}
    </div>
  )
}

function RDistribution(props: { trips: RoundTrip[] }) {
  const rs = props.trips.map((t) => t.rMultiple).filter((r): r is number => r != null && Number.isFinite(r))
  if (!rs.length) return null
  const buckets = [
    { label: '≤ -5R', lo: -Infinity, hi: -5 },
    { label: '-5R~-2R', lo: -5, hi: -2 },
    { label: '-2R~0R', lo: -2, hi: 0 },
    { label: '0R~2R', lo: 0, hi: 2 },
    { label: '≥ 2R', lo: 2, hi: Infinity },
  ]
  const counts = buckets.map((b) => rs.filter((r) => r >= b.lo && r < b.hi).length)
  const maxCount = Math.max(...counts, 1)
  const mean = rs.reduce((s, r) => s + r, 0) / rs.length
  const sorted = [...rs].sort((a, b) => a - b)
  const median = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return (
    <div style={{ marginTop: 10 }}>
      {buckets.map((b, i) => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 68, textAlign: 'right', fontSize: 12 }}>{b.label}</span>
          <div style={{ flex: 1, position: 'relative', height: 12, background: 'var(--line2)', borderRadius: 4 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: 12, width: `${(counts[i] / maxCount) * 100}%`, background: 'var(--gold)', borderRadius: 4 }} />
          </div>
          <span style={{ width: 24, textAlign: 'right', fontSize: 12 }}>{counts[i]}</span>
        </div>
      ))}
      <p className="tiny" style={{ marginTop: 6 }}>
        中位数 {median.toFixed(2)}R · 平均 {mean.toFixed(2)}R · n={rs.length}。典型交易接近盈亏平衡，少数极端亏损拖累整体。
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

function writeView(tab: Tab) {
  const next = new URL(window.location.href)
  next.searchParams.set('view', viewOf(tab))
  history.replaceState(null, '', next)
}

export function Dashboard(props: {
  book: Book
  stage?: string | null
  updating?: boolean
  onReset: () => void
  onSample: () => void
  onUpdateAccount?: (args: { initialCapital: number | null; cashText: string; cashflowComplete: boolean }) => void
}) {
  const { book } = props
  const p = book.performance
  const [tab, setTab] = useState<Tab>(() => currentView())
  const [sort, setSort] = useState<SortKey>('time')
  const [showAccountDrawer, setShowAccountDrawer] = useState(false)
  const [selected, setSelected] = useState<RoundTrip | null>(null)
  const [insight, setInsight] = useState<Insight | null>(null)
  const [groupReturn, setGroupReturn] = useState<Insight | null>(null)
  const [showFills, setShowFills] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sideFilter, setSideFilter] = useState<SideFilter>('all')
  const [symbolFilter, setSymbolFilter] = useState<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [range, setRange] = useState<{ lo: number; hi: number } | null>(null)
  const [showAllTrips, setShowAllTrips] = useState(false)

  useEffect(() => {
    writeView(tab)
  }, [tab])

  const go = (next: Tab) => {
    setTab(next)
    writeView(next)
  }

  const closedAll = useMemo(
    () => book.episodes.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP')),
    [book.episodes],
  )
  const symbols = useMemo(() => [...new Set(closedAll.map((t) => t.symbol))].sort(), [closedAll])
  const rangeDates = range && book.equity[range.lo] && book.equity[range.hi]
    ? { start: book.equity[range.lo].date, end: book.equity[range.hi].date }
    : null
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

  const scatter = closed.filter((t) => t.maePct != null && t.mfePct != null)
  const small = p.closedCount < 30 || p.uniqueOpenDays < 15
  const accountOk = p.pathKind === 'account'
  const sleeveOk = p.pathKind === 'sleeve' && book.equity.length > 0
  const naReason = p.accountReturnReason || '缺少账户收益率所需数据'
  const fail = p.pathAudit && !p.pathAudit.ok
  const hover = cursor != null ? book.equity[cursor] : null
  const troughIdx = useMemo(() => {
    if (!book.equity.length || p.ddTrough == null) return null
    const i = book.equity.findIndex((e) => e.date === p.ddTrough)
    return i >= 0 ? i : null
  }, [book.equity, p.ddTrough])
  const cfMarks = useMemo(
    () => book.equity.map((e, i) => (e.cashflow ? i : -1)).filter((i) => i >= 0),
    [book.equity],
  )
  const tradeBench = useMemo(() => tradeBenchComparison(book.episodes, book.equity), [book.episodes, book.equity])
  const benchMissing = useMemo(() => {
    const m: string[] = []
    if (p.initialCapital == null) m.push('capital')
    if (!p.cashflowComplete) m.push('cashflow')
    if (p.equitySubsetOnly) m.push('subset')
    return m
  }, [p.initialCapital, p.cashflowComplete, p.equitySubsetOnly])
  const sleeveMarkers = useMemo(() => {
    if (!sleeveOk || !book.equity.length) return []
    const peakIdx = book.equity.reduce((best, e, i) => (e.equity > book.equity[best].equity ? i : best), 0)
    const troughIdx = book.equity.reduce((best, e, i) => (e.equity < book.equity[best].equity ? i : best), 0)
    const out: Array<{ i: number; value: number; text: string; tone?: 'up' | 'down' }> = []
    if (book.equity[peakIdx].equity > 0) {
      out.push({ i: peakIdx, value: book.equity[peakIdx].equity, text: `峰值 ${moneyK(book.equity[peakIdx].equity)}`, tone: 'up' })
    }
    if (book.equity[troughIdx].equity < 0) {
      out.push({ i: troughIdx, value: book.equity[troughIdx].equity, text: `谷底 ${moneyK(book.equity[troughIdx].equity)}`, tone: 'down' })
    }
    return out
  }, [sleeveOk, book.equity])
  const drawerOpen = Boolean(selected || insight || showAccountDrawer)

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

  const accountStats = (
    <>
      <Stat
        k={<span className="hint">XIRR（年化）</span>}
        v={p.xirr == null ? '待补数据' : signedPct(p.xirr)}
        tone={p.xirr == null ? 'na' : undefined}
        sub={p.xirr == null ? '缺少期初净资产或完整入出金 · 立即补充 →' : p.xirrReason || '整本账 · 含入出金'}
        tip={
          p.xirr == null
            ? '补填期初净资产与完整入出金后才能计算 XIRR。缺失不等于零，也不猜。'
            : '按你实际投进去、拿出来的钱算的年化回报。没有完整入出金时不猜。'
        }
        onClick={() => (p.xirr == null ? openAccountSupplement() : openInsight({ kind: 'xirr' }))}
      />
      <Stat
        k={<span className="hint">相对基准财富</span>}
        v={p.relativeSpx == null ? '待补数据' : signedPct(p.relativeSpx)}
        tone={p.relativeSpx == null ? 'na' : undefined}
        sub={
          p.relativeSpx == null
            ? '要对拍基准需要账户收益率 · 立即补充 →'
            : accountOk
              ? p.benchKind === 'spy-total-return'
                ? '账户级 · SPY 全收益'
                : '账户级 · SPX 价格指数，不含股息'
              : '账户级'
        }
        tip="把你的账户财富和基准从同一天滚到现在，看谁涨得多。优先用 SPY 复权全收益；没有 SPY 时改用 SPX 价格指数，不含股息。不是两个收益率直接相减。"
        onClick={() => (p.relativeSpx == null ? openAccountSupplement() : openInsight({ kind: 'spx' }))}
      />
    </>
  )

  return (
    <div className={`dash ${drawerOpen ? 'with-drawer' : ''} ${props.updating ? 'is-updating' : ''}`}>
      {props.updating ? <div className="recalc-veil">正在更新 · {props.stage}</div> : null}

      {book.isSample ? (
        <div className="sample-bar">
          <strong>示例数据</strong>
          <span>
            {book.accountName} · {p.sampleStart} 至 {p.sampleEnd} · {p.closedCount} 笔复盘单元 · {p.uniqueOpenDays} 个开仓日
            · 真实成交，未填期初净资产
          </span>
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
            {book.isSample ? '示例账本' : book.accountName}｜{p.sampleStart} 至 {p.sampleEnd}｜美股正股｜{p.closedCount}{' '}
            笔闭环 · {p.uniqueOpenDays} 个开仓日
            {props.stage ? <em className="compute-ok">{props.stage}</em> : null}
          </p>
        </div>
        <div className="hd-right">
          <ThemeToggle />
          <span className="pill">US Equities · Common stock</span>
          {!book.isSample ? (
            <button type="button" className="ghost sm" onClick={props.onReset}>
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

      {book.warnings.length ? (
        <details className="warn">
          <summary>范围与口径说明（{book.warnings.length}）</summary>
          <ul>
            {book.warnings.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {filtered ? (
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

      <section className="kpis">
        <Stat
          k={<span className="hint">{accountOk ? 'TWR' : '累计盯市盈亏'}</span>}
          v={accountOk ? signedPct(p.twr) : signedMoney(p.netPnl)}
          sub={accountOk ? '整本账 · 已剥离出入金' : '正股成交还原 · 费用按已匹配部分计入'}
          tip={
            accountOk
              ? '这是账户自己涨了多少，中途存进去、取出来的钱已经拿掉了。所以你再筛选某几笔交易，这个数字也不会变。它不是你口袋里实际拿到的回报。'
              : '没有期初净资产时，不猜账户规模。这条是美股正股成交还原出来的现金加市值，起点为 0，也就是这段正股交易的盯市盈亏。缺的费用不估成 0，也不挡住计算。'
          }
          onClick={() => openInsight({ kind: 'twr' })}
        />
        {accountOk ? accountStats : null}
        <Stat
          k={<span className="hint">最大回撤</span>}
          v={
            sleeveOk
              ? p.maxDrawdownUsd
                ? <span className="down">−{moneyAbs(p.maxDrawdownUsd)}</span>
                : 'N/A'
              : p.maxDrawdown == null
                ? 'N/A'
                : <span className="down">{pct(p.maxDrawdown)}</span>
          }
          sub={
            sleeveOk
              ? p.maxDrawdown == null
                ? '正股盯市 · 美元回撤'
                : `美元回撤 · ${p.currentlyUnderwater ? '仍在水下' : `水下 ${p.underwaterDays} 日`}`
              : p.maxDrawdown == null
                ? naReason
                : `${moneyAbs(p.maxDrawdownUsd)}${p.currentlyUnderwater ? ' · 仍在水下' : ` · 水下 ${p.underwaterDays} 日`}`
          }
          tip={
            accountOk
              ? '账户从最高点掉到最低点，最多跌了多少。中途存取已经被拿掉，所以大额取钱不会单独把这条线砸下去。'
              : '正股盯市盈亏从最高点掉到最低点。这不是完整账户回撤，也不需要你先填期初净资产。'
          }
          onClick={() => go('risk')}
        />
        <Stat
          k={<span className="hint">胜率</span>}
          v={winRate.value != null ? pctPlain(winRate.value, 0) : 'N/A'}
          sub={
            filtered
              ? `按所选交易 · n=${winRate.n}`
              : `n=${winRate.n} · ${p.uniqueOpenDays} 个开仓日${winRate.ci ? ` · 95% ${ciText(winRate.ci, 'pct', 0)}` : ''}`
          }
          tip="赚了钱的交易占几成。Wilson 区间按单笔独立近似；旁边还会给出按开仓日聚类的 bootstrap 区间。胜率高不等于整体赚钱。"
          onClick={() => openInsight({ kind: 'winRate' })}
        />
        <Stat
          k={<span className="hint">单笔期望</span>}
          v={expectancy.value != null ? money(expectancy.value) : 'N/A'}
          sub={
            filtered
              ? '按所选交易重算'
              : expectancy.ci
                ? `95% 区间：${ciText(expectancy.ci, 'money', 0).replace('–', ' 至 ')}${expectancy.ci.lo < 0 && (expectancy.ci.hi == null || expectancy.ci.hi > 0) ? ' · 区间跨过 0，尚不明确正向期望' : ''}`
                : '—'
          }
          tip="平均每笔交易赚或亏多少钱。旁边的区间如果从亏到赚都有，说明现在还看不准到底有没有稳定优势。"
          onClick={() => openInsight({ kind: 'expectancy' })}
        />
        {!accountOk ? accountStats : null}
      </section>

      <nav className="tabs sticky-tabs">
        {TABS.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? 'on' : ''} onClick={() => go(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'ledger' ? (
        <div className="grid-2">
          <article className="panel">
            <h3>这本账赚没赚</h3>
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
          </article>
          <article className="panel">
            <h3>数据覆盖</h3>
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
          </article>
        </div>
      ) : null}

      {tab === 'quality' ? (
        <div>
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
          <EdgePanel winRate={winRate} payoff={p.payoff} profitFactor={profitFactor} expectancy={expectancy} />
          <article className="panel">
            <h3>盈亏贡献</h3>
            <p className="muted">按股票聚合已实现盈亏，盈利在上、亏损在下。判断盈利是否集中在少数交易。</p>
            <PnLBySymbol trips={scoped} />
          </article>
          <div className="grid-2">
            <article className="panel">
              <h3>交易质量观察</h3>
              <p className="muted">质量与行为按持仓片段（episode）计算；核算仍用 FIFO。每个数字都带 n 和区间。</p>
              <div className="kv-grid">
                <MetricLine k="胜率" m={winRate} kind="pct" digits={0} plain filtered={filtered} onClick={() => openInsight({ kind: 'winRate' })} />
                {p.winRateBoot && !filtered ? (
                  <MetricLine k="胜率 bootstrap" m={p.winRateBoot} kind="pct" digits={0} plain />
                ) : null}
                <MetricLine k="单笔期望" m={expectancy} kind="money" filtered={filtered} onClick={() => openInsight({ kind: 'expectancy' })} />
                <MetricLine k={<Hint term="Profit Factor" def="毛利除以毛亏。没有亏损时记为 +∞，bootstrap 里这些轮次保留，不删除。" />} m={profitFactor} kind="num" filtered={filtered} />
                <MetricLine k="盈亏比" m={p.payoff} kind="num" />
              </div>
              {p.pfInfShare > 0 ? <p className="tiny">Bootstrap 中 {pctPlain(p.pfInfShare, 1)} 的轮次 PF 为 +∞。</p> : null}
            </article>
            <article className="panel">
              <h3>日线估算退出质量</h3>
              <p className="muted">盈利捕获与亏损恢复分开。金额加权，不平均单笔比率。同日往返为不适用。</p>
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
            </article>
            <article className="panel">
              <h3>ATR 标准化盈亏</h3>
              <p className="muted">用开仓前 ATR×数量当风险单位。没有足够日线时记为缺失，不用 2% 代替。</p>
              <div className="kv-grid">
                <span>有效 n</span>
                <b>{p.atrR.n}</b>
                <span>平均</span>
                <b>{p.atrR.mean != null ? p.atrR.mean.toFixed(2) : '—'}</b>
                <span>中位</span>
                <b>{p.atrR.median != null ? p.atrR.median.toFixed(2) : '—'}</b>
                <span>左尾 5% / 10%</span>
                <b>
                  {p.atrR.p05 != null ? p.atrR.p05.toFixed(2) : '—'} / {p.atrR.p10 != null ? p.atrR.p10.toFixed(2) : '—'}
                </b>
              </div>
              <RDistribution trips={scoped} />
            </article>
            <article className="panel">
              <h3>高级指标</h3>
              <p className="muted">样本不足时禁用，不输出可执行仓位建议。</p>
              <button type="button" className="ghost sm" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '收起 SQN' : '了解限制'}
              </button>
              {showAdvanced ? (
                <div className="kv-grid" style={{ marginTop: 12 }}>
                  <span>SQN</span>
                  <b>
                    {small ? (
                      <button type="button" className="link" onClick={() => openInsight({ kind: 'sqn' })}>
                        暂不可用
                      </button>
                    ) : p.sqn != null ? (
                      p.sqn.toFixed(2)
                    ) : (
                      '—'
                    )}
                  </b>
                </div>
              ) : null}
              {small ? (
                <p className="tiny">
                  SQN 暂不可用。当前 {p.closedCount} 笔、{p.uniqueOpenDays} 个开仓日，保护条件为至少 30 笔且开仓日足够。达到条件后仍需结合区间判断。
                </p>
              ) : null}
            </article>
          </div>
          <article className="panel" style={{ marginTop: 12 }}>
            <h3>日线估算 MAE × MFE</h3>
            <p className="muted">只画可计算的跨日往返。点一下打开路径。横轴不利、纵轴有利。</p>
            <Scatter
              points={scatter.map((t) => ({
                id: t.id,
                x: t.maePct || 0,
                y: t.mfePct || 0,
                up: t.realizedPnl >= 0,
                label: `${t.symbol} · ${money(t.realizedPnl)} · MAE ${t.maePct != null ? pctPlain(t.maePct, 1) : 'N/A'} · MFE ${t.mfePct != null ? pctPlain(t.mfePct, 1) : 'N/A'}`,
              }))}
              onPick={(id) => openTrip(closed.find((t) => t.id === id) || closedAll.find((t) => t.id === id)!)}
            />
          </article>
          <div className="table-hd">
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
                {closed.slice(0, showAllTrips ? undefined : 15).map((t) => (
                  <tr
                    key={t.id}
                    className={selected?.id === t.id ? 'on' : ''}
                    onClick={() => openTrip(t)}
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
                      <div className="muted">
                        {holdLabel(t.holdMinutes)} {sessionLabel(t)}
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
                        .map((tag) => (
                        <em key={tag} className="tag">
                          {tag}
                        </em>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {closed.length > 15 ? (
              <button type="button" className="link" onClick={() => setShowAllTrips((v) => !v)}>
                {showAllTrips ? '收起' : `展开全部 ${closed.length} 笔`}
              </button>
            ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === 'bench' ? (
        <div className="bench">
          {!accountOk ? <BenchUnavailablePanel missing={benchMissing} onSupplement={openAccountSupplement} /> : null}
          <div className="grid-2">
            <article className="panel wide">
              <h3>
                {accountOk ? '三条财富曲线' : '正股交易子账本盈亏走势'}
                {!accountOk && sleeveOk ? (
                  <span className="pill" style={{ marginLeft: 8 }}>
                    子账本口径 · 包含估算值
                  </span>
                ) : null}
              </h3>
              <p className="muted">
                {accountOk
                  ? '三条线都是财富指数，起点=1.00，已剥离出入金。现金为虚线，基准为灰实线。优先 SPY 复权全收益；没有 SPY 时用 SPX 价格指数（不含股息）。'
                  : sleeveOk
                    ? '展示已导入正股交易产生的累计盯市盈亏，不代表完整账户收益。缺少历史价格的日期使用最近可用价格估算。'
                    : naReason}
              </p>
              {fail ? (
                <p className="tiny">路径校验未通过，本图禁用，避免把错误财富曲线当成账户收益。</p>
              ) : accountOk && book.equity.length ? (
                <div className="chart-wrap tall">
                  <MultiLine
                    height={260}
                    baseline={100}
                    cursor={cursor}
                    range={range}
                    marks={cfMarks}
                    dates={book.equity.map((e) => e.date)}
                    onCursor={setCursor}
                    onRange={setRange}
                    series={[
                      { values: book.equity.map((e) => e.cashIndex), color: 'var(--t3)', width: 1.2, dash: '5 4' },
                      { values: book.equity.map((e) => e.benchIndex), color: 'var(--t2)', width: 1.4 },
                      { values: book.equity.map((e) => e.index), color: 'var(--gold)', fill: 'var(--gold-fill)', width: 2 },
                    ]}
                  />
                  {hover ? (
                    <div className="chart-tip">
                      <b>{hover.date}</b>
                      <span>账户财富 {(hover.index / 100).toFixed(3)}</span>
                      <span>基准财富 {(hover.benchIndex / 100).toFixed(3)}</span>
                      <span>相对财富比 {hover.benchIndex ? pct(hover.index / hover.benchIndex - 1) : '—'}</span>
                      <span>当日收益 {dayRet(book.equity, cursor ?? 0) == null ? '—' : pct(dayRet(book.equity, cursor ?? 0)!)}</span>
                      <span>净现金流 {hover.cashflow ? money(hover.cashflow) : '$0'}</span>
                      <span>回撤 {pct(hover.drawdown)}</span>
                      <span>净敞口 {pctPlain(hover.netExposure, 1)}</span>
                    </div>
                  ) : null}
                </div>
              ) : sleeveOk ? (
                <div className="chart-wrap tall">
                  <MultiLine
                    height={260}
                    baseline={0}
                    tickFormat={moneyK}
                    dates={book.equity.map((e) => e.date)}
                    zeroFill
                    endLabel={{ value: book.equity.at(-1)!.equity, text: `当前 ${money(book.equity.at(-1)!.equity)}` }}
                    markers={sleeveMarkers}
                    cursor={cursor}
                    range={range}
                    marks={cfMarks}
                    onCursor={setCursor}
                    onRange={setRange}
                    series={[{ values: book.equity.map((e) => e.equity), color: 'var(--gold)', width: 2 }]}
                  />
                  {hover ? (
                    <div className="chart-tip">
                      <b>{hover.date}</b>
                      <span>盯市盈亏 {money(hover.equity)}</span>
                      <span>现金 {money(hover.cash)}</span>
                      <span>未实现 {money(hover.mtm)}</span>
                      <span>回撤 {pct(hover.drawdown)}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="tiny">还没有可画的正股路径。</p>
              )}
              {range && range.hi !== range.lo ? (
                <p className="tiny">
                  已框选 {book.equity[range.lo]?.date} 至 {book.equity[range.hi]?.date}。交易级指标按开仓日筛选；账户级 TWR / XIRR /
                  回撤不重算。
                  <button type="button" className="link" onClick={() => setRange(null)}>
                    重置范围
                  </button>
                </p>
              ) : (
                <p className="tiny">在图上拖动可框选查看区间。现金流日期有浅色标记。</p>
              )}
            </article>
            <article className="panel">
              <h3>基准结果</h3>
              {accountOk ? (
                <>
                  <p className="muted">
                    {p.benchKind === 'spy-total-return'
                      ? '∏(1+rp)/∏(1+rb)−1，基准为 SPY 复权全收益。'
                      : '∏(1+rp)/∏(1+rb)−1，基准为 SPX 价格指数，不含股息。'}
                  </p>
                  <div className="kv-grid">
                    <span>账户终值</span>
                    <b>{p.finalEquity == null ? 'N/A' : moneyAbs(p.finalEquity)}</b>
                    <span>相对持有现金</span>
                    <b>{signedPct(p.relativeCash)}</b>
                    <span>相对基准财富</span>
                    <b>
                      <button type="button" className="link" onClick={() => openInsight({ kind: 'spx' })}>
                        {signedPct(p.relativeSpx)}
                      </button>
                    </b>
                  </div>
                </>
              ) : (
                <>
                  <p className="tiny">缺少期初净资产和完整现金流，账户终值与相对基准暂不可计算。</p>
                  <button type="button" className="ghost sm" onClick={openAccountSupplement}>
                    补充账户数据
                  </button>
                </>
              )}
            </article>
            <article className="panel">
              <h3>超额收益诊断（Alpha）</h3>
              {!accountOk ? (
                <p className="tiny">补充账户数据后，将估计无法由市场涨跌解释的年化收益，并同时展示 Beta 与拟合可信度。</p>
              ) : !p.alpha || !p.alpha.valid ? (
                <p className="tiny">{p.alpha?.invalidReason || '暂不可用：回归序列未通过一致性校验。'}</p>
              ) : (
                <>
                  <p className="muted">需要账户日收益序列与同期基准；结果是回归估计，不等同于实际累计超额收益。</p>
                  <div className="kv-grid">
                    <span>对齐后的日收益 n</span>
                    <b>
                      {p.alpha.n} · {p.alpha.start} → {p.alpha.end}
                    </b>
                    <span>年化 α 点估计</span>
                    <b>{p.closedCount >= 30 ? pct(p.alpha.annualized) : `${pct(p.alpha.annualized)}（仅点估计）`}</b>
                    <span>标准误 / 95% 区间</span>
                    <b>
                      {pct(p.alpha.se)} · {pct(p.alpha.ciLo)} – {pct(p.alpha.ciHi)}
                    </b>
                    <span>β / 标准误</span>
                    <b>
                      {p.alpha.beta.toFixed(2)} / {p.alpha.betaSe.toFixed(2)}
                    </b>
                    <span>R²</span>
                    <b>{p.alpha.r2.toFixed(2)}</b>
                    <span>无风险利率</span>
                    <b>{p.alpha.rfSource}</b>
                    <span>频率 / 年化 / 标准误</span>
                    <b>
                      {p.alpha.freq} · ×252 · {p.alpha.seMethod}
                    </b>
                    <span>口径</span>
                    <b className="tiny">{p.alpha.basis}</b>
                  </div>
                </>
              )}
            </article>
          </div>
          {!accountOk ? (
            <TradeBenchPanel
              rows={tradeBench.rows}
              n={tradeBench.n}
              beat={tradeBench.beat}
              medianExcess={tradeBench.medianExcess}
              meanExcess={tradeBench.meanExcess}
              onOpenTrip={openTrip}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'risk' ? (
        <div className="grid-2">
          <article className="panel wide">
            <h3>回撤</h3>
            <div className="dd-split">
              {fail ? (
                <p className="tiny">路径异常，回撤图禁用。</p>
              ) : (accountOk || sleeveOk) && book.equity.length ? (
                <div className="chart-wrap">
                  <AreaDrawdown
                    height={180}
                    points={book.equity.map((e) => e.drawdown)}
                    cursor={cursor}
                    range={range}
                    trough={troughIdx}
                    onCursor={setCursor}
                    onPick={(i) => openInsight({ kind: 'day', point: book.equity[i] })}
                  />
                  {hover ? (
                    <div className="chart-tip compact">
                      <b>{hover.date}</b>
                      <span>回撤 {pct(hover.drawdown)}</span>
                      <span>{accountOk ? '账户财富' : '盯市盈亏'} {accountOk ? (hover.index / 100).toFixed(3) : money(hover.equity)}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="tiny">回撤比例暂不可计算。</p>
              )}
              <div className="dd-facts">
                <div className="drawer-k">{accountOk ? '来自同一条账户财富曲线' : '来自正股盯市盈亏曲线'}</div>
                <h4>
                  最大回撤{' '}
                  {p.maxDrawdown == null ? 'N/A' : <span className="down">{pct(p.maxDrawdown)}</span>}
                </h4>
                <dl className="kv">
                  <div>
                    <dt>开始</dt>
                    <dd>{p.ddStart || '—'}</dd>
                  </div>
                  <div>
                    <dt>谷底</dt>
                    <dd>{p.ddTrough || '—'}</dd>
                  </div>
                  <div>
                    <dt>恢复</dt>
                    <dd>{p.ddRecover || (p.currentlyUnderwater ? '尚未恢复' : '—')}</dd>
                  </div>
                  <div>
                    <dt>回撤金额</dt>
                    <dd>{p.maxDrawdown == null ? 'N/A' : moneyAbs(p.maxDrawdownUsd)}</dd>
                  </div>
                  <div>
                    <dt>期间出金</dt>
                    <dd>{moneyAbs(p.withdrawals)}</dd>
                  </div>
                </dl>
                <p className="tiny">
                  {accountOk
                    ? '回撤比例来自 TWR 财富曲线。出入金已被剥离，不会单独制造回撤跳变。'
                    : '回撤来自正股盯市盈亏的最高点。不是完整账户回撤。'}
                </p>
              </div>
            </div>
          </article>
          <article className="panel wide">
            <h3>风险数字</h3>
            <p className="muted">
              {accountOk
                ? `夏普与索提诺都用同一套 rf（${p.rf.approx === 'missing-zero' ? '缺失按 0 近似' : '报价近似'} · ${p.rf.source} · ${p.rf.version}${p.rf.lastDate ? ` · 截止 ${p.rf.lastDate}` : ''}）。索提诺门槛是 rf，不是 0。`
                : sleeveOk
                  ? '没有账户收益率时，不计算夏普/索提诺。回撤按正股盯市盈亏最高点计算。'
                  : naReason}
            </p>
            <div className="kv-grid">
              <span>年化波动</span>
              <b>{p.volAnn == null ? <VChip label="无法计算" tone="fail" /> : pct(p.volAnn)}</b>
              <span>夏普</span>
              <b>{p.sharpe == null ? <VChip label="无法计算" tone="fail" /> : p.sharpe.toFixed(2)}</b>
              <span>索提诺</span>
              <b>
                {p.sortino == null ? <VChip label="无法计算" tone="fail" /> : p.sortino.toFixed(2)}
                {p.sortino != null ? <div className="tiny">门槛 rf</div> : null}
              </b>
              <span>最大回撤</span>
              <b>
                {p.maxDrawdown == null ? (
                  <VChip label="无法计算" tone="fail" />
                ) : (
                  <span className="down">{pct(p.maxDrawdown)}</span>
                )}
              </b>
              <span>回撤金额</span>
              <b>{p.maxDrawdown == null ? <VChip label="无法计算" tone="fail" /> : moneyAbs(p.maxDrawdownUsd)}</b>
              <span>Ulcer</span>
              <b>{p.maxDrawdown == null ? <VChip label="无法计算" tone="fail" /> : p.ulcer.toFixed(3)}</b>
              <span>水下天数</span>
              <b>{p.maxDrawdown == null ? <VChip label="无法计算" tone="fail" /> : p.underwaterDays}</b>
              <span>当前水下</span>
              <b>{p.maxDrawdown == null ? <VChip label="无法计算" tone="fail" /> : p.currentlyUnderwater ? '是' : '否'}</b>
              <span>平均毛敞口</span>
              <b>{sleeveOk || accountOk ? pctPlain(p.grossExposureMean, 0) : <VChip label="无法计算" tone="fail" />}</b>
              <span>平均净敞口</span>
              <b>{sleeveOk || accountOk ? pctPlain(p.netExposureMean, 0) : <VChip label="无法计算" tone="fail" />}</b>
            </div>
          </article>
        </div>
      ) : null}

      {tab === 'behavior' ? (
        <div className="grid-2">
          <article className="panel wide">
            <p className="muted">
              行为观察按持仓片段。点击一行打开该分组。n&lt;10 不写成规律，n&lt;5 收进低样本分组。
            </p>
            <details className="fold-block" open>
              <summary>开盘 / 盘中 / 尾盘</summary>
              <GroupTable
                rows={book.checkup.sessions}
                onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
              />
            </details>
            <details className="fold-block" open>
              <summary>持仓时间</summary>
              <GroupTable
                rows={book.checkup.holdBuckets}
                onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
              />
            </details>
            <details className="fold-block">
              <summary>多头 / 空头</summary>
              <GroupTable
                rows={book.checkup.sides}
                onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
              />
            </details>
            <details className="fold-block">
              <summary>星期</summary>
              <GroupTable
                rows={book.checkup.weekdays}
                onPick={(row) => openInsight({ kind: 'group', row, trips: tripsForGroup(row.id, book.episodes) })}
              />
            </details>
            <details className="fold-block">
              <summary>盈亏持仓时长比</summary>
              <p className="tiny">{book.checkup.disposition.fact}</p>
              <div className="kv-grid">
                <span>盈亏持仓时长比</span>
                <b>{book.checkup.disposition.ratio != null ? book.checkup.disposition.ratio.toFixed(2) : 'N/A'}</b>
                <span>亏损持仓长于盈利中位</span>
                <b className={book.checkup.disposition.n >= 10 ? clsPnl(book.checkup.disposition.amount) : ''}>
                  {money(book.checkup.disposition.amount)}
                </b>
              </div>
            </details>
            <details className="fold-block">
              <summary>亏损后再开仓</summary>
              <p className="tiny">{book.checkup.tilt.fact}</p>
              <div className="kv-grid">
                <span>亏损后再开仓</span>
                <b>
                  {book.checkup.tilt.nTilt}/{book.checkup.tilt.nAfterLoss}
                </b>
                <span>仓位倍数</span>
                <b>{book.checkup.tilt.sizeMultiple != null ? `${book.checkup.tilt.sizeMultiple.toFixed(2)}×` : 'N/A'}</b>
                <span>这些单盈亏</span>
                <b className={book.checkup.tilt.nTilt >= 10 ? clsPnl(book.checkup.tilt.amount) : ''}>
                  {money(book.checkup.tilt.amount)}
                </b>
              </div>
            </details>
            <details className="fold-block">
              <summary>追高覆盖</summary>
              <p className="tiny">{book.checkup.chase.fact}</p>
              <div className="kv-grid">
                <span>有 20 日窗口</span>
                <b>
                  {book.checkup.chase.covered}/{book.checkup.chase.total}
                </b>
                <span>分位均值</span>
                <b>{book.checkup.chase.mean != null ? book.checkup.chase.mean.toFixed(0) : 'N/A'}</b>
                <span>分位≥80 盈亏</span>
                <b className={book.checkup.chase.highN >= 10 ? clsPnl(book.checkup.chase.highPnl) : ''}>
                  {money(book.checkup.chase.highPnl)}
                </b>
              </div>
            </details>
          </article>
        </div>
      ) : null}

      {tab === 'trust' ? (
        <div className="grid-2">
          <article className="panel">
            <h3>审计摘要</h3>
            <div className="kv-grid">
              <span>闭环往返 / 持仓片段</span>
              <b>
                {book.trips.filter((t) => t.status === 'closed' && !t.tags.includes('DRIP')).length} / {book.credibility.closedCount}
              </b>
              <span>独立开仓日</span>
              <b>{book.credibility.uniqueOpenDays}</b>
              <span>日收益观测</span>
              <b>{book.credibility.dayCount}</b>
              <span>样本起止</span>
              <b>
                {book.credibility.start} → {book.credibility.end}
              </b>
              <span>费用覆盖</span>
              <b>{book.credibility.feeCoverage}</b>
              <span>MAE/MFE 可计算</span>
              <b>{pctPlain(book.credibility.maeMfeComputableShare, 0)}</b>
              <span>追高窗口覆盖</span>
              <b>{pctPlain(book.credibility.chaseCoverage, 0)}</b>
              <span>指标口径版本</span>
              <b>{book.credibility.metricVersion}</b>
              <span>Bootstrap seed</span>
              <b>{p.bootstrapSeed}</b>
            </div>
          </article>
          <article className="panel">
            <h3>为什么有些结论不可信</h3>
            <p className="tiny">{book.credibility.bannerText}</p>
            <p className="tiny">{book.credibility.bannerDetail}</p>
            <p className="tiny">{book.credibility.minSampleNote}</p>
            <ul className="tiny">
              {book.credibility.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <div className="kv-grid">
              <span>分析样本区间</span>
              <b className="tiny">{book.credibility.analysisWindow}</b>
              <span>样本外验证</span>
              <b className="tiny">{book.credibility.oosWindow}</b>
              <span>模型训练</span>
              <b className="tiny">{book.credibility.modelTraining}</b>
            </div>
            <p className="tiny">置信区间仍显示在前几层对应指标旁。这里不堆 p 值，也不运行预测模型。</p>
          </article>
          <article className="panel wide">
            <h3>敏感性</h3>
            <p className="muted">{book.sensitivity.note}</p>
            <div className="kv-grid">
              <span>去掉最大一笔后的期望</span>
              <b>{book.sensitivity.expectancyDropMaxTrade == null ? '—' : money(book.sensitivity.expectancyDropMaxTrade)}</b>
              <span>去掉最大单日后的期望</span>
              <b>{book.sensitivity.expectancyDropMaxDay == null ? '—' : money(book.sensitivity.expectancyDropMaxDay)}</b>
              <span>最大一笔 / 最大单日占比</span>
              <b>
                {book.sensitivity.maxTradePnlShare == null ? '—' : pctPlain(book.sensitivity.maxTradePnlShare, 0)}
                {' / '}
                {book.sensitivity.maxDayPnlShare == null ? '—' : pctPlain(Math.abs(book.sensitivity.maxDayPnlShare), 0)}
              </b>
              <span>前 1 / 3 / 5 笔盈利占比</span>
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
              <span>前半 / 后半期望</span>
              <b>
                {book.sensitivity.firstHalfExpectancy == null ? '—' : money(book.sensitivity.firstHalfExpectancy)}
                {' / '}
                {book.sensitivity.secondHalfExpectancy == null ? '—' : money(book.sensitivity.secondHalfExpectancy)}
              </b>
              <span>FIFO vs 持仓片段</span>
              <b>
                {book.sensitivity.fifoVsEpisode.fifoN} / {book.sensitivity.fifoVsEpisode.episodeN} 笔 · 期望{' '}
                {book.sensitivity.fifoVsEpisode.fifoExp == null ? '—' : money(book.sensitivity.fifoVsEpisode.fifoExp)}
                {' vs '}
                {book.sensitivity.fifoVsEpisode.episodeExp == null ? '—' : money(book.sensitivity.fifoVsEpisode.episodeExp)}
              </b>
            </div>
            <table className="grid trips">
              <thead>
                <tr>
                  <th>额外成本</th>
                  <th>期望</th>
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
          </article>
        </div>
      ) : null}

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
