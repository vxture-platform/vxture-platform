# 代码与部署环境对照表

> 更新：2026-06-01
> 本文件是 `vxture` 仓库的部署边界权威说明。若其他部署文档与本文冲突，以本文为准，并优先修订旧文档。

---

## 一、仓库职责边界

`vxture` 仓库只负责平台控制面代码与平台部署，不承接业务执行面的 vx-worker-02/03/04/05 等业务 worker 部署。

| 范围                   | 归属仓库      | 部署环境               | 服务器策略                                                | 本仓是否负责部署 |
| ---------------------- | ------------- | ---------------------- | --------------------------------------------------------- | ---------------- |
| 平台 prod              | `vxture`      | `main` → production    | `VXTURE_DEPLOY_HOST` 常驻服务器                           | 是               |
| 平台 beta              | `vxture`      | 未来按需启用           | 临时按量服务器，建议命名为 `vxture-beta`，用完即关闭      | 待规划           |
| 平台 develop           | `vxture`      | 本地开发 / CI          | 不部署长期服务器                                          | 否               |
| 业务 prod              | 外部业务仓库  | 外部业务仓库定义       | `vx-worker-02`，与 beta 用容器、端口、子域名隔离          | 否               |
| 业务 beta              | 外部业务仓库  | 外部业务仓库定义       | `vx-worker-02`，与 prod 同机隔离，验证满意后平滑切换 prod | 否               |
| 业务 worker 运维资产   | 外部业务仓库  | 外部业务仓库定义       | 由业务仓库维护 compose、secrets、脚本、回滚和发布审计     | 否               |
| 历史 vx-worker-02 文件 | 已迁出 / 删除 | 不作为本仓有效部署入口 | P7b 已从本仓删除，后续由外部业务仓库维护                  | 否               |

强制规则：

1. 本仓新增或修改 GitHub Actions 时，不得新增业务 worker 部署入口。
2. 本仓不得新增 `WORKER02_*` / `WORKER03_*` 等业务 worker GitHub Secrets 要求。
3. 本仓不得把业务 beta/prod 自动化挂到 `docker-build`、`deploy-production` 或任何 promotion 后置流程。
4. 业务仓库可以复用本仓的端口思想和分支治理经验，但实际 compose、脚本、secrets、DNS 切换、回滚路径必须由业务仓库维护。
5. `services/model/platform` 是平台 AI 接入网关，不是业务执行面服务；业务 worker 只能作为受控调用方，不承接该服务的部署职责。

---

## 二、外部业务仓库分工

业务执行面采用“一个业务仓库维护一个业务部署面”的方式推进。当前先迁移 Ruyin，等 Ruyin 仓库工作流、vx-worker-02 部署、回滚、secrets、DNS 和验证链路完整跑顺后，再规划 Varda 迁移。

| 业务     | 外部业务仓库               | 部署目标                                       | 当前状态                       | 本仓关系                                   |
| -------- | -------------------------- | ---------------------------------------------- | ------------------------------ | ------------------------------------------ |
| Ruyin    | `vxture/agentstudio-ruyin` | `vx-worker-02`                                 | 已迁移代码，作为业务工作流模板 | 本仓仅保留平台契约说明，不再承接部署       |
| Varda    | `vxture/agentstudio-varda` | 待规划                                         | Ruyin 跑顺后再规划迁移         | 迁移前不得在本仓恢复 vx-worker-02 workflow |
| umbra    | 外部 umbra 栈              | `vx-worker-04`（Vultr 境外主机，不在 tailnet） | 运行中（ruyin.ai + VPN）       | 只读写边界；不进入本仓部署链路             |
| 后续业务 | 对应 `agentstudio-*` 仓库  | worker-04+ 或业务指定 worker                   | 按业务独立规划                 | 不进入本仓部署链路                         |

Ruyin 业务仓库应沉淀为模板，覆盖：beta/prod 容器隔离、端口分配、子域名/DNS、secrets、镜像拉取、部署审计、回滚和用户验收流程。Varda 迁移只复用已验证的业务仓库模式，不复用本仓历史 vx-worker-02 文件。

---

## 三、代码目录与部署环境对照

