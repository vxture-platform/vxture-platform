# 服务健康端点响应契约（health / identity / provenance）标准

**用途**：统一所有服务健康端点的**响应契约**——不只证明"进程在听"，还诚实报告"这是谁、跑的哪个版本、哪次构建、什么环境"。跨仓库(平台/arda/vxtpl/模板/umbra)一致遵循，运维一眼可辨、可回溯、可聚合。
**关系**：本标准是 [`020-container-healthcheck-standard`](./020-container-healthcheck-standard.md) 的响应层延伸。020 管**探活机制**(无依赖 liveness、绑 `0.0.0.0`、探测参数)；本标准管**响应体 + 构建溯源注入**。二者配套。
**来源**：从 vxture 实战 + 多产品健康端点漂移对账萃取。零一项目可直接套用。
**版本**：1.0.0 ｜ **更新**：2026-07-21

---

## 1. 为什么（问题）

健康端点最常见的退化：只回 `{"status":"ok"}`，或**硬编造版本**。真实事故形态：

- 生产端点报 `"sha":"dev"` / `"stage":"local"`（构建期没注入 → 谁都不知道线上跑的哪次构建）。
- BFF 硬编码 `"version":"1.0.0"`（永远是 1.0.0，等于没有）。
- 同一产品不同服务，字段名/形状各不相同（`product` vs `service`、`sha` vs `gitSha`、有的带 `timestamp` 有的不带）→ 无法统一聚合。

健康端点是**运行态的版本 SoT**。要么报真值，要么诚实兜底 `dev`/`unknown`——**绝不硬编造**。

---

## 2. 两类端点（务必分开）

| 端点                        | 语义                             | 依赖                             | 返回码                                           | 谁用                                   |
| --------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------ | -------------------------------------- |
| **liveness**（存活 + 身份） | 进程在听 + 我是谁/哪个构建       | **零依赖**（不碰 DB/Redis/上游） | 存活即 **200**（状态在 body 的 `status` 里表达） | Docker HEALTHCHECK、LB、监控、版本聚合 |
| **readiness**（就绪，可选） | 能否对外服务（关键依赖是否就绪） | 探关键依赖                       | 就绪 **200** / 未就绪 **503**                    | 滚动发布闸门、编排                     |

**铁律**：容器 liveness 探针**只探 liveness 端点**，绝不探 readiness——否则依赖抖动会让容器被误判 unhealthy（见 020 §4）。readiness 供发布/编排用。

**路径约定**（保留现有、新增照此）：

| 运行时                   | liveness          | readiness（可选） |
| ------------------------ | ----------------- | ----------------- |
| Next.js / 前端 HTTP 应用 | `GET /api/health` | `GET /api/ready`  |
| NestJS / 后端服务        | `GET /healthz`    | `GET /readyz`     |

> 新服务一律用上表规范路径。

---

## 3. 响应契约（identity block）

**每个 liveness 端点**必须返回下列身份块（字段名、类型固定）：

```json
{
  "status": "ok",
  "service": "console",
  "version": "v0.20.8",
  "gitSha": "8a03ec48",
  "stage": "production",
  "buildTime": "2026-07-21T07:30:00.000Z",
  "time": "2026-07-21T07:55:49.332Z"
}
```

| 字段        | 类型        | 必填 | 含义 / 取值                                                                                          |
| ----------- | ----------- | ---- | ---------------------------------------------------------------------------------------------------- |
| `status`    | string      | ✅   | liveness 恒为 `"ok"`（进程能应答就是 ok；就绪度不在这里表达）                                        |
| `service`   | string      | ✅   | 服务标识，最细粒度部署单元。如 `console` / `console-bff` / `platform-api`                            |
| `version`   | string      | ✅   | 人看的发布号 = 部署所用 git tag（如 `v0.20.8`）；非 tag 构建**诚实兜底** `"dev"`                     |
| `gitSha`    | string      | ✅   | 构建 commit SHA（短或全）；缺失兜底 `"unknown"`。**不带 `sha-` 前缀**（前缀是镜像 tag 形态，非数据） |
| `stage`     | string      | ✅   | 运行环境：`production` / `beta` / `dev` / `local`。由部署 tag 前缀推导；未知兜底 `"dev"`             |
| `buildTime` | string(ISO) | ✅   | 镜像构建时间戳；缺失兜底 `"unknown"`                                                                 |
| `time`      | string(ISO) | ✅   | **当前**服务器时间——证明实时应答 + 时钟正常                                                          |
| `product`   | string      | ⭕   | 产品线标识（多服务产品用），如 `vxture` / `arda`。单服务产品可省                                     |
| `uptimeSec` | number      | ⭕   | 进程启动至今秒数                                                                                     |

`version` 与 `gitSha` **都留、不冗余**：`version` 回答"上的哪个发布"，`gitSha` 回答"确切哪次构建"。

**禁止**：body 内出现任何密钥、内网地址、PII、依赖连接串。身份块是可公开信息。

readiness 端点在身份块基础上加 `checks`（逐依赖）：

```json
{
  "status": "ready",
  "service": "platform-api",
  "version": "...",
  "gitSha": "...",
  "stage": "production",
  "time": "...",
  "checks": { "db": "ok", "redis": "ok" }
}
```

`status` ∈ `ready` | `degraded` | `fail`；`fail` → HTTP 503。

---

## 4. 构建期注入（关键：值从哪来）

身份块的 `version` / `gitSha` / `buildTime` / `stage` **必须在构建期注入镜像**，运行时只读取。这是 `sha:"dev"` 类事故的根治点。

### 4.1 约定的 build-args → ENV

镜像 Dockerfile 声明四个 ARG（**带诚实默认值**，未注入也能构建且值诚实）：

