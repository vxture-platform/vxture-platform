# Vxture 基础设施概要

> 供 AI Coding 参考的基础设施现状与部署规划
> 更新：2026-06-01

---

## 一、整体架构

本文件描述 `vxture` 仓库负责的基础设施边界。代码与部署环境的权威对照见 [`08-code-environment-map.md`](./08-code-environment-map.md)。

```
用户/浏览器
    ↓
Cloudflare（DNS + CDN + WAF + Tunnel）
    ↓
vxture-VXTURE_DEPLOY_HOST（阿里云 ECS，公网入口 39.103.62.17）
  ├── Nginx 反向代理（SSL 终止）
  ├── 平台门户（website / admin / console）
  ├── 平台 BFF（website-bff / console-bff / admin-bff / auth-bff / gateway-bff）
  └── 平台数据库（PostgreSQL platform_main + Redis）

模型接入 / 授权 / 配额 / 计量已拆仓（Atlas，`vxture-atlas`，2026-07-24），不在本仓部署范围。

未来可选：
vxture-beta（临时按量服务器）
  └── 平台 beta 环境（同 部署服务器的平台服务集合，用完关闭）

外部业务仓库：
vx-worker-02/03/04/05 等（业务执行面，不由本仓部署）
  └── 业务 beta / prod 双环境（容器、端口、子域名隔离）
```

当前已确认的业务仓库推进顺序：

| 业务  | 外部业务仓库               | 目标 worker  | 状态                       |
| ----- | -------------------------- | ------------ | -------------------------- |
| Ruyin | `vxture/agentstudio-ruyin` | vx-worker-02 | 已创建仓库，承接迁移和部署 |
| Varda | `vxture/agentstudio-varda` | 待规划       | 等 Ruyin 模板跑顺后再迁移  |

### 核心分层原则

| 分层                     | 服务器             | 内容                           | 环境          | 本仓职责 |
| ------------------------ | ------------------ | ------------------------------ | ------------- | -------- |
| **平台控制面 prod**      | VXTURE_DEPLOY_HOST | 门户 + 平台 BFF + 平台数据库   | 常驻 prod     | 是       |
| **平台控制面 beta**      | vxture-beta        | 门户 + 平台 BFF + 平台数据库   | 临时按量 beta | 待规划   |
| **业务执行面 beta/prod** | vx-worker-02+      | 业务 BFF + Server + 业务数据库 | 外部业务环境  | 否       |

### 接入层说明

| 接入方式                 | 适用场景                                      | 本仓职责         |
| ------------------------ | --------------------------------------------- | ---------------- |
| Cloudflare Proxy + Nginx | 平台类域名（website / admin / console / api） | 是               |
| Tailscale SSH            | GitHub Actions 到 部署服务器的部署通道        | 是               |
| Cloudflare Tunnel        | 外部业务域名或 vx-worker-02 直连              | 否               |
| Tailscale 跨节点调用     | 外部业务调用平台 auth-bff / SSO / Atlas       | 只维护平台侧契约 |

---

## 二、节点信息

| 节点                      | 角色               | 系统         | 规格                | Tailscale IP   | 公网 IP      | 本仓职责 |
| ------------------------- | ------------------ | ------------ | ------------------- | -------------- | ------------ | -------- |
| vxture-VXTURE_DEPLOY_HOST | 平台控制面 prod    | Ubuntu 26.04 | 2C 2G 40G+2G ESSD   | 100.100.197.42 | 39.103.62.17 | 是       |
| vxture-beta               | 平台控制面 beta    | 待定         | 临时按量            | 待定           | 待定         | 待规划   |
| vxture-vx-worker-02       | 外部业务执行面     | Ubuntu 26.04 | 8C 24G 200G+3T RAID | 100.76.219.48  | 无           | 否       |
| stone-work                | 办公电脑（开发）   | Windows 11   | —                   | 100.75.104.94  | —            | 开发访问 |
| stone-mix14               | 个人笔记本（管理） | Windows 11   | —                   | 100.72.64.52   | —            | 管理访问 |

**VXTURE_DEPLOY_HOST 存储**：40G 系统盘（OS + 容器镜像）+ 2G ESSD `/data`（平台数据库 + Nginx）。初始化检查要求数据盘不低于 2G（含 2G），用量增长后再在线扩容。

**VXTURE_DEPLOY_HOST 命名约定**：`vxture-VXTURE_DEPLOY_HOST` 保留为本机 SSH 配置中的 Host alias、文档逻辑节点名和外部管理识别名，不要求改名；`VXTURE_DEPLOY_HOST` 是服务器 Linux hostname 和 Tailscale hostname，初始化脚本中的 `TARGET_HOSTNAME` 必须保持为 `VXTURE_DEPLOY_HOST`。`VXTURE_DEPLOY_HOST` 仍是本仓平台生产部署目标名，不等同于 Linux hostname。