| 代码目录 / 能力                             | 代码性质                        | 本仓 prod 部署       | 未来平台 beta 部署 | 业务 worker 部署 | 说明                                                                              |
| ------------------------------------------- | ------------------------------- | -------------------- | ------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `portals/website`                           | 平台官网 / 登录入口             | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 平台用户入口                                                                      |
| `portals/console`                           | 租户控制台                      | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 平台控制面                                                                        |
| `portals/admin`                             | 运营后台                        | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 平台控制面                                                                        |
| `bff/gateway-bff`                           | 平台统一 API 网关               | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | `api.vxture.com` 入口                                                             |
| `bff/auth-bff`                              | JWT / OAuth / SSO 签发源        | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 外部业务如需认证，应通过 HTTP/SSO 调用，不引用本仓包                              |
| `bff/website-bff`                           | 官网 BFF                        | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 平台数据访问                                                                      |
| `bff/console-bff`                           | 控制台 BFF                      | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 平台数据访问                                                                      |
| `bff/admin-bff`                             | 运营后台 BFF                    | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 平台数据访问                                                                      |
| `packages/shared/*`                         | 共享类型 / 常量 / 工具          | 随依赖构建           | 随依赖构建         | 不由本仓部署     | 低层包不单独部署                                                                  |
| `packages/core/*`                           | 平台基础设施能力                | 随依赖构建           | 随依赖构建         | 不由本仓部署     | 不承接业务运行时                                                                  |
| `packages/design/*`                         | 设计系统                        | 随前端构建           | 随前端构建         | 不由本仓部署     | 包发布另按 DS 流程                                                                |
| `services/commerce/*`、`services/support/*` | 平台域服务代码                  | 随 BFF 打包          | 随 BFF 打包        | 否               | 当前不是独立容器                                                                  |
| `services/notification/*`                   | 平台通知能力                    | 随 BFF 打包          | 随 BFF 打包        | 否               | 例如 SMTP 邮件                                                                    |
| `services/model/platform`                   | 平台 AI 接入网关                | `VXTURE_DEPLOY_HOST` | `vxture-beta`      | 否               | 模型注册、Provider 接入、路由、授权、配额、计量；业务 worker 仅通过受控 HTTP 调用 |
| `agent-studio/*`                            | Agent 前端历史/候选目录         | 不作为平台部署       | 待重新确认         | 外部业务仓库负责 | 不得据此规划 vx-worker-02 workflow                                                |
| `agent-server/*`                            | Agent Server 历史/候选目录      | 不作为平台部署       | 待重新确认         | 外部业务仓库负责 | 不得据此规划 vx-worker-02 workflow                                                |
| `bff/varda-bff`                             | Agent BFF 历史/候选目录         | 不作为平台部署       | 待重新确认         | 外部业务仓库负责 | 不得据此规划 vx-worker-02 workflow                                                |
| `business/*`                                | 外部业务/品牌入口历史或占位目录 | 不作为平台部署       | 待重新确认         | 外部业务仓库负责 | 若继续保留，需单独 ADR 说明                                                       |

> “历史/候选目录”表示当前仓库存在相关代码或文件，但它们不自动构成本仓部署职责。任何人或 AI 不得仅凭目录存在就新增 vx-worker-02/03/04/05 等业务 worker 部署规划。

---

## 四、Atlas（原 Model Platform）

已拆分为独立仓 `vxture-atlas`（2026-07-24），本仓 `services/model/platform` 于 2026-07-28 退役删除，不再是本仓部署单元。业务服务如需 AI 能力，只能通过受控 HTTP/API 调用 Atlas，不得持有平台统一 Provider Key、不得在业务 worker 自建网关。详见 [`docs/30-design/platform/40-model-platform.md`](../30-design/platform/40-model-platform.md)。

---

## 五、环境与分支对照

| 分支 / 环境        | 代码来源       | 构建产物                  | 部署目标                   | 自动部署 | 说明                                     |
| ------------------ | -------------- | ------------------------- | -------------------------- | -------- | ---------------------------------------- |
| 本地开发           | 工作分支       | 本地 pnpm / Docker 可选   | 开发者本机                 | 否       | 可本地启动多个服务进行联调               |
| `develop`          | 日常集成       | CI 校验                   | 无                         | 否       | 不构建正式镜像，不部署                   |
| `beta`             | 预发布候选     | 可构建 `:beta` 镜像       | 默认无长期平台 beta 服务器 | 否       | 未来若需要，手动部署到临时 `vxture-beta` |
| `main`             | 已确认生产版本 | `:latest` / `:sha-*` 镜像 | `VXTURE_DEPLOY_HOST`       | 是       | main 更新后自动部署平台 prod             |
| 业务仓库 beta/prod | 外部业务仓库   | 外部业务仓库定义          | `vx-worker-02`             | 外部定义 | 本仓不得承接                             |

