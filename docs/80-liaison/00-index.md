# 80-liaison

跨组织对接联络。**2026-07-27 起，新联络改用 GitHub Issues（`liaison` 标签），本目录停止新增
`NN-YYMMDDHHmm-slug.md` 文件**——原因与约定见
[`140-repo-governance-standard.md`](../10-standards/140-repo-governance-standard.md) §10。
既有信件文件保留作历史归档（本目录下同级文件），不追溯迁移、不删除。

下表是当前活跃的跨仓 issue 快照（人工维护，非自动同步——状态以对应仓库里的 issue 实际状态为准，
本表仅供一眼概览，发现过期及时更新，不做实时联动）。**上次核对：2026-08-10**（当日本仓开着的 8 个收到 4 个：#148/#152/#167/#189/#209/#216/#223 关闭，余 #188/#205/#220/#226）。

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

| Issue                                                        | 内容概要                                                                 | 状态                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#148](https://github.com/vxture/vxture-platform/issues/148) | Atlas 管理界面缺口（provider-keys/taskProfile UI）+ Atlas 管理面归属讨论 | **Closed**（2026-08-10；part2 已由 `product_250` M-1..M-5 回答并建成；part1 两个 UI 缺口移交 [`vxture-atlas#131`](https://github.com/vxture/vxture-atlas/issues/131) 承接——按裁定归 atlas admin-module） |
| [#152](https://github.com/vxture/vxture-platform/issues/152) | modelCode 前缀约定与真实上游 API 冲突                                    | **Closed**（2026-08-10；PR#204/#207 + 活库回填随 db-init `seed` 跑到 `0fce0a1`；adapters 读序归 atlas 自排期）                                                                                           |
| [#159](https://github.com/vxture/vxture-platform/issues/159) | product_210 ToolDescriptor 缺 endpoint 字段                              | Open（已修：PR#173，`§4.1a`；atlas 已镜像进 `discovery.types.ts`）                                                                                                                                       |
| [#164](https://github.com/vxture/vxture-platform/issues/164) | 治理标准缺周期性 DB 维护类别                                             | Open（已修：PR#173，新增 `db-maintenance.yml` 第三类）                                                                                                                                                   |
| [#167](https://github.com/vxture/vxture-platform/issues/167) | 安全：五仓 ruleset 均对 admin 开无条件 bypass                            | **Closed**（2026-08-10；实读五仓 API `bypass_actors` 全空，vxture-template 最后一个由本次清掉。**新发现**：`vxture-ontos` 无任何分支保护——空仓，另见 infra registry 纠错）                               |
| [#170](https://github.com/vxture/vxture-platform/issues/170) | S2S token 缺 tenant_id claim（personal 类租户无租户身份）                | **Closed**（PR#171 随合并自动关闭）                                                                                                                                                                      |

| [#188](https://github.com/vxture/vxture-platform/issues/188) | 安全：标准点名第三方 action 供应链风险，却把生产 SSH 私钥交给可变 tag | Open（钉 SHA 已办：PR#222 全部 30 处 + tailscale v3→v4；**换掉 appleboy 未办**——要重写活的部署路径、只能靠真实部署验证，排在端口重排那次 deploy 之后） |
| [#189](https://github.com/vxture/vxture-platform/issues/189) | SONAR：org `SONAR_TOKEN` 全域 403，两仓都把失败报成成功 | **Closed**（2026-08-10；owner 换发 token → 本仓首次真实扫描 `EXECUTION SUCCESS`；PR#225 摘掉 `continue-on-error`。`SonarQube` 是否进 required checks 留给 owner） |
| [#220](https://github.com/vxture/vxture-platform/issues/220) | 发布 atlas plan_version（计费全 409 门控）+ ConsumeResponseBody 加 `event_id` | Open（`event_id` 已发：PR#229；plan 那半 = **运营动作**，且机制已更正——atlas 不作应用单卖，配额以 `bundled` 组件打包进应用计划、按 WS 加油包补，见 issue 内更正） |
| [#223](https://github.com/vxture/vxture-platform/issues/223) | CD 远端 wrapper 用固定 `/tmp/deploy.sh`，arda×atlas 实测撞车 | **Closed**（2026-08-10；PR#228 四个 workflow 改 per-run staging 路径 + 标准 §4 立规。本仓自查出更锋利一例：deploy 与 db-init 共用固定路径且 concurrency group 不同） |

### vxture-platform（arda 开给本仓的 issue）

| Issue                                                        | 内容概要                                                      | 状态                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#226](https://github.com/vxture/vxture-platform/issues/226) | RFC 8693 token exchange（arda external-API step 3，最后一项） | Open（**平台侧无需开发**：该 grant 自 T1 起就在跑，已逐条回答 claim/TTL/scope 并纠正两处；platform-api 现供 `/openapi.json`；等 arda 实测换票后关闭） |

### vxture-karda

| Issue                                                   | 内容概要                                                                                                     | 状态 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| [#72](https://github.com/vxture/vxture-karda/issues/72) | 确认模型选择 UX 方向（业务自动适配 vs 用户主动选择，依赖的 atlas #41/#42 均已 Closed，karda 可以据此确认了） | Open |

### vxture-platform（runos 开给本仓的 issue）

runos 于 2026-08-09～10 建仓并首次生产部署（worker-02，v0.1.0/v0.2.0），三封请求全部开在本仓。
runos 仓内现有 issue（`vxture-runos#9`，Prisma 7 adapter 抢先读 `DATABASE_URL`）是 atlas↔runos 的事，不涉本仓。

| Issue                                                        | 内容概要                                                                                   | 状态                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#205](https://github.com/vxture/vxture-platform/issues/205) | `runa`→`runos` 改名/注册（product 行、OIDC client、`aud=runos`、`mgmt:runos`、C3 webhook） | Open（平台侧全办完：PR#211/#213/#214 + PR#219 中文名 **鲁诺斯**/定位纠正/清 `runos.ai`（该域名**从不存在**）+ PR#224 密钥按目录发放，db-init `provision-secrets` 已跑、runos client secret 已生成待转运；**等 runos 跑 e2e 自行关闭**） |
| [#209](https://github.com/vxture/vxture-platform/issues/209) | CD 参照模式加固：显式 build `target:` + 多镜像构建指引 + worker-02 宿主 Docker socket      | **Closed**（2026-08-10；1/2 = PR#215；**3 = owner 拍板不批 raw socket**，要求 runos 另提 socket proxy 方案——操作集合 + microVM/gVisor 时间线，新形状另开 issue）                                                                        |
| [#216](https://github.com/vxture/vxture-platform/issues/216) | `product_110` §6/§7 + 矩阵 runos 行按**商业能力面**收窄改写（TD-004 / runos ADR-003）      | **Closed**（main `c2e4975`，PR#218；`product_110` v1.1 + `product_100` v1.2；未决项转 `product_110` §6.8：商业域计量归属/去重、org grant 求值点）                                                                                       |

## 历史归档（既有信件文件，本目录同级，不再新增同类文件）

`10`–`40` 号为 2026-07-22～23 期间的信件往来（taxonomy 修订回函 / karda 注册 A 段回函+完成确认），
保留原状，仅供追溯，不代表当前进行中的对接状态——当前状态以上表 Issues 为准。
