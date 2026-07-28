# 部署脚本设计

> 更新：2026-06-07
> 范围：仅覆盖 `vxture` 仓库负责的 平台控制面部署脚本。业务 worker 脚本由外部业务仓库维护。

本文档定义 部署脚本的命名、职责边界、执行顺序和审计验证关系。脚本是运维动作入口，不是规则本身；规则沉淀在文档、env 模板和 guardrail 脚本中。

---

## 一、设计原则

1. **动词开头**：脚本名必须表达动作，例如 `bootstrap`、`generate`、`sync`、`deploy`、`verify`、`backup`。
2. **对象明确**：脚本名必须表达作用对象，例如 `host`、`env-files`、`nginx-config`、`platform-stack`。
3. **kebab-case**：脚本名使用小写字母、数字和连字符，避免 shell、CI、SSH、日志检索中的歧义。
4. **数字前缀表达分组和顺序**：前缀先表达脚本类型，再表达该类型内的人工执行顺序；文件名主体仍必须说明意图。
5. **动作、审计、验证分离**：部署脚本执行动作，审计脚本检查配置规则，验证脚本检查运行态结果。
6. **不打印 secret**：任何脚本不得输出真实 env 值、token、password、provider key。
7. **幂等优先**：初始化和 env 生成脚本必须尽量幂等；已有真实 env 文件不得被无提示覆盖。
8. **Linux 换行**：`.sh` 文件必须保持 LF 换行，仓库通过 `.gitattributes` 固定，避免 Windows 工作区导致服务器 bash 解析失败。

---

## 二、编号段规则

VXTURE_DEPLOY_HOST 脚本编号采用两位数字段，不使用连续 `01-06` 小流水号。这样做的目的不是追求形式，而是让运维动作先按风险和用途分类，再进入 runbook。

| 编号段  | 类型                       | 说明                                                       | 当前状态                                                          |
| ------- | -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `10-19` | 加载环境 / 公共准备        | 主机初始化、env/secret 文件生成、通用前置准备              | 已使用 `10`、`11`、`12`、`13`、`15`、`19`                         |
| `20-49` | 部署主链路                 | Nginx 同步、数据库检查、首次部署、常规升级、发布后验证     | 已使用 `20`、`21`、`22`、`23`、`24`、`25`、`30`、`31`、`39`、`40` |
| `50-59` | 运维动作                   | 备份、常态检查、非发布但可重复执行的安全操作               | 已使用 `50`、`51`、`52`、`53`                                     |
| `60-89` | 故障恢复 / 重置            | 回滚、恢复、重建、清理、重置类动作                         | 已使用 `60`、`61`、`62`                                           |
| `90-99` | 人工诊断 / 临时工具 / 保留 | 一次性诊断、人工排障、临时检查工具；默认不进入常规发布链路 | 已使用 `90`                                                       |

编号使用规则：

- 同一编号段内保留间隔，优先使用 `10`、`20`、`30` 这类整十号，方便插入后续脚本。
- 新脚本必须先判断动作类型，再选择编号段；不能因为“下一个数字可用”就顺延。
- `60-89` 和 `90-99` 默认不进入新服务器部署或常规发布 runbook，除非文档明确说明触发条件。
- 临时脚本如果需要提交到仓库，优先放在 `90-99`；任务结束后应沉淀为正式脚本、文档或删除。

---

## 三、脚本清单规划

部署资产按职责拆分为三类：

```text
deploy-manual-init/bootstrap/ # 一次性手动初始化包，不进入 CI/CD 自动传送
deploy/maintenance/           # 手动维护 / 迁移 / 灾备脚本，可随部署包传送但不自动执行
deploy/scripts/               # 正式部署链路脚本，由 CI/CD 传送并执行
runtime/                           # 本地开发真实 env / secrets，不提交、不上传
```

服务器运行目录：

```text
~/vxture-bootstrap/             # 从 deploy-manual-init 上传，一次性使用后删除
/srv/vxture/deploy/   # 从 deploy/ 同步，CI/CD 维护的正式部署包目录
/srv/vxture/runtime/            # 真实运行参数目录，不按 VXTURE_DEPLOY_HOST 再分层
/srv/vxture/data/               # 运行数据与 Nginx 挂载目录，不按 VXTURE_DEPLOY_HOST 再分层
/srv/vxture/backups/VXTURE_DEPLOY_HOST/  # 部署服务器的部署参数、运行配置备份目录
```

