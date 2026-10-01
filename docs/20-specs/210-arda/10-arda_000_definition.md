# Arda 产品定义（数据平台，L2）

> 版本：**v1.0** · 状态：定稿（三通道已定型上产；v1 功能切片可依此开发）
> 依据：[`product_100_matrix.md`](../../30-design/product_100_matrix.md) §2/§3、[`product_110_sharing-isolation.md`](../../30-design/product_110_sharing-isolation.md) §4/§5、[`product_200_integration.md`](../../30-design/product_200_integration.md)（三通道契约）
> 配套：接口契约 = [`arda_200_interface.md`](./30-arda_200_interface.md)；最终对接要求与决策留痕 = [`arda_300_integration-final.md`](./40-arda_300_integration-final.md)
> 实施仓：arda 独立产品仓（不进 vxture monorepo）；本文为产品定义权威，实现细节归 arda 仓文档。

---

## 1. 定位卡

- **一句话**：通用结构化数据 + 数据汇聚共享——**agent-db 是数据的 System of Record，Arda 是数据的 System of Access**。
- 层位：L2 对象域平台；product_code = `arda`；域名 = arda.vxture.com（beta-arda.vxture.com）。
- L2 统一原型参数（product_110 §4.3）：对象域=结构化业务数据；托管水位线 = 托管通用件、其余汇聚；**无运行时托管**（目录与服务化，无常驻实例）；A 级数据驻留 = agent-db 为主；隔离 = 库级物理隔离 + 目录授权。
- 分工铁句：**连接 = Arda，理解 = Karda**——"平台知道哪里有数据"的唯一登记处是 Arda；非结构化内容的消费管线归 Karda。

## 2. 域模型（v1）

### 2.1 数据目录（核心对象）

目录四元组：**`(org, ws, product, datasource)`**——每个 DataSource 以此归属键登记，org 为绝对隔离边界（数据键携带 `org_id`，跨 org 无通路）。

### 2.2 连接器（DataSource 的类型化实现）

| 类型             | 说明                                                                                            | v1                    |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| ① 内部 agent-db  | 各 L3 产品业务库（`vxturebiz_{product}_{env}`）的 DataSource 登记                               | ✅ v1 范围            |
| ② 外部结构化源   | 客户自有数据库/数仓等                                                                           | ⬜ 后续               |
| ③ 外部非结构化源 | Notion / 飞书 / SharePoint / 对象存储等；Arda 只连接、鉴权、同步调度，内容经通道交付 Karda 加工 | ⬜ 后续（依赖 Karda） |

### 2.3 资产分级（P-T-A 的 Arda 参数）

| 级  | 内容                                            | 供给/授权                                                                                 |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P   | 跨业务复用的通用参考/主数据（§4）               | 平台供给，跨 org 只读，**经 entitlement 消费（SKU/tier 权益），不走 grant**；来源审计强制 |
| T/A | 业务数据，驻留 agent-db（SoR），Arda 目录层登记 | org 内经 SharingGrant（scope=`read`）显式共享，default-deny；**写永远只属属主**           |

## 3. v1 功能切片（实施依据）

前提 = v1 不含 P 级供给、不含跨 WS 共享（grant 求值随共享面后置）。三个能力块依序交付：

1. **数据目录**：DataSource 的登记/查询/生命周期（注册→活跃→解绑），四元组归属键 + 元数据；解绑事件为级联撤销的上游信号（后置接入 invalidate 通道）；
2. **连接器登记（内部 agent-db 类型）**：agent-db DataSource 的类型化接入——连接参数（secret 引用，不落明文）、健康探测、同步调度占位；
3. **数据服务化只读输出**：对已登记 DataSource 的服务面查询/读取 API（scope=`read` 语义）；v1 求值 = 属主访问（caller.ws=resource.ws ∧ caller.product=resource.product）+ entitlement（经 C2）；grant 求值后置接入。

**明确不在 v1**：P 级资产供给、跨 WS/product 共享（grant）、外部连接器（②③）、非结构化管线、S2S 工具面（agent 调用，依赖 [`product_210`](../../30-design/product_210_tool-protocol.md)）。

## 4. P 级通用数据：v1 清单框架与准入流程

