# ADR-014 毛利均衡的积分换算 —— 按模型成本反推换算比例、目标毛利趋同、换算功能归 admin

> 状态：✅ Accepted（2026-10-06，owner 四点裁定 + 三项参数裁定）
> 关系：**扩展 ADR-013**（原始 token 按调用方接收、`metering.token_credit_rates` 已建表）
> 与 product_220 §4.2（`ai.credit` 单一计量入口、1 credit = 1,000,000 micro、token 换算基线）；
> **不改变之**。对端成本数据在 vxture-atlas（`model.model_price_rules` / `reqlog.upstream_cost`）。
> 起因：owner 2026-10-06「不同模型配不同成本、用不同换算比例、让毛利基本趋同；换算功能放 admin、可设置、预置推荐参数」。

---

## 背景

ADR-013 建好了消耗侧的管线：四维 token → `token_credit_rates`（按 provider/model × 生效窗口 × 四维每 1K 单价 + rerank/parse）→ micro-credit → 结转 → 整数走 consume 引擎扣 `ai.credit` 池。但：

- **种子只有一行拉平的默认费率**（四维同价 500000 micro/1K ＝ 2K tokens/credit），没有运营入口，只能靠 seed+迁移改。
- **一张拉平费率两头错**：实测(¥0.20 锚价下，收费固定 ¥100/1M)对便宜模型毛利 ~96%、对超高端 **−142%**。毛利随模型、随用量结构剧烈漂移。
- **成本在 atlas**（每模型四维供应商价 + 峰谷 + 实付 `upstream_cost`），平台侧不存不读；两层只按 `request_id` 对账（无 FK，设计边界）。
- `ai.credit` 此前**没有钱的锚**：plan 送多少 credit 是手拍整数，加油包只有 3 个离散 SKU，credit↔¥ 无基准。

本 ADR 解决「每个 credit 值多少钱、每个模型按什么比例换算、运营在哪里设置」。

## 决策清单

| #   | 决策         | 结论                                                                                                                                                                                   | 关键理由                                                                           |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D1  | 积分锚价     | `ai.credit` 锚定 **1 credit = ¥0.20**（一行可调配置，不写死）。它只给 credit 一个「值多少钱」的基准，不改任何扣费机制。                                                                | 卖/买/毛利全部从它可推；现有加油包 SKU 正好读成「¥0.20 列表价 + 量大折扣」，不改价 |
| D2  | 目标毛利     | 定价围绕一个**目标毛利 `m`**（预置 **70%**，admin 可随时调，一处生效）。                                                                                                               | owner「让毛利基本趋同」；m 是运营旋钮不是代码常量                                  |
| D3  | 分维反推     | 每模型**逐维** credit 费率 = `该维成本 ÷ ((1−m) × 锚价)`。**性质：每一维毛利 = m ⇒ 总毛利 = m，与进/出/缓存用量占比无关。**                                                            | 拉平费率做不到；分维反推把毛利与用量结构解耦，这是「趋同」能成立的根               |
| D4  | 成本按模型   | 每模型一套四维成本（input/output/cache_read/cache_write，¥/1K）。来源 **采集为主 + 手配兼容**：默认同步自 atlas `model_price_rules`（或实付 `upstream_cost`），admin 可手动覆盖/补缺。 | owner「不同模型配或采集不同成本」；atlas 是成本权威，admin 自持一份用于商业换算    |
| D5  | 换算归 admin | 换算/定价功能在 **admin**（商业面），可设置，预置推荐参数。admin **推导并写** `token_credit_rates`（平台库，带不可改的生效窗口行）。**取代**本轮之前把费率编辑放 opera 的设想。        | owner「换算功能应该在 admin」；定价是商业判断，opera 技术面只管模型接入与自检      |
| D6  | 大致趋同     | 毛利「基本趋同、大致趋近即可」。残余偏差来源：无成本模型（`no_rate` 回落默认）、micro 取整、峰谷成本波动而费率固定。都在容忍内，admin 预览点名偏离者。                                 | owner 明示「大致趋近即可」；精确到小数的均衡既不必要也做不到（峰谷动）             |
| D7  | 不动的铁律   | 钱≠配额（`billing.credits` CNY 钱包与 `ai.credit` 池仍隔离，product_321）；费率行不可改（改价=关旧窗口+插新行）；consume 引擎、幂等、结转全复用 ADR-013。                              | 已成立的边界不因定价功能而破                                                       |

## 换算公式与一个算例

```
  rate_credit_per_1k(模型, 维) = cost_per_1k(模型, 维) ÷ ((1 − m) × 锚价)
  micro_per_1k                 = rate_credit_per_1k × 1_000_000
  收费¥/1K = rate_credit_per_1k × 锚价 = cost ÷ (1−m)   ⇒   毛利 = (收费−成本)/收费 = m  (每一维恒成立)
```

m = 70%、锚价 ¥0.20 ⇒ 分母 `(1−0.7)×0.20 = 0.06`：