连接命名约定：

```text
vxture-VXTURE_DEPLOY_HOST # 保留的 SSH Host alias / 逻辑节点名 / 外部管理识别名，用于 ssh/scp/rsync 连接
VXTURE_DEPLOY_HOST     # 服务器 Linux hostname / Tailscale hostname，用于 hostnamectl 和 tailscale up
```

| 编号 | 脚本                                                          | 分组           | 状态   | 职责                                                                                                                                                                                                                         | 频率                             | 是否需要 sudo |
| ---- | ------------------------------------------------------------- | -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------- |
| 10   | `deploy-manual-init/bootstrap/10-restore-connection-env.sh`   | 手动初始化     | 已落地 | 恢复新服务器连接环境中的 Tailscale 配置；SSH 由云厂商或人工先恢复，脚本不覆盖 SSH                                                                                                                                            | 新服务器一次性 / 连接恢复        | 是或 sudo     |
| 11   | `deploy-manual-init/bootstrap/11-bootstrap-host.sh`           | 手动初始化     | 已落地 | 初始化 ECS 主机：DNS、hostname、数据盘挂载、Docker、Node、pnpm、UFW、Tailscale、数据目录、部署包目录；不拉取源码仓库                                                                                                         | 新服务器一次性 / 基线升级        | 是            |
| 15   | `deploy-manual-init/bootstrap/15-reset-app-layer.sh`          | 手动初始化     | 已落地 | 原服务器应用层 reset：清理平台容器、镜像、deploy bundle、runtime、平台数据和 Nginx 非证书配置；保留 SSH、Tailscale、Docker、UFW、磁盘挂载                                                                                    | 原服务器应用层重置               | 是            |
| 12   | `scripts/12-generate-env-files.sh`                            | 公共准备       | 已落地 | 从 `.example` 模板生成或安全补齐 `.env`、`.env.<service>`、`secrets/platform.env`、`secrets/platform-mail.env`，并初始化原始密码文件占位                                                                                     | 首次部署 / env 重建 / 模板变更后 | 否            |
| 13   | `scripts/13-prepare-runtime-env.sh`                           | 公共准备       | 已落地 | 准备 `/srv/vxture/runtime` 目录、owner 和权限，并调用 `12-generate-env-files.sh` 同步运行参数模板；常规升级聚合脚本会调用此脚本                                                                                              | 首次部署 / 每次发布前            | 否或 sudo     |
| 19   | `deploy-manual-init/bootstrap/19-check-bootstrap-status.sh`   | 手动初始化检查 | 已落地 | 只读检查 10 / 11 / 15 / 90 的手动配置结果：系统、用户、权限、DNS、apt、磁盘、Docker、Node、pnpm、UFW、Tailscale、目录文件                                                                                                    | 手动初始化后                     | 否或 sudo     |
| 20   | `scripts/20-sync-nginx-config.sh`                             | 部署主链路     | 已落地 | 同步部署包 `nginx/` 配置和 `compose.nginx.yml` 到 `/srv/vxture/data/nginx/`，必要时 reload                                                                                                                                   | Nginx 配置变更                   | docker 权限   |
| 21   | `scripts/21-prepare-platform-database.sh`                     | 部署主链路     | 已落地 | 启动 PostgreSQL、等待健康、执行 strict env audit，并验证 `DATABASE_URL` 可登录；不执行 migration / seed                                                                                                                      | 首次部署 / 每次发布前            | docker 权限   |
| 22   | `scripts/22-run-platform-migrations.sh`                       | 部署主链路     | 已落地 | 使用部署包 `database/prisma` 手动执行 PostgreSQL `prisma migrate deploy`，要求 `CONFIRM_MIGRATE=yes`                                                                                                                         | 首次部署 / 手动迁移              | docker 权限   |
| 23   | `scripts/23-seed-platform-database.sh`                        | 部署主链路     | 已落地 | 手动执行平台初始 seed，要求 `CONFIRM_SEED=yes`                                                                                                                                                                               | 首次部署 / 明确补种              | docker 权限   |
| 24   | `scripts/24-first-deploy-platform.sh`                         | 部署主链路     | 已落地 | 聚合首次部署链路：`21 -> 22 -> 23 -> 25 -> 30 -> 40`，要求 `CONFIRM_FIRST_DEPLOY=yes`                                                                                                                                        | 首次部署 / 应用层 reset 后       | docker 权限   |
| 25   | `scripts/25-provision-signing-key.sh`                         | 部署主链路     | 已落地 | provision IdP RS256 签名密钥（公钥入 `iam.signing_key`，打印私钥 + KID 供手动填 `secrets/platform-identity.env`），要求 `CONFIRM_PROVISION_KEY=yes`；幂等（已有 active key 不轮换）；私钥未填时打印后 `exit 1` 挡住后续 `30` | 首次部署 / 密钥轮换              | docker 权限   |
| 30   | `scripts/30-deploy-platform-stack.sh`                         | 部署主链路     | 已落地 | 读取镜像源配置、pull 镜像、`docker compose up -d --remove-orphans` 平台栈；私有 registry 登录由人工或 CI 在脚本外完成                                                                                                        | 每次发布                         | docker 权限   |
| 31   | `scripts/31-regular-upgrade-platform.sh`                      | 部署主链路     | 已落地 | 聚合常规升级链路：`13 -> 20 -> 21 -> 30 -> 40`；不执行 migration / seed                                                                                                                                                      | 每次发布 / CI/CD                 | docker 权限   |
| 39   | `guardrails/39-audit-env.mjs`                                 | 部署主链路     | 已落地 | 审计 VXTURE_DEPLOY_HOST env 文件归属、Compose 注入和旧变量残留                                                                                                                                                               | 每次发布前 / 30 部署前闸内调用   | 否            |
| 40   | `scripts/40-verify-platform-runtime.sh`                       | 部署主链路     | 已落地 | 验证 Compose 配置、容器状态、健康检查、Nginx、TLS、公网 HTTPS（env 审计由 30 部署前闸独占，不在此重复）                                                                                                                      | 每次发布后                       | docker 权限   |
| 50   | `scripts/50-backup-runtime-env.sh`                            | 运维动作       | 已落地 | 备份真实 `.env*`、`secrets/platform.env`、`secrets/platform-mail.env`、Nginx 配置快照                                                                                                                                        | 改 env 前 / 发布前               | 否或读权限    |
| 51   | `scripts/51-check-platform-alerts.sh`                         | 常态巡检       | 已落地 | 常态检查版本基线、运行配置、Docker 网络、容器健康、证书、Nginx、UFW 历史端口和部署包状态，输出 HIGH / LOW 告警；由 `platform-alerts` 定时 workflow 每日执行，不在部署链内                                                    | 定时（platform-alerts）/ 可手动  | docker 权限   |
| 52   | `maintenance/52-backup-connection-env.sh`                     | 手动维护       | 已落地 | 备份 SSH / Docker / UFW 等连接与基础环境配置                                                                                                                                                                                 | 迁移 / 灾备前                    | 手动          |
| 53   | `maintenance/53-backup-deploy-params.sh`                      | 手动维护       | 已落地 | 备份 `.env*`、`secrets`、Nginx 配置、TLS 证书                                                                                                                                                                                | 重装 / 迁移前                    | 手动          |
| 60   | `maintenance/60-restore-connection-env.sh`                    | 手动恢复       | 已落地 | 恢复连接类配置中非 Tailscale 的维护项                                                                                                                                                                                        | 迁移 / 灾备恢复                  | 手动          |
| 61   | `maintenance/61-restore-deploy-params.sh`                     | 手动恢复       | 已落地 | 恢复 `.env*`、`secrets`、Nginx 配置、TLS 证书，要求 `CONFIRM_RESTORE=yes`                                                                                                                                                    | 新服务器恢复 / 灾备              | 手动          |
| 62   | `maintenance/62-reset-platform-database.sh`                   | 故障恢复       | 已落地 | 受保护重置 PostgreSQL 数据目录；仅在新服务器首装失败且当前数据库数据无需保留时使用                                                                                                                                           | 新服务器首装排障                 | sudo          |
| 90   | `deploy-manual-init/bootstrap/90-disable-windterm-osc3008.sh` | 临时工具       | 已落地 | 可选禁用 WindTerm OSC 3008 输出，便于新服务器交互排障                                                                                                                                                                        | 新服务器一次性 / 可选            | 是            |

