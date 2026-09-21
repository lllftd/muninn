import { useState, type ReactNode } from 'react'
import { money, pctPlain } from '../lib/format.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import { WhatPage } from './WhatPage.tsx'

export { WhatPage }

/** evidenceAnchor → 对应完整证据图的中文名,给深链按钮做标签。 */
const EVIDENCE_LABEL: Record<string, string> = {
  sensitivity: '敏感性图表',
  mc: '蒙特卡洛分布',
  mae: 'MAE×MFE 散点',
  hold: '持仓时间点须图',
  weekdays: '星期分组',
  sides: '多空分组',
  freq: '频率分组',
  quality: '交易质量',
  psm: '倾向匹配',
  'stop-scan': '硬止损扫描',
  'rule-replay': '规则回放',
  'opp-cost': '机会成本',
  kelly: 'Kelly 参考',
}

/**
 * 这些 anchor 的完整图在「怎么办」页(反事实证据),不在本页下方。深链会切 tab。
 * 用它区分按钮文案:同页说「展开下方…↓」,跨页说「去『怎么办』看…→」——别做错误的空间承诺。
 */
const CROSS_TAB_ANCHORS = new Set(['opp-cost', 'stop-scan', 'rule-replay', 'kelly', 'psm'])

/**
 * 这些诊断的证据已完整写在标题里(如前后半程 "前半 -$619 → 后半 +$458"),
 * 下方也没有专属它的图。不显示深链——数字自足,不做"下面还有图"的空承诺。
 */
const SELF_EVIDENT_IDS = new Set(['trend-better', 'trend-worse'])

/**
 * 是否显示深链按钮。总原则(用户定):证据要在卡内自足,能不跳就不跳。
 * - 证据已在标题里说清(SELF_EVIDENT_IDS):不显示。
 * - 跨页 anchor(图在「怎么办」页):显示,因为图确实在别处。
 * - 同页 + 卡内已有内嵌图:不显示——证据已就地自足,再挂"↓看"是多余跳转。
 * - 同页 + 卡内无图:显示,作为唯一的看图入口。
 */
function showDeepLink(id: string, anchor: string, hasInlineChart: boolean): boolean {
  if (SELF_EVIDENT_IDS.has(id)) return false
  if (CROSS_TAB_ANCHORS.has(anchor)) return true
  return !hasInlineChart
}

/** 深链按钮文案。跨页说去怎么办;同页无图说展开下方。 */
function evidenceLinkText(anchor: string): string {
  const label = EVIDENCE_LABEL[anchor] ?? '完整图'
  if (CROSS_TAB_ANCHORS.has(anchor)) return `去「怎么办」看${label} →`
  return `展开下方${label} ↓`
}

/**
 * 主因卡:结论下面直接跟依据。规范第六节要求「证据就地」——废掉原「查看依据」跳转按钮,
 * 改为卡内「依据 ▾」折叠:展开后就地显示现象/解释复述 + 建议行,再给一个深链到下面完整图。
 * 读者不必跳走再爬回来。
 */
function Card(props: { d: Diagnosis; onEvidence: (anchor: string) => void; inlineChart?: ReactNode }) {
  const { d } = props
  // 有内嵌图的卡默认展开依据(证据就地);纯文字依据的卡默认收起,避免 L0 失控。
  const [open, setOpen] = useState(Boolean(props.inlineChart))
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
      {/* 主证据就地:一句可执行建议(来自 diagnose 的 next 字段,原来没渲染)。 */}
      {d.next ? <p className="diag-next">→ {d.next}</p> : null}
      {/* 次要依据卡内折叠,默认收起,避免 L0 失控;展开后仍在卡内,不跳走。 */}
      <div className="diag-actions">
        <button
          type="button"
          className="diag-fold-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`layer-caret ${open ? 'down' : ''}`} aria-hidden>
            ▸
          </span>
          依据
        </button>
      </div>
      {open ? (
        <div className="diag-evidence">
          <p className="tiny">
            置信:事实 {confWord(d.factConfidence)} · 外推 {confWord(d.extrapolationConfidence)}
            {d.n ? ` · n=${d.n}` : ''}
          </p>
          {/* 证据就地:主证据图直接画在卡内,不跳走。 */}
          {props.inlineChart ? <div className="diag-chart">{props.inlineChart}</div> : null}
          {showDeepLink(d.id, d.evidenceAnchor, Boolean(props.inlineChart)) ? (
            <button type="button" className="link" onClick={() => props.onEvidence(d.evidenceAnchor)}>
              {evidenceLinkText(d.evidenceAnchor)}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

const CONC_IDS = new Set(['structure-max-win', 'risk-concentrate'])
const QUALITY_IDS = new Set(['payoff-highlight'])

export function WhyDiagnoses(props: {
  diagnoses: Diagnosis[]
  onEvidence: (anchor: string) => void
  /** 给指定诊断卡内嵌主证据图(证据就地)。返回 null 则该卡只有文字依据。 */
  chartFor?: (d: Diagnosis) => ReactNode
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
  // 集中度诊断:升级为正式卡,依据(集中度米字条)就地内嵌,不再是跳转指针。
  const conc = props.diagnoses.find((d) => CONC_IDS.has(d.id))
  return (
    <div className="why-diagnoses">
      {highlights.length || conc ? (
        <section id="why-structure">
          <h3 className="review-sec">结构</h3>
          {highlights.map((d) => (
            <Card key={d.id} d={d} onEvidence={props.onEvidence} inlineChart={props.chartFor?.(d)} />
          ))}
          {conc ? <Card d={conc} onEvidence={props.onEvidence} inlineChart={props.chartFor?.(conc)} /> : null}
        </section>
      ) : null}
      {impact.length ? (
        <section id="why-impact">
          <h3 className="review-sec">钱是怎么亏的</h3>
          {impact.map((d) => (
            <Card key={d.id} d={d} onEvidence={props.onEvidence} inlineChart={props.chartFor?.(d)} />
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
              <ObsRow key={d.id} d={d} onEvidence={props.onEvidence} chart={props.chartFor?.(d)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * 低置信观察行:样本太薄(常 n<10),默认收起、只列一行结论。点开就地展开对应分组图 +
 * 一行薄样本警告——依据就地、不跳走,但用警告和默认收起保住"别把薄样本当规律"的克制。
 */
function ObsRow(props: { d: Diagnosis; onEvidence: (anchor: string) => void; chart?: ReactNode }) {
  const { d } = props
  const [open, setOpen] = useState(false)
  return (
    <li className={`obs-item ${open ? 'open' : ''}`}>
      <button type="button" className="obs-line" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`layer-caret ${open ? 'down' : ''}`} aria-hidden>
          ▸
        </span>
        <b>{d.headline}</b>
      </button>
      {open ? (
        <div className="obs-evidence">
          <p className="tiny obs-warn">
            样本薄(n={d.n}) · 事实 {confWord(d.factConfidence)} · 外推 {confWord(d.extrapolationConfidence)} · 不当可外推规律
          </p>
          {props.chart ? <div className="diag-chart">{props.chart}</div> : null}
          {showDeepLink(d.id, d.evidenceAnchor, Boolean(props.chart)) ? (
            <button type="button" className="link" onClick={() => props.onEvidence(d.evidenceAnchor)}>
              {evidenceLinkText(d.evidenceAnchor)}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
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
