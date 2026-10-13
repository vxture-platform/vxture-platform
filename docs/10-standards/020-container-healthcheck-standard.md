# 容器健康探测（healthcheck）标准

**用途**：给任意服务补齐 Docker healthcheck，作为部署就绪闸门 + 状态可视 + 排障入口。零一项目可直接套用。
**来源**：从 vxture 实战萃取，含 Next.js standalone 的真实大坑。
**版本**：1.1.0 ｜ **更新**：2026-10-13
**配套**：本标准管**探活机制**；健康端点**响应体契约**（返回什么字段、构建期溯源注入）见 [`025-service-health-endpoint-contract`](./025-service-health-endpoint-contract.md)。

---

## 1. 适用判定

每个长驻服务都应有 healthcheck。无状态前端、BFF、后端服务、反代均适用。一次性 job / init 容器不需要。

---

## 2. 做法（可直接复制的模式）

1. 每个服务加 `healthcheck`，探一个**轻量、无依赖**的 liveness 端点。
2. **探测工具只用镜像里已有的运行时**，不引入新依赖：
   - **Python**：`["CMD","python","-c","import urllib.request; urllib.request.urlopen('http://127.0.0.1:PORT/health', timeout=3)"]`
   - **Node / Next.js**：`["CMD","node","-e","fetch('http://127.0.0.1:PORT/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`
   - **nginx**：`["CMD","nginx","-t"]`
   - 别盲赌 `busybox wget --spider`（不同构建支持不一）；要用就 `wget -q -O /dev/null URL`，或直接用语言运行时更稳。
3. 应用侧加一个 **dependency-free 健康路由**（不连 DB/Redis/上游，只证明进程在听）：
   - **Next.js App Router**：`app/api/health/route.ts` → `export function GET(){ return NextResponse.json({status:"ok"}) }`，配 `export const dynamic="force-dynamic"`、`runtime="nodejs"`。
   - **Python**：`/health` 返回 200 `"ok"`。
4. **参数**：`interval 30s` / `timeout 5s` / `retries 3` / `start_period`（给启动留足：Next ~20s，Python ~10–15s）。
5. **部署脚本用健康态做就绪闸门**：轮询直到全部 `healthy` 才算部署成功；长期不 healthy → warn，崩溃/退出 → fail。**坏镜像进不了"部署成功"。**

---

## 3. ⚠️ 最大的坑：Next.js standalone + Docker loopback 探活

**现象**：standalone 的 `server.js` 绑定 `process.env.HOSTNAME`，而 Docker 会自动把 `HOSTNAME` 设成**容器 ID** → 应用只监听容器 IP、**不监听 `127.0.0.1`** → `http://127.0.0.1:PORT` 探活永远连不上 → 容器卡在 `health: starting`，部署报 "not healthy after 60s"。
**为什么极易漏判**：经反向代理 / 服务名访问一切正常，只看"页面能开 / verify 过"会漏。

**修法**：Dockerfile runner 阶段加 `ENV HOSTNAME=0.0.0.0`（绑全网卡，loopback 可达，反代访问不受影响）。

### 通用原则（升级版）

**容器内应用一律监听 `0.0.0.0`，loopback 探活才可靠。**

逐框架自检（默认绑哪、需不需要改）：

| 运行时                    | 默认绑定                                | 动作                                            |
| ------------------------- | --------------------------------------- | ----------------------------------------------- |
| Next.js standalone        | `$HOSTNAME`（Docker 设成容器ID）        | **必须** `ENV HOSTNAME=0.0.0.0`                 |
| Node (express/fastify)    | 显式 `listen(port)` 默认 `::`/`0.0.0.0` | 通常 OK；勿写死 `127.0.0.1`                     |
| Python (uvicorn/gunicorn) | 取决于 `--host`                         | 显式 `--host 0.0.0.0`（vxture 本就如此,未踩坑） |
| Go (net/http)             | `:PORT` = 全网卡                        | OK                                              |
| Java (Spring)             | `0.0.0.0` 默认                          | OK；除非设了 `server.address`                   |