`vx-worker-02` 的存储和业务数据目录由外部业务仓库维护，本仓只记录边界，不维护实施步骤。

---

## 三、层级分工

### VXTURE_DEPLOY_HOST — 平台控制面（仅 prod，无 beta）

| 服务                  | 容器名              | 端口     | 说明                                   |
| --------------------- | ------------------- | -------- | -------------------------------------- |
| Nginx                 | `vx-nginx`          | 80 / 443 | SSL 终止、所有子域名反向代理           |
| website               | `vx-website`        | 3010     | Next.js，vxture.com 官网/注册/登录     |
| console               | `vx-console`        | 3020     | Next.js，console.vxture.com 租户工作台 |
| admin                 | `vx-admin`          | 3030     | Next.js，y.vxture.com 运营后台         |
| gateway-bff           | `vx-gateway-bff`    | 8000     | 唯一公共 API 入口                      |
| auth-bff              | `vx-auth-bff`       | 3090     | JWT 唯一签发源，所有 BFF 依赖          |
| website-bff           | `vx-website-bff`    | 3011     | 注册/登录/租户初始化                   |
| console-bff           | `vx-console-bff`    | 3021     | 租户管理/成员/账单/订阅                |
| admin-bff             | `vx-admin-bff`      | 3031     | 平台运营管理                           |
| **platform-postgres** | `vx-platform-pg`    | 内部     | 平台数据库（见 Schema 表）             |
| **platform-redis**    | `vx-platform-redis` | 内部     | 会话/限流/Token 黑名单                 |

**平台数据库 Schema 分布（`platform_main`，8 个 schema）：**

| Schema     | 内容                                      | 管理方                                           |
| ---------- | ----------------------------------------- | ------------------------------------------------ |
| `identity` | 账号、凭证、OAuth、会话、验证码、登录记录 | auth-bff / website-bff                           |
| `iam`      | 角色、权限、成员角色绑定、能力定义        | console-bff                                      |
| `tenant`   | 租户、成员、配置、邀请                    | website-bff / console-bff                        |
| `product`  | 产品方案、能力定义、定价                  | admin-bff                                        |
| `commerce` | 订单、账单、支付、退款、订阅、积分        | admin-bff / console-bff                          |
| `model`    | AI 模型目录、授权、定价策略               | admin-bff / console-bff（读）；Atlas（外部，写） |
| `ops`      | 平台管理员、角色权限、配置、治理记录      | admin-bff                                        |
| `support`  | 工单、审计日志、通知日志                  | admin-bff                                        |

> **VXTURE_DEPLOY_HOST 内存压力提示**：2G RAM 运行全套平台服务较紧。建议 Next.js 使用 `output: 'standalone'`，各容器设置 `--memory` 上限，开启 2G swap 作为应急缓冲。

### 外部业务执行面（vx-worker-02，不由本仓部署）

业务执行面的目标形态：一台 vx-worker-02 同时承载 Ruyin beta 和 prod，通过独立容器、端口、子域名和数据目录隔离；用户在 beta 满意后，再平滑过渡到 prod。该模式先在 `vxture/agentstudio-ruyin` 中跑通，并沉淀为后续业务仓库工作流模板。

这部分属于外部业务仓库任务。本仓不得新增 vx-worker-02/03/04/05 等业务 worker 的 compose、workflow、secrets、脚本或部署检查单。P7b 已删除本仓 Ruyin 实现目录和 `deploy/vx-worker-02` 历史资产；后续不得重新创建为本仓部署入口。Atlas 是平台能力（已拆仓 `vxture-atlas`），业务 worker 只能作为受控调用方，不部署本仓网关容器。Varda 迁移需等待 Ruyin 仓库部署闭环稳定后，再规划 `vxture/agentstudio-varda`。

---

## 四、数据持久化目录

### VXTURE_DEPLOY_HOST：`/data/`（2G ESSD 起步 — 平台数据）

```
/data/
├── nginx/
│   ├── conf/
│   │   ├── nginx.conf
│   │   ├── sites-enabled/       ← 各域名 server block
│   │   └── snippets/            ← ssl-params.conf / proxy-params.conf
│   ├── ssl/                     ← *.vxture.com 通配符证书 + 私钥
│   └── logs/
└── platform/
    ├── db/
    │   ├── postgres/            ← Platform PostgreSQL PGDATA（所有平台 schema）
    │   └── redis/               ← Platform Redis AOF（会话/限流/黑名单）
    ├── backups/                 ← pg_dump 本地存储，再同步阿里云 OSS
    └── logs/                    ← 各平台 BFF 运行日志
```