- **范围铁律**（ADR-12）：行业公开数据 + 三方公开服务数据，**敏感数据不进平台**；Arda 的 P 级形态 = asset（自有资产）；
- **准入判据**：Rule of Two——**≥2 个 agent 需要且无租户属性**才进 P 级；
- **准入流程**：对齐 `product.launch_checklist` 模式——准入登记（来源/许可证据/再分发范围/责任 operator）→ 版本变更审计 → 分发消费审计 → 许可复审；审计入 `support.audit_log`；
- **v1 候选清单**（待 owner 拍板，见 §7）：行政区划、行业分类代码（国标）、其他通用参考数据由 L3 产品定义反推补充。

## 5. 三通道接入（参数与契约以 arda_200 为准）

三通道端点、请求响应形状、值域、鉴权全部收敛在 [`arda_200_interface.md`](./30-arda_200_interface.md)（接口契约本体）。本节仅记 Arda 的产品级参数：

| 项              | 取值                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| 目录            | product_code=`arda`；plan `arda-free` 起步                                                                          |
| C1              | client `arda`/`arda-beta`（realm=customer）；RP 五端点归 arda 仓实现；**access_token 只带治理上下文，无商业 claim** |
| C2              | `GET /platform/entitlements?workspace_id=&product=arda`；短 TTL 缓存；资产面可见集解析随共享面接入                  |
| C3 consume      | `POST /usage/consume`（`local_usage.usage_raw` 缓冲 + 异步上报，幂等 key 强制，不做本地配额裁决）                   |
| C3 gauge        | `PUT /usage/gauge`（storage.bytes 绝对水位快照，不进 consume）                                                      |
| C3 provisioning | webhook 消费端：验签（HMAC）+ 幂等；开通=在 `app` schema 建该 WS 目录空间，拆除=逆操作                              |
| 数据面          | `vxturebiz_arda_{beta,prod}`，context/app/agent/local_usage 四 schema，`workspace_id` 权威隔离键                    |

### 5.1 beta 渠道定位与授权模型

**定位：公测演示版**（beta-arda.vxture.com + `vxturebiz_arda_beta`，以演示数据为主）。租户以**授权方式**进入，不走自助购买；配额受控（token 成本上限）：

- **授权载体 = 运营授予的受限订阅**（复用计量引擎，零新机制）：`subscription_kind='trial'` + `trial_end_at` + `activation_method='operator_grant'`；与 prod 商业试用同机制、靠 plan 区分（beta 专用 plan，池额度小）；
- **配额即成本上限**：beta AI 用量经 Atlas→consume 扣 beta plan 的池，池尽硬停。**硬停要调用方带
  `intent: "reserve"`**（2026-10-01）——缺省的 `report` 档是 200 + `gated`、照记不拦，
  所以本行此前写的「池尽 409 gated 硬停」要按 2026-08-10 的裁定重读；详见
  [`arda_200 §3.1`](./30-arda_200_interface.md)；
- **两条防串约定**：① `had_trial_at` 仅 `activation_method='trial'` 写，`operator_grant` 不写（公测不烧转正试用资格）；② beta 授权只发未付费租户，转正付费时运营同步取消 beta 授权订阅（防 C2 就高合并把 beta 池变成付费赠送）；
- **beta 空间 = 懒建**（首次进入时建，定期重置），不依赖 provisioning webhook；**prod 接收端按 `payload.plan` 忽略 beta plan 的开通事件**。

## 6. 边界（不做）

- 不做非结构化内容理解/索引（归 Karda）；不做实体/语义 Schema 定义（归 Ontos）；不做模型推理（归 Atlas）；
- 不复制平台主数据、不直连平台库、不持 Provider Key；
- 不提供写通道给非属主（SharingGrant scope 仅 `read`）；不做"平台自动拉通汇聚"（流动由属主发起）；
- 无常驻运行时实例（目录与服务化形态）。

## 7. 待拍板项

| #   | 项                                                          | 归属                     | 状态 |
| --- | ----------------------------------------------------------- | ------------------------ | ---- |
| 1   | P 级通用数据 v1 清单（§4 候选转正）                         | owner                    | ⬜   |
| 2   | C3 计量 metric 定价口径（价格值，非 metric 定义——后者已定） | owner + 运营             | ⬜   |
| 3   | Arda/Karda 边界案例裁定规则（同一载体双注册细则）           | Karda 产品定义，本文跟踪 | ⬜   |
