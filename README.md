# Muninn · 交易复盘与绩效分析

把券商导出的成交记录丢进去,重建每一笔往返交易,拉取行情,算出一整套**经得起追问**的量化绩效 —— 并且诚实标注每个数字的口径、覆盖范围和样本可信度。

不是记账工具。它要回答的是:**「我这套交易到底行不行?哪里在漏钱?这个成绩是真本事还是运气 / 靠一两单撑起来的?」**

> 全程仅在浏览器本地处理,成交数据不出本机、不上传服务器。

---

## 快速开始

```bash
npm install
npm run dev        # 本地开发,固定端口 43127(strictPort)
npm run build      # tsc -b && vite build,产物在 dist/
npm run preview    # 预览构建产物,端口 43127
npm test           # vitest 单测
npm run lint       # oxlint
```

打开后可以直接点「查看样本账本」用内置真实脱敏数据体验,或上传自己的 CSV。

---

## 支持的导入

按 **CSV 表头自动识别**券商,无需手动选择:

| 券商 | 成交记录 | 费用来源 |
|------|----------|----------|
| 富途 / Moomoo | History Transactions | 需配合 Order History 补全 Filled 费用 |
| 盈透 IB | Trades(Flex / Portal 两种格式) | 成交里已含佣金 |
| 老虎证券 | 成交记录导出 | 成交里已含佣金 |
| 通用 | 任意带「代码 / 方向 / 数量 / 价格 / 时间」列的成交表 | 视表头而定 |

**成交记录必填,订单 / 费用明细可选。** 目前只分析美股正股与 ETF —— 非美市场、期权、基金、碎股会被识别并列入「已排除」,不混进绩效口径。

---

## 它算什么

**交易层(不需要期初净资产就能算)**
- 两套独立的往返交易重建口径互相对拍:**FIFO**(逐笔先进先出)与 **Episode**(持仓事件聚合)
- 用日线回放每笔持仓的路径:MAE / MFE、capture / giveback、追高分位、疑似拆股检测
- 胜率、期望、盈亏比、Profit Factor、R 倍数、ATR 归一 —— 全部带 **Bootstrap 置信区间**

**账户层(需要填期初净资产)**
- TWR、XIRR(含状态诊断:无根 / 多根 / 数据不足)
- 对 SPY 全收益(缺失时退回 SPX 价格)的 **alpha–beta 回归**,带一致性校验
- 回撤 / Ulcer / Sharpe / Sortino / Calmar,无风险利率取自内置 DTB3 数据

**行为诊断**
- 按时段 / 方向 / 星期 / 持仓时长分组
- 亏损后加仓(tilt)、追高、处置效应
- **敏感性分析**:单笔 / 单日 PnL 集中度、前后半段一致性 → 判断成绩是否被少数交易撑起

**可信度守门**
- 样本量不足时打红条,不让小样本结论冒充统计显著
- 每项指标标注覆盖状态(已导入 / 未提供 / 无法计算),缺失 ≠ 零

当前口径版本:`METRIC_VERSION`(见 `src/types.ts`)。

---

## 架构

```
src/
  engine/      核心计算(纯函数,带单测)
    futu.ts        多券商 CSV 解析、字段映射、品类过滤
    fifo.ts        FIFO 往返交易重建
    episode.ts     Episode 口径重建
    path.ts        日线回放 MAE/MFE、追高、拆股检测
    metrics.ts     TWR/XIRR/alpha/回撤/风险比率/Bootstrap
    checkup.ts     行为分组 + 可信度
    sensitivity.ts 集中度与一致性
    columns.ts     券商表头归一化与字段打分
  lib/         csv / 时间(多券商多时区)/ 格式化 / 统计 / 无风险利率
  ui/          Landing 上传页 · Dashboard · 图表 · 抽屉
  data/        DTB3 无风险利率数据
  quotes/      行情客户端
  fixtures/    样本账本与测试数据
server/ · api/ · netlify/   行情代理(见下)
scripts/gpt56.py            调 gpt-5.6-sol 的命令行助手
```

数据流:`上传 CSV → importFutu 解析 → fetchQuotes 拉行情 → assembleBook 组装 → Dashboard 渲染`(`src/engine/book.ts` 是组装总线)。

---

## 行情与部署

行情走 Yahoo,通过 serverless 代理请求(`api/quotes.ts` 对应 Vercel、`netlify/functions/quotes.mjs` 对应 Netlify),固定美东节点绕开香港节点风控,带 jina 兜底;样本账本另用内置的 `public/sample-quotes.json` 静态行情包,避免部署环境行情源被封 IP。

技术栈:React 19 · TypeScript · Vite · Vitest · oxlint。

---

## `scripts/gpt56.py`

调用 Futu llm-proxy 上 `gpt-5.6-sol` 的命令行助手,密钥从项目根目录 `.env` 读取(`LLM_PROXY_API_KEY` 等,`.env` 已在 `.gitignore` 中):

```bash
python3 scripts/gpt56.py "你的问题"
echo "你的问题" | python3 scripts/gpt56.py
```

---

## 隐私

- 成交与订单数据**只在浏览器本地解析计算**,不上传。
- `.env`、`History Transactions-*.csv`、`Order History-*.csv` 均已在 `.gitignore` 中,不会误推到仓库。