当前 部署脚本以 `scripts/` 中的正式部署链路为基线；`maintenance/` 只随部署包传送，不由 CI/CD 自动执行；`deploy-manual-init/` 只用于服务器初始化或应用层 reset 手动执行。暂不新增 `rollback` 脚本，原因是当前回滚主要依赖镜像 tag 与 GitHub Actions 产物；在镜像 tag 策略未完全固定前，写自动 rollback 容易制造误操作风险。

---

## 四、职责边界

### 11-bootstrap-host.sh

负责服务器级初始化：

- 安装 Docker CE 与 Compose plugin
- 安装或升级 Node.js 与 pnpm 到版本基线
- 配置基础 UFW 规则
- 安装或提示配置 Tailscale
- 挂载已格式化数据盘到 `/srv/vxture/data`，并写入 `/etc/fstab`
- 创建 `/srv/vxture/data/*` 数据目录
- 创建 `/srv/vxture/runtime` 运行参数目录
- 创建 `/srv/vxture/deploy` 部署包目录
- 创建 `/srv/vxture/backups/VXTURE_DEPLOY_HOST` 备份目录

禁止：

- 拉取或更新完整源码仓库
- 部署平台业务栈
- 修改生产 `.env*` 真实值
- 写入 Provider Key、OAuth Secret、Turnstile Secret

