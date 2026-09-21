import { money, pctPlain } from '../lib/format.ts'
import { ForestPlot, MultiLine } from './charts.tsx'
import type { SpaceReport, StopLevel } from '../types.ts'

function ciMoney(ci: { lo: number; hi: number } | null) {
  if (!ci) return ''
  return `80% CI ${money(ci.lo)} ~ ${money(ci.hi)}`
}

function stopIndex(l: StopLevel) {
  return Math.round(l.pct * 100) - 1
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
  const lastI = scan ? scan.levels.length - 1 : -1
  const lastPreset = scan?.presets.find((l) => stopIndex(l) === lastI)
  const topLever = space.evLevers[0]
  const passedStops = scan?.presets.filter((l) => l.fdr) ?? []
  const stopN = scan?.levels.length ?? 0
  const ruleN = space.ruleReplay.rules.filter((r) => r.computable).length
  const bh = space.oppCost.symbolBh
  const spy = space.oppCost.spy
  const beatByHold = bh != null && bh.delta < 0
  const matrixRows = space.oppCost.matrix.filter((r) => r.longMean != null || r.shortMean != null || r.reverseShortMean != null)

  return (
    <div className="how-evidence">
      <article className="panel" id="ev-levers">
        <h3>期望值杠杆弹性</h3>
        {space.evLevers.length && topLever ? (
          <>
            <Scan
              text={`减亏比提胜更值钱：${topLever.label} ${topLever.shock} 撬动 ${money(topLever.delta)}`}
              hint="各杠杆做相同幅度的相对冲击。须是 80% CI。须穿过 0 = 撬动力还锁不住。不是预测。"
            />
            <ForestPlot
              items={space.evLevers.map((l) => ({
                id: l.id,
                label: `${l.label} ${l.shock}`,
                value: l.delta,
                lo: l.deltaCi?.lo,
                hi: l.deltaCi?.hi,
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
                  ? `扫了 ${stopN} 档硬止损，${passedStops.length} 档通过 FDR → 可认领 ${pctPlain(scan.bestPreset?.pct ?? passedStops[0].pct, 0)}`
                  : `扫了 ${stopN} 档硬止损，无一通过多重检验 → 没有可信的止损参数`
              }
              hint={scan.note}
            />
            <ForestPlot
              items={scan.presets.map((l) => ({
                id: String(l.pct),
                label: pctPlain(l.pct, 0),
                value: l.delta,
                lo: l.deltaCi?.lo,
                hi: l.deltaCi?.hi,
                dim: !l.fdr,
                note: l.fdr ? '通过 FDR' : '未通过 FDR',
              }))}
              format={money}
            />
            <MultiLine
              height={168}
              baseline={scan.actualPnl}
              tickFormat={(v) => money(v)}
              dates={scan.levels.map((l) => `${Math.round(l.pct * 100)}%`)}
              series={[{ values: scan.levels.map((l) => l.pnl), color: 'var(--path-line)', width: 1.6 }]}
              vRef={{
                i: scan.presets[0] ? stopIndex(scan.presets[0]) : 0,
                label: '参数越紧越好 = 过拟合信号',
              }}
              markers={scan.presets
                .filter((l) => stopIndex(l) !== lastI)
                .map((l) => ({
                  i: stopIndex(l),
                  value: l.pnl,
                  text: `${Math.round(l.pct * 100)}%`,
                  tone: l.fdr ? ('up' as const) : ('down' as const),
                }))}
              endLabel={
                lastPreset
                  ? { value: lastPreset.pnl, text: '20%' }
                  : { value: scan.actualPnl, text: '实际' }
              }
            />
            <details className="fold-block">
              <summary>
                {passedStops.length ? `${passedStops.length} 档通过 FDR` : '五档预设全部未通过 FDR'}
              </summary>
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
                  {scan.presets.map((l) => (
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
              : `${ruleN} 条可计算规则全部未通过 FDR → 没有可信的退出规则`
          }
          hint={space.ruleReplay.note}
        />
        <details className="fold-block">
          <summary>{space.ruleReplay.bestPreset ? '通过档与其余回放' : '各规则均未通过，查看回放表'}</summary>
          <table className="grid trips">
            <thead>
              <tr>
                <th>规则</th>
                <th>回放合计</th>
                <th>相对实际</th>
                <th>触及</th>
                <th>FDR</th>
              </tr>
            </thead>
            <tbody>
              {space.ruleReplay.rules.map((r) => (
                <tr key={r.id} className={r.computable && r.fdr ? '' : 'low-n'}>
                  <td>{r.label}</td>
                  <td>{r.computable ? money(r.pnl) : '无法计算'}</td>
                  <td>{r.computable ? money(r.delta) : '—'}</td>
                  <td>{r.computable ? `${r.nTriggered}/${r.nEligible}` : '需要分时'}</td>
                  <td>{!r.computable ? '—' : r.fdr ? '通过' : '未通过'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </article>

      <article className="panel" id="opp-cost">
        <h3>机会成本</h3>
        {bh || spy ? (
          <>
            <Scan
              text={
                beatByHold
                  ? `同期拿着不动都比你强 · 差 ${money(bh!.delta)}${bh?.deltaCi ? `（${ciMoney(bh.deltaCi)}）` : ''}`
                  : `同期持有对照差 ${bh ? money(bh.delta) : spy ? money(spy.delta) : '—'}`
              }
              hint={space.oppCost.note}
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
    </div>
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