**2G ESSD 起步容量口径：**

| 内容                         | 估计大小      |
| ---------------------------- | ------------- |
| PostgreSQL seed / 初期数据   | < 0.5G        |
| Redis 持久化                 | < 0.5G        |
| Nginx 配置 / 证书 / 少量日志 | < 0.5G        |
| 预留空间                     | 约 0.5G       |
| **合计**                     | **不超过 2G** |

> 2G 满足当前 seed 数据和初始部署检查；生产数据、日志或本地备份增长后，应在线扩容 Alibaba Cloud ESSD，无需停机。

### vxture-beta：临时平台数据目录（未来）

未来若开启平台 beta，必须在独立临时服务器上按 部署服务器的平台结构初始化数据目录，并在关闭服务器前完成数据清理或快照归档。

vx-worker-02 的业务数据目录由外部业务仓库维护，本仓不定义 `/data/{business}/` 结构。

---

## 五、域名规划

| 域名                 | 接入方式                       | 目标服务（节点）        | 本仓职责 | 状态   |
| -------------------- | ------------------------------ | ----------------------- | -------- | ------ |
| `vxture.com`         | CF Proxy → Nginx → website     | VXTURE_DEPLOY_HOST:3010 | 是       | 待部署 |
| `www.vxture.com`     | CF Proxy                       | 重定向到 vxture.com     | 是       | 待部署 |
| `y.vxture.com`       | CF Proxy → Nginx → admin       | VXTURE_DEPLOY_HOST:3030 | 是       | 待部署 |
| `console.vxture.com` | CF Proxy → Nginx → console     | VXTURE_DEPLOY_HOST:3020 | 是       | 待部署 |
| `api.vxture.com`     | CF Proxy → Nginx → gateway-bff | VXTURE_DEPLOY_HOST:8000 | 是       | 待部署 |
| `beta.vxture.com`    | 待规划                         | vxture-beta 临时服务器  | 待规划   | 预留   |
| 业务域名             | 外部业务仓库定义               | vx-worker-02            | 否       | 外部   |

**CF Proxy 模式**：Full Strict（Cloudflare ↔ Nginx 之间必须有效 HTTPS）

---

## 六、跨节点服务调用关系

```
VXTURE_DEPLOY_HOST（平台控制面 prod）
  ├── Nginx → portals（内部容器网络）
  ├── portals → platform BFFs（内部容器网络）
  ├── platform BFFs → platform-postgres（内部容器网络）
  ├── platform BFFs → platform-redis（内部容器网络）
  ├── console/admin BFFs → Atlas（外部，`vxture-atlas`，MODEL_PLATFORM_URL）
  └── auth-bff 对外部业务开放 HTTP/SSO 契约（Tailscale 或公网网关策略另行确认）

外部业务仓库（当前 Ruyin 为 `vxture/agentstudio-ruyin`，后续 Varda 为 `vxture/agentstudio-varda`）
  └── 如需认证或 AI 能力，只能通过平台公开的 SSO / auth-bff / Atlas HTTP 契约调用，不得引用本仓内部包
```

**关键约束**：本仓只维护平台侧 auth-bff / SSO / Atlas 契约，不维护业务 worker 容器或部署链路。

---

## 七、端口速查

> 端口权威定义见 [`docs/40-implementation/ai/port-allocation.md`](../40-implementation/ai/10-port-allocation.md)，本文件不再维护端口表。

---

## 八、当前状态快照（2026-05-11）

### VXTURE_DEPLOY_HOST 运行中的容器

| 容器名            | 状态      | 处置                                                                  |
| ----------------- | --------- | --------------------------------------------------------------------- |
| vxture-nginx      | ✅ 运行   | 保留平台域名配置；业务域名相关配置迁出本仓部署边界                    |
| vxture-pg-prod    | ⚠️ 运行   | 重命名为 `vx-platform-pg`，数据目录迁至 `/data/platform/db/postgres/` |
| vxture-pg-beta    | ❌ 需清理 | 平台层无 beta，停止并删除                                             |
| vxture-redis-prod | ⚠️ 运行   | 重命名为 `vx-platform-redis`，数据目录迁至 `/data/platform/db/redis/` |
| vxture-redis-beta | ❌ 需清理 | 平台层无 beta，停止并删除                                             |
| ruyin-8443-test   | ❌ 需清理 | 历史测试 Caddy，停止并删除                                            |

### vx-worker-02 运行中的容器

vx-worker-02 不属于本仓部署范围。相关容器清理、业务数据目录、Cloudflare Tunnel 和子域名切换由外部业务仓库或业务运维文档维护。

---

## 九、待完成事项

> 部署任务跟踪见 [`docs/00-meta/status.md § 部署待完成事项`](../00-meta/30-status.md)。
