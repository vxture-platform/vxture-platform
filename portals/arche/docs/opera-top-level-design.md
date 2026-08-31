# Opera 基础设施控制平面（Infrastructure Control Plane）

## 顶层设计文档 v1.0

---

# 1. 产品定位

## 1.1 产品定义

Opera 是 Vxture 平台统一基础设施控制平面（Infrastructure Control Plane）。

负责平台技术资源管理、运行管理、计量管理、发布管理、可观测管理和安全管理。

Opera 不承担商业运营职责。

---

## 1.2 职责边界

### Opera 负责

- 技术资源管理
- 模型服务管理
- 服务运行管理
- 资源调度管理
- 请求计量管理
- 成本事实管理
- 发布管理
- 日志与监控
- 安全审计

### Opera 不负责

- 产品运营
- 商业运营
- 套餐管理
- 定价管理
- 配额策略
- 订单管理
- 合同管理
- 账单管理

---

## 1.3 平台分工

```text
┌───────────────────────┐
│        Admin          │
│  Business Operation   │
└──────────┬────────────┘
           │
           │
┌──────────▼────────────┐
│        Opera          │
│ Infrastructure Plane │
└──────────┬────────────┘
           │
 ┌─────────┼─────────┐
 │         │         │
 ▼         ▼         ▼

Atlas     Arda      Runos
Model     Data      Ability

           │
           ▼

         Ruyin
       Workspace
```

---

# 2. 总体架构

## 2.1 领域划分

```text
Opera
│
├── Resource Domain
├── Runtime Domain
├── Metering Domain
├── Delivery Domain
├── Observability Domain
└── Security Domain
```

---

# 3. Resource Domain

## 目标

统一管理平台技术资源。

---

## 当前资源

### Atlas

- Provider
- Model
- Endpoint
- API Key

---

## 未来资源

### Infrastructure

- Cluster
- Node
- GPU

### Data

- Datasource
- Dataset
- Storage

### Ability

- Agent
- Workflow
- Skill

---

## 统一资源模型

```typescript
interface Resource {
  id: string;
  type: string;
  name: string;
  status: string;
  tags: string[];
  metadata: Record<string, any>;
}
```

---

# 4. Runtime Domain

## 目标

统一管理平台运行时资源。

包括：

- 服务运行
- 流量路由
- 模型路由
- 故障转移

---

# 5. Metering Domain

## 目标

记录平台技术事实。

### 记录内容

- Request
- Input Token
- Output Token
- Duration
- Latency
- Raw Cost

---

## 原则

Opera 记录事实成本。

Admin 管理销售价格。

```text
Opera
└── Raw Cost

Admin
└── Sale Price
```

---

# 6. Delivery Domain

## 目标

统一软件交付能力。

包括：

- Build
- Deployment
- Release
- Rollback
- Canary

---

# 7. Observability Domain

## Metrics

- CPU
- Memory
- GPU
- Network
- Disk

---

## Service Metrics

- QPS
- TPS
- Latency
- Error Rate

---

## Trace

基于 OpenTelemetry。

统一链路追踪：

```text
Gateway
→ Router
→ Service
→ Provider
→ Response
```

---

## Log

- Application Log
- System Log
- Audit Log

---

# 8. Security Domain

## Access Control

平台运维权限。

### 角色

- Platform Admin
- Operator
- Developer
- Viewer

---

## Secret Vault

统一密钥管理。

### 管理对象

- Provider Key
- Database Password
- JWT Secret
- OAuth Secret

---

## Audit

记录：

- 谁
- 什么时间
- 修改什么

---

# 9. 菜单结构

```text
Opera

├── Dashboard

├── Atlas

├── Observability

├── Security

└── Settings
```

---

# 10. Opera 发展路线

## Opera 1.0

### Dashboard

- 平台状态
- Atlas状态
- 请求统计

### Atlas

- Provider
- Model
- Endpoint
- Router
- Metering

### Observability

- Metrics
- Logs

### Security

- RBAC
- Audit

---

## Opera 2.0

新增：

- Cluster
- Node
- Storage
- Queue
- Alert
- Secret Vault

---

## Opera 3.0

新增：

- Deployment
- Release
- Canary
- Multi Product Resource Center
- Unified Infrastructure Platform

---

# 11. 设计原则

## Headless First

所有能力先提供 API。

UI 仅作为控制面。

---

## Resource Oriented

所有对象统一资源化管理。

---

## Observable First

所有请求必须可追踪。

---

## Metering First

所有资源必须可计量。

---

## Product Agnostic

Opera 不属于 Atlas。

Opera 管理 Atlas。

未来同样管理：

- Arda
- Runos
- Ruyin
- Future Products

---
