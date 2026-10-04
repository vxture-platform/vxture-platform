# ADR-013 原始 token 用量按调用方产品接收 · 平台换算 credit · 小数结转

> 状态：✅ Accepted（2026-10-04，owner 四条裁定：2026-09-30 一条 + 2026-10-03 三条）
> 关系：**扩展 ADR-11**（workspace × product 权益引擎、`ai.credit` 单一计量入口）与 product_220 §4.2
> （「ai.credit 仍是 L0 单一 metric/货币/换算基线」），不改变之；**取代** product_220 §4.2 「硬条件：单一计量入口」
> 一句里的「ai.credit 现阶段 = 操作宿主产品 atomic 预扣，终态收敛到 Atlas 统一上报」—— 那句假定 Atlas 自己扣
> `ai.credit`，与 owner 2026-09-30 的裁定相反。对端决策：vxture-atlas `ADR-010`；起因：vxture-platform#547。

---

## 背景

Atlas 是全平台**唯一的推理计量入口**（atlas 200 §1.2），替各产品上报每一次模型调用。它一直发
`POST /usage/consume { product: "atlas", metric: "atlas.chat", amount: totalTokens }`，而 owner 2026-09-23
裁定 L0/L1 不是产品并把 atlas 从 `product.products` 里拔掉（#469/#472），consume 先 `resolveProductId`
⇒ 400 `unknown_product`。**Atlas 的推理用量从未入过账**（生产 332 条记录零入账，2026-10-01 核实），
平台看到的推理用量一直是 0。Atlas 侧照常服务、记自己的 reqlog，所以两边都没报错。

现有 consume 一次只收一个 metric + 一个 amount，幂等键 `(workspace, product, key)`；四维原始 token
进不去；`usage_events` 没有 `occurred_at`，补报历史用原始时间做不到；全仓没有任何 token 指标、也没有
token→credit 的换算表（文档只写了基线「1 credit ≈ 2K tokens」和「各产品自定义费率表」）。

## 决策清单