```dockerfile
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG DEPLOY_STAGE=dev
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME} \
    DEPLOY_STAGE=${DEPLOY_STAGE}
```

> Next.js standalone：这些是**服务端运行时** env（`runtime="nodejs"` 的 health route 直接读 `process.env`），**不是** `NEXT_PUBLIC_*`——不进客户端 bundle。

### 4.2 CI 注入（GitHub Actions）

构建工作流按下表推导并作为 build-args 传入（值来自 `github.ref_name` / `github.sha` / 运行时 `date`）：

| build-arg      | 来源                                                            | 兜底           |
| -------------- | --------------------------------------------------------------- | -------------- |
| `APP_VERSION`  | `github.ref_name`（当 `ref_type == 'tag'`，如 `v0.20.8`）       | 非 tag → `dev` |
| `GIT_SHA`      | `github.sha`（短 SHA）                                          | —              |
| `BUILD_TIME`   | 构建步骤 `date -u +%Y-%m-%dT%H:%M:%SZ`                          | —              |
| `DEPLOY_STAGE` | tag 前缀映射：`v*`→`production`、`beta-*`→`beta`、`dev-*`→`dev` | 其它 → `dev`   |

**幂等/无破坏**：ARG 有默认值，旧调用不传也能构建（值落 `dev`/`unknown`，诚实）。

---

## 5. 各框架落地

**Next.js App Router**（`app/api/health/route.ts`）——保持零依赖、`dynamic="force-dynamic"`、`runtime="nodejs"`：

```ts
import { NextResponse } from "next/server";
import { buildHealthIdentity } from "@vxture/shared";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET() {
  return NextResponse.json(buildHealthIdentity({ service: "console" }));
}
```

**NestJS**（`health.router.ts`）：

```ts
import { Controller, Get } from "@nestjs/common";
import { buildHealthIdentity } from "@vxture/shared";
@Controller()
export class HealthRouter {
  @Get("healthz")
  check() {
    return buildHealthIdentity({ service: "console-bff" });
  }
}
```

**共享助手**（`@vxture/shared`，单一取值/兜底来源，禁止各服务各写一份）：

```ts
export function buildHealthIdentity(opts: {
  service: string;
  product?: string;
}) {
  return {
    status: "ok" as const,
    service: opts.service,
    ...(opts.product ? { product: opts.product } : {}),
    version: process.env.APP_VERSION || "dev",
    gitSha: process.env.GIT_SHA || "unknown",
    stage: process.env.DEPLOY_STAGE || "dev",
    buildTime: process.env.BUILD_TIME || "unknown",
    time: new Date().toISOString(),
  };
}
```

**Python**：`/health` 返回同名字段，值读同名环境变量（`APP_VERSION` 等），兜底同上。

---

## 6. 反面模式（禁止）

- ❌ **硬编造** `version:"1.0.0"` / `sha:"dev"` / `stage:"local"`——宁可诚实兜底 `dev`/`unknown`，绝不假装。
- ❌ liveness 端点里探 DB/Redis/上游——违反零依赖，会让容器误判 unhealthy。
- ❌ 各服务各写一份健康响应结构——字段名/形状必漂移；一律用共享助手。
- ❌ body 泄露密钥/内网地址/PII。
- ❌ liveness 未存活时返回 5xx 却把探针指向它以外——探针只认 liveness。

---

## 7. 合规清单（套用到服务）

1. liveness 端点返回 §3 完整身份块（用 §5 共享助手）。
2. 镜像 Dockerfile 声明 §4.1 四个 ARG→ENV（带诚实默认）。
3. 构建工作流按 §4.2 传入四个 build-args。
4. 有关键依赖的服务加 readiness 端点（§2/§3），容器探针**不**指向它。
5. 部署后 `curl <liveness>` 核对：`version`/`gitSha`/`stage` 是真值而非 `dev`/`unknown`/`local`。

---

## 8. 现状对账（2026-07-21）

**本仓（vxture-platform）**：

| 服务                                          | 现状                                     | 差距                                                  |
| --------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| website / console / admin / accounts (Next)   | `{status:"ok"}`                          | 缺整个身份块                                          |
| console-bff / admin-bff / website-bff         | `{status, service, timestamp}`           | 缺 version/gitSha/stage/buildTime；`timestamp`→`time` |
| auth-bff / platform-api                       | `{status, service, version:"1.0.0"}`     | **硬编码假版本**；缺 gitSha/stage/buildTime/time      |
| model-platform（2026-07-28 已退役，见下方注） | `live`/`ready`/`diagnostics`（结构最好） | 已随服务退役失效，不再需要修                          |
| 全部镜像                                      | 无 version/sha/stage 注入                | 需补 §4 build-args                                    |

**跨仓（各仓 owner 自行修正）**：

| 服务               | 现状                                                         | 差距                                                                              |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `vxtpl.vxture.com` | `{status, product, gitSha:"sha-763c71c", time}`              | 最接近；缺 `version`/`stage`/`buildTime`；`gitSha` 去掉 `sha-` 前缀；补 `service` |
| `arda.vxture.com`  | `{status, version:"arda-app/dev", sha:"dev", stage:"local"}` | 值全是占位——**需按 §4 接构建注入**；字段名对齐（`sha`→`gitSha`）                  |

---

## 附：迁移注意

- 改 `timestamp`→`time`、`sha`→`gitSha` 属**响应字段重命名**：确认没有消费方依赖旧字段名（监控/告警/聚合脚本），需同步。
- Docker `HEALTHCHECK` 命令探的是 liveness 路径，本次只扩响应体、不改路径与探测命令 → 探针不受影响。
