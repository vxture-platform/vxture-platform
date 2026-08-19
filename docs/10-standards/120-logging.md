# 日志与可观测性规范

> 更新：2026-05-14

本文档定义日志级别、结构化格式、敏感字段过滤和各层日志约定。目标：故障时能快速定位问题，日常运行不产生噪音，敏感信息不泄露。

---

## 1. 日志级别

| 级别    | 场景                                                               | 示例                                     |
| ------- | ------------------------------------------------------------------ | ---------------------------------------- |
| `error` | 需要人工介入的异常：请求失败、数据库连接断开、外部 API 调用失败    | 500 响应、LLM 调用超时                   |
| `warn`  | 降级或异常但不中断服务：重试成功、配置缺失但有默认值、接近配额上限 | Redis 不可用但 fail-open、token 即将过期 |
| `info`  | 服务生命周期、关键业务事件                                         | 服务启动/停止、用户登录、租户创建        |
| `debug` | 开发调试信息，生产默认关闭                                         | SQL 参数、HTTP 请求体、中间件执行路径    |

**生产环境默认级别：`info`**（仅输出 info / warn / error）。`debug` 仅在排查问题时临时开启。

```typescript
// 日志级别设置（NestJS）
const app = await NestFactory.create(AppModule, {
  logger:
    process.env.NODE_ENV === "production"
      ? ["error", "warn", "info"]
      : ["error", "warn", "info", "debug"],
});
```

---

## 2. 结构化日志格式（JSON）

所有服务端日志输出 **JSON 格式**，禁止纯文本拼接。字段约定：

```typescript
interface LogEntry {
  timestamp: string; // ISO 8601，UTC（例：2026-05-14T08:30:00.000Z）
  level: "error" | "warn" | "info" | "debug";
  service: string; // 服务名（例：'auth-bff'、'varda-server'、'model-platform'）
  requestId?: string; // 链路追踪 ID（见 error-handling.md §4）
  userId?: string; // 已脱敏处理，仅前 8 位 UUID
  tenantId?: string; // 租户 ID（完整，非敏感）
  message: string; // 可读描述，一句话
  data?: Record<string, unknown>; // 附加结构化数据
  error?: {
    // 仅 level=error 时填写
    name: string; // 异常类名
    message: string; // 异常消息
    stack?: string; // 仅开发环境包含
  };
}
```

**示例输出：**

```json
{
  "timestamp": "2026-05-14T08:30:00.000Z",
  "level": "info",
  "service": "auth-bff",
  "requestId": "a1b2c3d4-...",
  "userId": "u-abc123**",
  "message": "用户登录成功",
  "data": { "method": "feishu_oauth", "tenantId": "t-xyz789" }
}
```

```json
{
  "timestamp": "2026-05-14T08:31:05.123Z",
  "level": "error",
  "service": "model-platform",
  "requestId": "e5f6g7h8-...",
  "tenantId": "t-xyz789",
  "message": "LLM provider 调用失败",
  "data": { "model": "doubao-seed-2-0-lite", "latencyMs": 30000 },
  "error": {
    "name": "GatewayTimeoutError",
    "message": "Request timed out after 30000ms"
  }
}
```

---

## 3. 敏感字段过滤

以下字段在任何日志中**禁止出现原始值**，必须脱敏或省略：

```typescript
// 全局 logger 配置中注册脱敏列表
const REDACT_KEYS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "authorization",
  "cookie",
  "x-vxture-internal-auth",
  "apiKey",
  "cardNumber",
  "idCard",
];

// 手机号脱敏（保留前 3 后 4）
function maskPhone(phone: string) {
  return phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
}

// 邮箱脱敏
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name[0]}***@${domain}`;
}
```

**具体规则：**

```
❌ log.info('登录', { password: req.body.password })
✅ log.info('登录', { email: maskEmail(req.body.email) })

❌ log.debug('JWT', { token: accessToken })
✅ log.debug('JWT 已签发', { userId, expiresIn: '15m' })

❌ log.error('DB error', { connectionString: DATABASE_URL })
✅ log.error('DB 连接失败', { host: 'pgm-example.pg.rds.aliyuncs.com', database: 'vxturestudio_platform_main' })
```

---

## 4. 各层日志约定

### 4.1 BFF 层

**必须记录（info）：**

- 每个请求的入口：method、path、statusCode、latencyMs、requestId
- 认证结果：成功或失败（含失败原因 code，不含 token 内容）

**禁止记录：**

- 完整 request body（可能含密码、手机号）
- JWT token 内容
- response body 中的敏感字段

```typescript
// ✅ BFF 请求日志（仅记录必要字段）
this.logger.info("HTTP 请求完成", {
  requestId,
  method: req.method,
  path: req.path,
  statusCode: res.statusCode,
  latencyMs: Date.now() - startTime,
  userId: maskUserId(ctx.userId),
});
```

### 4.2 Service 层

**必须记录（info）：**

- 关键业务事件：账号创建、租户创建、订阅变更、权限变更

**禁止记录：**

- 每次数据库查询的完整 SQL（debug 模式下可以记录参数化 SQL，但不含实际参数值）
- 加密字段的原始值

### 4.3 Model Platform 层

**必须记录（info）：**

- 每次 LLM 调用的 model、tenantId、agentId、inputTokens、outputTokens、latencyMs、usageType

**禁止记录：**

- prompt 内容（对话历史、系统提示词）
- LLM 返回的内容（response text）

```typescript
// ✅ Model Platform 调用日志（记录计量数据，不记录内容）
this.logger.info("LLM 调用完成", {
  requestId,
  model: req.modelCode,
  tenantId: req.tenantId,
  agentId: req.agentId,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  latencyMs,
});
```

### 4.4 agent-server 层

**必须记录（info）：**

- Tool Use Loop 的开始和结束：sessionId、loopRound、finishReason
- 工具调用：toolName、success、latencyMs（不记录工具输入/输出内容）

**禁止记录：**

- 用户对话内容（message 文本）
- 工具返回数据（可能含用户业务数据）

---

## 5. 日志 vs 错误报告

| 类型               | 用途                     | 工具                   |
| ------------------ | ------------------------ | ---------------------- |
| 结构化日志         | 请求追踪、业务审计、计量 | 本地 stdout → 日志平台 |
| 错误报告（待接入） | 未处理异常聚合、告警     | Sentry（规划中）       |

**当前阶段**（Sentry 未接入）：

- `error` 级别日志即为告警信号，通过 `docker logs` 或日志平台监控
- 部署后 24h 监控：`docker logs vx-auth-bff --tail 200 | grep '"level":"error"'`

---

## 6. 禁止项

```
❌ 禁止在日志中输出密码、token、完整手机号、完整身份证号
❌ 禁止在日志中输出 LLM 对话内容（prompt/response）
❌ 禁止在 debug 级别记录数据库连接字符串
❌ 禁止使用 console.log 替代 logger（无法控制级别和格式）
❌ 禁止在生产环境默认开启 debug 级别（噪音过多，性能影响）
❌ 禁止在日志中拼接大型对象（用 JSON.stringify 序列化受控字段）
```

---

## 7. 日志检查清单（PR）

```
□ 新增 error 日志包含足够上下文（requestId、tenantId、错误原因）
□ 没有新的 console.log 被提交到生产代码
□ 新增日志没有输出密码、token、手机号原始值
□ LLM 相关日志记录了计量字段，未记录对话内容
□ 工具调用日志记录了 toolName 和 latency，未记录完整输入输出
```
