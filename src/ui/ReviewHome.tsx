import { money, pctPlain } from '../lib/format.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import { WhatPage } from './WhatPage.tsx'

export { WhatPage }

function Card(props: { d: Diagnosis; onEvidence: (anchor: string) => void }) {
  const { d } = props
  const factChip = d.factConfidence === 'high' && d.extrapolationConfidence === 'low'
  return (
    <article className={`panel diag-card tone-${d.tone} conf-${d.extrapolationConfidence}`}>
      <div className="diag-tags">
        {factChip ? <span className="diag-tag">事实确定 · 外推待观察</span> : null}
        {d.extrapolationConfidence === 'low' && !factChip ? <span className="diag-tag">低外推置信</span> : null}
      </div>
      <h3>{d.headline}</h3>
      <p>
        <b>现象</b> {d.phenomenon}
      </p>
      <p>
        <b>解释</b> {d.explanation}
      </p>
      <div className="diag-actions">
        <button type="button" className="ghost sm" onClick={() => props.onEvidence(d.evidenceAnchor)}>
          查看依据
        </button>
      </div>
    </article>
  )
}

const CONC_IDS = new Set(['structure-max-win', 'risk-concentrate'])
const QUALITY_IDS = new Set(['payoff-highlight'])

export function WhyDiagnoses(props: {
  diagnoses: Diagnosis[]
  onEvidence: (anchor: string) => void
}) {
  const impactAll = props.diagnoses.filter((d) => d.section === 'impact' && d.id !== 'luck-loss-mass' && d.tone !== 'highlight')
  const impact = impactAll.filter(
    (d) =>
      !CONC_IDS.has(d.id) &&
      !QUALITY_IDS.has(d.id) &&
      (d.factConfidence === 'high' || d.extrapolationConfidence !== 'low'),
  )
  const observe = [
    ...impactAll.filter((d) => !(d.factConfidence === 'high' || d.extrapolationConfidence !== 'low')),
    ...props.diagnoses.filter((d) => d.section === 'observe'),
  ].filter((d) => !CONC_IDS.has(d.id) && !QUALITY_IDS.has(d.id))
  const highlights = props.diagnoses.filter((d) => d.section === 'highlight' && !QUALITY_IDS.has(d.id) && !CONC_IDS.has(d.id))
  const conc = props.diagnoses.find((d) => CONC_IDS.has(d.id))
  return (
    <div className="why-diagnoses">
      {highlights.length || conc ? (
        <section id="why-structure">
          <h3 className="review-sec">结构</h3>
          {highlights.map((d) => (
            <Card key={d.id} d={d} onEvidence={props.onEvidence} />
          ))}
          {conc ? (
            <p className="conc-ptr">
              <button type="button" className="link" onClick={() => props.onEvidence('sensitivity')}>
                集中度极高，详见敏感性 ↓
              </button>
            </p>
          ) : null}
        </section>
      ) : null}
      {impact.length ? (
        <section id="why-impact">
          <h3 className="review-sec">钱是怎么亏的</h3>
          {impact.map((d) => (
            <Card key={d.id} d={d} onEvidence={props.onEvidence} />
          ))}
        </section>
      ) : (
        <section id="why-impact">
          <h3 className="review-sec">钱是怎么亏的</h3>
        </section>
      )}
      {observe.length ? (
        <section id="why-observe">
          <h3 className="review-sec">低置信观察</h3>
          <ul className="obs-list">
            {observe.map((d) => (
              <li key={d.id}>
                <button type="button" className="obs-line" onClick={() => props.onEvidence(d.evidenceAnchor)}>
                  <b>{d.headline}</b>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function WhyLuck(props: {
  line: string
  losePct: number | null
  cleared: string[]
}) {
  return (
    <section className="why-luck" id="luck-zone">
      <h2 className="review-sec">这是实力还是运气</h2>
      <p className="verdict">{props.line}</p>
      {props.losePct != null ? (
        <p className="tiny">
          有放回抽样里约 {props.losePct}% 终值为负。完整图只在下面这一处。
        </p>
      ) : null}
      {props.cleared.length ? (
        <p className="tiny">
          查了未见异常：{props.cleared.join('、')}。
        </p>
      ) : null}
    </section>
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
  const half =
    d.h1 != null && d.h2 != null ? `前后半程：前半 ${money(d.h1)} → 后半 ${money(d.h2)}。` : null
  return { drop, half }
}

export function confWord(c: 'low' | 'mid' | 'high') {
  return c === 'high' ? '高' : c === 'mid' ? '中' : '低'
}

export function pctOrDash(v: number | null) {
  return v == null ? '—' : pctPlain(v, 0)
}