| 维/模型（示例成本）   | 成本¥/1K | credit/1K | micro/1K | 收费¥/1K | 毛利 |
| --------------------- | -------- | --------- | -------- | -------- | ---- |
| 便宜·input（¥0.002）  | 0.002    | 0.033     | 33333    | 0.0067   | 70%  |
| 便宜·output（¥0.008） | 0.008    | 0.133     | 133333   | 0.0267   | 70%  |
| 高端·output（¥0.080） | 0.080    | 1.333     | 1333333  | 0.2667   | 70%  |

> 示例成本是公开价量级；真实值采集自 atlas。无论便宜/高端、无论进出占比，毛利都收敛到 70%。

## 预置推荐参数

- 锚价 **¥0.20/credit**；目标毛利 **70%**。
- 每模型四维成本：取到 atlas 真实价就用；取不到用公开价量级占位并**标注未采集**（`no_rate` 回落默认费率，不猜）。
- 默认档费率（provider=NULL,model=NULL）：仍保留 ADR-013 的 2K/credit 拉平行作为**兜底**（无成本模型落这里），不删。

## 后果

- **admin 新增「模型换算/定价」面**：全局锚价+目标毛利；每模型「成本(四维,采集/手配) → 推导换算(四维,可覆盖) → 实测毛利」；预览各模型毛利趋同并点名偏离（无成本/手动覆盖）；「应用」写 `token_credit_rates` 新生效窗口行。
- **新通道 admin-bff → platform-api（运营面鉴权，不是产品 S2S）**：`token_credit_rates` 在平台库（metering），由 platform-api 管。**不能复用 `PlatformAuthGuard`**——它认的是「任意可信产品 S2S 调用方」，拿它当门会让任何产品（karda / tenderforge…）改价。费率写必须是运营/admin 面的凭据，所以这条通道与它的 HTTP 端点一起随 admin PR 落（届时定鉴权形态）。平台侧 PR1 先落**写语义的服务**（`CreditRatesService`，纯 DB：先关旧窗口再插新行、不改价、可复算），端点留到通道就位。
- **atlas 成本采集端点已存在**（2026-10-06 核：无需改 atlas）：`GET capability/price-rules` 回每模型四维供应商单价（`ModelPriceRuleAdminRecord`：input/output/cachedInput/cacheWrite/cacheWrite1h + currency + unitTokens + 生效窗口）——这是推导的成本输入；`GET capability/logs/cost` 回实付成本汇总（`reqlog.upstream_cost`，按 model/provider、峰谷覆盖）——供毛利对账/告警。两者都挂 `OperatorAuthGuard`（运营面），与 opera-bff 现用的 atlas capability 代理同一条通道。
- **opera 不变**：模型服务二级页（看/增/改模型 + 自检）保持；可只读显示生效换算比例，不在 opera 编辑费率。
- **毛利/漏计量可见**：admin 预览毛利趋同；`no_rate`/`failed_attempt` 作为「有成本却没配费率＝在漏计量」的告警。

## 实现落点（待排 PR）

- platform-api（**PR1**）：`CreditRatesService`——`token_credit_rates` 的写语义（新建=事务内先关同作用域旧窗口再插新行；关闭=撤覆盖回落更粗档；永不 UPDATE 价列）。复用 ADR-013 的表，无 DDL。HTTP 端点不在本 PR（见上，随 admin 通道落）。
- atlas（**PR2 = 无需改**，2026-10-06 核）：成本采集端点 `capability/price-rules` + `capability/logs/cost` 已存在（OperatorAuthGuard），直接供 admin 用。
- admin（**PR3**，剩下的主体）：`portals/admin` 新「换算/定价」模块（锚价+目标毛利设置、每模型成本→分维费率推导、毛利趋同预览、应用）；admin-bff 两条**运营面**通道——读 atlas（`price-rules` + `logs/cost`，OperatorAuthGuard，比照 opera-bff 现用代理）、写 platform-api（`token_credit_rates`，需给 platform-api 加一个**运营面**守卫，比照 atlas 的 `OperatorAuthGuard`，并把 PR1 的 `CreditRatesService` 包成 HTTP 端点）。
- 种子：锚价 ¥0.20、目标毛利 70%（归 admin）、默认兜底费率（沿用 ADR-013）。
- 守卫：费率行不可改（column-locks EXTRA_ANCHOR 已含价列）；写语义单元测试（事务顺序、冲突回滚）；换算推导单元测试（分维毛利=m，PR3）。

## 实现顺序

分层 ADR-013（已上线）→ **PR1 平台写语义服务（CreditRatesService + 测试，无端点）** → **~~PR2 atlas 成本采集端点~~（已存在，无需改）** → **PR3 admin 换算面 + 两条运营面通道 + platform-api 运营面守卫与 HTTP 费率端点 + 锚价/目标毛利配置**。
真实成本/毛利校准待 reporting_ro 生产取数（owner 当次授权）。
