import { ciText, clsPnl, holdLabel, money, moneyAbs, pct, pctPlain } from '../lib/format.ts'
import type { Book, CoverageRow, EquityPoint, GroupRow, RoundTrip } from '../types.ts'
import type { Tab } from './views.ts'

export type Insight =
  | { kind: 'twr' }
  | { kind: 'xirr' }
  | { kind: 'spx' }
  | { kind: 'dd' }
  | { kind: 'winRate' }
  | { kind: 'expectancy' }
  | { kind: 'coverage'; row: CoverageRow }
  | { kind: 'group'; row: GroupRow; trips: RoundTrip[] }
  | { kind: 'sqn' }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'day'; point: EquityPoint }

function sessionLabel(trip: RoundTrip): string {
  if (trip.holdMinutes >= 48 * 60) return '跨日'
  if (trip.session === 'open30') return '开盘'
  if (trip.session === 'close') return '尾盘'
  return '盘中'
}

export function InsightDrawer(props: {
  book: Book
  insight: Insight
  onClose: () => void
  onOpenTrip?: (trip: RoundTrip) => void
  onGo?: (tab: Tab) => void
}) {
  const { book, insight } = props
  const p = book.performance
  return (
    <aside className="drawer wide-drawer">
      <button type="button" className="drawer-close" onClick={props.onClose}>
        关闭
      </button>
      {insight.kind === 'twr' ? (
        <>
          <div className="drawer-k">账户级 · 已剥离现金流</div>
          <h3>TWR {p.twr == null ? 'N/A' : pct(p.twr)}</h3>
          <p className="tiny">{p.accountReturnReason || '时间加权收益率。当日现金流按开盘已入账（权重 1）进入分母。没有净资产时，左侧 KPI 改为正股盯市盈亏。'}</p>
          <dl className="kv">
            <div>
              <dt>计算周期</dt>
              <dd>
                {p.sampleStart} → {p.sampleEnd}
              </dd>
            </div>
            <div>
              <dt>净值观测</dt>
              <dd>{p.dayCount} 日</dd>
            </div>
            <div>
              <dt>期初净资产</dt>
              <dd>{p.initialCapital == null ? '未提供' : moneyAbs(p.initialCapital)}</dd>
            </div>
            <div>
              <dt>现金流</dt>
              <dd>{p.cashflowComplete ? '已确认完整或已导入' : '未确认完整'}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{p.twr == null ? '无法计算' : '有数值'}</dd>
            </div>
          </dl>
          <button type="button" className="link" onClick={() => props.onGo?.('bench')}>
            跳转到资金曲线
          </button>
        </>
      ) : null}

      {insight.kind === 'xirr' ? (
        <>
          <div className="drawer-k">投资者资金加权 · 年化</div>
          <h3>XIRR {p.xirr == null ? 'N/A' : pct(p.xirr)}</h3>
          <p className="tiny">{p.xirrReason || '不规则现金流的内部收益率，通常以年化表达，不能直接和累计 TWR 比大小。'}</p>
          <dl className="kv">
            <div>
              <dt>求解状态</dt>
              <dd>{p.xirrStatus || '—'}</dd>
            </div>
            <div>
              <dt>出金</dt>
              <dd>{moneyAbs(p.withdrawals)}</dd>
            </div>
            <div>
              <dt>入金</dt>
              <dd>{moneyAbs(p.deposits)}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{p.xirr == null ? '无法计算' : '有数值'}</dd>
            </div>
          </dl>
        </>
      ) : null}

      {insight.kind === 'spx' ? (
        <>
          <div className="drawer-k">链式财富比，不是收益相减</div>
          <h3>相对基准财富 {p.relativeSpx == null ? 'N/A' : pct(p.relativeSpx)}</h3>
          <p className="tiny">
            ∏(1+rp)/∏(1+rb)−1。
            {p.benchKind === 'spy-total-return' ? '基准为 SPY 复权全收益。' : '基准为 SPX 价格指数，不含股息。'}
            账户级指标，交易筛选不会改写它。
          </p>
          <button type="button" className="link" onClick={() => props.onGo?.('bench')}>
            查看三条财富曲线
          </button>
        </>
      ) : null}

      {insight.kind === 'dd' ? (
        <>
          <div className="drawer-k">来自同一条账户财富曲线</div>
          <h3>最大回撤 {p.maxDrawdown == null ? 'N/A' : pct(p.maxDrawdown)}</h3>
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
          <p className="tiny">回撤比例来自 TWR 财富曲线。出入金已被剥离，不会单独制造回撤跳变。</p>
          <button type="button" className="link" onClick={() => props.onGo?.('risk')}>
            定位到回撤图
          </button>
        </>
      ) : null}

      {insight.kind === 'winRate' ? (
        <>
          <div className="drawer-k">交易级 · Wilson 95%（按单笔独立近似）</div>
          <h3>胜率 {p.winRate.value == null ? 'N/A' : pctPlain(p.winRate.value, 0)}</h3>
          <dl className="kv">
            <div>
              <dt>有效 n / 开仓日</dt>
              <dd>
                {p.winRate.n} / {p.uniqueOpenDays}
              </dd>
            </div>
            <div>
              <dt>Wilson 95%</dt>
              <dd>{p.winRate.ci ? ciText(p.winRate.ci, 'pct', 0) : '—'}</dd>
            </div>
            <div>
              <dt>开仓日 bootstrap</dt>
              <dd>{p.winRateBoot?.ci ? ciText(p.winRateBoot.ci, 'pct', 0) : '—'}</dd>
            </div>
            <div>
              <dt>口径</dt>
              <dd>持仓片段；Wilson 按单笔独立近似，bootstrap 按开仓日聚类</dd>
            </div>
          </dl>
          <p className="tiny">{p.winRate.basis}</p>
          <table className="grid trips">
            <thead>
              <tr>
                <th>持仓片段</th>
                <th>盈亏</th>
              </tr>
            </thead>
            <tbody>
              {book.episodes
                .filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
                .slice()
                .sort((a, b) => b.realizedPnl - a.realizedPnl)
                .map((t) => (
                  <tr key={t.id} onClick={() => props.onOpenTrip?.(t)} role="button" tabIndex={0}>
                    <td>
                      <b>{t.symbol}</b>
                      <div className="tiny">{t.openTime.toLocaleString('zh-CN', { hour12: false })}</div>
                    </td>
                    <td className={clsPnl(t.realizedPnl)}>{money(t.realizedPnl)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : null}

      {insight.kind === 'expectancy' ? (
        <>
          <div className="drawer-k">交易级 · cluster bootstrap</div>
          <h3>单笔期望 {p.expectancy.value == null ? 'N/A' : money(p.expectancy.value)}</h3>
          <dl className="kv">
            <div>
              <dt>n</dt>
              <dd>{p.expectancy.n}</dd>
            </div>
            <div>
              <dt>95% 区间</dt>
              <dd>{p.expectancy.ci ? ciText(p.expectancy.ci, 'money', 0) : '—'}</dd>
            </div>
          </dl>
          <p className="tiny">{p.expectancy.basis}。区间跨 0 表示当前不能排除没有 edge。</p>
          <table className="grid trips">
            <thead>
              <tr>
                <th>往返</th>
                <th>盈亏</th>
              </tr>
            </thead>
            <tbody>
              {book.episodes
                .filter((t) => t.status === 'closed' && !t.tags.includes('DRIP'))
                .slice()
                .sort((a, b) => b.realizedPnl - a.realizedPnl)
                .map((t) => (
                  <tr key={t.id} onClick={() => props.onOpenTrip?.(t)} role="button" tabIndex={0}>
                    <td>
                      <b>{t.symbol}</b>
                      <div className="tiny">{t.openTime.toLocaleString('zh-CN', { hour12: false })}</div>
                    </td>
                    <td className={clsPnl(t.realizedPnl)}>{money(t.realizedPnl)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : null}

      {insight.kind === 'coverage' ? (
        <>
          <div className="drawer-k">数据状态</div>
          <h3>
            {insight.row.item} · {coverageLabel(insight.row.status, insight.row.countedInPnl)}
          </h3>
          <p>{insight.row.note}</p>
          <dl className="kv">
            <div>
              <dt>为什么没有值 / 当前状态</dt>
              <dd>{coverageWhy(insight.row)}</dd>
            </div>
            <div>
              <dt>影响哪些指标</dt>
              <dd>{coverageImpact(insight.row.item)}</dd>
            </div>
            <div>
              <dt>能否补充</dt>
              <dd>{coverageFix(insight.row.item)}</dd>
            </div>
            <div>
              <dt>补充后</dt>
              <dd>需要重新导入并分析，不会静默改写当前数字</dd>
            </div>
          </dl>
        </>
      ) : null}

      {insight.kind === 'group' ? (
        <>
          <div className="drawer-k">
            {insight.row.n < 5 ? '低样本 · 仅为观察事实，不支持行为结论' : '分组下钻'}
          </div>
          <h3>
            {insight.row.label} · n={insight.row.n}
          </h3>
          <p className="tiny">{insight.row.fact}</p>
          <table className="grid trips">
            <thead>
              <tr>
                <th>往返</th>
                <th>盈亏</th>
                <th>持仓</th>
              </tr>
            </thead>
            <tbody>
              {insight.trips.map((t) => (
                <tr key={t.id} onClick={() => props.onOpenTrip?.(t)} role="button" tabIndex={0}>
                  <td>
                    <b>{t.symbol}</b>
                    <div className="tiny">
                      {t.openTime.toLocaleString('zh-CN', { hour12: false })} · {sessionLabel(t)}
                    </div>
                  </td>
                  <td className={clsPnl(t.realizedPnl)}>{money(t.realizedPnl)}</td>
                  <td>
                    {holdLabel(t.holdMinutes)}
                    <div className="tiny">{t.maePct == null ? 'MAE 不适用或缺失' : '日线估算 MAE/MFE'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {insight.kind === 'sqn' ? (
        <>
          <div className="drawer-k">高级指标保护</div>
          <h3>SQN 暂不可用</h3>
          <p>
            当前 {p.closedCount} 笔、{p.uniqueOpenDays} 个开仓日。保护条件为至少 30 笔且开仓日足够。达到条件后仍需结合区间判断，不会自动变成可交易信号。
          </p>
        </>
      ) : null}

      {insight.kind === 'tab' ? (
        <>
          <div className="drawer-k">这一层需要留意</div>
          <h3>{tabWatchTitle(insight.tab)}</h3>
          <p className="tiny">{tabWatchBody(book, insight.tab)}</p>
        </>
      ) : null}

      {insight.kind === 'day' ? (
        <>
          <div className="drawer-k">同一条账户路径上的一天</div>
          <h3>{insight.point.date}</h3>
          <dl className="kv">
            <div>
              <dt>账户财富</dt>
              <dd>{(insight.point.index / 100).toFixed(3)}</dd>
            </div>
            <div>
              <dt>基准财富</dt>
              <dd>{(insight.point.benchIndex / 100).toFixed(3)}</dd>
            </div>
            <div>
              <dt>相对财富比</dt>
              <dd>
                {insight.point.benchIndex ? pct(insight.point.index / insight.point.benchIndex - 1) : '—'}
              </dd>
            </div>
            <div>
              <dt>净值</dt>
              <dd>{moneyAbs(insight.point.equity)}</dd>
            </div>
            <div>
              <dt>净现金流</dt>
              <dd>{insight.point.cashflow ? money(insight.point.cashflow) : '$0.00'}</dd>
            </div>
            <div>
              <dt>回撤</dt>
              <dd>{pct(insight.point.drawdown)}</dd>
            </div>
            <div>
              <dt>净敞口</dt>
              <dd>{pctPlain(insight.point.netExposure, 1)}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </aside>
  )
}

export function coverageLabel(status: string, counted?: boolean): string {
  if (status === 'imported' && counted === false) return '已导入 · 未计入净收益'
  if (status === 'imported') return '已导入'
  if (status === 'not_provided') return '未提供'
  return '无法计算'
}

function coverageWhy(row: CoverageRow): string {
  if (row.status === 'imported') return row.note
  if (row.status === 'not_provided') return '导入文件没有这一项。缺失不等于零。'
  return row.note
}

function coverageImpact(item: string): string {
  if (item === '滑点') return '不影响 FIFO 盈亏，但执行质量无法估计'
  if (item.includes('佣金') || item.includes('SEC')) return '已实现盈亏可能偏高；对账不再重复扣除'
  if (item === '分红' || item === '借券费') return '已实现与 TWR 可能不完整'
  if (item === '期初净资产') return '账户收益率、回撤比例、相对基准均不可计算'
  if (item === '外部入出金') return 'XIRR 显示 N/A；TWR 仍可在有净值时计算'
  return '见覆盖说明'
}

function coverageFix(item: string): string {
  if (item === '滑点') return '不能从日线 OHLC 伪造；需要订单提交价或决策基准价'
  if (item === '期初净资产') return '在账户设置中填写，无法从成交额推断'
  if (item === '外部入出金') return '上传出入金 CSV，或确认期间没有外部入出金'
  if (item.includes('佣金')) return '补充订单历史中的 Filled 费用'
  return '按导入说明补充对应文件'
}

function tabWatchTitle(tab: Tab): string {
  if (tab === 'ledger') return '核算'
  if (tab === 'bench') return '基准比较'
  return '这一层'
}

function tabWatchBody(book: Book, tab: Tab): string {
  if (tab === 'ledger') {
    const miss = book.performance.coverage.filter((c) => c.status === 'not_provided').map((c) => c.item)
    return miss.length ? `${miss.join('、')}未提供。` : '覆盖项已导入或已标记。'
  }
  if (tab === 'bench') {
    if (book.performance.rf.warning) return book.performance.rf.warning
    return book.performance.alpha?.valid ? '行情与无风险利率已对齐。' : 'Alpha 未通过一致性校验或账户收益不可计算。'
  }
  if (tab === 'quality') return `n=${book.performance.closedCount}，小样本保护仍然有效。`
  if (tab === 'risk') return book.performance.hasNav ? '回撤来自账户财富曲线。' : '未提供期初净资产，回撤比例不可计算。'
  return book.credibility.bannerText
}
