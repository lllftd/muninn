import { ColorScatter, ForestPlot } from './charts.tsx'
import { money } from '../lib/format.ts'
import type { ActionEval } from '../engine/counterfactual.ts'

function verdictSymbol(a: ActionEval): string {
  if (a.verdict === '值得考虑') return '值得考虑'
  if (a.verdict === '当前证据不足') return '当前证据不足'
  if (a.verdict === '当前不支持') return '当前不支持'
  if (a.verdict === '情景估算') return '情景估算'
  if (a.verdict === '当前无法估计') return '当前无法估计'
  return '数据不足'
}

function evidenceColor(a: ActionEval): string {
  if (a.verdict === '值得考虑') return 'var(--up)'
  if (a.verdict === '当前证据不足') return 'var(--gold)'
  if (a.verdict === '当前不支持') return 'var(--down)'
  return 'var(--t3)'
}

/** 收益—风险四象限地图：横轴毛收益变化、纵轴尾部风险改善、气泡=受影响交易数、颜色=证据等级。 */
export function DecisionMap({ actions }: { actions: ActionEval[] }) {
  const pts = actions
    .filter((a) => a.kind !== 'upper-bound' && a.verdict !== '当前无法估计' && a.riskReduction != null)
    .map((a) => ({
      id: a.id,
      x: a.delta,
      y: a.riskReduction as number,
      color: evidenceColor(a),
      r: 5 + Math.sqrt(Math.max(a.n, 1)) * 2.5,
      label: `${a.name} · 收益 ${money(a.delta)} · 尾部改善 ${money(a.riskReduction as number)}`,
      name: a.name,
    }))
  if (!pts.length) return <p className="tiny">没有可绘制的动作。</p>
  return (
    <div className="how-map">
      <ColorScatter
        points={pts}
        vRef={0}
        vRefLabel="收益不变"
        hRef={0}
        hRefLabel="风险不变"
        xFormat={money}
        yFormat={money}
        xLabel="毛收益变化 →"
        yLabel="尾部风险改善 ↑"
        height={260}
        callouts={pts.map((p) => ({ id: p.id, text: p.name }))}
      />
      <ul className="tiny plain-facts how-map-legend">
        <li>右上＝收益增、风险降（优先验证）</li>
        <li>左上＝风险降、但牺牲收益</li>
        <li>右下＝收益增、但风险升</li>
        <li>左下＝收益降、风险升（不建议）</li>
      </ul>
    </div>
  )
}

/** Bootstrap 置信区间森林图：区间跨零＝证据不足，整体在零左侧＝不支持，右侧＝可考虑。 */
export function BootstrapForest({ actions }: { actions: ActionEval[] }) {
  const items = actions
    .filter((a) => a.kind !== 'upper-bound')
    .map((a) => {
      const notTriggered = a.verdict === '当前无法估计'
      return {
        id: a.id,
        label: a.name,
        value: notTriggered ? null : a.delta,
        lo: notTriggered ? null : a.ciLo,
        hi: notTriggered ? null : a.ciHi,
        n: a.n,
        status: notTriggered ? '当前无法估计' : verdictSymbol(a),
      }
    })
  if (!items.length) return <p className="tiny">没有可画的置信区间。</p>
  return <ForestPlot items={items} format={money} palette="signed" />
}

/** 水平差异条：中央零线代表原策略，左=收益降低，右=收益改善，误差线表示不确定性。 */
export function DifferenceBar({ actions }: { actions: ActionEval[] }) {
  const rows = actions.filter((a) => a.kind !== 'upper-bound')
  if (!rows.length) return <p className="tiny">没有可比较的动作。</p>
  const span = Math.max(
    1,
    ...rows.map((a) => Math.abs(a.delta)),
    ...rows.map((a) => Math.max(Math.abs(a.ciLo ?? 0), Math.abs(a.ciHi ?? 0))),
  )
  const pos = (v: number | null) => (v == null ? null : 50 + (v / span) * 50)
  return (
    <div className="diffbar">
      <div className="diffbar-head" aria-hidden>
        <span>候选规则</span>
        <span>成本前收益变化（相对原策略）</span>
      </div>
      {rows.map((a) => {
        const na = a.verdict === '当前无法估计'
        const p = pos(a.delta)
        const lo = pos(a.ciLo)
        const hi = pos(a.ciHi)
        const left = p == null ? 50 : Math.min(50, p)
        const width = p == null ? 0 : Math.abs(p - 50)
        return (
          <div key={a.id} className={`diffbar-row${na ? ' na' : ''}`}>
            <span className="diffbar-name">{a.name}</span>
            <span className="diffbar-track">
              <i className="diffbar-zero" />
              {na ? (
                <i className="diffbar-na">无法估计</i>
              ) : (
                <>
                  {lo != null && hi != null ? (
                    <i className="diffbar-ci" style={{ left: `${Math.min(lo, hi)}%`, width: `${Math.abs(hi - lo)}%` }} />
                  ) : null}
                  <i
                    className={`diffbar-fill ${a.delta < 0 ? 'neg' : 'pos'}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </>
              )}
            </span>
            <span className="diffbar-meta">
              {na ? '无法估计' : `${money(a.delta)}${a.triggered ? ` · 触发 ${a.triggered} 笔` : ''}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
