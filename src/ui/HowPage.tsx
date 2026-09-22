import { useRef } from 'react'
import { money, pctPlain } from '../lib/format.ts'
import type { Book, SpaceReport, StopLevel, SurvivalReport } from '../types.ts'
import type { HealthReport } from '../engine/health.ts'
import { evaluateActions, type ActionEval } from '../engine/counterfactual.ts'
import { RuleHeat } from './howCharts.tsx'
import { BootstrapForest, DecisionMap, DifferenceBar } from './howModels.tsx'
import { PageToc, type TocItem } from './tocNav.tsx'

function stopLevels(space: SpaceReport): StopLevel[] {
  return space.stopScan?.presets ?? []
}

function lossPareto(book: Book) {
  const losses = book.episodes
    .filter((t) => t.status === 'closed' && !t.tags.includes('DRIP') && t.realizedPnl < 0)
    .sort((a, b) => a.realizedPnl - b.realizedPnl)
  const total = losses.reduce((s, t) => s + t.realizedPnl, 0)
  const seen = new Map<string, number>()
  let acc = 0
  const rows = losses.slice(0, 10).map((t) => {
    const c = (seen.get(t.symbol) ?? 0) + 1
    seen.set(t.symbol, c)
    acc += t.realizedPnl
    return { id: t.id, symbol: t.symbol, ordinal: c, amount: t.realizedPnl, cumShare: total < 0 ? acc / total : 0 }
  })
  const top1 = losses.slice(0, 1).reduce((s, t) => s + t.realizedPnl, 0)
  const top3 = losses.slice(0, 3).reduce((s, t) => s + t.realizedPnl, 0)
  const top5 = losses.slice(0, 5).reduce((s, t) => s + t.realizedPnl, 0)
  const denom = total < 0 ? total : 0
  return {
    n: losses.length,
    total,
    top1Share: denom ? top1 / denom : null,
    top3Share: denom ? top3 / denom : null,
    top5Share: denom ? top5 / denom : null,
    rows,
  }
}

type SuggestionLabel = '改进方向' | '值得考虑' | '当前数据不支持' | '仅作诊断'

type SuggestionViz =
  | { kind: 'concentration'; top1: number; top3: number; top5: number }
  | { kind: 'rules'; rows: Array<{ name: string; delta: number; ciLo: number | null; ciHi: number | null }> }
  | { kind: 'flow'; total: number; recovered: number; deteriorated: number; censored: number }

type Suggestion = {
  id: string
  label: SuggestionLabel
  title: string
  why: string[]
  checks: string[]
  boundary: string[]
  viz?: SuggestionViz
}

