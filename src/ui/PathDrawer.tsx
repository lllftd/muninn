import { DualPath } from './charts.tsx'
import { clsPnl, holdLabel, money, pct, signed } from '../lib/format.ts'
import { etDateKey } from '../lib/time.ts'
import type { Bar, RoundTrip } from '../types.ts'

export function PathDrawer(props: {
  trip: RoundTrip
  bars: Bar[] | undefined
  onClose: () => void
}) {
  const { trip } = props
  const start = etDateKey(trip.openTime)
  const end = etDateKey(trip.closeTime || trip.openTime)
  const window = (props.bars || []).filter((b) => b.date >= start && b.date <= end)
  const dir = trip.side === 'long' ? 1 : -1
  const altPx = trip.mfePrice
  const altPnl = altPx != null ? (altPx - trip.openPrice) * trip.qty * dir - trip.fees : null
  const last = window.at(-1)
  const pathNa = trip.maePct == null || trip.mfePct == null

  return (
    <aside className="drawer">
      <button type="button" className="drawer-close" onClick={props.onClose}>
        关闭
      </button>
      <div className="drawer-k">
        {trip.pathQuality === 'daily_estimate'
          ? '日线估算路径 · 不代表真实盘中持仓顺序'
          : trip.sameDay
            ? '同日往返：日线高低可能发生在持仓外，MAE/MFE 为 N/A'
            : '无日线，路径指标为缺失'}
      </div>
      {pathNa ? (
        <p className="muted">日线估算 MAE / MFE / 捕获率：N/A</p>
      ) : (
        <DualPath
          closes={window.map((b) => ({ date: b.date, close: b.close, high: b.high, low: b.low }))}
          openPx={trip.openPrice}
          closePx={trip.closePrice}
          mae={trip.maePrice}
          mfe={trip.mfePrice}
        />
      )}
      {last && !pathNa ? (
        <div className="ohlc">
          <span>{last.date.slice(5)}</span>
          <span>high {last.high.toFixed(2)}</span>
          <span>low {last.low.toFixed(2)}</span>
          <span>收盘 {last.close.toFixed(2)}</span>
        </div>
      ) : null}

      <div className="dual-slots">
        <div className="slot">
          <div className="slot-h">槽 A · 实际</div>
          <div className={clsPnl(trip.realizedPnl)}>{money(trip.realizedPnl)}</div>
          <div className="muted">{trip.closePrice ? trip.closePrice.toFixed(2) : '未平'}</div>
        </div>
        <div className="slot">
          <div className="slot-h">槽 B · 日线估算 MFE</div>
          <div className={altPnl != null ? clsPnl(altPnl) : ''}>{altPnl != null ? money(altPnl) : 'N/A'}</div>
          <div className="muted">{altPx != null ? altPx.toFixed(2) : 'N/A'}</div>
        </div>
      </div>

      <dl className="kv">
        <div>
          <dt>开仓</dt>
          <dd>
            {trip.openTime.toLocaleString('zh-CN', { hour12: false })} @ {trip.openPrice.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt>净盈亏</dt>
          <dd className={clsPnl(trip.realizedPnl)}>{money(trip.realizedPnl, 2)}</dd>
        </div>
        <div>
          <dt>日线估算 MAE</dt>
          <dd>{trip.maePct == null ? 'N/A' : `${pct(trip.maePct)} @ ${trip.maePrice?.toFixed(2)}`}</dd>
        </div>
        <div>
          <dt>日线估算 MFE</dt>
          <dd>{trip.mfePct == null ? 'N/A' : `${pct(trip.mfePct)} @ ${trip.mfePrice?.toFixed(2)}`}</dd>
        </div>
        <div>
          <dt>日线估算捕获</dt>
          <dd>{trip.captureRate != null ? pct(trip.captureRate) : 'N/A'}</dd>
        </div>
        <div>
          <dt>回吐 / 恢复</dt>
          <dd>
            {trip.givebackRate != null ? pct(trip.givebackRate) : 'N/A'} / {trip.recoveryRate != null ? pct(trip.recoveryRate) : 'N/A'}
          </dd>
        </div>
        <div>
          <dt>当日区间事后位置</dt>
          <dd>{trip.executionLocation != null ? pct(trip.executionLocation, 0) : 'N/A'}</dd>
        </div>
        <div>
          <dt>ATR标准化盈亏</dt>
          <dd>{trip.rMultiple != null ? `${signed(trip.rMultiple)}R` : '—'}</dd>
        </div>
        <div>
          <dt>持仓</dt>
          <dd>{holdLabel(trip.holdMinutes)}</dd>
        </div>
      </dl>
      <p className="tiny">
        根据日线 OHLC 估算，不代表真实盘中持仓路径；开仓日和退出日的极值可能发生在持仓区间之外。当日区间事后位置不是滑点，不从盈亏中扣除。
      </p>
    </aside>
  )
}
