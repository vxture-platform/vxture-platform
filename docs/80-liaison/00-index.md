# 80-liaison

跨组织对接联络。**2026-07-27 起，新联络改用 GitHub Issues（`liaison` 标签），本目录停止新增
`NN-YYMMDDHHmm-slug.md` 文件**——原因与约定见
[`140-repo-governance-standard.md`](../10-standards/140-repo-governance-standard.md) §10。
既有信件文件保留作历史归档（本目录下同级文件），不追溯迁移、不删除。

下表是当前活跃的跨仓 issue 快照（人工维护，非自动同步——状态以对应仓库里的 issue 实际状态为准，
本表仅供一眼概览，发现过期及时更新，不做实时联动）。

> **2026-07-27 更新**：atlas 侧 5 个 issue（#34/#35/#41/#42/#43）在开出后数十分钟内即被关闭——
> 核实并非误报或异常，是 atlas 仓另一并行会话已提前于 `254092f` 提交完成（capability discovery、
> 租户过滤模型清单、taskProfile 路由、A2.3 结论、karda 回函 `vxture-karda#70`），双方时间线有重叠，
> 关闭时机早于本表更新纯属巧合，已逐条核实（commit 存在、karda#70 存在且内容吻合）。

## 活跃 issue 追踪

### vxture-atlas