function joinCn(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join('、')}和${items[items.length - 1]}`
}

function unsupportedCategories(unsupported: ActionEval[]): string[] {
  const cats: string[] = []
  if (unsupported.some((a) => a.id === 'stop')) cats.push('固定硬止损')
  if (
    unsupported.some(
      (a) =>
        a.id === 'hold-5' ||
        a.id.startsWith('trail') ||
        a.name.includes('统一退出') ||
        a.name.includes('仅浮亏退出') ||
        a.name.includes('回撤退出'),
    )
  ) {
    cats.push('统一提前退出')
  }
  if (unsupported.some((a) => a.name.includes('条件化减仓') || a.name.includes('条件化全部退出'))) {
    cats.push('超期浮亏机械减仓')
  }
  return cats
}

function buildSuggestions(book: Book, actions: ActionEval[], survival: SurvivalReport): Suggestion[] {
  const out: Suggestion[] = []
  const pareto = lossPareto(book)
  const unsupported = actions.filter((a) => a.kind !== 'upper-bound' && a.verdict === '当前不支持')
  const worth = actions.filter((a) => a.verdict === '值得考虑')

  if (pareto.n >= 3 && pareto.top3Share != null && pareto.top3Share >= 0.5) {
    out.push({
      id: 'control-loss-size',
      label: '改进方向',
      title: '控制单笔亏损集中度',
      why: [`前 3 笔亏损占全部毛亏 ${pctPlain(pareto.top3Share, 0)}。`],
      checks: ['检查初始风险预算', '检查亏损后是否追加了风险', '检查单笔最大风险暴露'],
      boundary: [
        '该方向来自亏损集中度诊断，不是经过历史回放验证的规则。',
        '当前缺少完整账户净值和原始失效条件，本报告不提供具体风险比例。',
        '在具备完整净值数据时，可按账户净值设定单笔风险上限。',
      ],
      viz: { kind: 'concentration', top1: pareto.top1Share ?? 0, top3: pareto.top3Share, top5: pareto.top5Share ?? 0 },
    })
  }

  if (unsupported.length) {
    out.push({
      id: 'unsupported-unified',
      label: '当前数据不支持',
      title: '统一提前退出与固定硬止损未改善历史结果',
      why: unsupported.map((a) => `${a.name}：成本前收益变化 ${money(a.delta)}`),
      checks: ['这些规则在历史回放中未带来正收益，多数点估计为负。'],
      boundary: [
        '针对本报告测试的固定第 N 日退出、固定硬止损等规则。',
        '不代表所有交易都应该无限期持有。',
        '不代表应取消已有失效条件。',
        '不代表固定退出对其他账本也无效。',
      ],
      viz: { kind: 'rules', rows: unsupported.map((a) => ({ name: a.name, delta: a.delta, ciLo: a.ciLo, ciHi: a.ciHi })) },
    })
  }

  for (const a of worth) {
    out.push({
      id: a.id,
      label: '值得考虑',
      title: a.name,
      why: [`成本前收益变化 ${money(a.delta)}${a.improveProb != null ? `，改善概率 ${pctPlain(a.improveProb, 0)}` : ''}。`],
      checks: ['需要真实账户成本与换手数据确认净效果。'],
      boundary: ['针对有日线路径、可回放的交易。', '不代表可直接上线，需结合成本判断。'],
    })
  }

  if (survival.eligible > 0) {
    if (survival.underwaterLong < 5) {
      out.push({
        id: 'conditional-derisk',
        label: '当前数据不支持',
        title: '超期浮亏后机械减仓',
        why: [`「超期且浮亏」实际仅触发 ${survival.underwaterLong} 笔，证据有限。`],
        checks: ['无法据此判断按该条件减仓是否更好。'],
        boundary: ['针对持仓明显超期且仍浮亏的交易。', '现有样本无法证明按该条件减仓更好，不代表所有长持仓都应继续持有。'],
        viz: {
          kind: 'flow',
          total: survival.underwaterLong,
          recovered: survival.recovered,
          deteriorated: survival.deteriorated,
          censored: survival.censored,
        },
      })
    } else {
      const rec = survival.recoverProb
      const det = survival.deteriorateProb
      const leanDerisk = det != null && rec != null && det > rec
      out.push({
        id: 'conditional-derisk',
        label: leanDerisk ? '值得考虑' : '当前数据不支持',
        title: '超期浮亏后机械减仓',
        why: [
          `进入该状态 ${survival.underwaterLong} 笔：恢复 ${survival.recovered} 笔、恶化 ${survival.deteriorated} 笔、观察期内无结局 ${survival.censored} 笔。`,
        ],
        checks: [leanDerisk ? '样本更倾向恶化，方向支持减仓。' : '样本更倾向恢复，不支持机械减仓。'],
        boundary: ['针对持仓明显超期且仍浮亏的交易。', '样本量有限，不能据此认定该状态通常会恢复或恶化。'],
        viz: {
          kind: 'flow',
          total: survival.underwaterLong,
          recovered: survival.recovered,
          deteriorated: survival.deteriorated,
          censored: survival.censored,
        },
      })
    }
  }

  if (!out.length) {
    out.push({
      id: 'no-rule',
      label: '仅作诊断',
      title: '本次没有发现证据充分、可直接执行的改进规则',
      why: ['历史回放未找到可稳定改善结果的统一规则。'],
      checks: ['不为了报告形式强行给出建议。'],
      boundary: ['基于当前账本的一次性诊断。', '不代表现有做法没有改进空间，而是当前样本不足以支持机械规则。'],
    })
  }

  return out
}

function sugTone(label: SuggestionLabel): string {
  if (label === '改进方向') return 'direction'
  if (label === '值得考虑') return 'worth'
  if (label === '当前数据不支持') return 'unsupported'
  return 'diagnosis'
}

function evidenceStrength(a: ActionEval): string {
  if (a.verdict === '当前无法估计') return '无法估计'
  if (a.verdict === '情景估算') return '不适用'
  if (a.verdict === '当前证据不足') return '有限'
  return '中等'
}

function riskChange(a: ActionEval): string {
  if (a.riskReduction == null) return '未检测到明显变化'
  if (Math.abs(a.riskReduction) < 1) return '无明显变化'
  return money(a.riskReduction)
}

function ciTextOf(a: ActionEval): string {
  if (a.ciLo == null || a.ciHi == null) return '无法估计'
  return `${money(a.ciLo)} ~ ${money(a.ciHi)}`
}

function scopeOf(a: ActionEval): string {
  if (a.kind === 'stop') return '针对有日线路径、可触及止损的交易。'
  if (a.kind === 'proxy') return '按 EWMA 波动率缩放仓位（0.5×~1.5×）。'
  return '针对有日线路径、可回放的交易。'
}

function caveatOf(a: ActionEval): string {
  if (a.kind === 'stop') return '日线无法判断盘中先后，止损触发点可能与实际成交价存在偏差。'
  if (a.kind === 'proxy') return '未含换手成本；仓位缩放依赖账户净值，当前账户层数据不完整时估计受限。'
  return '毛改善未扣除新增交易成本；日线不知道盘中先后，不是预测。'
}

function SuggestionVizBlock(props: { viz: SuggestionViz }) {
  const v = props.viz
  if (v.kind === 'concentration') {
    const r = 26
    const C = 2 * Math.PI * r
    const filled = Math.max(0, Math.min(1, v.top3)) * C
    return (
      <div className="how-viz how-donut">
        <svg viewBox="0 0 64 64" className="how-donut-svg" role="img" aria-label={`前 3 笔占全部毛亏 ${pctPlain(v.top3, 0)}`}>
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--panel2)" strokeWidth="8" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="var(--gold)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filled.toFixed(1)} ${C.toFixed(1)}`}
            transform="rotate(-90 32 32)"
          />
          <text x="32" y="37" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--t1)">
            {pctPlain(v.top3, 0)}
          </text>
        </svg>
        <div className="how-donut-cap">
          <span>前 3 笔占全部毛亏</span>
          <span className="tiny">
            最大 1 笔 {pctPlain(v.top1, 0)} · 前 5 笔 {pctPlain(v.top5, 0)}
          </span>
        </div>
      </div>
    )
  }
  if (v.kind === 'rules') {
    const maxAbs = Math.max(
      1,
      ...v.rows.flatMap((r) => [Math.abs(r.delta), Math.abs(r.ciLo ?? 0), Math.abs(r.ciHi ?? 0)]),
    )
    const pos = (val: number) => `${(1 - Math.abs(val) / maxAbs) * 100}%`
    return (
      <div className="how-viz how-lollipop">
        {v.rows.map((r) => {
          const p = pos(r.delta)
          const lo = r.ciLo == null ? null : pos(r.ciLo)
          const hi = r.ciHi == null ? null : pos(r.ciHi)
          const left = lo != null && hi != null ? Math.min(parseFloat(lo), parseFloat(hi)) : parseFloat(p)
          const width = lo != null && hi != null ? Math.abs(parseFloat(hi) - parseFloat(lo)) : 0
          return (
            <div key={r.name} className="how-lollipop-row">
              <span className="how-lollipop-name">{r.name}</span>
              <span className="how-lollipop-track">
                <i className="how-lollipop-zero" />
                {lo != null && hi != null ? (
                  <i className="how-lollipop-ci" style={{ left: `${left}%`, width: `${width}%` }} />
                ) : null}
                <i className="how-lollipop-dot" style={{ left: p }} />
              </span>
              <span className="how-lollipop-val down">{money(r.delta)}</span>
            </div>
          )
        })}
        <p className="tiny">点＝点估计，横线＝80% 不确定性区间；越靠左收益越差，右端为 0 基准</p>
      </div>
    )
  }
  return (
    <svg viewBox="0 0 240 80" className="how-tree-svg" role="img" aria-label="超期浮亏状态流">
      <text x="120" y="16" textAnchor="middle" fontSize="11" fill="var(--t1)">
        进入「超期且浮亏」{v.total} 笔
      </text>
      <path d="M120 22 V32 M40 32 H200 M40 32 V40 M120 32 V40 M200 32 V40" fill="none" stroke="var(--t3)" strokeWidth="1" />
      <text x="40" y="56" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--up)">
        {v.recovered}
      </text>
      <text x="40" y="70" textAnchor="middle" fontSize="10" fill="var(--t2)">
        恢复
      </text>
      <text x="120" y="56" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--down)">
        {v.deteriorated}
      </text>
      <text x="120" y="70" textAnchor="middle" fontSize="10" fill="var(--t2)">
        恶化
      </text>
      <text x="200" y="56" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--t2)">
        {v.censored}
      </text>
      <text x="200" y="70" textAnchor="middle" fontSize="10" fill="var(--t2)">
        无结局
      </text>
    </svg>
  )
}

