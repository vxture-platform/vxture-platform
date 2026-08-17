# Vxture 产品矩阵与分层(Product Matrix)(product_100)

> 版本:**v1.2** · 日期:2026-08-10(v1.1 = 2026-07-28,v1.0 定稿 2026-07-06) · 状态:**已定稿**(产品名称为终版,owner 拍板,稳定使用,除非再次修订)
> v1.2 修订:**runos 行按商业能力面改写**(owner 决定 2026-08-07,runos `ADR-003`;办理 = issue [#216](https://github.com/vxture/vxture-platform/issues/216)),见文末修订记录;v1.1 修订:**ontos L1→L2 重定位**(owner 拍板 2026-07-28);其余不变。
> 定位:平台**产品架构层**权威——回答"平台由哪些产品组成、各在什么层、彼此什么关系"。与 [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) v1.1 互为伴生(本文管结构,彼文管资产与授权流动);对接契约见 [`product_200_integration.md`](./product_200_integration.md)。
> 取代:外部上游 `product-matrix.md v1.1`(不再提供,本文重构);[`product-oidc-subscription.md`](./commerce/40-oidc-subscription.md) 的产品清单/定位部分(该文档已标记删除)。
> 下游:`data_platform_100_architecture.md` §1#1(产品矩阵业务目标)、product 域 seed/目录、各产品定义文档。
>
> 🧭 **产品架构文档族路由(`product_{NNN}`,2026-07-06 立族)**:编号对齐 `data_{domain}_{NNN}` 惯例——**1\*\* 架构 / 2\*\* 细化标准 / 3\*\* 实施**,编号预留扩展空间。
> **100** 本文(矩阵与分层总纲,族入口)｜**110** [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md)(共享与隔离模型)｜**200** [`product_200_integration.md`](./product_200_integration.md)(平台×产品三通道对接标准)｜**210** [`product_210_tool-protocol.md`](./product_210_tool-protocol.md)(L0 工具协议规范,**v1.0 已定稿**)｜**220** [`product_220_catalog-resource-model.md`](./product_220_catalog-resource-model.md)(目录·权益与资源模型,**v1.0 已定稿**)｜**230** [`product_230_mesh-architecture.md`](./product_230_mesh-architecture.md)(登录后跨产品通信 fabric/mesh 架构,**v1.0 已定稿**)｜**240** [`product_240_repo-template.md`](./product_240_repo-template.md)(产品仓模板)｜**250** [`product_250_management-plane-contract.md`](./product_250_management-plane-contract.md)(管理面契约:platform↔L1,**v0.1 草案**)｜**300** [`product_300_naming-migration.md`](./product_300_naming-migration.md)(目录定名迁移 runbook,规划稿)｜**310** [`product_310_arda-integration.md`](./product_310_arda-integration.md)(Arda 对接实施总纲,规划稿)。
> 族外:决策记录 = ADR-11/ADR-12(ADR 自有编号线);评审/过程留档([`sharing-isolation-review.md`](./design_sharing_100_isolation-review.md))与 owner 原稿([`inputs/`](./inputs/00-index.md))**不进编号体系**;各产品定义文档归 `docs/20-specs/` 产品文档线。

---

## 1. 分层定义(L0–L3)

```
L0  vxture 平台本体(非产品,无 product code)
     org/WS/身份/entitlement/计量计费/工具协议规范/共享沙箱/sharing 策略 SoT
     门户 = website / console / admin(平台位);内嵌副驾 varda
      ↓ 供养
L1  横向能力平台(跨域,被 L2/L3/技能消费;API-first、零端用户 UI,管理面按 product_250 交付)
     Atlas(模型) · Runos(商业能力面:四原语网关,v1.2)
      ↓ 供养
L2  对象域平台(域能力 + P-T-A 分级资产托管,统一原型见 sharing-isolation-model §4)
     Arda(结构化数据) · Karda(非结构化知识) · Terra(时空/物理世界) · Ontos(语义/本体构建,v1.1 重定位)
      ↓ 供养
L3  行业 agent 应用(消费同一套 L1/L2 能力面,差异仅来自数据与场景编排)
     Raven · Anlan · Forge · Xuanzhen

层外:Ruyin(client 端产品,desktop) · umbra(边界 VPN,外部,不进共享模型) · Hermes(internal)
```

判层依据:**被谁消费**。L1 被所有层消费(含 L2 与技能);L2 被 agent 消费并托管资产;L3 只消费不供给。L0 不是产品——它是让产品成立的租户/商业/协议底座(对齐既定"L0 vxture 不作 product code")。

## 2. 产品矩阵总表(终版名称)

| product_code | 名称     | 层           | 域名                                                    | OIDC                                                               | 订阅(entitlement)                           | SharingGrant                          | P 级资产                        | agent-db                                                                          | 现状                                                                                                                                                 |
| ------------ | -------- | ------------ | ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas`      | Atlas    | L1           | atlas.vxture.com                                        | 是                                                                 | 是                                          | 技能小模型经其计量,自身资产不进 grant | —                               | 否(Model Platform DB,独立物理库 `vxturestudio_modelruntime_main`)                 | **拆仓已完成**(2026-07-24 拆分为独立仓 `vxture-atlas`,2026-07-28 平台侧 `services/model/platform` 已退役;`MODEL_PLATFORM_URL` 现指向外部 atlas 主机) |
| `ontos`      | Ontos    | **L2**(v1.1) | ontos.vxture.com                                        | 是                                                                 | 是                                          | Schema 资产授权模式待产品定义         | —                               | 待定义                                                                            | client 已 seed;产品定义空白;**2026-07-28 重定位 L2**(面向用户高频构建操作,非纯 API 能力管道,见修订记录)                                              |
| `runos`      | Runos    | L1           | runos.vxture.com                                        | 是                                                                 | 是                                          | **是**(技能资产,scope=use)            | 平台能力(四原语,scope=use)      | **是**(业务权威在自库 `vx_runos_db`:能力注册表、entitlement 快照、配额计数、审计) | client+product 已 seed;**商业能力面**(v1.2,runos `ADR-003`;原"多模态助手 agent"、"纯控制面"文案均作废)                                               |
| `arda`       | Arda     | L2           | arda.vxture.com                                         | 是                                                                 | 是                                          | **是**(数据集,scope=read)             | 通用参考/主数据(asset)          | 否(目录层;SoR 在各 agent-db)                                                      | seed 占位 `data` → 改名 `arda`;**"arda=平台门户 shell"旧表述作废**                                                                                   |
| `karda`      | Karda    | L2           | karda.vxture.com                                        | 是                                                                 | 是                                          | **是**(知识库,scope=retrieve/apply)   | 平台知识库(asset)               | 否(全量托管,agent 基本不自建)                                                     | 全新;产品定义待建(共享模型为其前置输入)                                                                                                              |
| `terra`      | Terra    | L2           | terra.vxture.com                                        | 是                                                                 | 是                                          | **是**(租户空间数据)                  | 地图/影像(brokered)+白膜(asset) | 是(业务数据留 agent-db)                                                           | 全新;产品定义待建                                                                                                                                    |
| `raven`      | Raven    | L3           | raven.vxture.com                                        | 是                                                                 | 是                                          | 消费方 + 其 A 级资产可被 grant        | —                               | **是**                                                                            | client 已 seed;行业定位待产品定义                                                                                                                    |
| `anlan`      | Anlan    | L3           | anlan.ai                                                | 是                                                                 | 是                                          | 同上                                  | —                               | **是**                                                                            | 同上                                                                                                                                                 |
| `forge`      | Forge    | L3           | forge.vxture.com                                        | 是                                                                 | 是                                          | 同上                                  | —                               | **是**                                                                            | 同上                                                                                                                                                 |
| `xuanzhen`   | Xuanzhen | L3           | xuanzhen.ai                                             | 是                                                                 | 是                                          | 同上                                  | —                               | **是**                                                                            | 同上                                                                                                                                                 |
| `ruyin`      | Ruyin    | client 端    | ruyin.vxture.com(web 面,2026-07-07 定;desktop 分发另议) | 是(client 已落活库:`ruyin.vxture.com`,scopes=openid profile email) | **否**(不进 entitlement 新引擎)             | 否(仅 Atlas/Runos 层能力互通)         | —                               | **重新定义**:client 端产品(desktop);目录+client 已注册(2026-07-07),产品定义待建   |
| `umbra`      | umbra    | 外部         | **ruyin.ai**(域名不变)                                  | 是(client_id=`umbra`,2026-07-07 切换完成)                          | **保持现状**(承继原 ruyin 租户级订阅)       | **否**(不进入共享模型)                | —                               | —                                                                                 | 边界 VPN;外部仓 worker-04 栈;RP 契约照旧(参数已随 client_id 更新)                                                                                    |
| `hermes`     | Hermes   | internal     | —                                                       | 否                                                                 | 否                                          | 否                                    | —                               | —                                                                                 | 平台内部服务,不变                                                                                                                                    |
| (varda)      | Varda    | L0 内嵌      | —                                                       | —                                                                  | 否(平台内嵌副驾,非独立产品,无 product code) | 否                                    | —                               | 独立 datasource                                                                   | 已上生产                                                                                                                                             |

> **`agent-db` 列语义(§6#16 收窄)**:每产品仓均自建业务库(product_200 §7),该列答的是"该产品**业务数据的 SoR 是否落自有 agent-db**"——`是` = 业务权威在自库;`否` = SoR 在平台侧/别处或无独立业务数据,**非"无库"**(atlas 的 Model Platform DB 仍是自有库,只是业务 SoR 归属不同)。**runos 自 v1.2 起该列改 `是`**:能力注册表、有效 entitlement 快照、配额计数与审计事件是业务权威数据,SoR 在 `vx_runos_db`(runos `ADR-007`,基础设施登记见 [`13-infra-allocation-registry.md`](../50-deployment/13-infra-allocation-registry.md))。
>
> 中文品牌名与 i18n 文案由运营后补(product_name/nick 双列机制已就绪);`product_code` 即本表,为稳定锚点。
> 新增域名(arda/karda/terra)为按 `{code}.vxture.com` 规则的建议值,DNS/证书随各产品接入排期。

## 3. 逐产品定位卡

**L1 横向能力平台**

- **Atlas(模型平台)**:统一模型接入/路由/配额/用量治理;大模型与专用小模型唯一宿主;唯一 LLM 出口与计量口径(推理量必过 Atlas → consume)。即现 `@vxture/service-model-platform` / Model Platform 的终态产品名(`model-platform.md` 本就声明现名非终态);Model Platform DB(key/reqlog/routing)归其运行平面。
- **Runos(商业能力面,v1.2 改写)**:业务场景 agent 除模型推理外的一切非模型能力的单一能力门;聚合四原语(连接器/技能/执行器/资产),经两段裁决(opera 技术供给 → admin 商业封装)开放为可售能力包。**两域读法**(共享模型 §6.1):**联邦域**——与其他平台对等、无义务、无联邦流量经过、不出现在调用链路、零计量(v1.0 结论原样保留);**商业域**——网关在调用链路上,四方合取授权、凭证注入、配额计量、全链路审计,执行器在自有沙箱运行。能力准入 Rule of Two;模型推理恒不经 Runos。

> L1 类别不变量(v1.1 收紧):**API-first、零端用户 UI、管理面统一按 [`product_250_management-plane-contract.md`](./product_250_management-plane-contract.md) 交付**——atlas/runos 无一例外。ontos 因不满足此判据重定位 L2(见下)。
>
> v1.2 补注:runos 取得数据面(网关 + 执行器沙箱)**不触动该不变量**——不变量约束的是"有无端用户 UI、管理面怎么交付",不是"有无运行时";runos 的管理面仍按 `product_250` 以 admin-module 形式交付(opera 技术视图 + admin 商业视图两个消费者)。

**L2 对象域平台**(统一原型 = 能力层 + P-T-A 资产层 + 授权层,主变量托管水位线)

- **Arda(数据平台)**:通用结构化数据 + 数据汇聚共享;agent-db 是 SoR、Arda 是 SoA;目录四元组 (org, ws, product, datasource);连接器唯一登记处("连接 = Arda")。
- **Karda(知识平台)**:知识加工/检索/治理能力域,平台/组织/agent 三级知识库全量托管;跨库统一检索(可见范围并集);派生边 day-one、级联撤销("理解 = Karda")。
- **Terra(时空平台)**:数字孪生 + 基础地理 + 物联感知横向底座;托管标准化底座 + 孪生运行态;地图/影像 P 级走 brokered service 形态(测绘合规)。
- **Ontos(语义/本体构建平台,v1.1 自 L1 重定位)**:实体/关系/语义 Schema 的**构建与治理**,面向用户高频操作(本体建构是交互式工作,非纯 API 管道)——与 Arda(数据治理)同级同构。"**Schema 归 Ontos,实例归各 L2**"(决策记录 §12#1)语义保留:Ontos 作为 L2 成员向兄弟产品供 Schema,类比 Arda 向 agent 供数据目录。产品定义仍空白待建,重定位只改层不补定义。

**L3 行业 agent 应用**:Raven / Anlan / Forge / Xuanzhen——行业定位与领域模型归各自产品定义(待建,本文只登记层与接入形态);统一形态 = OIDC RP + agent-db(一产品一套、WS 隔离,业务面模板)+ 三通道对接 + L0 工具协议消费方。

**层外**

- **Ruyin(client 端,desktop)**:重新定义的客户端产品;不共享 entitlement 模型,Karda 知识库能力默认不开放,仅 Atlas/Runos 层能力互通;产品定义待建。
- **umbra(边界 VPN)**:域名 ruyin.ai 不变,即现平台 OIDC RP 契约(`identity-platform-ruyin-contract.md`)的实际对接方;保持现状租户级订阅模式;不进入共享模型;外部仓维护(写边界:只读)。
- **Hermes(internal)**:平台内部服务,无 OIDC/订阅。
- **Varda(内嵌副驾)**:L0 平台内嵌智能助手,非独立产品;会话/审计在独立 datasource。

## 4. 结构关系(供给总图)

见 [`product_110_sharing-isolation.md`](./product_110_sharing-isolation.md) §7.3(v1.1 起**按域分列**)。要点:**联邦域**——L2 → 域内 agent 唯一直连(L0 协议 + 入口 grant∧entitlement 求值),Runos 分发不转发;**商业域**(v1.2)——供给方登记四原语 → 两段裁决 → 业务场景 agent 恒经 Runos 网关消费能力包,同一提供方端点一套实现两道门;两域皆真——Atlas 统一推理计量(恒不经 Runos);Ontos 供 Schema(v1.1 起以 L2 成员身份供给,流向不变);L0 贯穿(org/WS/entitlement/计量/协议/沙箱/sharing SoT)。

## 5. 商业化参与矩阵

| 机制                                   | 参与产品                                                                                  | 说明                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| workspace × product 订阅(state × tier) | atlas / ontos / runos / arda / karda / terra / raven / anlan / forge / xuanzhen           | ADR-11 权益引擎;每产品 5 档(free→enterprise)                                                                                          |
| P 级资产 SKU(entitlement 售卖)         | karda(平台知识库) / terra(地图·影像·白膜) / arda(通用参考数据) / runos(平台能力包,四原语) | 独立 SKU 或 tier 权益;来源审计强制(共享模型 §4.2);runos 能力包 = 两段裁决产物(opera 供给 → admin 封装),配额 = min(技术上限, 商业配额) |
| SharingGrant(org 内)                   | arda / karda / terra 的 T/A 级资产 + runos 技能                                           | SoT = 控制面 `sharing` 域                                                                                                             |
| 现状租户级订阅(豁免新引擎)             | umbra                                                                                     | 承继原 ruyin 的 plan/claim,不迁移                                                                                                     |
| 不参与                                 | hermes / varda / ruyin(client 端,待产品定义再议)                                          | —                                                                                                                                     |

## 6. 命名迁移与实施登记(docs 已定,落地为后续实施项)

本表为**目标态与迁移考量登记**,均非本轮 docs 动作;实施须按锁步纪律单独排期与授权。**实施规划权威 = [`product_300_naming-migration.md`](./product_300_naming-migration.md)**(含 ruyin→umbra 一次切换专项规划,owner 2026-07-07 拍板授权实施):

| #   | 迁移项                       | 动作                                                                                                                                                               | 考量                                                                               |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | seed `data` → `arda`         | ✅ 完成(PR #663,2026-07-07 落活库,状态权威 = product_300 §1 M1)                                                                                                    | 占位产品行,无订阅引用,可重灌阶段直接改                                             |
| 2   | `nocus` OIDC client          | ✅ 完成(退役:活库置 disabled,PR #663;状态权威 = product_300 §1 M2)                                                                                                 | Nocus 名在终版矩阵无位置                                                           |
| 3   | `vault` / `cortex` 候选名    | 废弃                                                                                                                                                               | 仅存在于旧设计稿(product-oidc-subscription),随其标记删除                           |
| 4   | `karda` / `terra` 目录项     | 新增 product + client + 域名                                                                                                                                       | 随各自产品接入排期                                                                 |
| 5   | 现 `ruyin` code → `umbra`    | ✅ **完成**(2026-07-07:活库 seed 生效 + worker-04 对端 env 切换;验证=umbra×ruyin.ai authorize 302 正控、旧 client_id 组合 400 负控、plan `umbra-free`、目录四产品) | secret 沿用原 hash(免明文转运);规划权威 = product_300 §2 v1.1                      |
| 6   | 新 `ruyin`(client 端) 目录项 | 🚧 并入 #5 同窗(product + OIDC client 落 `ruyin.vxture.com`;plan/产品定义仍待建)                                                                                   | 同一 seed 事务先改码后插入,无撞名                                                  |
| 7   | `products.layer` 列          | product 域加显式分层列(varchar CHECK: l1/l2/l3/client/external/internal)                                                                                           | 归 `data_product_200` 后续修订(铁律四:矩阵分层是既定能力);未落列前以本文为分层权威 |
| 8   | `sharing` 域 schema          | 控制面新增域(SoT)                                                                                                                                                  | 归 `data_sharing_100/200` 新设计线(待建)                                           |

## 7. 修订记录

### v1.2(2026-08-10)— runos 行按商业能力面改写(owner 决定 2026-08-07,runos `ADR-003`)

**依据**:runos 产品定义 v0.5 采纳,Runos = **商业能力面**;`product_110` §6/§7 的"纯控制面/无运行时/零计量/不在调用链路"与之冲突,runos 侧按偏差纪律声明(TD-004)并提报本仓 issue [#216](https://github.com/vxture/vxture-platform/issues/216)。**定性 = 收窄改写(scoping),不是反转**:联邦域四条性质(唯一直连、无中心瓶颈、无 ESB、提供方侧求值)整体保留,新增的是**第二个域**——以订阅独立交付的业务场景 agent 经 Runos 网关消费可售能力包。语义权威改在 [`product_110`](./product_110_sharing-isolation.md) v1.1 §6/§7,本文只改矩阵行与定位卡。

**本次已改**:§1 分层图 L1 行、§2 矩阵 runos 行(`agent-db` 否→**是**、P 级资产列 → 平台能力(四原语)、现状/定位 → 商业能力面)、§2 `agent-db` 列语义注、§3 Runos 定位卡 + L1 不变量补注、§4 流向注记、§5 P 级资产 SKU 行。

**随后补齐(2026-08-10 同日,#205 机械项)**:域名格改 `runos.vxture.com`——**`runos.ai` 这个域名不存在**(owner 2026-08-10 明确),异 apex 例外只剩 anlan.ai / xuanzhen.ai;中文名 = **鲁诺斯**(seed 侧同批修正)。

**仍未决**:商业域内的计量归属与去重、org 自建能力的 grant 求值点,登记在 `product_110` §6.8,**商业域首个可售能力包上线前**须收口。

**下游同步清单**(随各自文档/排期落地,本修订不代做):

| #   | 同步项                                                                              | 落点                                                 | 状态                                                                                       |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | 术语表 Runos 一行定义(skills → commercial capability plane)                         | `docs/00-meta/20-glossary.md`                        | ✅ 本次已改                                                                                |
| 2   | ADR-12 D8 结论按域收窄标注(决策原文不改写,加指向注)                                 | `decisions/ADR-012-sharing-grant-design.md`          | ✅ 本次已加注                                                                              |
| 3   | 模板模块矩阵 runos 三格(C3 consume 零计量 / provider 守卫不适用 / 覆盖表"纯控制面") | `product_240_repo-template.md` §3、§5                | ✅ 本次已加注(全表修订随模板线下次迭代)                                                    |
| 4   | C3 consume 计量注册表键位与上报归属(商业域能力包口径)                               | 计量注册表 / billing 线                              | 待定(阻塞项 = `product_110` §6.8#1)                                                        |
| 5   | 商业域网关在 L0 工具协议中的位置(既是 caller 又是 provider;"不建网关"仅约束协议层)  | `product_210_tool-protocol.md` §1/§2                 | ✅ 本次已加注(`aud=runos`/`scope=tool:runos`/四固定 MCP 工具的契约位待 runos 侧对齐时回填) |
| 6   | `vx_runos_db` 基础设施登记(库名/端口段/部署宿主)                                    | `docs/50-deployment/13-infra-allocation-registry.md` | 已办(issue #214)                                                                           |
| 7   | **集成矩阵 runos 行的 C3 consume 格**(v1.2 遗漏,2026-08-13 补登)                    | `product_200_integration.md` §6                      | ✅ 已补(按域二分 + 指向 §6.8#1 未决;本条当初漏列,与 #3 同类)                               |

### v1.1(2026-07-28)— ontos L1→L2 重定位(owner 拍板)

**依据**:ontos 面向用户的高频构建操作(本体/语义建构是交互式工作),不满足 L1 判据("其它产品实现业务时必须经过的底层管道",被服务调用、API-first、零端用户 UI);其原 L1 登记本就"产品定义空白、多格待定义",从未被论证。重定位后 L1 成为干净类别(atlas/runos 同构:API-first + 管理面按 `product_250` 统一交付),L2/L3 = 自有 portal 的用户面产品——分类学自洽,无特判。

**本次已改**:§1 分层图、§2 矩阵行、§3 定位卡(L1 不变量声明 + ontos 卡迁入 L2)、§4 流向注记。

**下游同步清单**(随各自文档/排期落地,本修订不代做):

| #   | 同步项                                                                                                                                       | 落点                                                                               | 状态                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | 术语表 L1/L2 清单                                                                                                                            | `docs/00-meta/20-glossary.md`                                                      | ✅ 已改(2026-08-10 随 v1.2 一并落地)             |
| 2   | 模块×层矩阵 ontos 列按 L2 重读(全表修订随模板线下次迭代)                                                                                     | `product_240_repo-template.md` §3                                                  | 已加注记                                         |
| 3   | ~~端口段重分配(ontos 现划在 L1 段,应迁 L2 段)~~ **已完成**(owner 2026-08-13:ontos 迁入 L2,接手 vxtpl 腾出的子块;vxtpl 与 template 合并归 L3) | [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f) | 待改(ontos 未部署,零迁移成本,**先于任何部署改**) |
| 4   | `products.layer` 列值(若 §6#7 显式分层列已落库则 UPDATE,未落则无事)                                                                          | data_product 线 / seed                                                             | 待查                                             |
| 5   | ontos 建仓时套用 L2 app profile(而非 L1 services profile)                                                                                    | `product_240` §2.5                                                                 | 建仓前置                                         |

## 8. 旧文档处置

- [`product-oidc-subscription.md`](./commerce/40-oidc-subscription.md):产品清单/定位被本文取代,接入通道被 [`product_200_integration.md`](./product_200_integration.md) 取代——**已标记删除**(banner);其 UUID 分配表/Phase 实施细节在删除前如仍有效须迁入接替文档或 seed 注释;
- `tenant.md` / `decisions/005` / `glossary.md` 相关条目:单层租户与旧 ruyin 语义的清理见各文件标记。
