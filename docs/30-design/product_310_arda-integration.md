# Arda 对接实施规划 + 决策索引（product_310）

> 版本：**v2.0** · 状态：三通道定型上产，对接闭环
> 定位：**平台侧（线 A）视角**——Arda（L2 数据平台，三通道首个消费者）对接的**实施规划 + 交付状态 + 决策概要索引**。逐步实施/晋升/探针流水已删。
> **与 [`arda_300`](../20-specs/210-arda/40-arda_300_integration-final.md) 的分工**（去重，勿两处重述）：本文（design 侧）= 平台怎么交付 + 决策**概要索引**（结论 + 指针）；`arda_300`（产品包侧，线 B 面向）= 产品侧义务 + 决策**详细留痕**（结论 + 否决方案 + 依据）。**决策的"为什么/否决什么"以 arda_300 §2 与 product_220 §7 为准，本文不重述。**
> 上游：[`product_200`](./product_200_integration.md)（三通道契约）、[`product_220`](./product_220_catalog-resource-model.md)（目录·权益·资源）、[`product_230`](./product_230_mesh-architecture.md)（传输面）、[`product_210`](./product_210_tool-protocol.md)（工具协议）、ADR-11（权益引擎）。
> 产品侧落地包：[`arda_000`](../20-specs/210-arda/10-arda_000_definition.md)（定义）、[`arda_100`](../20-specs/210-arda/20-arda_100_handoff.md)（交接）、[`arda_200`](../20-specs/210-arda/30-arda_200_interface.md)（接口契约）、[`arda_300`](../20-specs/210-arda/40-arda_300_integration-final.md)（最终要求 + 决策详细留痕）。

---

## 1. 交付状态

三通道平台侧**全部定型上产**（develop=beta=main）。Arda 作为首个消费者的对接链路（登录→开通→门控→consume→缓存重拉）已端到端跑通。

| 通道            | 平台侧交付                                                                                                     | 端点                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| C1 身份         | ✅ arda/arda-beta OIDC client（realm=customer），access_token 零商业字段                                       | IdP `accounts.vxture.com`                              |
| C2 权益         | ✅ 信封 v2（订阅事实块 + 销售轴 + quota_pools），短 TTL                                                        | `GET /platform/entitlements`                           |
| C3 用量         | ✅ consume（counter 瀑布）+ gauge（storage 水位快照）                                                          | `POST /usage/consume`、`PUT /usage/gauge`              |
| C3 provisioning | ✅ webhook 派发（HMAC/幂等/tailnet 投递）                                                                      | arda 侧 `{ARDA_WEBHOOK_BASE_URL}/provisioning/webhook` |
| C2 可见集       | ✅ 平台侧已实现（资产面共享，随共享面接入）                                                                    | `GET /platform/sharing/visible-set`                    |
| 宿主            | ✅ 独立宿主 `platform-api`（身份面/商业面分离，D13）；产品经内网别名 `http://<worker-01-tailnet-ip>:8080` 接入 | —                                                      |

**剩线 B 项**（不阻塞平台）：P3.2 v1 功能切片、P4.4 入口 grant 求值（随共享面）、T3 工具面 provider（随 product_210 逐项授权）。

## 2. 双线并行模型

```
线 A：vxture 平台仓（本仓）          线 B：arda 独立产品仓（不进 monorepo）
  三通道对外化 + 契约交付   ──契约──→   RP 五端点 + 目录/连接器/服务化 + C2/C3 接入
```

- 两线唯一同步点 = **契约文档**（product_200/220 + arda_200/300 + `@vxture/shared` 值域），arda 仓不引用 vxture 仓代码（可包依赖 `@vxture/shared`，非源码引用）；
- 线 B 写边界：arda 仓为独立授权范围，建仓与首次部署须 owner 显式授权。

## 3. 决策索引（D1–D13，概要）

> **本表只留结论 + 权威指针（概要）**。每条决策"为什么这样、否决了什么旧方案"的**详细防回退留痕**——产品面决策见 [`arda_300`](../20-specs/210-arda/40-arda_300_integration-final.md) §2，全平台契约级见 [`product_220`](./product_220_catalog-resource-model.md) §7「明确不采纳」/§10。改动前先读那两处。

| #      | 决策             | 结论                                                                                   | 详细留痕 / 权威                                                         |
| ------ | ---------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1→D13 | C2/C3 宿主       | 独立宿主 platform-api（身份/商业面分离；D1 挂 auth-bff 由 D13 修正）                   | arda_300 §2                                                             |
| D2     | invalidate v1    | 短 TTL（30–60s）缓存自然过期，推送随共享面建                                           | 本文 §1                                                                 |
| D3     | Arda v1 范围     | 不含 P 级资产供给                                                                      | [`arda_000`](../20-specs/210-arda/10-arda_000_definition.md) §3         |
| D4     | webhook 渠道维度 | 搁置备案（per-product 单行；触发条件成立按备案设计再开）                               | 本文（备案）                                                            |
| D5     | storage 计量     | gauge 快照（LWW，`PUT /usage/gauge`）                                                  | arda_300 §2 · [`data_commerce_240`](./data_commerce_240_usage-gauge.md) |
| D6     | bundled 建模     | role 轴正交化（C2 加 `bundled` 布尔，tier 纯五档）                                     | product_220 §2/§3/§7                                                    |
| D7     | 共享资源目录     | L0 `platform_metrics` 单一定义点；席位不池化                                           | product_220 §4/§7                                                       |
| D8     | 共享池模型       | 保留池（默认自留）+ 共享溢出池（租户策略开启）                                         | product_220 §4.3                                                        |
| D9     | 值域权威         | `@vxture/shared` 唯一权威 + C2 `subscription_status`                                   | product_220 §3                                                          |
| D10    | trial 到期落点   | C2 呈现 `null`（回归 never-subscribed）                                                | product_220 §3                                                          |
| D11    | 传输面/mesh      | tailnet 内网寻址（S2S 绝不公网）                                                       | arda_300 §2 · [`product_230`](./product_230_mesh-architecture.md)       |
| D12    | 契约收缩         | 信封只承载商业事实（`capabilities` 退役、`limits` 块、六值域、代表订阅规则、深链词表） | arda_300 §2 · product_220 §3/§7                                         |
| D13    | 宿主拆分         | platform-api 完整拆 + 内网别名 + S2S bearer JWKS 验签                                  | arda_300 §2                                                             |

## 4. 附：命名迁移

M1（seed `data`→`arda` 改码）、M2（`nocus` client 退役）、M5（sharing 域建库）均已完成上产；详见 [`product_300`](./product_300_naming-migration.md) §1。