export function HowPage(props: { space: SpaceReport; book: Book; health: HealthReport; onGoWhy: () => void }) {
  const { space, book, health } = props
  const actions = evaluateActions(space)
  const exec = actions.filter((a) => a.kind === 'replay' || a.kind === 'stop')
  const unsupported = exec.filter((a) => a.verdict === '当前不支持')
  const survival = space.counterfactual.survival
  const nClosed = space.giveback.nClosed
  const nPath = space.giveback.nPath
  const pathPct = nClosed ? nPath / nClosed : 0
  const accountPct = Math.round(health.score * 100)
  const pareto = lossPareto(book)
  const suggestions = buildSuggestions(book, actions, survival)
  const levels = stopLevels(space)
  const byRegime = space.counterfactual.byRegime
  const mainRef = useRef<HTMLDivElement>(null)

  const holdH3 = book.checkup.holdBuckets.find((r) => r.id === 'h3')
  const longWeak = Boolean(holdH3 && holdH3.n >= 5 && holdH3.pnl < 0)

  const vol = actions.find((a) => a.kind === 'proxy')
  const volUnstable = Boolean(vol && vol.delta > 0 && (vol.improveProb == null || vol.improveProb < 0.7 || (vol.ciLo != null && vol.ciLo < 0)))

  const summary: Array<{ k: string; text: string }> = []
  if (pareto.n >= 3 && pareto.top1Share != null && pareto.top3Share != null) {
    summary.push({
      k: '核心发现',
      text: `全部毛亏高度集中于少数大额交易，其中最大一笔占 ${pctPlain(pareto.top1Share, 0)}，前 3 笔占 ${pctPlain(pareto.top3Share, 0)}。`,
    })
  }
  if (longWeak) {
    const cats = unsupportedCategories(unsupported)
    const unifiedExit = cats.includes('统一提前退出')
    summary.push({
      k: '持仓关系',
      text: `长持仓组历史表现较弱，但不能据此认定持仓时间导致亏损${unifiedExit ? '；本次测试的统一提前退出也未改善历史结果' : ''}。`,
    })
  }
  if (pareto.top3Share != null && pareto.top3Share >= 0.5) {
    summary.push({ k: '改进方向', text: '优先检查单笔风险预算和亏损扩张机制，不宜仅根据持仓时间机械退出。' })
  }
  const cats = unsupportedCategories(unsupported)
  let ruleText = ''
  if (cats.length) ruleText += `当前数据不支持本次测试的${joinCn(cats)}。`
  if (volUnstable) ruleText += '波动率目标的点估计偏正，但结果尚不稳定。'
  if (ruleText) summary.push({ k: '规则检验', text: ruleText })
  summary.push({
    k: '数据范围',
    text: `分析 ${nClosed} 笔交易；${nPath} 笔具有完整价格路径，价格路径覆盖率 ${pctPlain(pathPct, 0)}；账户字段覆盖率 ${accountPct}%。`,
  })

  const riskActions = actions.filter((a) => a.kind !== 'upper-bound' && a.riskReduction != null)
  const hasRiskSignal = riskActions.some((a) => Math.abs(a.riskReduction as number) >= 1)
  const upperBounds = actions.filter((a) => a.kind === 'upper-bound')
  const ruleRows = actions.filter((a) => a.kind !== 'upper-bound')

  const howToc: TocItem[] = [
    { id: 'summary', label: '报告摘要' },
    { id: 'suggestions', label: '改进建议' },
    { id: 'rule-check', label: '候选规则检验' },
    { id: 'scenario', label: '损失约束情景' },
    { id: 'statistics', label: '统计依据' },
  ]

  return (
    <div className="analysis-page">
      <PageToc items={howToc} ariaLabel="怎么办目录" mainRef={mainRef} />
      <div className="analysis-main how-page print-section" ref={mainRef}>
        <section className="how-hero" id="summary">
          <p className="how-why-ref">
            诊断发现与详细证据见「为什么」页；本页只给出结论与建议。
            <button type="button" className="link" onClick={props.onGoWhy}>
              前往「为什么」
            </button>
          </p>

          <h2 className="review-sec">本次分析结论</h2>
          <div className="how-summary">
            {summary.map((s) => (
              <p key={s.k} className="how-summary-line">
                <b>{s.k}</b>
                <span>{s.text}</span>
              </p>
            ))}
          </div>
        </section>

        <section className="how-block" id="suggestions">
          <h2 className="review-sec">改进建议</h2>
          <div className="how-suggestions">
            {suggestions.map((s) => (
              <article key={s.id} className={`panel how-sug how-sug-${sugTone(s.label)}`}>
                <header className="how-sug-hd">
                  <span className={`how-tag how-tag-${sugTone(s.label)}`}>{s.label}</span>
                  <h3>{s.title}</h3>
                </header>
                <dl className="how-sug-dl">
                  <div>
                    <dt>为什么</dt>
                    <dd>
                      {s.viz ? (
                        <SuggestionVizBlock viz={s.viz} />
                      ) : (
                        <ul className="tiny plain-facts">
                          {s.why.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{s.label === '改进方向' ? '建议检查' : '影响'}</dt>
                    <dd>
                      <ul className="tiny plain-facts">
                        {s.checks.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>适用边界</dt>
                    <dd>
                      <ul className="tiny plain-facts">
                        {s.boundary.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="how-block" id="rule-check">
          <h2 className="review-sec">候选规则检验</h2>
          <p className="tiny">
            中央零线代表原策略；左侧表示收益降低，右侧表示收益改善。误差线表示结果不确定性，收益均为扣除成本前的估计。
          </p>
          <DifferenceBar actions={actions} />
          {volUnstable ? (
            <p className="tiny how-vol-note">
              波动率目标 15% 的点估计为正，但不确定性区间跨越零线，现有数据无法确认其能稳定改善结果
              {health.score < 0.4 ? '；同时其仓位缩放依赖账户净值，当前账户层数据不完整，估计受限' : ''}。
            </p>
          ) : null}

          <div className="how-rules">
            {ruleRows.map((a) => {
              const na = a.verdict === '当前无法估计'
              return (
                <details key={a.id} className="how-rule">
                  <summary className="how-rule-summary">
                    <span className="how-rule-name">{a.name}</span>
                    <span className="how-rule-facts">
                      <span className="how-rule-fact">
                        <b>成本前收益变化</b>
                        <em>{na ? '无法估计' : money(a.delta)}</em>
                      </span>
                      <span className="how-rule-fact">
                        <b>实际触发</b>
                        <em>{na ? '—' : `${a.triggered} 笔`}</em>
                      </span>
                      <span className="how-rule-fact">
                        <b>证据强度</b>
                        <em>{evidenceStrength(a)}</em>
                      </span>
                      <span className="how-rule-fact">
                        <b>结论</b>
                        <em>{a.verdict}</em>
                      </span>
                    </span>
                    <span className="how-rule-toggle" aria-hidden>
                      查看详细结果
                    </span>
                  </summary>
                  <dl className="how-rule-detail">
                    <div>
                      <dt>点估计</dt>
                      <dd>{na ? '无法估计' : money(a.delta)}</dd>
                    </div>
                    <div>
                      <dt>不确定性区间</dt>
                      <dd>{ciTextOf(a)}</dd>
                    </div>
                    <div>
                      <dt>尾部风险变化</dt>
                      <dd>{riskChange(a)}</dd>
                    </div>
                    <div>
                      <dt>成交假设</dt>
                      <dd>{a.basis}</dd>
                    </div>
                    <div>
                      <dt>适用范围</dt>
                      <dd>{scopeOf(a)}</dd>
                    </div>
                    <div>
                      <dt>结果不代表什么</dt>
                      <dd>{caveatOf(a)}</dd>
                    </div>
                  </dl>
                </details>
              )
            })}
          </div>
        </section>

        <section className="how-block how-scenario" id="scenario">
          <h2 className="review-sec">损失约束情景</h2>
          <p className="tiny">以下结果用于衡量亏损压缩的理论空间，不代表实际可获得收益，也不参与建议排序。</p>
          <table className="grid trips">
            <thead>
              <tr>
                <th>假设</th>
                <th>理论改善上限</th>
              </tr>
            </thead>
            <tbody>
              {upperBounds.map((a) => (
                <tr key={a.id} className="how-eval-na">
                  <td>{a.name}</td>
                  <td className="how-eval-num">{money(a.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny">情景估算：仅截断亏损、不缩盈利，故改善恒为正；不是历史回放，不参与建议排序。</p>
        </section>

        <details className="fold-block how-block" id="statistics">
          <summary>统计依据（样本口径 · 完整参数）</summary>
          <div className="how-evidence">
            <article className="panel wide">
              <h3>超期浮亏后减仓（状态流）</h3>
              <div className="how-flow">
                <p>
                  进入「超期且浮亏」状态 <b>{survival.underwaterLong} 笔</b>
                </p>
                <ul className="tiny plain-facts">
                  <li>恢复至盈亏平衡：{survival.recovered} 笔</li>
                  <li>进一步恶化：{survival.deteriorated} 笔</li>
                  <li>观察期内无结局：{survival.censored} 笔</li>
                </ul>
                <p className="tiny">
                  恢复 {survival.underwaterLong ? `${survival.recovered}/${survival.underwaterLong}` : '—/—'}
                  {survival.recoverProb != null ? `（${pctPlain(survival.recoverProb, 0)}）` : ''}；恶化{' '}
                  {survival.underwaterLong ? `${survival.deteriorated}/${survival.underwaterLong}` : '—/—'}
                  {survival.deteriorateProb != null ? `（${pctPlain(survival.deteriorateProb, 0)}）` : ''}。
                  {survival.underwaterLong < 5
                    ? '样本过少，不能据此认定该状态通常会恢复。'
                    : '样本有限，仅作参考。'}
                </p>
              </div>
            </article>

            <article className="panel wide">
              <h3>动作收益差异区间</h3>
              <BootstrapForest actions={actions} />
            </article>

            <article className="panel wide">
              <h3>收益—风险结构</h3>
              {hasRiskSignal ? (
                <DecisionMap actions={actions} />
              ) : (
                <p className="tiny">这些动作未改变当前尾部风险样本，因此本次主要差异来自收益变化。</p>
              )}
            </article>

            <article className="panel wide">
              <h3>分策略（贝叶斯收缩）</h3>
              {byRegime.length ? (
                <>
                  <table className="grid trips how-eval">
                    <thead>
                      <tr>
                        <th>策略</th>
                        <th>样本数</th>
                        <th>后验均值</th>
                        <th>80% 可信区间</th>
                        <th>P(改善 &gt; 0)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byRegime.map((g) => (
                        <tr key={g.regime}>
                          <td>{g.label}</td>
                          <td>{g.n}</td>
                          <td className="how-eval-num">{g.meanDelta == null ? '—' : money(g.meanDelta)}</td>
                          <td className="how-eval-num">
                            {g.ciLo == null || g.ciHi == null ? '—' : `${money(g.ciLo)} ~ ${money(g.ciHi)}`}
                          </td>
                          <td className="how-eval-num">{g.probImprove == null ? '—' : pctPlain(g.probImprove, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="tiny">
                    注：当前「短线 / 长线 / 波段」由持仓天数与是否日内反推，属于系统自动识别的持仓形态（模型分组），不是真实交易策略。
                  </p>
                </>
              ) : (
                <p className="tiny">样本不足，无法按策略做贝叶斯收缩。</p>
              )}
            </article>

            <article className="panel wide">
              <h3>数据完整度</h3>
              <div className="how-cover-row">
                <span className="how-cover-label">价格路径</span>
                <div className="how-cover-track">
                  <i style={{ width: `${Math.round(pathPct * 100)}%` }} />
                </div>
                <span className="how-cover-num">
                  {nPath}/{nClosed}
                </span>
              </div>
              <p className="tiny">账户净资产与初始风险未随账单提供，是解锁美元口径风险预算的前提。</p>
            </article>

            <article className="panel wide">
              <h3>退出规则回放（全参数）</h3>
              <p className="tiny">
                毛改善未扣除新增交易成本；日线不知道盘中先后，规则结果只能当作纪律空间的探索性反事实，不是预测。
              </p>
              <RuleHeat rules={space.ruleReplay.rules} />
            </article>

            {levels.length ? (
              <article className="panel wide">
                <h3>硬止损回放（全参数）</h3>
                <table className="grid trips">
                  <thead>
                    <tr>
                      <th>预设档</th>
                      <th>回放合计</th>
                      <th>相对实际</th>
                      <th>触及笔数</th>
                      <th>FDR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.map((l) => (
                      <tr key={l.pct} className={l.fdr ? '' : 'low-n'}>
                        <td>{pctPlain(l.pct, 0)}</td>
                        <td>{money(l.pnl)}</td>
                        <td>{money(l.delta)}</td>
                        <td>{l.nStopped}</td>
                        <td>{l.fdr ? '通过' : '未通过'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  )
}
