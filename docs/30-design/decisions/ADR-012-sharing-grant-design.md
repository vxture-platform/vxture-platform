# §12(ADR-12)共享授权模型 · 产品分层定名 · P 级资产供给(定稿 v1)

> 状态:✅ Accepted(2026-07-06,owner 拍板)
> 关系:**扩展 ADR-11,不改变之**——ADR-11 的 workspace × product 权益引擎(state × tier、就高合并、瀑布扣减)原样有效;本 ADR 补充 org 内共享授权(SharingGrant)、产品分层终版命名与 P 级资产供给决策。
> 权威展开(产品架构族 `product_{NNN}`,族路由见 product_100 头部):模型全文 = [`design/product_110_sharing-isolation.md`](../product_110_sharing-isolation.md) v1.0;矩阵 = [`design/product_100_matrix.md`](../product_100_matrix.md) v1.0;对接 = [`design/product_200_integration.md`](../product_200_integration.md) v1.0;定名迁移规划 = [`design/product_300_naming-migration.md`](../product_300_naming-migration.md)(ruyin→umbra 仅规划,本次不实施)。本文只记决策与理由,不重述设计。

---

## 背景

平台进入多产品矩阵阶段(L1 能力平台 + L2 域平台 + L3 行业 agent),需要在 org 内实现数据/知识/能力的按需共享。ADR-11 解决了"跨 tenant 卖什么、怎么计量"(entitlement),未覆盖"org 内谁能看谁的资产"(共享授权)。外部上游稿(product-matrix v1.1 / ADR-entitlement-and-workspace v2)因授权与共享逻辑变化不再沿用,由仓内重构取代。

## 决策清单

| #   | 决策                 | 结论                                                                                                                                                                                                            | 关键理由                                                                                                               |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D1  | org 内共享授权模型   | **SharingGrant**:resource(数据集/知识库/技能)× grantee(WS/product/org-all)× scope(按资产类型参数化)× status/expires;default-deny;共享不产生数据副本;召回层强制权限                                              | 与 entitlement 正交互补(跨 tenant 走 entitlement,org 内走 grant,两套不混用);策略即隔离,撤销即时无残留                  |
| D2  | 策略 SoT 落位        | **平台控制面新增 `sharing` 域(schema)**;物化可见集 + invalidate 推送(复用 entitlement_current 模式);求值执行点仍在各资产面(L2)入口                                                                              | grant 横贯三类资产、跨 L2,单个 L2 非自然属主;联合求值 grant ∧ entitlement 两操作数须同源;org 审计/一键回收天然在平台面 |
| D3  | 级联撤销             | lineage-aware:派生边(派生资产→来源→授权依据)**ingestion 时点记录**;撤销事件广播 → L2 按边 re-scope(非 re-index)                                                                                                 | 防"数据已撤销、派生索引仍可召回";派生边事后补记则无从级联                                                              |
| D4  | 管理权               | **WS 发起 + org 全局审计与一键回收**;全部策略变更入 `support.audit_log`                                                                                                                                         | 对标行业(资源属主自治 + 组织兜底)                                                                                      |
| D5  | P 级平台资产         | 范围 = **行业公开数据 + 三方公开服务数据,敏感数据不进平台**;形态二分 **asset / brokered service**(地图/影像等管制类一律 brokered);经 entitlement 消费不走 grant;**全生命周期来源审计**(准入/版本/分发/许可复审) | 测绘等监管下平台自持再分发不可行;来源审计是许可合规的最低成本兜底                                                      |
| D6  | 产品分层与终版命名   | L1 = **Atlas/Ontos/Runos**,L2 = **Arda/Karda/Terra**,L3 = **Raven/Anlan/Forge/Xuanzhen**;L0 vxture 非产品;名称为终版稳定使用                                                                                    | 销 `data_platform_300` §18.2#5"暂缓定名"待决;"arda=平台门户 shell"旧语义作废                                           |
| D7  | ruyin / umbra 重定义 | 现 ruyin.ai 对接方 = **umbra(边界 VPN)**,域名不变,**保持现状租户级订阅**(豁免新引擎);**Ruyin 重新定义为 client 端产品(desktop)**,不进 entitlement,仅 Atlas/Runos 层互通                                         | 既有 RP 契约与生产订阅零改动(起步最小化);语义在文档层消歧,code 迁移为登记的独立实施项                                  |
| D8  | 能力供给通道         | L2 供给唯一直连(L0 工具协议 + 入口求值);Runos 纯控制面无运行时,不构成第二通道 —— **2026-08-10 按域收窄**(见下"D8 收窄"注)                                                                                       | 避免双接口面/双重求值/ESB 反模式                                                                                       |
| D9  | 业务面契约扩展       | agent-db 隔离键 = **workspace_id**(模板 workspace 化);新增 L2 域平台条款(L2 可按 P-T-A 托管他产品资产;产品间调用走 L0 工具协议,禁直连对方库)                                                                    | 对齐 ADR-11 workspace 化;为跨产品托管/直连补契约载体                                                                   |

> **D8 收窄(2026-08-10,决策原文不改写)**:owner 2026-08-07 采纳 runos 产品定义 v0.5(runos `ADR-003`),Runos = **商业能力面**。D8 结论**在联邦域内一字不变**——L2 供给唯一直连、入口求值、无中心瓶颈、无 ESB;新增的是**商业能力域**:以订阅独立交付的业务场景 agent 经 Runos 网关消费可售能力包,该域内 Runos 在调用链路上、有配额与计量、执行器在自有沙箱运行。这是收窄(scoping)不是反转,平台侧办理 = issue #216,语义权威 = [`product_110`](../product_110_sharing-isolation.md) v1.1 §6/§7(两域模型 §6.1、按域判定表 §6.7、未决项 §6.8)。D1–D7、D9 不受影响。

## 影响

- 新设计线:`data_sharing_100/200`(sharing 域字段级)、L0 工具协议规范(S2S 身份透传,token exchange)——共享模型落地的最大工程前置;
- 文档:`product-oidc-subscription.md` 标记删除(被 product-matrix + integration 取代);`tenant.md` 标记删除(单层租户模型过时);`data_platform_100` §1/§2.2.3/§2.3 已更新;
- 实施登记(非本轮):seed 定名迁移(data→arda、nocus 处置、ruyin→umbra)、`products.layer` 加列、sharing 域建库(见 product-matrix §6)。

## 不做

- 不建中心网关/ESB;不在平台控制面建向量/索引表;L0 共享沙箱仅文档占位;umbra 不进共享模型;Atlas 之外无第二模型宿主。
