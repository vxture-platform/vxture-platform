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
│   │   ├── vxture.com.conf       ← website portal (3010)
│   │   ├── console.conf          ← console portal (3020)
│   │   ├── admin.conf            ← admin portal (3030)
│   │   └── api.conf              ← gateway-bff (8000)
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

VXTURE_DEPLOY_HOST 运行**一个** PostgreSQL 实例，包含所有平台 schema，仅 prod，无 beta。

```bash
docker run -d \
  --name vx-platform-pg \
  --restart unless-stopped \
  --network vxture-prod \
  -e POSTGRES_USER=vxture \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/platform_pg_password \
  -e POSTGRES_DB=platform_main \
  -v /data/platform/db/postgres:/var/lib/postgresql/data \
  postgres:18-alpine
# 不对外暴露端口，仅 vxture-prod Docker network 内访问
```

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

```bash
docker run -d \
  --name vx-platform-redis \
  --restart unless-stopped \
  --network vxture-prod \
  -v /data/platform/db/redis:/data \
  -v /srv/vxture/runtime/secrets/redis-password:/run/secrets/platform_redis_password:ro \
  redis:8-alpine \
  sh -c 'redis-server --appendonly yes --requirepass "$(cat /run/secrets/platform_redis_password)"'
# 不对外暴露端口
```

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

# PostgreSQL full dump
docker exec vx-platform-pg pg_dump -U vxture platform_main \
  | gzip > "${BACKUP_DIR}/pg_${DATE}.sql.gz"

# Redis RDB snapshot
REDIS_PASSWORD="$(cat /srv/vxture/runtime/secrets/redis-password)"
docker exec vx-platform-redis redis-cli -a "${REDIS_PASSWORD}" BGSAVE
sleep 3
cp /data/platform/db/redis/dump.rdb "${BACKUP_DIR}/redis_${DATE}.rdb"

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

---

## 参考文档

- `docs/50-deployment/00-overview.md` — 架构总览（AI Coding 参考）
- `docs/50-deployment/04-services.md` — Docker Compose 编排
- `docs/50-deployment/05-ci-cd.md` — CI/CD 流水线
