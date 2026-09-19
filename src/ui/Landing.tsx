import { useRef, useState, type ReactNode } from 'react'
import { CASH_TEMPLATE, FILL_TEMPLATE, ORDER_TEMPLATE } from '../fixtures/sampleBook.ts'
import { detectKind } from '../lib/csv.ts'
import { importFutu } from '../engine/futu.ts'
import { Brand, ThemeToggle } from './chrome.tsx'
import type { ImportResult } from '../types.ts'

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function excludedCsv(imported: ImportResult): string {
  const rows = ['time,symbol,name,reason,qty']
  for (const row of imported.excludedRows) {
    rows.push(`${row.time},${row.symbol},${JSON.stringify(row.name)},${row.reason},${row.qty}`)
  }
  return `${rows.join('\n')}\n`
}

function Drop(props: {
  title: string
  hint: string
  required?: boolean
  file: File | null
  status?: string | null
  onFile: (f: File) => void
  onReplace?: () => void
  extra?: ReactNode
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${props.file ? 'has' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) props.onFile(f)
      }}
    >
      {props.file ? (
        <div className="drop-status">
          <div className="drop-title">✓ {props.file.name}</div>
          {props.status ? <div className="drop-hint">{props.status}</div> : null}
          {props.extra}
          <div className="drop-actions">
            <button type="button" className="link" onClick={() => inputRef.current?.click()}>
              更换文件
            </button>
            {props.onReplace ? (
              <button type="button" className="link" onClick={props.onReplace}>
                清除
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <button type="button" className="drop-empty" onClick={() => inputRef.current?.click()}>
          <div className="drop-ico" aria-hidden>
            CSV
          </div>
          <div className="drop-title">{props.title}</div>
          <div className="drop-hint">{props.hint}</div>
          <div className="drop-cta">{props.required ? '必填 · 支持 CSV' : '可选 · 支持 CSV'}</div>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) props.onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export function Landing(props: {
  busy: boolean
  stage?: string | null
  error: string | null
  onSample: () => void
  onSubmit: (args: {
    fillText: string
    orderText: string
    cashText: string
    accountName: string
    initialCapital: number | null
    cashflowComplete: boolean
  }) => void
}) {
  const fillPick = useRef<HTMLInputElement>(null)
  const [fills, setFills] = useState<File | null>(null)
  const [orders, setOrders] = useState<File | null>(null)
  const [fillText, setFillText] = useState('')
  const [orderText, setOrderText] = useState('')
  const [imported, setImported] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [accountName, setAccountName] = useState('')
  const [capital, setCapital] = useState('')
  const [cashText, setCashText] = useState('')
  const [cashFile, setCashFile] = useState<File | null>(null)
  const [noExternalCf, setNoExternalCf] = useState(false)
  const accountFold = useRef<HTMLDetailsElement>(null)

  const refreshImport = (nextFill: string, nextOrder: string) => {
    if (!nextFill.trim()) {
      setImported(null)
      return
    }
    try {
      const result = importFutu(nextFill, nextOrder)
      setImported(result)
      setParseError(result.fills.length ? null : '成交文件里没有可用的美股正股记录。')
    } catch (err) {
      setImported(null)
      setParseError(err instanceof Error ? err.message : '无法识别这份成交记录')
    }
  }

  const takeFile = async (file: File, slot?: 'fills' | 'orders' | 'cash') => {
    const text = await file.text()
    const kind = slot || detectKind(text)
    if (kind === 'orders') {
      setOrders(file)
      setOrderText(text)
      refreshImport(fillText, text)
      return
    }
    if (kind === 'cash') {
      setCashFile(file)
      setCashText(text)
      setNoExternalCf(false)
      if (accountFold.current) accountFold.current.open = true
      return
    }
    setFills(file)
    setFillText(text)
    refreshImport(text, orderText)
  }

  const fillReady = Boolean(imported && imported.fills.length)
  const excluded = imported ? imported.excludedRows.length : 0
  const matched = imported && orders ? Math.max(imported.fills.length - imported.feeUnmatched, 0) : 0
  const initial = capital.trim() ? Number(capital.replace(/,/g, '')) : null
  const cashflowComplete = noExternalCf || Boolean(cashText.trim())

  return (
    <div className="landing">
      <div className="landing-top">
        <Brand />
        <ThemeToggle />
      </div>
      <div className="hero-copy">
        <h1>把交易还原清楚，把结果看明白。</h1>
        <div className="hero-actions">
          <button type="button" className="btn-primary" onClick={() => fillPick.current?.click()} disabled={props.busy}>
            选择成交记录
          </button>
          <button type="button" className="ghost" onClick={props.onSample} disabled={props.busy}>
            {props.busy ? props.stage || '正在分析…' : '查看样本账本'}
          </button>
        </div>
        <p className="hero-note">仅在浏览器本地处理 · 成交记录必填 · 订单历史可选</p>
        <input
          ref={fillPick}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void takeFile(f, 'fills')
            e.target.value = ''
          }}
        />
      </div>

      <section className="upload-card">
        <div className="card-k">导入交易记录</div>
        <div className="card-d">成交记录必填，订单历史可选；文件仅在浏览器本地处理。</div>
        <div className="drops">
          <Drop
            title="拖入 History Transactions CSV"
            hint="或点击选择文件"
            required
            file={fills}
            status={
              imported
                ? `已识别 ${imported.rawCount} 行 · ${imported.fills.length} 行有效 · ${excluded} 行被排除${
                    imported.dripKept ? ` · ${imported.dripKept} 笔分红再投资已保留` : ''
                  }`
                : null
            }
            extra={
              imported && excluded ? (
                <button type="button" className="link" onClick={() => download('excluded_rows.csv', excludedCsv(imported))}>
                  查看排除明细
                </button>
              ) : null
            }
            onFile={(f) => void takeFile(f)}
            onReplace={() => {
              setFills(null)
              setFillText('')
              setImported(null)
              setParseError(null)
            }}
          />
          <Drop
            title="拖入 Order History CSV"
            hint="或点击选择文件 · 用于补全 Filled 订单费用"
            file={orders}
            status={
              imported && orders
                ? `匹配 ${matched} 笔成交 · ${imported.feeUnmatched} 笔未匹配`
                : '可选 · 用于补全 Filled 订单费用'
            }
            extra={
              imported && orders && imported.feeUnmatched ? (
                <span className="drop-hint">未匹配费用按缺失处理，不会估成零。</span>
              ) : null
            }
            onFile={(f) => void takeFile(f, 'orders')}
            onReplace={() => {
              setOrders(null)
              setOrderText('')
              if (fillText) refreshImport(fillText, '')
            }}
          />
        </div>

        {imported ? (
          <div className="validate-strip">
            <span>已识别 {imported.rawCount} 条成交记录</span>
            <span>
              保留 {imported.fills.length} 条，排除 {excluded} 条
            </span>
            {orders ? (
              <span>
                订单费用匹配率{' '}
                {imported.fills.length ? `${Math.round((matched / imported.fills.length) * 100)}%` : '—'}
              </span>
            ) : (
              <span>尚未提供订单历史，费用按缺失处理</span>
            )}
          </div>
        ) : null}

        <details className="account-fold" ref={accountFold}>
          <summary>账户设置与外部入出金</summary>
          <label>
            期初净资产（USD）
            <input
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              placeholder="可选。不填也能算正股盯市盈亏；填了才算账户 TWR"
              inputMode="decimal"
            />
            <span className="field-note">留空则按美股正股成交还原盯市盈亏。费用用订单里匹配到的部分，缺的不估成 0，也不挡住计算。</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={noExternalCf}
              onChange={(e) => {
                setNoExternalCf(e.target.checked)
                if (e.target.checked) {
                  setCashText('')
                  setCashFile(null)
                }
              }}
            />
            分析期间确认没有外部入出金
          </label>
          <div className="cash-block">
            <div className="cash-k">补充外部入出金（可选）</div>
            <p className="field-note">缺失不等于零。未确认完整时 XIRR 显示 N/A。</p>
            <Drop
              title="拖入出入金 CSV"
              hint="或点击选择文件"
              file={cashFile}
              status={cashFile ? `${cashText.trim().split('\n').length - 1} 行` : null}
              onFile={(f) => void takeFile(f, 'cash')}
              onReplace={() => {
                setCashFile(null)
                setCashText('')
              }}
            />
            <label className="cash">
              或粘贴 CSV 内容
              <textarea
                rows={3}
                value={cashText}
                onChange={(e) => {
                  setCashText(e.target.value)
                  if (e.target.value.trim()) setNoExternalCf(false)
                }}
                placeholder="time,type,amount&#10;2024-03-01T09:00:00,deposit,25000"
                disabled={noExternalCf}
              />
            </label>
          </div>
          <label>
            账户名称（可选，不影响核算）
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="例如 保证金综合账户" />
          </label>
        </details>

        <div className="upload-foot">
          <button
            type="button"
            className="btn-primary"
            disabled={!fillReady || props.busy}
            onClick={() =>
              props.onSubmit({
                fillText,
                orderText,
                cashText: noExternalCf ? '' : cashText,
                accountName: accountName.trim() || '我的美股正股账户',
                initialCapital: initial && Number.isFinite(initial) && initial > 0 ? initial : null,
                cashflowComplete,
              })
            }
          >
            {props.busy ? props.stage || '正在分析…' : '开始分析'}
          </button>
        </div>
        <div className="row-links">
          <button type="button" className="link" onClick={() => download('History_Transactions.csv', FILL_TEMPLATE)}>
            成交模板
          </button>
          <button type="button" className="link" onClick={() => download('Order_History.csv', ORDER_TEMPLATE)}>
            订单模板
          </button>
          <button type="button" className="link" onClick={() => download('cashflows.csv', CASH_TEMPLATE)}>
            出入金模板
          </button>
        </div>
        <div className="range-row">
          <div>
            <b>分析范围：美股普通股</b>
            <p>其他资产会列入排除明细，不会静默计入账户收益。分红再投资保留在核算账本，不计入主动交易质量。</p>
          </div>
          <details className="scope">
            <summary>查看支持范围</summary>
            <p>保留：美股普通股，含做空与 T+0。DRIP / 不足 0.5 股保留为分红再投资。</p>
            <p>排除：期权、ETF / 基金、A 股、日股及其他非美股市场，可下载排除明细。</p>
          </details>
        </div>
        {parseError ? <p className="error">{parseError}</p> : null}
        {props.error ? <p className="error">{props.error}</p> : null}
      </section>

      <ol className="steps">
        <li>
          <b>01 核算引擎</b>
          把成交还原成 FIFO 账本和持仓片段，先对清楚账。
        </li>
        <li>
          <b>02 绩效测量</b>
          数据齐全时计算账户收益、基准和风险；缺什么就标成缺失。
        </li>
        <li>
          <b>03 复盘诊断</b>
          看交易质量和行为观察，不给买卖或仓位建议。
        </li>
        <li>
          <b>04 可信度评估</b>
          看样本够不够、结果敏不敏感，避免把描述当成可外推结论。
        </li>
      </ol>
    </div>
  )
}