| Issue                                                   | 内容概要                                                                                                                                                       | 状态                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [#34](https://github.com/vxture/vxture-atlas/issues/34) | 回复 karda 140 函——token-exchange 已实现、host 已分配两个前提已过期                                                                                            | **Closed**（`254092f`，回函=`vxture-karda#70`）               |
| [#35](https://github.com/vxture/vxture-atlas/issues/35) | A2.3 部署亲和结论（host 分配已解除阻塞）                                                                                                                       | **Closed**（结论=同机 worker-02）                             |
| [#36](https://github.com/vxture/vxture-atlas/issues/36) | A3.3 rerank P95 延迟基准压测 + 回函                                                                                                                            | Open                                                          |
| [#37](https://github.com/vxture/vxture-atlas/issues/37) | 实现 A1 `POST /v1/embed`                                                                                                                                       | Open                                                          |
| [#38](https://github.com/vxture/vxture-atlas/issues/38) | 实现 A2 `POST /v1/parse`                                                                                                                                       | Open                                                          |
| [#39](https://github.com/vxture/vxture-atlas/issues/39) | 实现 A3 `POST /v1/rerank`                                                                                                                                      | Open                                                          |
| [#40](https://github.com/vxture/vxture-atlas/issues/40) | URL 路径统一：`/model-platform/chat` → `/v1/chat`                                                                                                              | **Closed**（本仓对应侧已跟进：PR#157/158 改代理路径）         |
| [#41](https://github.com/vxture/vxture-atlas/issues/41) | 租户过滤的"可选模型"清单接口（karda 用户选择器依赖）                                                                                                           | **Closed**（`GET /model-platform/models?tenantId=`）          |
| [#42](https://github.com/vxture/vxture-atlas/issues/42) | 任务画像路由（`model_policy`，业务自动适配依赖）                                                                                                               | **Closed**（`taskProfile` + `model_grants.task_profile` 列）  |
| [#43](https://github.com/vxture/vxture-atlas/issues/43) | 能力发现登记 `.well-known/vxture-tools`                                                                                                                        | **Closed**（`service/src/discovery/`）                        |
| [#52](https://github.com/vxture/vxture-atlas/issues/52) | M-1 operator-token 校验落地到 admin 路由（product_250 mgmt-plane 契约 atlas 半，本仓平台半=PR#151）                                                            | Open（排在 `#66` 端到端确认之后，见下）                       |
| [#66](https://github.com/vxture/vxture-atlas/issues/66) | 主线程：platform→atlas S2S 全量上线（console-bff 四方法已切 `/tenancy/*`，`act.sub="console"` 非产品码）+ atlas→platform C2/C3 已双向打通 + 命名空间冲突已解决 | Open（等 atlas v0.1.15 真实端到端验证回报，之后才推进 `#52`） |

### vxture-platform（atlas 反向开给本仓的 issue）

| Issue                                                        | 内容概要                                                                 | 状态                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [#148](https://github.com/vxture/vxture-platform/issues/148) | Atlas 管理界面缺口（provider-keys/taskProfile UI）+ Atlas 管理面归属讨论 | Open（架构问题已由 `product_250` M-1..M-5 回答；UI 缺口排入 atlas admin-module 批次，待 atlas `#52`） |
| [#152](https://github.com/vxture/vxture-platform/issues/152) | modelCode 前缀约定与真实上游 API 冲突                                    | Open（标准澄清已发：PR#176，`config.upstreamModel` 字段，atlas 侧待排期实现）                         |
| [#159](https://github.com/vxture/vxture-platform/issues/159) | product_210 ToolDescriptor 缺 endpoint 字段                              | Open（已修：PR#173，`§4.1a`；atlas 已镜像进 `discovery.types.ts`）                                    |
| [#164](https://github.com/vxture/vxture-platform/issues/164) | 治理标准缺周期性 DB 维护类别                                             | Open（已修：PR#173，新增 `db-maintenance.yml` 第三类）                                                |
| [#167](https://github.com/vxture/vxture-platform/issues/167) | 安全：五仓 ruleset 均对 admin 开无条件 bypass                            | Open（本仓已修：PR#172 + live ruleset 确认；karda/arda/template 三仓仍待 owner）                      |
| [#170](https://github.com/vxture/vxture-platform/issues/170) | S2S token 缺 tenant_id claim（personal 类租户无租户身份）                | **Closed**（PR#171 随合并自动关闭）                                                                   |

### vxture-karda

| Issue                                                   | 内容概要                                                                                                     | 状态 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| [#72](https://github.com/vxture/vxture-karda/issues/72) | 确认模型选择 UX 方向（业务自动适配 vs 用户主动选择，依赖的 atlas #41/#42 均已 Closed，karda 可以据此确认了） | Open |

### vxture-platform（runos 开给本仓的 issue）

runos 于 2026-08-09～10 建仓并首次生产部署（worker-02，v0.1.0/v0.2.0），三封请求全部开在本仓。
runos 仓内现有 issue（`vxture-runos#9`，Prisma 7 adapter 抢先读 `DATABASE_URL`）是 atlas↔runos 的事，不涉本仓。

| Issue                                                        | 内容概要                                                                                   | 状态                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#205](https://github.com/vxture/vxture-platform/issues/205) | `runa`→`runos` 改名/注册（product 行、OIDC client、`aud=runos`、`mgmt:runos`、C3 webhook） | Open（主体已办：PR#211 产品行/显示名/audiences、PR#213 迁移语句退役、PR#214 infra registry；收尾：中文名 **鲁诺斯** + 定位纠正 + 残留 `runos.ai` 清除；`runos.ai` 域名**从不存在**，owner 2026-08-10 明确） |
| [#209](https://github.com/vxture/vxture-platform/issues/209) | CD 参照模式加固：显式 build `target:` + 多镜像构建指引 + worker-02 宿主 Docker socket      | Open（1/2 已办：PR#215 标准 §4 + 本仓 `docker-build.yml` 补 `target: runner`；**3 待 owner 拍板**：宿主 socket = host-root 等价，worker-02 与 atlas/arda/varda/vxtpl 同机，blast radius 需显式决定）        |
| [#216](https://github.com/vxture/vxture-platform/issues/216) | `product_110` §6/§7 + 矩阵 runos 行按**商业能力面**收窄改写（TD-004 / runos ADR-003）      | **Closed**（main `c2e4975`，PR#218；`product_110` v1.1 + `product_100` v1.2；未决项转 `product_110` §6.8：商业域计量归属/去重、org grant 求值点）                                                           |

## 历史归档（既有信件文件，本目录同级，不再新增同类文件）

`10`–`40` 号为 2026-07-22～23 期间的信件往来（taxonomy 修订回函 / karda 注册 A 段回函+完成确认），
保留原状，仅供追溯，不代表当前进行中的对接状态——当前状态以上表 Issues 为准。