### 15-reset-app-layer.sh

负责原服务器应用层 reset：

- 停止并删除 平台容器和 Nginx 容器
- 可选删除这些容器曾使用的镜像，默认 `RESET_IMAGES=1`
- 归档 `/srv/vxture/deploy`
- 归档 `/srv/vxture/runtime`
- 归档 `/srv/vxture/data/platform-pg`
- 归档 `/srv/vxture/data/platform-redis`
- 归档 `/srv/vxture/data/nginx/conf`
- 归档 `/srv/vxture/data/nginx/logs`
- 归档 `/srv/vxture/data/nginx/compose.yml`
- 保留 `/srv/vxture/data/nginx/ssl`
- 重建空应用层目录
- 将 `/srv/vxture/data/platform-pg` owner 设置为 PostgreSQL Alpine 容器用户 `70:70`
- 确保 `vxture-prod` / `vxture-beta` Docker 网络存在

禁止：

- 修改 SSH / authorized_keys / sshd 配置
- 修改 Tailscale state
- 重新安装 Docker / Node / pnpm
- 修改 UFW
- 修改 `/etc/fstab` 或磁盘挂载
- 自动触发 CI/CD 或应用部署

### 12-generate-env-files.sh

负责以 deploy bundle 中的 `.example` 为唯一模板源，同步 runtime env 文件：

- 不存在的 runtime env 文件：从对应 `.example` 复制创建
- 已存在的 runtime env 文件：只追加 `.example` 中新增但 runtime 缺失的 key
- 已存在的真实值：保留，不覆盖、不清空
- 已从 `.example` 删除但 runtime 仍存在的 key：追加明显 WARN 注释，标记“可以删除 / 已废弃待删除”
- `secrets/pg-password` 和 `secrets/redis-password` 不生成随机值，首次只写入 `CHANGEME`，必须手动替换

禁止：

- 覆盖已有真实 env 文件
- 打印 secret 值
- 启动或重启容器

### 13-prepare-runtime-env.sh

负责 runtime 目录准备和 env 模板同步入口：

- 创建 `/srv/vxture/runtime` 与 `/srv/vxture/runtime/secrets`
- 必要时通过 `sudo -n` 执行目录创建和权限修复
- 将 runtime owner 固定为当前部署用户，例如 `ecs-user:ecs-user`
- 调用 `12-generate-env-files.sh` 从 `.example` 模板同步运行参数文件

禁止：

