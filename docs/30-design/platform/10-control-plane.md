# Vxture 平台控制面与业务数据面架构概要设计

> 🧭 产品架构层上游（2026-07-06 新增，产品架构族 `product_{NNN}`）：**产品分层与矩阵** = [`product_100_matrix.md`](../product_100_matrix.md) v1.0（L0–L3，终版命名）；**共享与隔离语义** = [`product_110_sharing-isolation.md`](../product_110_sharing-isolation.md) v1.0（P-T-A 资产分级、SharingGrant、供给直连）；**对接契约** = [`product_200_integration.md`](../product_200_integration.md) v1.0（三通道）。本文的双平面架构继续有效，L2 域平台的资产托管落在各自**业务面**基础设施（不进平台控制面库）。数据架构权威 = `data_platform_100_architecture.md`（本文部分 schema 命名为旧稿表述，以彼为准）。

## 1. 文档目标

本文档定义 Vxture 平台在 AI SaaS 场景下的：

- 平台控制面（Platform Control Plane）
- 业务数据面（Business Data Plane）
- Model Platform 与统一配额体系
- Beta / Prod 环境治理
- PostgreSQL 容器与数据库边界
- Docker 网络与部署边界
- 面向 CI/CD 的容器组织原则

本文档为概要设计规范。
后续将继续细化：

- 数据库详细设计
- Docker Compose 设计
- CI/CD 设计
- Model Platform 详细设计
- Quota / Billing 详细设计
- 租户与环境治理设计

---

# 2. 核心架构思想

Vxture 平台采用：

```txt
Platform Control Plane
+
Business Data Plane
```

的双平面架构。

其核心原则：

```txt
平台负责控制
业务负责执行
```

即：

| 层级                   | 职责                                                      |
| ---------------------- | --------------------------------------------------------- |
| Platform Control Plane | 用户、租户、认证、订阅、计费、配额、审计、平台治理        |
| Business Data Plane    | AI业务、GIS业务、无人机业务、业务任务、业务文件、模型结果 |

---

# 3. Platform Control Plane（平台控制面）

## 3.1 定位

平台控制面是：

```txt
全平台唯一真实来源（Single Source of Truth）
```

负责：

- 平台经营数据
- 平台治理数据
- 平台权限数据
- 平台计费与配额数据

平台控制面不承载业务执行数据。

---

## 3.2 平台数据库

生产环境：

```txt
Database:
  阿里云 RDS PG18 · vxturestudio_platform_main（内网 endpoint，2026-08-19 起）
```

当前阶段：

- 一个 PostgreSQL 容器
- 一个主业务 Database
- 多 Schema

后续可按需拆分服务。

---

## 3.3 平台数据库承载内容

`vxturestudio_platform_main` 承载：

```txt
iam.*
tenant.*
subscription.*
billing.*
payment.*
invoice.*
audit.*
notification.*
system.*
quota.*
usage.*
```

包括：

- 用户
- 登录认证
- 租户与组织
- RBAC 权限
- 订阅
- 套餐
- 订单
- 支付
- 发票
- Token 配额
- AI 用量
- 平台审计
- 系统配置

---

## 3.4 平台数据库不承载内容

平台主库不允许存储：

```txt
灾害监测业务数据
无人机业务数据
GIS 图层数据
AI任务过程数据
模型输出结果
业务文件数据
业务缓存
向量数据
```

这些属于业务数据面。

---

# 4. Business Data Plane（业务数据面）

## 4.1 定位

业务数据面负责：

```txt
业务执行
AI任务
业务数据
业务文件
业务流程
```

业务数据面允许：

```txt
beta / prod 双环境
```

并允许：

- 公测
- 试用
- 生命周期清理
- 数据迁移
- 环境独立

---

## 4.2 业务数据库设计

每个业务独立数据库容器（使用 `vx-*` 前缀），由对应外部业务仓库维护。

例如：

```txt
vx-varda-pg        (prod)
└─ vxturebiz_varda_main

vx-{business}-pg  (prod)
└─ vxturebiz_{business}_main
```

beta 环境各业务独立，数据库与 prod 完全隔离。

---

## 4.3 业务数据库职责

业务数据库负责：

```txt
业务任务
业务对象
业务文件
GIS数据
AI结果
工作流数据
向量索引
模型推理结果
```

业务数据库不负责：

```txt
用户认证
订阅
支付
计费
Token额度
平台权限
```

---

## 4.4 业务与平台关联

业务库只保存：

```txt
tenant_id
app_instance_id
user_id
```

用于关联平台。

但不复制平台主数据。

---

# 5. Beta / Prod 环境治理

## 5.1 平台层

平台层：

```txt
只有 Prod
```

即：

```txt
vxturestudio_platform_main
```

为全平台唯一正式经营库。