| #   | 决策           | 结论                                                                                                                                                                                                                                                                                                                                                     | 关键理由                                                                                                                                              |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 归属           | 用量**计入调用方产品**（S2S 令牌 `act.sub`，如 karda / tenderforge），永远不是 atlas。调用方产品必须在目录里（L2/L3）。**Bearer 下的落点是代上报票（2026-10-04 PR C）**：atlas 自己的票 `act.sub = "atlas"` 永远不等于归属产品，所以它持 `delegated: true` 的 `aud=vxture` 票，请求体 `product` 就是归属产品（仍须在目录里，否则 400 `unknown_product`） | owner 2026-09-30「L0/L1 不是产品」；`usage_events` 永远记录花钱方（product_220 §4.2）                                                                 |
| D2  | 载荷形状       | **同一个端点** `POST /usage/consume`，请求体带 `tokens: {input, output, cache_write, cache_read}` + `request_id` + `occurred_at` + `model_code` / `provider_code` + 可选 `reasoning_tokens` / `rerank_candidates` / `parse_pages` / `attempt_index` / `outcome` / `backfill`；与旧形态 `metric`+`amount` 二选一                                          | ADR-11 §11.7 的路径权威不动；单一计量入口字面上仍是一个端点；`scopeToS2sCaller` 的调用点不新增（s2s-legacy-scope 快照的 trust-declared 计数只许减少） |
| D3  | 两层           | 原始事实落 `metering.token_usage_events`（append-only，月分区，按 occurred_at 可查）；换算成 `ai.credit` 后经**现有 consume 引擎**扣池、写 `usage_events`，`event_id` 回给 Atlas                                                                                                                                                                         | 「原始事实一旦没记事后补不回来」；换算规则随时会改，分层才可重算；引擎的幂等 / 瀑布 / 回执全部复用                                                    |
| D4  | 换算是数据     | `metering.token_credit_rates`：供应商 / 模型（NULL=任意）× 生效窗口 × 四维每 1K 单价 + rerank 每候选 / parse 每页。模型精确 > 供应商 > 默认档。**费率行不可改**（改价 = 关旧行窗口 + 插新行），事件记 `rate_id`                                                                                                                                          | owner「换算规则由运营随时调整，Atlas 不做换算」；可复算                                                                                               |
| D5  | 默认档         | 种子一行：2K tokens = 1 credit（product_220 §4.2 基线），四维同价、rerank / parse 为 0                                                                                                                                                                                                                                                                   | 缓存折价、按候选 / 按页计价是商业判断，不在种子里替 owner 定；改一行数据即生效                                                                        |
| D6  | 取整           | **按（工作空间 × 调用方产品）累计小数**：`metering.token_credit_carry` 留微 credit 余额，本次结果加余额，整数走引擎、小数留下                                                                                                                                                                                                                            | owner 2026-10-03「按工作区累计小数」；精确、不多收。键带 product_id 是为了花钱方归因不串                                                              |
| D7  | 补报历史       | **只补原始事实，不扣 credit**（`credit_skip_reason='pre_cutover'`）                                                                                                                                                                                                                                                                                      | owner 2026-10-03；池按月重置，7 月的用量没法扣进 7 月的池，扣进当前月是追溯扣费                                                                       |
| D8  | 失败的尝试     | 故障转移里失败的尝试**只记原始行、不扣客户**（`outcome='failed'`，`credit_skip_reason='failed_attempt'`）                                                                                                                                                                                                                                                | owner 2026-10-03；上游收了钱、客户没拿到结果，平台与运营能看见这笔成本，客户不为没拿到的结果付费                                                      |
| D9  | 没有费率       | 发生时刻找不到生效费率 ⇒ 照记、不扣（`no_rate`）                                                                                                                                                                                                                                                                                                         | 配置缺口不是客户的错；运营补上费率后可按 rate 复算                                                                                                    |
| D10 | 事务边界与自愈 | tx1 提交原始行 + 结转 + 幂等行；tx2 引擎扣减（引擎自开事务）。tx2 失败不抛、记 error；幂等行 `usage_event_id IS NULL AND whole_due > 0` = 待重放，同键再来会再试一次引擎（引擎幂等键挡双扣）                                                                                                                                                             | 引擎自开连接包不进来；原始事实不能因扣减失败而丢；自愈优于人工 replay                                                                                 |
| D11 | C2 读          | Atlas 调用前按**调用方产品**查 `GET /platform/entitlements?workspace_id&product=<caller>`，看 `ai.credit`（平台级共享键，WS 级池对所有产品可见）                                                                                                                                                                                                         | 与 D1 同一根轴                                                                                                                                        |

## 后果

- 平台：四张新表（§6b/§6c/§6d/§8b）、一份迁移（先 migrate 再 deploy）、`ConsumeResponseBody` 多四个可选字段
  （`token_event_id` / `credits_micro` / `credits_deducted` / `credit_skip_reason`），旧形态调用方形状不变。
- Atlas（`ADR-010` 的「平台定下接收方式后」那一半）：改上报载荷、C2 按调用方产品查、`usage_event_id` 落 reqlog、
  按 reqlog 补报历史（`backfill: true`）。**补报「做了没接」（2026-10-04 核）**：平台这一半能收——`backfill:true`
  的行以 `credit_skip_reason='pre_cutover'` 落表、不换算、不扣（`token-usage.service.ts`）；atlas 那一半没发——
  `reportTokens` 全仓两个调用点都不带 `backfill`，它只在 client 透传入参。reqlog 行带 `productCode`，按调用方补报
  可做；要不要补是 owner 的事（L3 分层设计 D11：建议做，只记不扣）。
- **调用方产品必须在目录里**：生产真实调用方 `tenderforge`、`yucer` 都不在 seed 里，要经 opera 产品注册
  （**L3**——它们是智能体，不是 L2；而且它们**早已在生产目录里**，缺的是分层对齐：`layer` / `product_type` 族
  此前没有任何机械链路，2026-10-04 决策 3 起由 `chk_products_layer_type_family` 焊住，迁移
  `2026-12-01-l3-layer-truth.sql` 在矛盾行上停手点名、交运营在 opera 改）登记，否则上报仍是 400
  `unknown_product` —— 这是 owner 的运营动作，不是代码。
