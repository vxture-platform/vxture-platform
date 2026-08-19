# 基础设施配置

> 运维操作参考：Nginx / PostgreSQL / Redis / Docker volume 映射
> 更新：2026-06-01

---

> 节点规格与 Tailscale IP 见 [`docs/50-deployment/00-overview.md` § 节点信息](./00-overview.md)。
> 本文件只维护 `vxture` 仓库负责的 平台基础设施；vx-worker-02/03/04/05 等业务基础设施由外部业务仓库维护。Atlas（原 model-platform）已拆仓 `vxture-atlas`，不再随本仓平台栈部署。

---

## Nginx（VXTURE_DEPLOY_HOST）

### 容器启动

```bash
docker run -d \
  --name vx-nginx \
  --restart unless-stopped \
  -p 80:80 \
  -p 443:443 \
  -v /data/nginx/conf/nginx.conf:/etc/nginx/nginx.conf:ro \
  -v /data/nginx/conf/sites-enabled:/etc/nginx/sites-enabled:ro \
  -v /data/nginx/conf/snippets:/etc/nginx/snippets:ro \
  -v /data/nginx/ssl:/etc/nginx/ssl:ro \
  -v /data/nginx/logs:/var/log/nginx \
  --network vxture-prod \
  nginx:1.29-alpine
```

### 目录结构

```
/data/nginx/
├── conf/
│   ├── nginx.conf
│   ├── sites-enabled/
│   │   ├── vxture.com.conf       ← website portal
│   │   ├── console.conf          ← console portal
│   │   ├── admin.conf            ← admin portal
│   │   └── api.conf              ← gateway-bff
│   └── snippets/
│       ├── ssl-params.conf       ← TLS 版本、cipher suite
│       └── proxy-params.conf     ← proxy_set_header 公共参数
├── ssl/
│   ├── vxture.com.crt            ← 通配符证书
│   └── vxture.com.key            ← 私钥（chmod 600）
└── logs/

```

### Nginx 配置片段

```nginx
# /data/nginx/conf/sites-enabled/vxture.com.conf
server {
    listen 443 ssl;
    server_name vxture.com www.vxture.com;
    include snippets/ssl-params.conf;
    ssl_certificate     /etc/nginx/ssl/vxture.com.crt;
    ssl_certificate_key /etc/nginx/ssl/vxture.com.key;
    location / {
        include snippets/proxy-params.conf;
        proxy_pass http://vx-website:3010;
    }
}

# /data/nginx/conf/sites-enabled/api.conf
# api.vxture.com → gateway-bff（所有前端 API 统一入口）
server {
    listen 443 ssl;
    server_name api.vxture.com;
    include snippets/ssl-params.conf;
    ssl_certificate     /etc/nginx/ssl/vxture.com.crt;
    ssl_certificate_key /etc/nginx/ssl/vxture.com.key;
    location / {
        include snippets/proxy-params.conf;
        proxy_pass http://vx-gateway-bff:8000;
        # gateway-bff 按路径前缀转发到各 BFF
        # /website-api/* → vx-website-bff:3011
        # /console-api/* → vx-console-bff:3021
        # /admin-api/*   → vx-admin-bff:3031
        # /auth-api/*    → vx-auth-bff:3090
    }
}

```

业务域名、vx-worker-02 Tunnel 和跨仓业务反向代理不在本仓维护。若 VXTURE_DEPLOY_HOST 上存在历史业务域名配置，应作为单独清理任务处理，不能据此继续规划本仓 vx-worker-02 部署。

**Cloudflare SSL 模式**：必须设置为 **Full (strict)**。

---

## 平台数据库（VXTURE_DEPLOY_HOST）

### PostgreSQL — platform_main

平台库在**阿里云 RDS PostgreSQL 18**（2026-08-19 起，本地 pg 容器退役）：内网 endpoint 仅
VPC 内可达（白名单放行 worker-01 内网 IP），库 `vxturestudio_platform_main`，账号
vxture_rds_default（owner，DDL/seed/verify）/ platform_svc（服务运行时）/
reporting_ro（报表只读）。凭据在 `/srv/vxture/runtime/secrets/rds-owner.env` 与
`rds-pw-*`（0600）。

**Schema 分布：**