- 填写真实密码、token、OAuth 凭据或第三方密钥
- 启动或重启容器
- 修改 `/srv/vxture/data` 数据卷
- 代替 `40-verify-platform-runtime.sh` 做严格运行态验证

### 20-sync-nginx-config.sh

负责 Nginx 配置同步：

- 从部署包 `nginx/` 同步到 `/srv/vxture/data/nginx/conf`
- 将 `compose.nginx.yml` 同步为 `/srv/vxture/data/nginx/compose.yml`
- 容器运行中时执行 `nginx -t`
- 配置测试通过后 reload

禁止：

- 修改平台 `.env*`
- 重启平台业务容器
- 自动申请或替换证书

### 21-prepare-platform-database.sh

负责平台数据库准备：

- 启动 PostgreSQL 容器并等待健康
- 调用 `VX_ENV_AUDIT_STRICT_RUNTIME=1 node guardrails/39-audit-env.mjs`，检查 `DATABASE_URL` 与 `secrets/pg-password` 等 runtime 参数一致性
- 使用 `DATABASE_URL` 验证能登录 `vx-platform-pg`
- 作为首次部署、常规升级和手动迁移的共同数据库前置检查

禁止：

- 修改 env 文件
- 修改 `secrets/pg-password`
- 重置或删除 PostgreSQL 数据目录
- 执行 `prisma migrate deploy`
- 执行 seed
- 输出数据库密码

### 22-run-platform-migrations.sh

负责平台数据库 migration：

- 复用 `21-prepare-platform-database.sh` 完成数据库健康和登录检查
- 使用部署包 `database/prisma/schema.prisma` 执行 `prisma migrate deploy`
- 使用 `/srv/vxture/runtime/.db-tools/` 作为临时 Node 工具缓存，避免每次发布重复安装工具
- 只在首次部署、数据库 schema 变更或人工确认的维护窗口执行

运行方式：

```bash
CONFIRM_MIGRATE=yes bash scripts/22-run-platform-migrations.sh
```

禁止：

- 由常规 CI/CD 发布自动执行
- 绕过 `CONFIRM_MIGRATE=yes`
- 执行 seed
- 修改 env 文件或数据库密码
- 重置或删除 PostgreSQL 数据目录

### 23-seed-platform-database.sh

负责平台初始 seed：

- 要求 `CONFIRM_SEED=yes`
- 复用 `21-prepare-platform-database.sh` 完成数据库健康和登录检查
- 默认执行 `database/prisma/seed-catalog.mjs`（catalog-only，生产安全，不种样例测试账号）；`SEED_SAMPLE=true` 时改执行 `seed.mjs`（catalog + sample，仅开发）
- 只在首次部署、应用层 reset 后，或明确需要补种初始化数据时执行

禁止：

- 由常规 CI/CD 发布自动执行
- 绕过 `CONFIRM_SEED=yes`
- 修改 env 文件或数据库密码
- 重置或删除 PostgreSQL 数据目录

### 24-first-deploy-platform.sh

负责首次部署聚合链路：

```text
21 -> 22 -> 23 -> 25 -> 30 -> 40
```

适用场景：

- 新服务器首次部署
- 原服务器应用层 reset 后重新部署
- PostgreSQL 数据目录已重建且需要重新 migration + seed

运行方式：

```bash
CONFIRM_FIRST_DEPLOY=yes bash scripts/24-first-deploy-platform.sh
```

前置条件：

- `/srv/vxture/runtime` 已按 `.example` 补齐真实值
- `/srv/vxture/data/nginx` 已恢复 TLS 证书和 Nginx 基础配置
- `secrets/pg-password` 与 `secrets/platform.env` 中 `DATABASE_URL` 密码一致

禁止：

- 常规升级使用
- 由 CI/CD 自动执行
- 替代人工填写生产 env 或恢复 TLS 证书

### 25-provision-signing-key.sh

负责 IdP RS256 签名密钥 provision（首次部署 migrate 之后、deploy 之前）：