原因：

```txt
支付不能双份
订阅不能双份
租户不能双份
权限不能双份
```

平台控制面必须唯一可信。

---

## 5.2 业务层

业务层允许：

```txt
beta
prod
```

beta 用于：

- 试用
- 公测
- 功能验证
- 沙箱环境
- AI能力测试

prod 用于：

- 正式客户
- 正式数据
- 正式订阅

---

## 5.3 Beta → Prod 转换

用户试用满意后：

```txt
beta → prod
```

支持：

```txt
迁移业务数据
或重新开始
```

迁移只迁移：

```txt
业务数据
```

不迁移：

```txt
用户
支付
订阅
权限
```

因为这些已经在 Platform Main。

---

## 5.4 Beta 数据生命周期

业务 beta 数据允许：

```txt
自动清理
自动归档
超期删除
```

需要支持：

```txt
trial_status
trial_expires_at
last_active_at
cleanup_after_at
```

---

# 6. Model Platform 架构

业务系统不允许直接调用模型厂商。统一模型接入层的终态产品名是 **Atlas**——2026-07-24 已拆分为独立仓 `vxture-atlas`，不再是本仓部署单元；架构/职责/调用链权威见 [`40-model-platform.md`](./40-model-platform.md)（已改为退役指针）与 `vxture-atlas` 仓自身文档。

---

# 7. 配额与计费体系

## 7.1 核心原则

```txt
配额中心化
业务去中心化
```

即：

- 配额由平台统一管理
- 业务只负责上报 usage
- Token 统一扣减

---

## 7.2 平台统一 Token Pool

平台维护：

```txt
tenant_token_pool
```

例如：

```txt
tenant A
├─ GPT-5 quota
├─ Claude quota
├─ DeepSeek quota
└─ Doubao quota
```

---

## 7.3 Usage 统一记录

平台记录：

```txt
tenant_usage
├─ tenant_id
├─ business_code
├─ environment
├─ model
├─ input_tokens
├─ output_tokens
├─ request_count
└─ cost
```

业务数据清理不会影响平台 usage。

---

# 8. Docker 与网络架构

## 8.1 网络设计

每个业务部署在独立的 Docker 网络，实现故障隔离。注意：vx-worker-02/03/04/05 等业务执行面由外部业务仓库维护，本节只说明控制面与业务面边界，不作为 `vxture` 仓库部署任务。

- 平台控制面：`vx-platform` 网络（VXTURE_DEPLOY_HOST）
- 每个业务数据面：独立网络，由外部业务仓库定义（vx-worker-02/03/04/05 等）
- Atlas（原 Model Platform）：已拆分为独立仓 `vxture-atlas`，不再是本仓部署单元

容器通过容器名访问，禁止固定容器 IP。

---

## 8.2 Nginx 入口

```txt
Cloudflare
    ↓
vx-nginx (VXTURE_DEPLOY_HOST)
    ↓
平台 / 业务容器
```

业务服务（如 ruyin）通过外部业务仓库维护的入口接入对应业务 worker；`vxture` 仓库不维护该 Tunnel 或业务反向代理。

---

## 8.3 容器边界原则

平台容器（VXTURE_DEPLOY_HOST，`vx-platform` 网络）：

```txt
vx-nginx, vx-website, vx-admin, vx-console
vx-auth-bff, vx-website-bff, vx-admin-bff, vx-console-bff, vx-gateway-bff
（数据态在云：RDS PostgreSQL + Tair Redis）
```

业务容器（vx-worker-02/03/04/05 等，各自独立网络，由外部业务仓库维护）：

```txt
vx-varda-bff, vx-varda-server, vx-varda-pg, vx-varda-redis
vx-{business}-bff, vx-{business}-server, vx-{business}-pg, vx-{business}-redis
```

不同业务相互隔离，一个业务崩溃不影响平台控制面。业务容器如需使用 AI 能力，只能通过受控 HTTP/API 调用 Atlas，禁止在业务 worker 自行部署模型网关或持有平台 Provider Key。

详见 [`docs/50-deployment/04-services.md`](../../50-deployment/04-services.md)。

---

# 9. Docker Compose 与 CI/CD

Docker Compose 配置、镜像命名、环境变量管理见 [`docs/50-deployment/`](../../50-deployment/00-index.md)。

---

# 10. 后续详细设计方向

下一阶段继续细化：

```txt
1. PostgreSQL Schema 详细设计
2. IAM 详细设计
3. Subscription / Billing 详细设计
4. Quota / Usage 详细设计
5. Model Platform 详细设计
6. Docker Compose 详细设计
7. GitHub Actions 详细设计
8. 多业务 Stack 编排设计
9. 业务 beta/prod 生命周期设计
10. 数据迁移与归档设计
```

---

End of document.
