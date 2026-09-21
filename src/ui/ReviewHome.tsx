import { money, moneyAbs, pctPlain } from '../lib/format.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import { WhatPage } from './WhatPage.tsx'
import type { WhyLeadFacts } from './whyViz.ts'

export { WhatPage }

export function WhyLead(props: { text: string; facts: WhyLeadFacts; coverage: string; nLine: string }) {
  const f = props.facts
  return (
    <section className="why-lead" id="why-lead">
      <p className="why-lead-k">这一期为什么</p>
      <p className="why-lead-body">{props.text}</p>
      <div className="why-lead-grid">
        <div>
          <p className="why-lead-k">结果</p>
          <ul>
            <li>
              净盈亏 <b className={f.net > 0 ? 'up' : f.net < 0 ? 'down' : ''}>{money(f.net)}</b>
            </li>
            <li>交易笔数 {f.n}</li>
            <li>胜率 {f.wr == null ? '—' : pctPlain(f.wr, 0)}</li>
            <li>本期交易序列最大回撤 {f.seqDdUsd == null ? '—' : `−${moneyAbs(f.seqDdUsd)}`}</li>
            <li>盈亏比 {f.payoff == null ? '—' : f.payoff.toFixed(2)}</li>
          </ul>
        </div>
        <div>
          <p className="why-lead-k">结构</p>
          <ul>
            <li>最大标的占毛利 {f.maxWinShare == null ? '—' : pctPlain(f.maxWinShare, 0)}</li>
            <li>前三大亏损占毛亏 {f.top3LossShare == null ? '—' : pctPlain(f.top3LossShare, 0)}</li>
            <li>
              去掉最大盈利后 <b className={clsPnlClass(f.netExMaxWin)}>{f.netExMaxWin == null ? '—' : money(f.netExMaxWin)}</b>
            </li>
            <li>浮盈转亏 {f.floatedToLoss} 笔</li>
          </ul>
        </div>
        <div>
          <p className="why-lead-k">可靠性</p>
          <ul>
            <li>数据{props.coverage}</li>
            <li>有效路径 n={f.pathN}</li>
            <li>R 口径异常 {f.rFlagged} 笔</li>
            <li>{props.nLine}</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

export type WhyEvidenceExtra = {
  scope?: string
  realized?: number | null
  counterfactual?: number | null
  mfeCap?: number | null
  metric?: string
  limit?: string
}

export function WhyFinding(props: { d?: Diagnosis | null; extra?: WhyEvidenceExtra }) {
  const d = props.d
  if (!d) return null
  const explore = d.section === 'observe' || d.extrapolationConfidence === 'low' || d.n < 10
  const ex = props.extra
  return (
    <div className={`why-evidence ${explore ? 'explore' : ''}`}>
      <p className="why-ch-verdict">发现：{d.headline}</p>
      <dl className="why-ev-dl">
        <dt>影响范围</dt>
        <dd>{ex?.scope ?? `n=${d.n}`}</dd>
        {ex?.realized != null ? (
          <>
            <dt>样本内已实现</dt>
            <dd className={clsPnlClass(ex.realized)}>{money(ex.realized)}</dd>
          </>
        ) : null}
        {ex?.counterfactual != null ? (
          <>
            <dt>机械反事实</dt>
            <dd className="why-cf">
              若完全不做该组，结果机械增加 {money(ex.counterfactual)}
              <span className="tiny"> 不代表该规则未来有效。</span>
            </dd>
          </>
        ) : null}
        {ex?.mfeCap != null ? (
          <>
            <dt>日线 MFE 反事实上限</dt>
            <dd className="why-mfe-cap">
              {money(ex.mfeCap)}
              <span className="tiny"> 日线估算，不是可回收利润。可实现改善待规则实验验证。</span>
            </dd>
          </>
        ) : null}
        <dt>核心指标</dt>
        <dd>{ex?.metric ?? '—'}</dd>
        <dt>置信度</dt>
        <dd>
          事实{confWord(d.factConfidence)} · 归因{confWord(attrConf(d))}
        </dd>
        <dt>数据限制</dt>
        <dd>{ex?.limit ?? (explore ? '当前样本不足，只作观察' : '—')}</dd>
        <dt>解释</dt>
        <dd>
          {d.phenomenon} {d.explanation}
        </dd>
      </dl>
    </div>
  )
}

function attrConf(d: Diagnosis): 'low' | 'mid' | 'high' {
  if (d.section === 'observe' || d.n < 10) return 'low'
  return d.extrapolationConfidence
}

function clsPnlClass(v: number | null) {
  if (v == null || v === 0) return ''
  return v > 0 ? 'up' : 'down'
}

export function WhyLuck(props: {
  line: string
  losePct: number | null
  cleared: string[]
}) {
  return (
    <div className="why-luck-copy">
      <p className="why-ch-verdict">{props.line}</p>
      {props.losePct != null ? (
        <p className="tiny">有放回抽样里约 {props.losePct}% 终值为负。这不能单独证明策略长期负期望。</p>
      ) : null}
      {props.cleared.length ? <p className="tiny">查了未见异常：{props.cleared.join('、')}。</p> : null}
    </div>
  )
}

export function luckFacts(d: {
  losePct: number | null
  mean: number | null
  dropFrom: number | null
  dropTo: number | null
  h1: number | null
  h2: number | null
}): { drop: string | null; half: string | null } {
  const drop =
    d.dropFrom != null && d.dropTo != null
      ? `集中度敏感性：去掉最大一笔，单笔均值从 ${money(d.dropFrom)} 变成 ${money(d.dropTo)}。`
      : null
  const half = d.h1 != null && d.h2 != null ? `前后半程：前半 ${money(d.h1)} → 后半 ${money(d.h2)}。` : null
  return { drop, half }
}

export function confWord(c: 'low' | 'mid' | 'high') {
  return c === 'high' ? '高' : c === 'mid' ? '中' : '低'
}

export function pctOrDash(v: number | null) {
  return v == null ? '—' : pctPlain(v, 0)
}