- 要求 `CONFIRM_PROVISION_KEY=yes`
- 复用 `21-prepare-platform-database.sh` 完成数据库健康和登录检查
- 执行部署包 `database/prisma/provision-signing-key.mjs`：生成 RS256 keypair，公钥 JWK 写入 `iam.signing_key`（status=active，经 `/oidc/jwks` 暴露），打印 `OIDC_ACTIVE_KID` + `OIDC_SIGNING_PRIVATE_KEY`
- 幂等：已存在 active key 时跳过（不轮换；`provision-signing-key.mjs --force` 才轮换）
- gate：`secrets/platform-identity.env` 的私钥仍为占位（`CHANGEME`/空）时，打印后 `exit 1` 中止，挡住 `30` 启动无密钥的 `auth-bff`；人工粘贴真值后重跑（`24` 聚合幂等）

运行方式：

```bash
CONFIRM_PROVISION_KEY=yes bash scripts/25-provision-signing-key.sh
```

禁止：

- 由常规 CI/CD 发布自动执行
- 绕过 `CONFIRM_PROVISION_KEY=yes`
- 把打印的私钥留进 CI 日志或聊天记录（首发由人工在交互式终端执行）
- 修改 env 文件或数据库密码

### 30-deploy-platform-stack.sh

负责平台栈部署动作：

- 调用 `VX_ENV_AUDIT_STRICT_RUNTIME=1 node guardrails/39-audit-env.mjs`，在拉镜像和平台启动前拦截 runtime env 不一致
- 读取镜像 registry / namespace / tag
- 提示私有 registry 需在脚本外完成登录
- `docker compose pull`
- `docker compose up -d --remove-orphans`
- 输出 compose 服务状态

禁止：

- 读取或保存 registry credential
- 生成或修改 env 文件
- 修改 Nginx 配置
- 执行数据库 migration / seed
- 执行数据库破坏性操作

### 31-regular-upgrade-platform.sh

负责常规升级聚合链路：

```text
13 -> 20 -> 21 -> 30 -> 40
```

执行内容：

- 准备 runtime 目录和 `.example` 差异补齐
- 检查 Auth runtime 契约，避免登录链路关键 env 缺失
- 同步 Nginx 配置并启动或更新 Nginx
- 检查 PostgreSQL 健康和 `DATABASE_URL` 登录能力
- 拉取镜像并重启平台栈
- 执行部署后运行态验证和常态告警检查

禁止：

- 执行 `prisma migrate deploy`
- 执行 seed
- 修改真实 env 值
- 重置或删除 PostgreSQL 数据目录

### 62-reset-platform-database.sh

负责新服务器首装失败时的 PostgreSQL 数据目录重置：

- 要求 `sudo` 执行
- 要求显式设置 `CONFIRM_RESET=yes`
- 停止平台 compose 容器并移除 postgres 容器
- 将旧 `/srv/vxture/data/platform-pg` 移动归档到 `/srv/vxture/backups/VXTURE_DEPLOY_HOST/platform-pg-reset/<timestamp>/`
- 重建空的 `/srv/vxture/data/platform-pg`
- 将新目录 owner 设置为 PostgreSQL Alpine 容器用户 `70:70`，避免 `postgres:18-alpine` 初始化 `/var/lib/postgresql/18/` 时权限失败

适用条件：

- 仅限新服务器首装或明确不需要保留当前 PostgreSQL 数据
- 典型场景是 PostgreSQL 数据目录已用旧密码初始化，导致 `DATABASE_URL` / `secrets/pg-password` 与数据库真实密码不一致

禁止：

- 在未确认数据可丢弃时执行
- 由 CI/CD 自动执行
- 删除归档目录

### 39-audit-env.mjs

负责 VXTURE_DEPLOY_HOST 运行参数审计：

- 检查 `/srv/vxture/runtime/.env*` 与模板结构
- 检查 `/srv/vxture/runtime/secrets/*` 必需文件
- 检查 Compose 是否从 `/srv/vxture/runtime` 注入 env 与 Docker secret
- 检查旧变量残留、跨服务重复变量和 secret 归属

禁止：

- 修改 env 文件
- 输出 secret 内容
- 启动、停止或重启容器
- 代替 `40-verify-platform-runtime.sh` 检查容器运行态

### 40-verify-platform-runtime.sh

负责部署后验证：