- **代上报（E3a 的前置件，平台这一半已落地 2026-10-04 PR C）**：Atlas→平台今天仍走共享口令（legacy），平台
  **验不了**请求体自报的调用方产品码（`trust-declared`，已登记的缺口 E2/E3）。Atlas 换成 Bearer 那天，它自己的
  令牌身份是 atlas 而用量归调用方，`scopeToS2sCaller` 的「只能上报自己产品」会把它拦下——所以要先有一条
  「代上报」的授权形态；owner 2026-10-04 把 E3a（产品面停收旧 header）提前到分层线之后，所以它成了 E3a 的
  前置件：不先落地，产品面一停收旧 header，经 atlas 的全部推理用量上报 401、C2 降级 fail-open，两边都不报错。**已落地的形状（L3 分层设计 §4.3 形态 A，命名按 E3a 设计 §3.1）**：
  auth-bff `PLATFORM_LEVEL_S2S_CALLERS` 的 atlas 条目持 `delegated-reporter` 授权，`POST /oidc/token`
  （token-exchange，`audience=vxture`，**不带** `workspace_id`）铸 `aud=vxture · act.sub="atlas" · mode=service ·
delegated=true`、无 workspace、TTL 300s，审计行 `after.delegated=true`；console 等仍铸不出 `aud=vxture`。
  platform-api `PlatformAuthGuard` 把 `delegated` 原样搬进 `s2sCaller`，`scopeToS2sCaller` 多一个必填档位
  `delegated`：C2 读与 C3 **token 形态**上报 `attribute-declared`（自报产品 = 归属产品，自报 workspace 照用；
  **C3 的归属产品须在目录里**，否则 400 `unknown_product`——`product="atlas"` 照样被拒；**C2 读不查目录**，
  与旧 header 路径相同，未知码得到的是空权益视图而不是 400）；gauge / 共享可见集 / 开通回执 / amount 形态
  `deny`（403 `s2s_delegated_path_not_allowed`）——`check-s2s-legacy-scope.mjs` 的快照把这两格登记成
  `delegatedAttributing: 2`，只许减少。C2 信号多一个 `reporter`，opera 上线检查把它挂在 C2 那一条上、抽屉经
  i18n 键 `integrationSignals.delegatedReporter` 说「最近一次权益拉取由 atlas 代为发起，不是这个产品自己换票调的」
  （免得把代报读成产品自己换票了）。**未落地**：atlas 仓的客户端换票（`platform-entitlement.client.ts` 改 Bearer，
  另一条线）；在那之前运行时一个字不变。顺序：分层 PR A → PR C → atlas 换票 → E3a 关 header（判据 = E6 计数里
  `entitlements|*` 与 `usage.consume|*` 全部产品码为 0，**atlas 换票前这两个数按自报产品码归因、发送方其实是
  atlas**）。**atlas 换票的前置条件是带 PR C 的平台 tag 真正在跑，不只是合并**：旧 platform-api 对无 workspace 的
  票回 403 `s2s_scope_missing_workspace`，而 atlas 把非 2xx 一律当 unreachable——C2 fail-open、C3 不计费、两边都
  不报错，正是本件要防的那种沉默；atlas 侧应把 `s2s_*` 的 403 当配置错误告警而不是 unreachable（atlas 仓另行）。
- 文档改正（#547 点名的三处）：product_220 §4.2、admin/80-plan-bundled-components.md、product_100_matrix §5，
  统一成「Atlas 上报原始 token（四维，计入调用方产品）；换算与 `ai.credit` 扣减在平台」。

## 实现落点

- DDL：`deploy/database/ddl/50_metering.sql` §6b/§6c/§6d/§8b；95（append-only）；90（FK）；98（列锁）；96（分区 parts）
- 迁移：`deploy/database/migrations/2026-10-04-token-usage-ingest.sql`
- 值域：`@vxture-platform/shared` `TOKEN_USAGE_OUTCOMES` / `TOKEN_CREDIT_SKIP_REASONS`（`check-catalog-domains` 锁 DDL 一致）
- 代码：`bff/platform-api/src/platform/token-usage.service.ts`（换算 / 结转 / 两段事务）、`usage-view.ts`
  （`parseConsumeRequest` / `buildTokenConsumeResponse`）、`platform-usage.router.ts`（同一端点分支）
- 设计正文：`data_commerce_200_metering.md` §6b–§6d / §8b / §11b
