// 统一资产/事件模型共享工具。
// 关键约定：事件「唯一身份」与「内容指纹」分离——
// - eventUid         唯一事件身份，用于生命周期回指（linkedEventId）与去重。
// - eventFingerprint 内容指纹，仅用于「疑似重复候选」检测，不作为身份。
// 两笔内容完全相同的合法成交指纹相同、uid 不同，不能被合并。

/** FNV-1a 32 位哈希，输出 8 位 hex。非加密，仅用于本地指纹/哈希。 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 内容指纹：字段一致则指纹一致。仅用于重复候选检测，不是唯一身份。 */
export function eventFingerprint(args: {
  timeMs: number
  symbol: string
  side: string
  qty: number
  price: number
  fees: number
}): string {
  const norm = (n: number) => (Number.isFinite(n) ? n : 0)
  const parts = [
    String(Math.round(args.timeMs)),
    args.symbol,
    args.side,
    String(norm(args.qty)),
    String(norm(args.price)),
    String(norm(args.fees)),
  ]
  return fnv1a(parts.join('|'))
}

/** 源文件哈希：对整份文本做 FNV-1a，用于无券商成交 ID 时生成稳定唯一身份。 */
export function sourceFileHash(text: string): string {
  return fnv1a(text)
}

/**
 * 事件唯一身份，生成优先级：
 * 1. uuid（调用方已持久化）
 * 2. broker + account + brokerExecutionId（有券商成交 ID）
 * 3. sourceHash + rowIndex（无券商成交 ID，重复导入同一文件不重复记账）
 */
export function makeEventUid(args: {
  uuid?: string
  broker?: string
  account?: string
  brokerExecutionId?: string
  sourceHash?: string
  rowIndex?: number
}): string {
  if (args.uuid) return args.uuid
  if (args.brokerExecutionId) {
    return `broker:${args.broker ?? ''}:${args.account ?? ''}:${args.brokerExecutionId}`
  }
  return `row:${args.sourceHash ?? '0'}:${args.rowIndex ?? 0}`
}
