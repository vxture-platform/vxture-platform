# Atlas 模型服务平台（Model Serving Platform）

## 产品设计文档 v1.0

---

# 1. 产品定位

## 产品定义

Atlas 是 Vxture 统一模型服务平台。

负责：

- 模型注册
- 模型管理
- 模型路由
- 模型代理
- 模型计量
- 模型观测

Atlas 不提供业务功能。

Atlas 是 Headless Platform。

---

# 2. 架构定位

```text
Business Application

        ↓

      Atlas

        ↓

 ┌──────┼───────┐
 │      │       │

OpenAI Claude Gemini
```

---

# 3. 核心领域

```text
Atlas

├── Provider
├── Model Registry
├── Endpoint
├── Router
├── API Gateway
├── API Key
├── Metering
└── Observability
```

---

# 4. Provider

## 定义

模型供应商。

---

## Provider 示例

- OpenAI
- Anthropic
- Google
- DeepSeek
- Qwen
- GLM

---

## 属性

```typescript
interface Provider {
  id: string;
  code: string;
  name: string;
  status: string;

  region: string;
  proxy: string;

  apiKey: string;

  createdAt: Date;
}
```

---

## 功能

### Provider 管理

- 创建
- 编辑
- 禁用
- 删除

### Provider 健康检查

- API检测
- 响应检测
- 延迟检测

---

# 5. Model Registry

## 定义

统一模型注册中心。

---

## 示例

```text
gpt-5
gpt-5-mini

claude-opus
claude-sonnet

gemini-3

deepseek-r1
```

---

## 模型能力

```text
Chat
Reasoning
Embedding
Vision
Image
Audio
Video
Tool Calling
```

---

## 数据模型

```typescript
interface Model {
  id: string;

  providerId: string;

  code: string;
  name: string;

  version: string;

  contextWindow: number;

  capabilities: string[];

  status: string;
}
```

---

# 6. Endpoint

## 定义

统一能力入口。

业务系统永远访问 Endpoint。

不直接访问模型。

---

## 示例

```text
chat/default

reasoning/default

embedding/default

vision/default
```

---

## Endpoint 模型

```typescript
interface Endpoint {
  id: string;

  code: string;

  category: string;

  primaryModelId: string;

  enabled: boolean;
}
```

---

# 7. Router

## 定义

Atlas 核心能力。

负责模型选择。

---

## 路由模式

### Single

```yaml
chat/default:
  primary: gpt-5
```

---

### Failover

```yaml
chat/default:
  primary: gpt-5

  fallback: claude-opus
```

---

### Weight

```yaml
chat/default:
  models:
    - model: gpt-5
      weight: 80

    - model: claude-opus
      weight: 20
```

---

### Canary

```yaml
chat/default:
  stable: gpt-5

  candidate: gpt-5.1

  traffic: 5%
```

---

# 8. API Gateway

## 目标

统一外部访问入口。

---

## 标准接口

```text
POST /v1/chat

POST /v1/embedding

POST /v1/image

POST /v1/audio
```

---

## OpenAI Compatible

兼容 OpenAI SDK。

---

# 9. API Key

## 类型

### Internal Key

服务间调用。

例如：

```text
runa-engine

arda-service
```

---

### External Key

外部应用调用。

---

## 功能

- 创建
- 吊销
- 禁用
- 轮换

---

# 10. Metering

## 目标

记录事实计量数据。

---

## Request

记录：

```text
Request Count
```

---

## Token

记录：

```text
Input Token

Output Token
```

---

## Latency

记录：

```text
TTFT

Duration
```

---

## Cost

记录：

```text
Provider Cost

Model Cost
```

---

## 聚合维度

### Provider

```text
OpenAI

Anthropic

Gemini
```

---

### Model

```text
GPT-5

Claude Opus
```

---

### Endpoint

```text
chat/default
```

---

### Tenant

```text
Tenant A

Tenant B
```

---

# 11. Observability

## Metrics

### Gateway

- QPS
- TPS
- Latency

---

### Provider

- Success Rate
- Error Rate

---

### Endpoint

- Request Count
- Token Count

---

# 12. Audit

记录：

- Provider变更
- Model变更
- Endpoint变更
- Router变更

---

# 13. Atlas 1.0 范围

## Provider

- CRUD
- Health Check

---

## Model Registry

- CRUD
- Capability Tag

---

## Endpoint

- CRUD

---

## Router

- Primary
- Fallback

---

## API Key

- CRUD
- Rotation

---

## Metering

- Request
- Token
- Cost

---

## Observability

- Metrics
- Logs

---

# 14. Atlas 2.0

新增：

- Weight Routing
- Canary Routing
- Multi Region Routing
- SLA Engine
- Quota Engine

---

# 15. Atlas 3.0

新增：

- Intelligent Routing
- Auto Cost Optimization
- Model Evaluation
- Benchmark Center
- Model Marketplace

---

# 16. 核心原则

## Provider Decoupling

业务系统永远不直接依赖供应商。

---

## Endpoint First

业务系统只依赖 Endpoint。

---

## Router Driven

所有模型切换由 Router 完成。

---

## Metering First

所有请求必须被计量。

---

## Observable First

所有请求必须可观测。

---