---

## 4. 必须知道的认知点

**Docker 的 restart policy 不会因 unhealthy 重启**：unhealthy 只是状态标记，Docker 本身不采取行动。`restart: always` / `unless-stopped` 接手的是**容器主进程退出**，不是一次探测失败。因此 healthcheck 开箱提供的是**部署就绪闸门 + 状态可视 + 排障入口**；运行时自愈和告警要另行接入。

### 4.1 自愈放在哪一层

| 方式                        | 如何动作                                                     | 适用范围与边界                                                            |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 容器内 watchdog             | 持续 liveness 失败后让服务主进程退出，由 restart policy 重启 | 服务自己负责；不需要 Docker socket；限可安全重启的无状态服务，须满足 §4.2 |
| 主机级看管者（如 autoheal） | 通过 Docker API 重启选中的 unhealthy 容器                    | 可作为未接入 watchdog 的服务及第三方镜像的兜底；须满足 §4.3               |
| 外部告警                    | 通知运营处置，不自动重启                                     | 不宜自动重启的服务及自愈失败的升级处置                                    |

容器内自愈与主机兜底可以分层使用；同一服务同时接入时须避免重复动作，并实测重启后的恢复。**不把本条机械用于数据库等有状态服务**：数据库停止应答可能正在恢复，反复杀进程会延长恢复甚至形成重启循环。

### 4.2 容器内信号式 watchdog 的必要条件

1. **`init: true` 与独立 PID 命名空间一起配置**。init 占据 PID 1，服务成为普通子进程；不能依赖应用恰好为 PID 1 安装了信号处理器。Linux 对 PID 1 有特殊信号保护：从其命名空间内发出的终止信号，若没有对应处理器，可能被忽略；广播也不会把 PID 1 当作普通目标。
2. **不以 `kill ... 1` 作为通用退出机制**。可以使用针对已核实服务 PID 的信号，或在独立容器 PID 命名空间内广播；Runos 使用 `kill -ABRT -1`。`-1` 表示向有权限的进程广播，**不是整个进程组**；不得在 `pid: host` 或共享其他容器 PID 命名空间的服务上套用广播。探针用户必须有权向目标进程发信号，且该进程退出必须真的使容器退出；信号选择及升级动作须按实际镜像验证。
3. **仅探无依赖 liveness，不探 readiness**（见标准 025 §2）。DB / Redis / 上游不可用不能成为杀掉本服务的依据。
4. **每次服务启动都在首次成功后才启用动作**。从未成功应答的服务交给部署闸门判失败，不因慢启动进入杀进程循环；成功后连续失败才累计，恢复成功清零。每次服务启动须重置启用标记与计数，不能跨启动复用；普通容器 restart 不清空可写层，仅把状态放在 `/tmp` 或不用持久卷并不能保证重置。
5. **探测超时也必须计入失败，且达到阈值仍能执行退出动作**。不能只在探测返回后累加：Docker 超时杀掉 healthcheck 进程时，那一段不会执行。可先记录尝试、成功后清零；同时限制内部探测时长，为退出动作留出 Docker healthcheck timeout 以内的时间。只证明立即返回失败会重启，不能证明卡住的探针会自愈。watchdog 动作阈值与 Docker 的 `healthcheck.retries` 分开声明，不能把后者当成重启次数阈值。
6. **Linux 镜像显式赋予执行权限**：以 exec 形式调用脚本时，Dockerfile 用 `COPY --chmod=0755 ...`，并将脚本可执行位记入 Git 索引。验证 CI 构建的 Linux 镜像里 `test -x` 成功；Windows Docker Desktop 的文件共享权限不能作为交付证据。

### 4.3 主机级看管者的权限与选择范围

