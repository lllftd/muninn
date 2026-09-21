import { money, pctPlain } from '../lib/format.ts'
import { DumbbellPlot, ForestPlot, TornadoPlot } from './charts.tsx'
import { RuleHeat } from './howCharts.tsx'
import type { SpaceReport, StopLevel } from '../types.ts'

function ciMoney(ci: { lo: number; hi: number } | null) {
  if (!ci) return ''
  return `80% CI ${money(ci.lo)} ~ ${money(ci.hi)}`
}

function Scan(props: { text: string; hint?: string }) {
  return (
    <p className="how-scan">
      <span>{props.text}</span>
      {props.hint ? (
        <span className="path-info" title={props.hint}>
          ⓘ
        </span>
      ) : null}
    </p>
  )
}

export function SpaceEvidence(props: { space: SpaceReport }) {
  const { space } = props
  const scan = space.stopScan
  const topLever = space.evLevers[0]
  const passedStops = scan?.presets.filter((l) => l.fdr) ?? []
  const ruleN = space.ruleReplay.rules.filter((r) => r.computable).length

  return (
    <div className="how-evidence">
      <article className="panel" id="ev-levers">
        <h3>样本净盈亏对{topLever.label}最敏感</h3>
        {space.evLevers.length && topLever ? (
          <>
            <Scan
              text={`${topLever.label}${topLever.shock} 时，样本净盈亏点估计 ${money(topLever.delta)}。这是数学敏感性分析，不代表已有可执行方法能实现该改善。`}
              hint="各杠杆做相同幅度的相对冲击（×1.1 / ×0.9），不是下降 10 个百分点。左右条是机械敏感性结果，不是置信区间。"
            />
            <TornadoPlot
              rows={space.evLevers.map((l) => ({
                id: l.id,
                label: l.label,
                left: l.worseDelta,
                right: l.delta,
                formula: `${l.label}${l.shock}：×0.9 → ${money(l.worseDelta)}；×1.1 → ${money(l.delta)}`,
              }))}
              format={money}
            />
          </>
        ) : (
          <p className="tiny">需要同时有盈利和亏损样本才做弹性分解。</p>
        )}
      </article>

      <article className="panel wide" id="stop-scan">
        <h3>硬止损回放</h3>
        {scan ? (
          <>
            <Scan
              text={
                passedStops.length
                  ? `扫了预设档，${passedStops.length} 档通过 FDR → 可认领 ${pctPlain(scan.bestPreset?.pct ?? passedStops[0].pct, 0)}`
                  : '五项均未通过。当前样本未验证任何预设硬止损参数，不建议上线。'
              }
              hint={scan.note}
            />
            <ForestPlot
              palette="neutral"
              items={scan.presets.map((l) => ({
                id: String(l.pct),
                label: pctPlain(l.pct, 0),
                value: l.delta,
                lo: l.deltaCi?.lo,
                hi: l.deltaCi?.hi,
                status: l.fdr ? '通过 FDR' : '未通过多重检验',
              }))}
              format={money}
            />
            <p className="tiny">点为中位数，线为 80% Bootstrap 区间。小样本用 80% 以免把噪声当成无效应。</p>
            <details className="fold-block">
              <summary>查看方法与完整结果</summary>
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
                  {scan.presets.map((l: StopLevel) => (
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
            </details>
          </>
        ) : (
          <p className="tiny">有日线 MAE 的样本不足 5 笔，不扫描止损线。</p>
        )}
      </article>

      <article className="panel wide" id="rule-replay">
        <h3>规则回放</h3>
        <Scan
          text={
            space.ruleReplay.bestPreset
              ? `${ruleN} 条可计算规则里，「${space.ruleReplay.bestPreset.label}」通过 FDR → 可认领`
              : `当前 ${ruleN || 5} 条预设退出规则均未获得足够统计支持。`
          }
          hint={space.ruleReplay.note}
        />
        <details className="fold-block">
          <summary>{space.ruleReplay.bestPreset ? '通过档与其余回放' : '各规则均未通过，查看热力表'}</summary>
          <RuleHeat rules={space.ruleReplay.rules} />
        </details>
      </article>
    </div>
  )
}

export function SpaceOppCost(props: { space: SpaceReport }) {
  const { space } = props
  const bh = space.oppCost.symbolBh
  const spy = space.oppCost.spy
  const matrixRows = space.oppCost.matrix.filter((r) => r.longMean != null || r.shortMean != null || r.reverseShortMean != null)
  const hasShortFlip = matrixRows.some((r) => r.reverseShortMean != null)
  return (
    <article className="panel" id="opp-cost">
      <h3>机会成本</h3>
      {bh || spy ? (
        <>
          <Scan
            text={
              bh
                ? `本期主动交易落后同期被动持有基准 ${money(bh.delta)}${bh.deltaCi ? `（${ciMoney(bh.deltaCi)}）` : ''}`
                : `等额市场对照差 ${spy ? money(spy.delta) : '—'}`
            }
            hint="该结果表示机会成本，不等于所有交易都应替换为指数持有。两种基准假设不同，不要合并成同一个结论。"
          />
          <DumbbellPlot
            rows={[bh, spy].filter(Boolean).map((row) => ({
              id: row!.id,
              label: row!.label,
              a: row!.actual,
              b: row!.bench,
              aLabel: '实际',
              bLabel: row!.id === 'spy' ? '等额 SPY/QQQ' : '持有不动',
              n: row!.n,
              delta: row!.delta,
              ci: row!.deltaCi ? ciMoney(row!.deltaCi) : null,
              note: row!.id === 'spy' ? '等额占用资金' : hasShortFlip ? '含空头对照，翻多见矩阵' : '空头翻多未计入此口径',
            }))}
          />
          <details className="fold-block">
            <summary>查看明细</summary>
            <ul className="tiny plain-facts">
              {bh ? (
                <li>
                  持有不动：实际 {money(bh.actual)}，对照 {money(bh.bench)}，差 {money(bh.delta)} · n={bh.n}
                </li>
              ) : (
                <li>标的持有不动：日线窗口不足 5 笔。</li>
              )}
              {spy ? (
                <li>
                  放 {spy.label}：实际 {money(spy.actual)}，对照 {money(spy.bench)}，差 {money(spy.delta)} · n={spy.n}
                </li>
              ) : (
                <li>没有 SPY/QQQ 日线，市场基准不算。</li>
              )}
            </ul>
            {matrixRows.length ? (
              <>
                <p className="tiny">空头翻多 = 把每笔空头假设改成做多重算一遍。</p>
                <table className="grid trips">
                  <thead>
                    <tr>
                      <th>标的</th>
                      <th>多 / 空</th>
                      <th>多头均值</th>
                      <th>空头均值</th>
                      <th>空头翻多</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((r) => (
                      <tr key={r.symbol} className={r.nLong + r.nShort < 10 ? 'low-n' : ''}>
                        <td>{r.symbol}</td>
                        <td>
                          {r.nLong} / {r.nShort}
                        </td>
                        <td>{r.longMean == null ? '—' : money(r.longMean)}</td>
                        <td>{r.shortMean == null ? '—' : money(r.shortMean)}</td>
                        <td>{r.reverseShortMean == null ? '—' : money(r.reverseShortMean)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </details>
        </>
      ) : (
        <p className="tiny">窗口不足，不算机会成本。</p>
      )}
    </article>
  )
}

export function SpaceRef(props: { space: SpaceReport }) {
  const { space } = props
  const psm = space.psm
  const kelly = space.kelly
  const ciCrosses = Boolean(psm.deltaCi && psm.deltaCi.lo < 0 && psm.deltaCi.hi > 0)
  const psmThin = psm.status !== 'ok' || psm.nMatched < 10 || ciCrosses
  const psmLine =
    psm.nTreated < 5
      ? '空头不足 5 笔，不做方向匹配。'
      : psmThin
        ? '同一标的做多做空混着来，样本不足以判定哪个方向拖累，但混杂本身值得警惕。'
        : `匹配后空头相对做多 ${psm.delta == null ? '—' : money(psm.delta)}/笔。`
  const fStar = kelly?.full
  const kellyLine =
    kelly == null
      ? '需要同时有盈利和亏损样本才估 Kelly。'
      : fStar == null || fStar <= 0
        ? `Kelly 仓位参考：f* = 0（期望为负时任何仓位公式都不适用）`
        : `Kelly 仓位参考：f* = ${pctPlain(fStar, 1)}，只展示 1/4 与 1/2，不是仓位建议`

  return (
    <div className="how-ref">
      <p className="how-obs" id="psm">
        {psmLine}
      </p>
      <p className="how-obs" id="kelly">
        {kellyLine}{' '}
        {kelly ? (
          <span
            className="path-info"
            title={`${kelly.note} p=${kelly.p == null ? '—' : pctPlain(kelly.p, 0)} · b=${kelly.b == null ? '—' : kelly.b.toFixed(2)} · 1/4=${kelly.quarter == null ? '—' : pctPlain(kelly.quarter, 1)} · r=${kelly.corrSizePnl == null ? '—' : kelly.corrSizePnl.toFixed(2)}`}
          >
            ⓘ
          </span>
        ) : null}
      </p>
    </div>
  )
}