平台 beta 的约束：

1. `vxture-beta` 是临时按量服务器，不是 vx-worker-02。
2. `vxture-beta` 只承接平台服务：website、console、admin、gateway-bff、auth-bff、平台 BFF、平台数据库/Redis。
3. `vxture-beta` 的创建、销毁、数据脱敏、DNS 切换和费用控制必须在启用前单独设计。

---

## 六、服务器职责对照

| 服务器               | 角色                                                                                     | 常驻性     | 本仓职责                                        | 禁止事项                                                       |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `VXTURE_DEPLOY_HOST` | 平台 prod 控制面                                                                         | 常驻       | 平台容器、平台数据库、Nginx、平台备份、生产部署 | 不承载业务 beta/prod 双环境                                    |
| `vxture-beta`        | 平台 beta 临时环境                                                                       | 临时       | 未来按需创建，仅用于平台验证                    | 不与 vx-worker-02 混用                                         |
| `vx-worker-02`       | 业务执行面                                                                               | 常驻       | 无，由外部业务仓库维护                          | 本仓不得部署、不得新增 secrets、不得新增 vx-worker-02 workflow |
| `vx-worker-04`       | umbra 栈（ruyin.ai + VPN；Vultr 境外主机，不在 tailnet；原 worker-03 已销毁 2026-07-07） | 常驻       | 无，由 umbra 外部栈维护                         | 同 vx-worker-02；只读写边界，动作须逐次显式授权                |
| `worker-05+`         | 后续业务执行面                                                                           | 按业务定义 | 无，由对应外部业务仓库维护                      | 同 vx-worker-02；不得部署本仓平台服务                          |

业务执行面的目标形态记录如下，供理解边界，不作为本仓实施任务：

| 业务环境 | 服务器         | 隔离方式                       | 目标           |
| -------- | -------------- | ------------------------------ | -------------- |
| beta     | `vx-worker-02` | 独立容器、独立端口、独立子域名 | 用户试用与验收 |
| prod     | `vx-worker-02` | 独立容器、独立端口、独立子域名 | 正式服务       |

---

## 七、CI/CD 边界

`vxture` 仓库的 CI/CD 只应覆盖以下职责：

| Workflow 类型     | 本仓允许范围                                     | 不允许范围                         |
| ----------------- | ------------------------------------------------ | ---------------------------------- |
| CI                | 类型检查、Lint、包边界、测试、审计               | 触发业务仓库部署                   |
| Docker build      | 构建本仓平台相关镜像                             | 以 vx-worker-02 为目标部署业务服务 |
| Production deploy | `main` 后自动部署 `VXTURE_DEPLOY_HOST` 平台 prod | 自动或手动部署 vx-worker-02        |
| Beta deploy       | 未来仅允许平台临时 `vxture-beta` 手动部署        | 复用 vx-worker-02 或部署业务 beta  |
| Branch promotion  | `develop -> beta -> main` 受控晋升               | 混入业务仓库发布确认               |

P7a 曾把 vx-worker-02 手动部署入口加入本仓 workflow，这是越界实现。当前已断开 GitHub Actions 入口：`deploy-production` 只允许 VXTURE_DEPLOY_HOST，`deploy-beta` 不再执行部署。P7b 已删除本仓 `deploy/vx-worker-02` 历史 compose/env/scripts 资产，后续 vx-worker-02 部署只能在外部业务仓库维护。

---

## 八、AI 规划检查清单

执行部署、CI/CD、环境变量、端口或 DNS 相关任务前，必须先回答以下问题：

1. 这项任务是否属于平台控制面？
2. 部署目标是否是 `VXTURE_DEPLOY_HOST` 或未来临时 `vxture-beta`？
3. 是否把 `services/model/platform` 保持为平台服务，而不是部署到业务 worker？
4. 是否引入了 `vx-worker-02/03/04/05`、业务 beta/prod、业务子域名、业务数据库或 `WORKER02_*` secrets？
5. 如果答案涉及业务 worker，是否已经确认这是外部业务仓库任务？
6. 如果涉及 Ruyin，是否应转到 `vxture/agentstudio-ruyin`？
7. 如果涉及 Varda 迁移，是否等待 Ruyin 模板跑顺后再规划 `vxture/agentstudio-varda`？
8. 是否更新了本文的代码与部署环境对照表？

只要任务目标包含业务 worker，本仓默认结论就是：停止实现，转外部业务仓库规划。
