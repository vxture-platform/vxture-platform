# 版本基线与升级策略

> 更新：2026-06-05
> 范围：仅覆盖 `vxture` 仓库负责的平台控制面、VXTURE_DEPLOY_HOST 生产部署、本地开发基线和 CI/CD 运行时。

---

## 一、目标

本文件定义平台部署与开发环境的版本基线，避免继续沿用历史遗留版本。所有初始化脚本、Dockerfile、Compose、CI/CD 和常态检查脚本必须以本文为版本判断依据。

版本基线服务两个目标：

1. **生产可重建**：VXTURE_DEPLOY_HOST 可以在 Ubuntu 26.04 LTS 上从零初始化、恢复配置、部署平台，并重复执行初始化脚本而不破坏已有运行态。
2. **开发环境前移**：本机开发环境使用较新的工具链，提前发现兼容性问题，但生产与 CI 至少统一在稳定基线。

---

## 二、生产基线

| 组件           | 基线                     | 策略                                                                |
| -------------- | ------------------------ | ------------------------------------------------------------------- |
| Ubuntu         | `26.04 LTS`              | VXTURE_DEPLOY_HOST 新部署目标；旧 22.04 / 24.04 仅视为历史运行现场  |
| Node.js        | `24.x`                   | 生产、CI、Dockerfile、迁移/seed 容器统一使用 Node 24                |
| pnpm           | `10.30.3`                | 与根目录 `packageManager` 对齐，脚本通过 Corepack 幂等准备          |
| Docker Engine  | `29.5.x`                 | 初始化脚本安装 Docker CE；常态检查低于基线时报 HIGH                 |
| Docker Compose | `5.1.x`                  | 使用 Docker Compose plugin；常态检查低于基线时报 HIGH               |
| PostgreSQL     | `18-alpine`              | 主版本可控，Alpine 浮动；数据可由 migrate + seed 重建               |
| Redis          | `8-alpine`               | 主版本可控，Alpine 浮动；运行态缓存数据不作为重建备份范围           |
| Nginx          | `1.29-alpine`            | Nginx 主版本可控，Alpine 浮动；禁止使用裸 `nginx:alpine`            |
| Tailscale      | stable apt 源            | 初始化脚本安装，节点加入网络仍为人工步骤                            |
| UFW            | Ubuntu apt 源            | 仅开放平台需要的端口；历史业务端口不进入重建基线                    |
| Cloudflare     | Origin Certificate + DNS | 证书在服务器备份；DNS / Proxy / SSL mode 属于 Cloudflare 控制台配置 |

---

## 三、开发基线

| 组件           | 基线              | 策略                                                      |
| -------------- | ----------------- | --------------------------------------------------------- |
| Node.js        | 最新 Current 可用 | 本机可高于生产基线，但 CI / Docker / 生产至少统一 Node 24 |
| pnpm           | `10.30.3`         | 必须与根目录 `packageManager` 一致                        |
| Docker Engine  | 最新稳定          | 开发机可高于生产；不反向要求生产立刻跟随开发机 patch      |
| Docker Compose | 最新稳定          | 开发机可高于生产                                          |

当开发机版本高于生产基线时，不能把本机通过视为生产通过；仍需以 CI、Docker 镜像构建和 VXTURE_DEPLOY_HOST 常态检查结果为准。

---

## 四、镜像标签策略

平台生产镜像不使用完全漂移的裸标签。

| 镜像       | 推荐写法             | 禁止或不推荐      | 原因                                                          |
| ---------- | -------------------- | ----------------- | ------------------------------------------------------------- |
| Node.js    | `node:24-alpine`     | `node:22-alpine`  | Node 22 是历史基线；Node 24 是当前稳定基线                    |
| Nginx      | `nginx:1.29-alpine`  | `nginx:alpine`    | 控制 Nginx 主版本，同时允许 Alpine 浮动                       |
| PostgreSQL | `postgres:18-alpine` | `postgres:alpine` | 控制数据库主版本                                              |
| Redis      | `redis:7-alpine`     | `redis:alpine`    | 仅 CI 冒烟/一次性工具容器；生产 Redis 在阿里云 Tair（云托管） |

当前策略不强制使用 digest。若进入强合规或多节点可重复部署阶段，再评估 digest pinning。

---

## 五、升级告警语义

常态检查脚本使用 HIGH / LOW 两级告警：

| 等级 | 含义                                 | 退出码 |
| ---- | ------------------------------------ | ------ |
| HIGH | 已影响部署可靠性、安全边界或运行健康 | 非 0   |
| LOW  | 未立即阻断运行，但需要纳入维护计划   | 0      |

### HIGH 示例

- OS 不是 Ubuntu 26.04。
- Node / pnpm / Docker / Compose 缺失或低于生产基线。
- 使用 `node:22-*`、`nginx:alpine` 等历史或漂移标签。
- `vxture-prod` Docker network 缺失。
- 关键 env / secret / SSL 证书缺失。
- env 存在跨文件残留变量。
- Nginx 配置测试失败。
- 平台容器 missing / unhealthy。
- PostgreSQL / Redis unhealthy。
- UFW 开放历史业务端口，例如 `5433`、`8080`、`8443`。

### LOW 示例

- 版本高于生产基线但与文档不一致。
- 磁盘使用率达到维护阈值但未到危险线。
- 备份快照过旧。
- 服务器仓库 dirty。
- 存在未启用的历史业务配置。

---

## 六、升级执行顺序

1. 更新本文版本基线。
2. 更新初始化脚本、Dockerfile、Compose、CI/CD 中的版本。
3. 运行常态检查脚本确认没有 HIGH 告警。
4. 本地运行必要构建和测试。
5. 按分支晋升流程进入 CI/CD。

禁止在没有版本基线更新的情况下，临时修改脚本里的硬编码版本。