- 调用 `VX_ENV_AUDIT_STRICT_RUNTIME=1 node guardrails/39-audit-env.mjs`
- 执行 `docker compose config --quiet`
- 检查关键容器 `docker compose ps`
- 检查内部健康接口
- 检查 Nginx 配置 `nginx -t`
- 检查公网域名 HTTPS 响应

禁止：

- 修改 env 文件
- 自动修复配置
- 自动重启服务

验证脚本只回答“当前是否健康”，不负责“如何修复”。

### 50-backup-runtime-env.sh

负责生产运行配置快照：

- 备份 `/srv/vxture/runtime/.env`
- 备份 `/srv/vxture/runtime/.env.*`
- 备份 `/srv/vxture/runtime/secrets/platform.env`
- 备份 `/srv/vxture/runtime/secrets/platform-mail.env`
- 备份 `/srv/vxture/runtime/secrets/pg-password`
- 备份 `/srv/vxture/runtime/secrets/redis-password`
- 备份 `/srv/vxture/data/nginx/conf`

备份目录建议：

```text
/srv/vxture/backups/VXTURE_DEPLOY_HOST/runtime-env/YYYYMMDDHHMMSS/
```

禁止：

- 输出备份文件内容
- 压缩包上传到公网
- 删除旧备份

### 51-check-platform-alerts.sh

> 由 `platform-alerts` 定时 workflow（每日）SSH 到 VXTURE_DEPLOY_HOST 执行，**不再嵌入部署链（30/40）**；基线、证书、防火墙等漂移本就不随单次部署变化，定时巡检更及时，也避免每次部署重复执行。仍可在部署服务器手动运行。

负责常态只读检查：

- 检查 Ubuntu / Node / pnpm / Docker / Compose 是否满足 `10-version-baseline.md`
- 检查 Docker daemon、`vxture-prod` 网络、平台 env / secret / SSL 文件是否存在
- 检查 env 是否存在跨文件残留变量
- 检查 Docker Compose 配置、关键容器健康状态、PostgreSQL / Redis 健康状态
- 检查 Nginx 配置和公网 HTTPS
- 检查 UFW 是否开放历史业务端口
- 检查部署包关键文件是否存在

告警规则：

- `[HIGH]`：影响部署可靠性、安全边界或运行健康，脚本退出非 0
- `[LOW]`：需要维护计划处理，但不立即阻断运行，脚本退出 0

禁止：

- 修改文件
- 重启服务
- 输出 secret 内容
- 自动修复告警

---

## 五、审计与验证关系

### 配置规则审计

跨环境审计脚本位于：

```bash
scripts/guardrails/audit-env.mjs
deploy/guardrails/39-audit-env.mjs
```

用途：

- 检查 env 文件结构
- 检查共享密钥重复
- 检查 Turnstile / OAuth / Provider Key 归属
- 检查 Compose env_file 注入
- 检查 env 模板和生成脚本同步
- 检查旧变量残留

本机使用：

```bash
pnpm audit:env
```

VXTURE_DEPLOY_HOST 使用：

```bash
cd /srv/vxture/deploy
VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR=/srv/vxture/deploy VX_RUNTIME_DIR=/srv/vxture/runtime node guardrails/39-audit-env.mjs
```

### 运行态验证

运行态验证由 `40-verify-platform-runtime.sh` 承担。它可以调用 env 审计脚本，但不能把 env 审计规则复制到 shell 内。

原因：

- env 审计规则需要和代码/文档一起维护，适合放在仓库级 guardrail 脚本。
- shell 验证脚本只负责服务器运行态：容器、端口、健康接口、Nginx、TLS。
- 两者分离后，CI、本地、服务器可以复用同一套 env 审计规则。

---

## 六、推荐执行顺序

### 全新服务器初始化

```bash
cd ~/vxture-bootstrap

bash 10-restore-connection-env.sh
sudo bash 11-bootstrap-host.sh
bash 19-check-bootstrap-status.sh
```

完成后进入 CI/CD：

```text
prepare deploy bundle -> 生成 runtime 框架 -> 人工补齐 runtime env -> strict env audit -> deploy-production
```

### 原服务器应用层 reset

```bash
cd ~/vxture-bootstrap

sudo CONFIRM_RESET_APP=yes bash 15-reset-app-layer.sh
bash 19-check-bootstrap-status.sh
```

