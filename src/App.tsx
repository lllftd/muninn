import { useCallback, useState } from 'react'
import { assembleBook } from './engine/book.ts'
import { importFutu } from './engine/futu.ts'
import { REAL_FILLS_CSV, REAL_ORDERS_CSV } from './fixtures/sampleBook.ts'
import { fetchQuotes } from './quotes/client.ts'
import { Dashboard } from './ui/Dashboard.tsx'
import { Landing } from './ui/Landing.tsx'
import { etDateKey } from './lib/time.ts'
import { METRIC_VERSION } from './types.ts'
import type { Book } from './types.ts'

const STAGES = ['正在校验现金流', '正在重建账户日收益', '正在对齐基准和无风险利率', '正在运行 Bootstrap']

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function App() {
  const [book, setBook] = useState<Book | null>(null)
  const [busy, setBusy] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runUpload = useCallback(
    async (args: {
      fillText: string
      orderText: string
      cashText: string
      accountName: string
      initialCapital: number | null
      cashflowComplete: boolean
      isSample?: boolean
    }) => {
      const replacing = book != null
      setBusy(true)
      setUpdating(replacing)
      setError(null)
      try {
        setStage(STAGES[0])
        await sleep(160)
        const imported = importFutu(args.fillText, args.orderText)
        const symbols = [...new Set(imported.fills.map((f) => f.symbol))]
        const times = imported.fills.map((f) => f.time.getTime()).filter((n) => Number.isFinite(n))
        const min = times.length ? new Date(Math.min(...times)) : new Date('2020-01-01')
        const max = times.length ? new Date(Math.max(...times)) : new Date()
        const start = new Date(min.getTime() - 400 * 86400000).toISOString().slice(0, 10)
        const end = etDateKey(max)
        setStage(STAGES[1])
        await sleep(120)
        setStage(STAGES[2])
        const quotes = await fetchQuotes(symbols, start, end)
        setStage(STAGES[3])
        await sleep(80)
        const next = assembleBook({
          fillText: args.fillText,
          orderText: args.orderText,
          cashText: args.cashText,
          accountName: args.accountName,
          initialCapital: args.initialCapital && args.initialCapital > 0 ? args.initialCapital : null,
          quotes,
          cashflowComplete: args.cashflowComplete,
          isSample: !!args.isSample,
        })
        setBook(next)
        setStage(`计算完成 · 口径版本 ${METRIC_VERSION}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : '分析失败')
        if (!book) setStage(null)
        else setStage('部分模块更新失败，已保留上一份结果')
      } finally {
        setBusy(false)
        setUpdating(false)
      }
    },
    [book],
  )

  const loadRealSample = useCallback(() => {
    void runUpload({
      fillText: REAL_FILLS_CSV,
      orderText: REAL_ORDERS_CSV,
      cashText: '',
      accountName: '保证金综合账户 5185',
      initialCapital: null,
      cashflowComplete: false,
      isSample: true,
    })
  }, [runUpload])

  if (!book) {
    return (
      <Landing
        busy={busy}
        stage={stage}
        error={error}
        onSample={loadRealSample}
        onSubmit={runUpload}
      />
    )
  }

  return (
    <Dashboard
      book={book}
      stage={stage}
      updating={updating}
      onReset={() => {
        setBook(null)
        setStage(null)
        setError(null)
      }}
      onSample={loadRealSample}
    />
  )
}