autoheal 持有 Docker socket，通常等价于拥有宿主机 root 权限；标签筛选只限定正常运行时的动作范围，**不是权限隔离**。共享部署主机默认按标签选择加入（如容器标记 `autoheal=true`），不配置全容器覆盖；数据库等不宜自动重启的服务不加入。部署前核对所用版本的标签配置、镜像来源和实际重启目标，并保留外部告警：看管者自身失效时不能靠自己报告静默。

---

## 5. 验证（交付前必做）

- 部署后 `docker ps` 看 `(healthy)`。
- `docker inspect --format '{{json .State.Health}}' <container>` 看探测**历史 + 最后一次输出（退出码/stdout）** —— 排障神器。
- 实测确认部署日志出现 **"All containers healthy"**，而非 `starting`/`warn`。
  > vxture 正是靠这一步发现 Next 绑定坑；只看"部署 success / verify 过"会漏。

**声明已接入容器内自愈时，另在隔离测试容器上验证以下场景**，不向生产服务注入故障。必须记录 `RestartCount`、健康历史和恢复应答，不能只看探针输出了“已发信号”。

| 场景                                    | 必须观察到                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| 首次成功后持续失败                      | 服务进程实际退出，`RestartCount` 增加，恢复后 liveness 成功                     |
| 一直成功                                | 不重启，失败计数为 0                                                            |
| 短暂失败后恢复                          | 计数清零，不把不连续失败累计到阈值                                              |
| 首次部署及重启后的慢启动 / 从未成功应答 | 每次启动重新等待首次成功，watchdog 不杀进程；健康状态仍如实失败，部署闸门不放行 |
| 首次成功后探针持续卡住 / 超时           | 超时计入失败，达到阈值仍能退出并重启，不能只增长 `FailingStreak`                |

还须核验 `init: true`、PID 命名空间与信号权限，CI 镜像内脚本可执行，以及 `docker stop` 的 SIGTERM 能正常下传并完成应用收尾。使用主机级看管者时另验证：标记加入的测试容器会被重启，未标记容器不会被重启。

---

## 6. 落地清单（套用到新服务）

1. 应用加 `/api/health`（或 `/health`）dependency-free 路由。
2. compose 服务加 `healthcheck`（用本镜像运行时，探 `127.0.0.1`）。
3. Dockerfile 确认监听 `0.0.0.0`（Next：`ENV HOSTNAME=0.0.0.0`）。
4. 部署脚本加"轮询至 healthy"就绪闸门。
5. 部署后 `inspect` 健康历史确认全绿。
6. 选择并记录运行时处置方式（容器内自愈 / 主机兜底 / 告警）；采用自愈时落实 §4 的条件并通过 §5 的故障场景，未接入时不得仅凭 `(healthy)` 宣称已有自愈。

### 本次修订依据（#291）

- [平台 issue #291](https://github.com/vxture-platform/vxture-platform/issues/291) 的实测与后续交付反馈：unhealthy 不触发重启、PID 1 信号保护、首次成功后启用、Linux 脚本权限。
- Runos 参照实现（固定提交 `3f4f737ea35f7aa5e82792234ddcd53814526644`）：[watchdog](https://github.com/vxture-foundation/vxture-runos/blob/3f4f737ea35f7aa5e82792234ddcd53814526644/deploy/healthcheck/liveness-watch.sh)、[compose](https://github.com/vxture-foundation/vxture-runos/blob/3f4f737ea35f7aa5e82792234ddcd53814526644/docker-compose.yml)、[真实 Docker 回归脚本](https://github.com/vxture-foundation/vxture-runos/blob/3f4f737ea35f7aa5e82792234ddcd53814526644/service/dev/liveness-watch-check.mjs)。参照脚本不替代 §5 的逐项验证，尤其持续超时须单独验证。
- **本次仅补标准**。2026-10-13 核查时平台 `deploy/compose.platform.yml` / `deploy/compose.nginx.yml` 仍提供探活与 restart policy，未接入本节 watchdog / autoheal；不宣称平台自愈已部署。本次未运行故障注入，也未修改兄弟仓实现。