完成后直接进入 CI/CD。此流程保留 SSH、Tailscale、Docker、UFW、磁盘挂载等系统级配置，只清理应用层。

### CI/CD 应用部署

```text
1. 同步 deploy bundle 到 /srv/vxture/deploy
2. 运行 scripts/31-regular-upgrade-platform.sh，进入常规升级聚合链路
3. 若 runtime env 未完成或存在 CHANGEME，停止，不启动 PostgreSQL
4. 人工补齐 /srv/vxture/runtime 下的真实 env / secrets
5. strict env audit 通过后，继续 Nginx 同步、数据库可用性检查、平台栈部署、运行态验证和常态告警检查
6. 常规 CI/CD 不执行 migration / seed
```

### 首次部署

```bash
cd /srv/vxture/deploy
CONFIRM_FIRST_DEPLOY=yes bash scripts/24-first-deploy-platform.sh
```

该聚合脚本严格执行：

```text
21 -> 22 -> 23 -> 25 -> 30 -> 40
```

首次部署前必须已经完成 runtime env 真值填写、TLS 证书恢复和 Nginx 基础目录准备。`25`
首次运行会打印签名密钥后中止；按 `07-checklist.md` §1.6 粘贴到 `secrets/platform-identity.env`
后整体重跑 `24`（各阶段幂等）。

### 常规发布

```bash
cd /srv/vxture/deploy
bash scripts/50-backup-runtime-env.sh
bash scripts/31-regular-upgrade-platform.sh
```

该聚合脚本严格执行：

```text
13 -> 20 -> 21 -> 30 -> 40
```

常规发布只检查数据库可用性，不执行 migration / seed。

### 修改生产 env 前

```bash
cd /srv/vxture/deploy

bash scripts/50-backup-runtime-env.sh
bash scripts/13-prepare-runtime-env.sh

VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR=/srv/vxture/deploy VX_RUNTIME_DIR=/srv/vxture/runtime node guardrails/39-audit-env.mjs
```

### 新服务器数据库密码不一致时

如果 `scripts/21-prepare-platform-database.sh` 提示 `DATABASE_URL` 无法登录 `vx-platform-pg`，且确认当前 PostgreSQL 数据不需要保留：

```bash
cd /srv/vxture/deploy
sudo CONFIRM_RESET=yes bash maintenance/62-reset-platform-database.sh
CONFIRM_FIRST_DEPLOY=yes bash scripts/24-first-deploy-platform.sh
```

该脚本只移动归档旧数据目录并重建空目录，不自动填写 env，也不自动修改密码。

---

## 七、迁移说明

旧脚本名已迁移为当前编号段模型：

| 旧脚本 / 过渡脚本                              | 新脚本                                                      |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `10-restore-tailscale-env.sh`                  | `deploy-manual-init/bootstrap/10-restore-connection-env.sh` |
| `01-init.sh` / `01-bootstrap-host.sh`          | `deploy-manual-init/bootstrap/11-bootstrap-host.sh`         |
| 原服务器应用层手动清理                         | `deploy-manual-init/bootstrap/15-reset-app-layer.sh`        |
| `setup-env.sh` / `02-generate-env-files.sh`    | `12-generate-env-files.sh`                                  |
| `02-sync-nginx.sh` / `03-sync-nginx-config.sh` | `20-sync-nginx-config.sh`                                   |
| `03-up.sh` / `04-deploy-platform-stack.sh`     | `30-deploy-platform-stack.sh`                               |
| `05-verify-platform-runtime.sh`                | `40-verify-platform-runtime.sh`                             |
| `06-backup-runtime-env.sh`                     | `50-backup-runtime-env.sh`                                  |

发布到服务器后，CI/CD 只同步 `deploy` 正式 deploy bundle 到 `/srv/vxture/deploy`。真实 `.env*`、`secrets/*`、证书和运行数据保留在 VXTURE_DEPLOY_HOST 本机，不由部署包覆盖。`deploy-manual-init/bootstrap` 不进入 CI/CD 自动传送；新服务器首次初始化时手动上传到 `~/vxture-bootstrap`，执行完成后删除。