| Schema     | 管理方                                           | 主要表                                                                                 |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `identity` | auth-bff / website-bff                           | account, account_credential, account_session, login_attempt, oauth_provider            |
| `iam`      | console-bff                                      | role, permission, role_permission, member_role_binding, capability                     |
| `tenant`   | website-bff / console-bff                        | tenant, tenant_member, tenant_setting, tenant_invitation                               |
| `product`  | admin-bff                                        | product_agent, product_plan, product_feature, product_plan_price                       |
| `commerce` | admin-bff / console-bff                          | tenant_invoice, tenant_payment, tenant_subscription, tenant_transaction, tenant_credit |
| `model`    | admin-bff / console-bff（读）；Atlas（外部，写） | model_provider, model_definition, model_grant, model_price_rule, model_policy          |
| `ops`      | admin-bff                                        | admin, role, permission, setting, governance_record, feature_flag                      |
| `support`  | admin-bff                                        | ticket, ticket_event, audit_log, notification_log                                      |

### Redis — platform

Redis 在**阿里云 Tair**（2026-08-19 起，本地 redis 容器退役）：内网 endpoint 仅 VPC 内可达
（白名单放行 worker-01 内网 IP），账号 default，密码文件
`/srv/vxture/runtime/secrets/tair-pw-default`（0600），应用经 `REDIS_URL` 连接。
数据为 TTL 会话/限流/黑名单，云侧自动备份即可，无本地备份需求。

**Platform Redis 用途：**

| Key 前缀        | 用途                            | 管理方      |
| --------------- | ------------------------------- | ----------- |
| `refresh:*`     | JWT Refresh Token               | auth-bff    |
| `blacklist:*`   | 已吊销 Access Token             | auth-bff    |
| `crossdomain:*` | 跨域一次性 SSO Token（TTL 30s） | auth-bff    |
| `vc:*`          | 邮件验证码 + 限流               | website-bff |
| `svc:*`         | 短信验证码 + 限流               | website-bff |

---

## 服务器初始化边界

VXTURE_DEPLOY_HOST 初始化拆为手动主机初始化和 CI/CD 应用部署两个阶段。

### 全新服务器

手动上传 `deploy-manual-init/bootstrap/` 到 `~/vxture-bootstrap`，执行：

```bash
cd ~/vxture-bootstrap

bash 10-restore-connection-env.sh
sudo bash 11-bootstrap-host.sh
bash 19-check-bootstrap-status.sh
```

该阶段只准备系统级能力和目录：

- SSH 需由云厂商或人工先恢复，bootstrap 不覆盖 SSH
- Tailscale
- hostname
- DNS / apt source
- Docker / Compose
- Node / pnpm
- UFW
- 数据盘挂载
- `/srv/vxture/data`
- `/srv/vxture/runtime`
- `/srv/vxture/deploy`
- `/srv/vxture/backups/VXTURE_DEPLOY_HOST`

### 原服务器应用层 reset

如果 SSH、Tailscale、Docker、UFW、磁盘挂载等系统级配置仍保留，只需要清理应用层：

```bash
cd ~/vxture-bootstrap

sudo CONFIRM_RESET_APP=yes bash 15-reset-app-layer.sh
bash 19-check-bootstrap-status.sh
```

`15-reset-app-layer.sh` 会归档并重建应用层目录，不修改系统级配置。

### 衔接 CI/CD

手动初始化完成后，应用系统部署只通过 CI/CD：

```text
同步 deploy bundle -> 生成 runtime 框架 -> 人工补齐 runtime env -> strict env audit -> 部署平台栈
```

在 runtime env 未完成前，不得启动 PostgreSQL、Redis 或平台业务容器。

---

## 外部业务基础设施边界

vx-worker-02/03/04/05 等业务 worker 的业务数据库、Redis、Docker network、Cloudflare Tunnel、业务域名和数据目录由外部业务仓库维护。本仓基础设施文档不得提供业务 worker 初始化命令，避免 AI 或维护者误把业务执行面纳入 `vxture` 仓库部署范围。Atlas 不在业务 worker 部署；若外部业务需要 AI 能力，应通过平台提供的受控 HTTP/API 契约接入。

---

## 平台数据库备份（VXTURE_DEPLOY_HOST）

### 自动备份脚本

`/data/platform/backups/backup.sh`：

