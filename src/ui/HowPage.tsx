import { money, pctPlain } from '../lib/format.ts'
import type { CoverReport } from '../engine/cover.ts'
import type { Diagnosis } from '../engine/diagnose.ts'
import type { RoundTrip, SpaceReport } from '../types.ts'
import { isDay4Shadow, isMisalignedHoldExperiment, type ExperimentRecord } from '../lib/experiments.ts'
import { SpaceEvidence, SpaceOppCost, SpaceRef } from './SpacePanel.tsx'
import { CapabilityMatrix } from './WhatPage.tsx'
import { ExperimentCard } from './ExperimentCard.tsx'
import {
  EvidenceLadder,
  HowMetricCards,
  HowXyScatter,
  QueueList,
  SampleShareBar,
  ScatterLegend,
} from './howCharts.tsx'
import {
  evidenceLadder,
  givebackConcentration,
  givebackPoints,
  holdBandStats,
  holdScatterPoints,
  jitterRate,
  sampleComposition,
  tripsInSlice,
  type SampleSlice,
} from './howViz.ts'

export function HowPage(props: {
  cover: CoverReport
  space: SpaceReport
  diagnoses: Diagnosis[]
  trips: RoundTrip[]
  claimedIds: string[]
  active: ExperimentRecord[]
  archived: ExperimentRecord[]
  onClaim: (d: Diagnosis) => void
  onChange: () => void
  onOpenHealth: () => void
  onFillAccount: () => void
  onOpenTrip?: (id: string) => void
  onOpenTrips?: (id: string, label: string, trips: RoundTrip[]) => void
  accountLimited?: boolean
}) {
  const { cover, space } = props
  const gb = space.giveback
  const verifiedAmt = Math.max(
    0,
    ...cover.queue.filter((r) => r.status === 'verified').map((r) => r.recoverable ?? 0),
  )
  const holdRow = cover.queue.find((r) => r.id === 'hold-h3')
  const giveRow = cover.queue.find((r) => r.id === 'giveback')
  const oppRow = cover.queue.find((r) => r.id === 'opp-cost')
  const day4 = props.active.find((e) => isDay4Shadow(e.constraint))
  const misaligned = props.active.find((e) => isMisalignedHoldExperiment(e.constraint))
  const mainExp = day4 ?? misaligned ?? props.active[0] ?? null
  const holdDx = holdRow?.diagnosisId ? props.diagnoses.find((d) => d.id === holdRow.diagnosisId) : undefined
  const rejected = cover.queue.filter((r) => r.status === 'rejected')
  const cands = cover.queue.filter((r) => r.id === 'intraday')
  const mainQueue = cover.queue.filter((r) => r.status !== 'rejected' && r.id !== 'intraday' && r.status !== 'reference')
  const shadowN = day4?.lastEvaluation?.shadowN ?? 0
  const targetN = day4?.targetN ?? 20
  const comp = sampleComposition(props.trips)
  const holdPts = holdScatterPoints(props.trips)
  const holdBands = holdBandStats(props.trips)
  const gbPts = givebackPoints(props.trips)
  const gbConc = givebackConcentration(gbPts)
  const ladder = evidenceLadder({
    hasHoldFinding: Boolean(holdRow),
    replayPassed: Boolean(space.stopScan?.bestPreset || space.ruleReplay.bestPreset),
    shadowN,
    targetN,
    verified: verifiedAmt > 0,
  })

  const claim = (id: string) => {
    const d = props.diagnoses.find((x) => x.id === id)
    if (d) props.onClaim(d)
  }

  const openSlice = (slice: SampleSlice) => {
    const list = tripsInSlice(props.trips, slice)
    const label =
      slice === 'floated' ? '回吐分析有效' : slice === 'pathNoFloat' ? '有路径但无浮盈' : '无法估计路径'
    props.onOpenTrips?.(slice, label, list)
  }

  const nowDo = misaligned
    ? '把当前实验修正为第 4 个交易日收盘退出'
    : mainExp && isDay4Shadow(mainExp.constraint)
      ? '继续记录第 4 个交易日收盘退出的影子结果'
      : holdDx?.canClaim
        ? '认领第 4 个交易日收盘退出影子实验'
        : '继续观察长持仓，不要改真实退出'

  return (
    <div className="how-page print-section">
      <HowMetricCards
        theory={giveRow?.recoverable ?? (gb.nPath > 0 && gb.nFloated >= 5 ? gb.sumDollar : null)}
        verified={verifiedAmt}
        shadowN={shadowN}
        targetN={targetN}
        floated={comp.floated}
        nClosed={comp.nClosed}
        waiting={!day4 || shadowN === 0}
        pendingReplace={Boolean(misaligned && !day4)}
        idle={!mainExp}
      />
      <div className="how-shell">
        <div className="how-main">
          <section className="how-hero" id="space">
            <p className="how-k">当前没有已验证可直接上线的修复规则</p>
            <p className="how-lead-body">{cover.howLead}</p>
          </section>

          <section className="how-action" id="action">
            <h2 className="review-sec">现在做什么</h2>
            <article className="panel how-today">
              <h3>当前没有已验证、可直接上线的退出规则</h3>
              <ul className="how-today-list">
                <li>
                  <b>现在做：</b>
                  {nowDo}
                </li>
                <li>
                  <b>暂时不要做：</b>直接启用 2%～20% 硬止损
                </li>
              </ul>
              {!mainExp && holdDx?.canClaim ? (
                <button type="button" className="btn-primary" onClick={() => props.onClaim(holdDx)}>
                  开始第 4 个交易日收盘影子实验
                </button>
              ) : null}
            </article>
            <EvidenceLadder steps={ladder} />
            <SampleShareBar comp={comp} onPick={openSlice} />
          </section>

          <section>
            <h2 className="review-sec">候选修复队列</h2>
            <p className="tiny">金额条表示相对影响大小。斜纹 = 机械反事实，不是进度条。绿 = 已验证。</p>
            <QueueList rows={mainQueue} claimedIds={props.claimedIds} onClaim={claim} />
          </section>

          {holdPts.length ? (
            <article className="panel" id="hold-scatter">
              <h3>持仓时长 × 单笔盈亏</h3>
              <p className="tiny">
                横轴为持仓时长（对数刻度）。第 4 日收盘是实验退出点；浅红区是持仓 ≥5 日的历史问题区域。只展示历史关联，不能证明第 4
                日退出一定有效。
              </p>
              <ScatterLegend />
              <div className="how-hold-wrap">
                <HowXyScatter
                  points={holdPts}
                  logX
                  vRef={4}
                  vRefLabel="第4日收盘"
                  shadeFrom={5}
                  shadeLabel="≥5 日问题区"
                  xLabel="持仓时长（对数刻度）"
                  yLabel="单笔盈亏"
                  xFormat={(v) => (v < 1 ? `${Math.max(1, Math.round(v * 24))}h` : `${Math.round(v)}d`)}
                  yFormat={money}
                  callouts={holdPts
                    .filter((p) => Math.abs(p.y) > 500)
                    .sort((a, b) => Math.abs(b.y) - Math.abs(a.y))
                    .slice(0, 4)
                    .map((p) => ({ id: p.id, text: `${p.symbol} ${money(p.y)}` }))}
                  onPick={props.onOpenTrip}
                />
                {holdPts.filter((p) => Math.abs(p.y) <= 500).length >= 8 ? (
                  <div className="how-hold-inset">
                    <p className="tiny">局部 −$500～+$500 · n={holdPts.filter((p) => Math.abs(p.y) <= 500).length}</p>
                    <HowXyScatter
                      points={holdPts.filter((p) => Math.abs(p.y) <= 500)}
                      logX
                      yMin={-500}
                      yMax={500}
                      vRef={4}
                      vRefLabel="第4日"
                      shadeFrom={5}
                      height={132}
                      xLabel="持仓时长"
                      yLabel="单笔盈亏"
                      xFormat={(v) => (v < 1 ? `${Math.max(1, Math.round(v * 24))}h` : `${Math.round(v)}d`)}
                      yFormat={money}
                      onPick={props.onOpenTrip}
                    />
                  </div>
                ) : null}
              </div>
              <ul className="tiny plain-facts">
                {holdBands.map((b) => (
                  <li key={b.id}>
                    {b.label}：n={b.n}，合计 {money(b.pnl)}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {gbPts.length ? (
            <article className="panel" id="giveback-scatter">
              <div className="how-gb-hd">
                <div>
                  <h3>最大浮盈 × 回吐比例</h3>
                  <p className="tiny">最大浮盈 MFE（美元，对数刻度）。横虚线是回吐率中位数，不是可达收益。</p>
                  <ScatterLegend />
                </div>
                {gbConc.top5Share != null && gbConc.top5Share >= 0.5 ? (
                  <aside className="how-conc-card">
                    <b>回吐高度集中</b>
                    <p>前 {gbConc.top5.length} 笔贡献理论回吐的 {pctPlain(gbConc.top5Share, 0)}</p>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        const ordered = gbConc.top5
                          .map((p) => props.trips.find((t) => t.id === p.id))
                          .filter((t): t is RoundTrip => Boolean(t))
                        props.onOpenTrips?.('giveback-top5', '理论回吐前 5 笔', ordered)
                      }}
                    >
                      查看这 {gbConc.top5.length} 笔交易
                    </button>
                  </aside>
                ) : null}
              </div>
              <HowXyScatter
                points={gbPts.map((p) => ({
                  id: p.id,
                  x: p.x,
                  y: jitterRate(p.id, p.y),
                  up: p.up,
                  size: Math.max(4, Math.min(12, Math.sqrt(Math.max(p.dollar, 1)) / 14)),
                  label: p.label,
                }))}
                logX
                opacity={0.68}
                hRef={gbConc.medianRate ?? undefined}
                hRefLabel={gbConc.medianRate == null ? undefined : `回吐率中位数：${pctPlain(gbConc.medianRate, 0)}`}
                xLabel="最大浮盈 MFE（美元，对数刻度）"
                yLabel="回吐率"
                xFormat={money}
                yFormat={(v) => pctPlain(v, 0)}
                onPick={props.onOpenTrip}
              />
              <p className="tiny">回吐率 ≥80% 的交易 {gbConc.highN} 笔。100% 附近做了轻微纵向抖动，悬停仍显示真实回吐率。</p>
            </article>
          ) : null}

          {rejected.length ? (
            <details className="fold-block how-block" id="how-rejected">
              <summary>暂不采用（{rejected.length}）</summary>
              <QueueList rows={rejected} claimedIds={props.claimedIds} onClaim={claim} />
            </details>
          ) : null}

          <details className="fold-block how-block" id="space-evidence">
            <summary>参考证据 · 敏感性 / 硬止损 / 规则回放</summary>
            <SpaceEvidence space={space} />
          </details>

          {cands.length ? (
            <section>
              <h2 className="review-sec">候选假设（未认领）</h2>
              <QueueList rows={cands} claimedIds={props.claimedIds} onClaim={claim} />
            </section>
          ) : null}

          {oppRow ? (
            <section>
              <h2 className="review-sec">决策参考</h2>
              <p className="tiny">{oppRow.finding}</p>
              <SpaceOppCost space={space} />
            </section>
          ) : null}

          <details className="fold-block how-block" id="how-ref">
            <summary>Kelly / 方向混杂 / 数据解锁</summary>
            <SpaceRef space={space} />
            <article className="panel" id="fill-data">
              <h3>数据解锁</h3>
              <CapabilityMatrix gaps={cover.gaps} onFillAccount={props.onFillAccount} onGuide={props.onOpenHealth} />
              {props.accountLimited ? <p className="tiny">账户级基准比较缺数据，补期初净资产后再看机会成本的资金占用口径。</p> : null}
            </article>
          </details>

          {props.archived.length ? (
            <details className="fold-block">
              <summary>已结束的实验</summary>
              {props.archived.map((row) => (
                <ExperimentCard key={row.id} row={row} kicker={row.closeKind === 'cancel' ? '已取消' : '已结案'} />
              ))}
            </details>
          ) : null}
        </div>

        <aside className="how-rail print-hide">
          <h2 className="review-sec">当前实验</h2>
          {mainExp ? (
            <ExperimentCard
              row={mainExp}
              diagnosisId={holdDx?.id}
              onChange={props.onChange}
              onOpenTrip={props.onOpenTrip}
              compact
            />
          ) : (
            <p className="tiny">还没有进行中的影子实验。</p>
          )}
        </aside>
      </div>
    </div>
  )
}
