# Sharing 域架构设计：SharingGrant 策略 SoT 与可见集（data_sharing_100）

<!-- data-architecture: target-state -->

> 状态：v1 草案 · 编号 `data_sharing_100`（架构层）· 待评审 · 未实施
> 上级权威：[`data_platform_100_architecture.md`](./data_platform_100_architecture.md) §2.2.4 八条铁律；共享模型主文档 = [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) v1.0 §8（本文不重述模型语义，只做数据域落位）
> 决策依据：[`ADR-12`](./decisions/ADR-012-sharing-grant-design.md) D2（策略 SoT = 平台控制面新增 `sharing` 域）
> 通道契约：[`product_200_integration.md`](./product_200_integration.md) §3.2（C2 可见集解析）、§4.2（C3 grant invalidate）
> 姊妹文件：[`data_sharing_200_schema.md`](./data_sharing_200_schema.md)（字段级细化）
> 实施登记：建库 = `product_300_naming-migration.md` M5、[`product_310_arda-integration.md`](./product_310_arda-integration.md) P4.2；解析 API + invalidate = P4.3

---

## 0. 域定位

`sharing` 是平台控制面新增 schema，回答一件事：**org 内"谁把什么开放给了谁、开放到什么程度"的策略 SoT**。

| 本域是什么                                                       | 本域不是什么                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| SharingGrant 的唯一权威存储（`grants`）                          | 资产本体存储——资产永远在业务面（agent-db / L2 产品数据面），本域只持 loose `resource_ref` |
| 按调用方预展开的物化可见集（`visible_set_current`，非 SoT 缓存） | 策略执行点——grant ∧ entitlement 求值在各 L2 产品入口召回层强制（product_110 §8.4#2）      |
| grant 变更/到期的失效事件源（经 C3 下发）                        | 跨 org 机制——grant 是 org 内机制，跨 tenant 供给走 entitlement（P 级，§4.2/§8.3）         |

选型理由承 ADR-12 D2：grant 横贯数据/知识/技能三类资产、跨 L2 产品，单个 L2 非自然属主；联合求值 grant ∧ entitlement 两操作数须同源（控制面）；org 管理员全局审计与一键回收天然在平台 Console/Admin 面。

## 1. 域内结构与跨域关系

```
sharing.grants                SoT：一行 = 一条授权（撤销保留行、重授新行）
sharing.visible_set_current   物化：按调用方 (workspace, product) 预展开的可见资源行（惰性 TTL 缓存）
sharing.visible_set_refresh   物化新鲜度锚：每调用方一行（空可见集也需新鲜度证据）
```

跨域关系（方向均为 sharing → 他域，本域不被平台他域依赖）：