```bash
#!/bin/bash
set -euo pipefail
DATE=$(date +%Y%m%d_%H%M)
BACKUP_DIR=/data/platform/backups

# PostgreSQL full dump（RDS：经一次性容器直连；RDS 自动备份为主力，此为冗余）
docker run --rm --env-file /srv/vxture/runtime/secrets/rds-owner.env postgres:18-alpine \
  sh -c 'pg_dump "$DATABASE_URL"' | gzip > "${BACKUP_DIR}/pg_${DATE}.sql.gz"

# Redis（Tair）为 TTL 瞬态数据，云侧自动备份，无本地快照步骤。

# 保留 7 天本地备份
find "${BACKUP_DIR}" -name "*.sql.gz" -o -name "*.rdb" | sort | head -n -14 | xargs -r rm

# 同步到阿里云 OSS（需配置 ossutil）
# ossutil cp -r ${BACKUP_DIR}/ oss://vxture-backups/platform/
```

```bash
# crontab -e（每天凌晨 2:00）
0 2 * * * /data/platform/backups/backup.sh >> /data/platform/backups/backup.log 2>&1
```

### 阿里云 ESSD 快照

在阿里云控制台为 `/data` 所在的 ESSD 设置自动快照策略：

- 频率：每日凌晨 3:00
- 保留：7 天
- 注意：快照与 pg_dump 互补（快照可快速回滚磁盘，pg_dump 可细粒度恢复数据）

---

## 内存优化建议（VXTURE_DEPLOY_HOST）

VXTURE_DEPLOY_HOST 内存 2G，运行约 11 个容器，建议：

