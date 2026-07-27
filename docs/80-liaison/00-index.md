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

| Issue                                                   | 内容概要                                                            | 状态                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| [#34](https://github.com/vxture/vxture-atlas/issues/34) | 回复 karda 140 函——token-exchange 已实现、host 已分配两个前提已过期 | **Closed**（`254092f`，回函=`vxture-karda#70`）              |
| [#35](https://github.com/vxture/vxture-atlas/issues/35) | A2.3 部署亲和结论（host 分配已解除阻塞）                            | **Closed**（结论=同机 worker-02）                            |
| [#36](https://github.com/vxture/vxture-atlas/issues/36) | A3.3 rerank P95 延迟基准压测 + 回函                                 | Open                                                         |
| [#37](https://github.com/vxture/vxture-atlas/issues/37) | 实现 A1 `POST /v1/embed`                                            | Open                                                         |
| [#38](https://github.com/vxture/vxture-atlas/issues/38) | 实现 A2 `POST /v1/parse`                                            | Open                                                         |
| [#39](https://github.com/vxture/vxture-atlas/issues/39) | 实现 A3 `POST /v1/rerank`                                           | Open                                                         |
| [#40](https://github.com/vxture/vxture-atlas/issues/40) | URL 路径统一：`/model-platform/chat` → `/v1/chat`                   | Open                                                         |
| [#41](https://github.com/vxture/vxture-atlas/issues/41) | 租户过滤的"可选模型"清单接口（karda 用户选择器依赖）                | **Closed**（`GET /model-platform/models?tenantId=`）         |
| [#42](https://github.com/vxture/vxture-atlas/issues/42) | 任务画像路由（`model_policy`，业务自动适配依赖）                    | **Closed**（`taskProfile` + `model_grants.task_profile` 列） |
| [#43](https://github.com/vxture/vxture-atlas/issues/43) | 能力发现登记 `.well-known/vxture-tools`                             | **Closed**（`service/src/discovery/`）                       |

### vxture-karda

| Issue                                                   | 内容概要                                                                                                     | 状态 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| [#72](https://github.com/vxture/vxture-karda/issues/72) | 确认模型选择 UX 方向（业务自动适配 vs 用户主动选择，依赖的 atlas #41/#42 均已 Closed，karda 可以据此确认了） | Open |

## 历史归档（既有信件文件，本目录同级，不再新增同类文件）

`10`–`40` 号为 2026-07-22～23 期间的信件往来（taxonomy 修订回函 / karda 注册 A 段回函+完成确认），
保留原状，仅供追溯，不代表当前进行中的对接状态——当前状态以上表 Issues 为准。