| 相关域           | 关系                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenancy`        | `tenant_id` / 各 `workspace_id` 真 FK（普通引用，铁律一）；org 内机制由 tenant 一致性触发器加固（见 200 §3）                                                                                            |
| `product`        | `resource_product_id` / `grantee_product_id` 真 FK                                                                                                                                                      |
| `metering`       | **无结构耦合**。entitlement 是联合求值的另一操作数，求值在 L2 入口完成（平台侧两个 API 各自独立：C2 entitlements + 本域可见集），本域不读订阅表                                                         |
| `provisioning`   | invalidate 下发**复用 `provisioning.webhook_deliveries` 投递基建**（队列/lease/HMAC/重试/死信，[`data_commerce_220`](./data_commerce_220_provisioning.md)），本域只是新的事件生产者，不建第二条投递通道 |
| `support`        | grant 创建/撤销/到期事件写 `support.audit_logs`（§8.7 管理权模型），本域不建自己的审计表                                                                                                                |
| 业务面（产品仓） | `resource_ref` = 业务面资产 id，**loose 引用**（铁律一边界#1，不建 FK、不校验存在性）；资产删除后的悬挂 grant 由属主产品经资产删除流程主动撤销                                                          |

## 2. 可见集合成的责任划分（product_200 §3.2 落地细化）

§3.2 的"可见资产集 = 自有 ∪ 被授权 ∪ org 级 ∪ 已订阅 P 级"是**在 L2 产品入口合成的最终结果**，四个成分来源不同，平台 sharing 域只供其中 grant 命中部分：

| 成分        | 来源                                                                                                                   | 平台 sharing 域职责                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 自有        | 属主访问 = 结构判定（`caller.ws = resource.ws ∧ caller.product = resource.product`，§8.3），产品在自己目录里比对归属键 | 无（不需要 grant）                                  |
| 被授权      | grant 命中（grantee = workspace / product）                                                                            | ✔ 可见集解析 API                                    |
| org 级      | grant 命中（grantee = org_all，含 T 级 org 库预设 grant）                                                              | ✔ 同上（org 级不是独立机制，就是一种 grantee 形态） |
| 已订阅 P 级 | entitlement（C2 §3.1，features / 资产 SKU）                                                                            | 无（P 级不走 grant）                                |

推论：平台侧**没有**"枚举调用方全部可见资产"的单一端点——业务面资产 id 只有属主产品自己认识（loose 引用），平台只能返回策略层登记过的 grant 命中集。这不是缺口，是铁律一（资产本体不进平台）的必然形态。

## 3. 物化与失效架构

对齐 `entitlement_current` 模式（惰性短 TTL 缓存 + 写路径失效 + invalidate 推送）：

1. **读（解析 API）**：查 `visible_set_refresh` 锚行——TTL 内 → 直接读 `visible_set_current` 行返回；过期/缺失 → 从 `grants` 按 §8.3 谓词重算该调用方全量可见集（≤ 一次索引查询 + 就高合成），UPSERT 行 + 锚，再返回。重算幂等，并发重复重算无害；
2. **写失效（同步）**：grant 创建/撤销时按 grantee 维度删除受影响调用方的物化行与锚（grantee=WS → 该 WS 全部行；grantee=product → 该 org 内该 product 行；org_all → 该 org 全部行），下一次读重算。撤销即时生效由此保证（叠加产品侧 30–60s 缓存 = 端到端秒级～分钟级，D2 已接受）；
3. **到期（被动轴）**：`expires_at` 无写事件。物化行携带贡献 grant 的最早到期时刻，读侧一并过滤（到期视同缺失 → 重算），方向安全（default-deny，宁可少见不可多见）；
4. **invalidate 推送（C3 §4.2）**：grant 撤销 → 同步入队 `grant.invalidated` 投递（目标 = 资产面产品 `resource_product` 的 webhook 端点，产品据派生边 re-scope，§8.6）；grant 到期 → **到期扫描 Job**（分钟级）补发同一事件（幂等键含到期时刻）。entitlement invalidate 同通道走既有 `subscription_changed` 事件型接线（收 P2.4 降档债），事件派生细节见 200 §4。

级联撤销职责边界（§8.6）：平台 = 广播事件 + 物化失效；产品 = 按 ingestion 时点记录的派生边把受影响派生资产移出可见集（re-scope 不 re-index）。派生边存储在产品业务面，不进本域。

## 4. 解析 API 落位（P4.3 实施）

对齐 D1 先例（C2/C3 端点挂 auth-bff `/platform/*`，独立守卫，后续可平移）：

```
GET /platform/sharing/visible-set?workspace_id={W}&product={P}
→ { resources: [{resource_type, resource_product, resource_workspace_id,
                 resource_ref, scope, expires_at?}], refreshed_at }
```

- 守卫 = InternalAuthGuard（`x-vxture-internal-auth`，与 entitlements/consume 同款，product_210 token exchange 落地前的过渡凭证）；
- `Cache-Control: private, max-age=30`（产品侧短 TTL，D2 契约）；
- `scope` 为多 grant 就高合成后的单值（§8.3）；调用方无 grant 命中时返回空数组（合法状态，非错误）；
- 仅资产面产品（Arda/Karda/Terra/Runos）接入；L3 agent 不直查（经 L2 入口被求值，§3.2）。

## 5. 非目标（v1 边界）

- 不做召回层过滤（执行点在产品入口，平台只出策略数据）；
- 不做 grant 审批流（WS 管理员发起即生效，§8.7；审批流按需后置）；
- 不做 WS onboarding 共享策略模板 / org-all 预设 grant 的自动播种（product_110 §10#3 冷启动应对，随 WS onboarding 线另建）；
- 不含 P 级资产供给（D3，entitlement 通道）；
- 首个消费者 = Arda（`resource_type = dataset`），knowledge_base/skill 值域 day-one 建全（[`feedback_schema_completeness`] 数据模型完整性），求值接入随 Karda/Runos 产品线。

## 6. 状态跟踪

| 项                                | 状态                      | 备注                                                                                                                                                |
| --------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本文 + `data_sharing_200`（P4.1） | ✅ 定稿（PR #675 合并）   |                                                                                                                                                     |
| M5 建库（P4.2）                   | ✅ DDL 完成（2026-07-07） | `82_sharing.sql` + 00/90/95/97/98 配套；scratch 全量 apply + 语义验证过；**生产建库已完成（2026-07-07，platform_main 定向增量 apply + 全量验证）**  |
| 解析 API + invalidate（P4.3）     | ✅ 完成（2026-07-07）     | `@vxture/service-sharing` + auth-bff `/platform/sharing/visible-set` + admin-bff 到期扫描 Job + `subscription_changed` 接线（实测注记见 200 §4/§6） |
| Arda 入口求值（P4.4）             | ⬜                        | arda 仓（线 B），非本仓范围                                                                                                                         |