```bash
# 开启 2G swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 减少 swap 激进性（推荐值 10，低内存时才用 swap）
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

各容器设置资源上限。**2026-08-17 实测复核后，这一节的说法要改**——见下表之后的更正。

各容器设置内存上限（`--memory`）防止单容器吃满内存导致 OOM：

| 容器                                  | 建议上限 |
| ------------------------------------- | -------- |
| platform-postgres                     | 400MB    |
| platform-redis                        | 128MB    |
| nginx                                 | 64MB     |
| website / console / admin             | 各 256MB |
| website-bff / console-bff / admin-bff | 各 192MB |
| auth-bff                              | 128MB    |
| gateway-bff                           | 64MB     |

### 2026-08-17：按真机实测重定内存上限（原判 152% 是低估）

**先更正一个前提**：worker-01 标称 2G，`free -m` 实测**可用只有 1607 MB**。按 2048 算低估了
拥挤程度——真实超配比初判更糟。

|                            | 重定前          | 重定后               |
| -------------------------- | --------------- | -------------------- |
| 15 个容器 `mem_limit` 之和 | 3168 m          | **2304 m**           |
| vs 物理内存 1607 m         | 197%            | 143%                 |
| vs 内存 + swap 3654 m      | 87%（余 486 m） | **63%（余 1350 m）** |

**「总和 ≤ 内存」在这台机器上做不到**，这点要说清楚：留 ~400 MB 给内核与 docker 后，15 个
容器人均只剩 80 MB，而那正好是稳态实测值——等于**一点爆发余量都不给**，第一次 SSR 高峰或
一次 `pg_dump` 就会有容器被 OOM 杀。所以目标改成**把最坏情况压进 swap 兜得住的范围**，
而不是压到内存以下。（实测 swap 2047 MB，当前用量 0。）

真机稳态实测与重定值：

| 服务                                                             | 实测      | 原上限    | 新上限                                     |
| ---------------------------------------------------------------- | --------- | --------- | ------------------------------------------ |
| postgres                                                         | 43 MiB    | 512 m     | **320 m**                                  |
| redis                                                            | 6.5 MiB   | 128 m     | 128 m（不动——redis 被 OOM 杀＝全部会话丢） |
| website / console / admin                                        | 78–85 MiB | 256 m     | **192 m**                                  |
| accounts / opera / auth-bff                                      | 54–64 MiB | 192–256 m | **160 m**                                  |
| website-bff / console-bff / admin-bff / opera-bff / platform-api | 45–59 MiB | 160–192 m | **128 m**                                  |
| gateway-bff                                                      | 30 MiB    | 128 m     | **96 m**                                   |
| nginx                                                            | 7.6 MiB   | 64 m      | 64 m                                       |

留的是**实测的 2～3 倍**，不是贴着稳态压。

**`memswap_limit` 与 `mem_limit` 必须同步改**：两者相等才是「禁 swap」，只改前者等于
**悄悄放开了 swap**——那比不改更糟，因为它看起来像收紧了。

初判时写「往下调是危险的，必须先量真机」——这条判断没变，只是前提满足了：现在每个值
都有实测支撑，不是估的。

### 2026-08-17 补齐：`cpus` 与 `pids_limit`（四份 compose 全覆盖）

此前**只有内存一个维度**有上限。一个跑飞的查询能吃光两核里的两核，一个 fork 循环能耗尽
进程表，两者都不受 `mem_limit` 约束。

| 文件                                 | 此前             | 现在                               |
| ------------------------------------ | ---------------- | ---------------------------------- |
| `deploy/compose.platform.yml`        | 14 × `mem_limit` | 补 14 × `cpus` + `pids_limit`      |
| `deploy/compose.nginx.yml`           | 1 × `mem_limit`  | 补 `cpus: 1.5` / `pids_limit: 128` |
| `deploy/dev/compose.dev.yml`         | **零**           | 补全四项，值与生产一致             |
| `deploy/worker-02/compose.varda.yml` | **零**           | 补全四项                           |

三条判据，写在各文件头部：

1. **`cpus` 是垄断闸不是配额。** 上限之和远大于核数是有意的——它们是天花板，不是预留。
   两核机器上任一容器都拿不满两核，就够了。
2. **`pids_limit` 按「异常」的门槛设**，不是按「够用」设。postgres 实测空闲 9 个进程，
   给 256。
3. **有状态件不禁 swap**（不设 `memswap_limit`）：宁可变慢也不要被 OOM 杀掉——库一死，
   所有 `depend_on` 它的 BFF 跟着倒，那是级联不是单点。无状态件则钉死无 swap。

本级 dev 已实测生效并验证数据无损（`docker inspect` 显示 Memory=536870912 / NanoCpus=
1500000000 / PidsLimit=256；重建后 `support.audit_logs` 25693 行、`actor_console` 列均在）。

### 镜像 digest 升级（2026-08-17）

两个基础镜像都按 digest 钉死（做法正确），但钉的是 **2026-06-09 解析**的那一版，与 registry
当前的 `18-alpine` / `8-alpine` 已经不是同一个。**已升级**：

| 镜像                 | 仓里钉的               | registry 当前          |
| -------------------- | ---------------------- | ---------------------- |
| `postgres:18-alpine` | `sha256:96d56f7f57c6…` | `sha256:d3e1620b530c…` |
| `redis:8-alpine`     | `sha256:09160599abd2…` | `sha256:978f0e01593e…` |

**已升级（2026-08-17）**：`compose.platform.yml` 与 `dev/compose.dev.yml` 同步换到上表右列。
同大版本补丁升级（**pg 18.4 → 18.6、redis 8.8.0 → 8.10.0**），数据目录格式不变，
是一次重启而不是一次迁移；本级已实测重建并核对数据无损。

> **一处更正**：本节初稿写「`worker-02/compose.varda.yml` 根本没钉 digest……正是平台那份
> 注释警告的情形」——**这是错的，我没读那一行上面的注释**。worker-02 不钉是**有实测理由的
> 决定**：境内镜像源对 by-digest 拉取限速（实测一个镜像 30 分钟以上），镜像内容改由
> worker-01 `docker save/load` 预载。**不要"顺手补上"**。
>
> 但它有个真实代价：**升级不会自己传过去**。worker-01 换到 18.6 之后，worker-02 仍是
> load 进来的那一版，要再做一次 `save/load` 才同步——这一步现在挂在 worker-02 的升级清单上。

**本级实测（升级前后对账）**：

|                                           | 升级前   | 升级后                          |
| ----------------------------------------- | -------- | ------------------------------- |
| postgres                                  | 18.4     | **18.6**                        |
| redis                                     | 8.8.0    | **8.10.0**                      |
| `support.audit_logs`                      | 25693 行 | 25693 行                        |
| `product.products`                        | 21 行    | 21 行                           |
| redis `dbsize`                            | 3        | 3                               |
| `actor_console` 列 / `oidc_clients` CHECK | 在       | 在                              |
| 资源上限                                  | —        | 重建后仍在（mem/cpu/pids 三项） |

两个容器 healthy，opera-bff 与门户正常。**重建的是容器不是卷**——数据在 `./data/` 下的
绑定挂载里，所以对账数字一个都没变，这正是可以放心做补丁升级的原因。

**生产侧未执行**：`compose.platform.yml` 已改好，但 apply 在 worker-01 上，由 owner 走部署流程。
`pull_policy: missing` 意味着**必须先 `docker compose pull`**，否则本地已有的旧 digest 镜像
不会被换掉。

---

## 参考文档

- `docs/50-deployment/00-overview.md` — 架构总览（AI Coding 参考）
- `docs/50-deployment/04-services.md` — Docker Compose 编排
- `docs/50-deployment/05-ci-cd.md` — CI/CD 流水线
