# 端口分配规范 — Port Allocation

> **本文件具有强制约束力。**
> AI coding 和 human coding 在启动新服务、分配端口时，**必须**查阅本文件并严格遵守。
> 任何端口变更须先修改本文件，再修改代码。

---

## 一、设计原则

全局使用 `3NNX` 四位端口格式：

| 位   | 含义                      |
| ---- | ------------------------- |
| `3`  | 固定前缀                  |
| `NN` | 服务组编号（两位，00~99） |
| `X`  | 组内服务偏移（0~9）       |

**分区规则：**

| NN 范围 | 区域             | 用途                                      |
| ------- | ---------------- | ----------------------------------------- |
| `00`    | 别名/特殊        | 3000 = website 别名（302→3010），其余保留 |
| `01~03` | Platform Portals | 三个运营 Portal（UI + BFF 对）            |
| `10`    | Infrastructure   | Model Platform 及基础服务                 |
| `11~99` | Agents           | 每个 Agent 独占一个 `NN` 段               |

**单独保留：**

| 端口   | 用途                                     |
| ------ | ---------------------------------------- |
| `8000` | API Gateway（唯一公共入口，NN 规则之外） |
| `8090` | Dev Panel（开发工具面板）                |

**外部项目预留：**

| 端口   | 用途                                                |
| ------ | --------------------------------------------------- |
| `3210` | ruyin.ai 网站外部项目预留，Vxture 本地服务不得占用  |
| `3220` | ruyin.ai 网站外部项目预留，本地 SSO callback/origin |
| `3281` | ruyin.ai 网站外部项目预留，Vxture 本地服务不得占用  |

> ruyin.ai 网站端口与 Ruyin 业务服务端口均属于外部业务仓库边界。`3110/3111/3112/3114/3115` 只作为 `vxture/agentstudio-ruyin` 跨仓预留，本仓本地服务不得占用，也不得据此规划 vx-worker-02 部署。

### ruyin.ai 网站本地接口要求

| 项              | 要求                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| 本地 origin     | `http://localhost:3220`                                                                                            |
| SSO start       | `http://localhost:3020/{locale}/sso/start?ctx=...`，生产为 `https://console.vxture.com/{locale}/sso/start?ctx=...` |
| `ctx.from`      | 固定为 `ruyin`                                                                                                     |
| `ctx.returnTo`  | 必须落在 `http://localhost:3220` origin 下，Vxture 会追加 `token` 和可选 `state` 查询参数                          |
| token 交换      | 必须由服务端/BFF 处理，不允许浏览器直接调用 `auth-bff` 内部 verify/sign 接口                                       |
| 当前 Vxture BFF | `GET /api/auth/callback?token=...`、`GET /api/auth/session`、`POST /api/auth/logout`                               |

---

## 二、Platform Portals（NN = 01~03）

**偏移规则：**

- `X = 0`：UI（Next.js）
- `X = 1`：BFF（NestJS）

| 端口      | 服务                       | 包                    | 环境变量           |
| --------- | -------------------------- | --------------------- | ------------------ |
| **3010**  | website-portal             | `@vxture/website`     | —                  |
| **3011**  | website-bff                | `@vxture/bff-website` | `WEBSITE_BFF_PORT` |
| **3020**  | console-portal             | `@vxture/console`     | —                  |
| **3021**  | console-bff                | `@vxture/bff-console` | `CONSOLE_BFF_PORT` |
| **3030**  | admin-portal               | `@vxture/admin`       | —                  |
| **3031**  | admin-bff                  | `@vxture/bff-admin`   | `ADMIN_BFF_PORT`   |
| **3090**  | auth-bff                   | `@vxture/bff-auth`    | `AUTH_BFF_PORT`    |
| 3040~3089 | 预留（最多 5 个新 portal） | —                     | —                  |

---

## 三、Infrastructure（NN = 10）

| 端口      | 服务          | 说明                                                                                                                                                                     |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **3100**  | Atlas（外部） | 本仓 `services/model/platform` 已退役（2026-07-24 拆仓至 `vxture-atlas`）；本地开发 `MODEL_PLATFORM_URL` 默认值仍指向该端口，**保留不得迁移**，避免与本地 atlas 联调冲突 |
| 3101~3109 | 预留          | 监控、消息队列等基础设施                                                                                                                                                 |

---

## 四、Agents / 外部业务预留（NN = 11~99）

本节只维护端口编号，避免本地开发和跨仓业务冲突；不代表 `vxture` 仓库负责部署这些服务。vx-worker-02 上的业务 beta/prod 部署由外部业务仓库维护，边界见 [`docs/50-deployment/08-code-environment-map.md`](../../50-deployment/08-code-environment-map.md)。

**偏移规则（Agent 层统一）：**

- `X = 0`：Agent Studio（Next.js 前端，prod）
- `X = 1`：Agent BFF（NestJS，prod）
- `X = 2`：Agent Server（私有后端，prod）
- `X = 4`：Agent BFF（NestJS，beta）
- `X = 5`：Agent Server（私有后端，beta）
- `X = 3 / 6~9`：预留（beta studio / 子服务 / WebSocket / gRPC 等）

### Agent 注册表

| Agent                 | NN   | prod X0         | prod X1      | prod X2         | beta X4  | beta X5     | 状态                                         |
| --------------------- | ---- | --------------- | ------------ | --------------- | -------- | ----------- | -------------------------------------------- |
| **Ruyin**（外部业务） | `11` | 3110 studio     | 3111 BFF     | **3112** server | 3114 BFF | 3115 server | 已迁出至 `vxture/agentstudio-ruyin`          |
| **Varda**（次子）     | `12` | **3120** studio | **3121** BFF | **3122** server | 3124 BFF | 3125 server | ✅ 三端运行中；业务仓迁移待 Ruyin 跑顺后规划 |
| Future Agent #3       | `13` | 3130            | 3131         | 3132            | 3134     | 3135        | 预留                                         |
| Future Agent #4       | `14` | 3140            | 3141         | 3142            | 3144     | 3145        | 预留                                         |
| …                     | …    | …               | …            | …               | …        | …           | …                                            |
| Future Agent #99      | `99` | 3990            | 3991         | 3992            | 3994     | 3995        | 预留                                         |

---

## 五、完整端口速查表

```
8000   API Gateway（唯一公共入口）
8090   Dev Panel

3000   website 别名（302 → 3010，方便开发者习惯性访问）
3010   website-portal（Next.js）
3011   website-bff（NestJS）
3020   console-portal（Next.js）
3021   console-bff（NestJS）
3030   admin-portal（Next.js）
3031   admin-bff（NestJS）
3090   auth-bff（NestJS，JWT 唯一签发源）

3100   Model Platform（固定）

3110   Ruyin Studio（外部业务仓库 / vx-worker-02 prod 预留）
3111   Ruyin BFF（外部业务仓库 / vx-worker-02 prod 预留）
3112   Ruyin Server（外部业务仓库 / vx-worker-02 prod 预留）
3114   Ruyin BFF beta（外部业务仓库 / vx-worker-02 beta 预留）
3115   Ruyin Server beta（外部业务仓库 / vx-worker-02 beta 预留）

3120   varda-studio（Next.js）
3121   varda-bff（NestJS）
3122   varda-server（NestJS）
3124   varda-bff-beta（外部业务仓库 / vx-worker-02 beta 预留）
3125   varda-server-beta（外部业务仓库 / vx-worker-02 beta 预留）

3210   ruyin.ai 网站外部项目预留（Vxture 不占用）
3220   ruyin.ai 网站外部项目预留 / 本地 SSO callback origin（Vxture 不占用）
3281   ruyin.ai 网站外部项目预留（Vxture 不占用）
```

---

## 六、环境变量命名约定

```bash
# Platform BFF（变量名固定格式：{NAME}_BFF_PORT）
WEBSITE_BFF_PORT=3011
CONSOLE_BFF_PORT=3021
ADMIN_BFF_PORT=3031

# Ruyin 外部业务仓预留（本仓不消费）
RUYINAGENT_BFF_PORT=3111
RUYINAGENT_SERVER_PORT=3112
RUYINAGENT_BETA_BFF_PORT=3114
RUYINAGENT_BETA_SERVER_PORT=3115

# Agent（变量名固定格式：{AGENT}_BFF_PORT / {AGENT}_SERVER_PORT）
VARDA_BFF_PORT=3121
VARDA_SERVER_PORT=3122
VARDA_SERVER_INTERNAL_URL=http://localhost:3122
VARDA_BETA_BFF_PORT=3124
VARDA_BETA_SERVER_PORT=3125
VARDA_BETA_SERVER_INTERNAL_URL=http://localhost:3125

# 基础设施
MODEL_PLATFORM_URL=http://localhost:3100
GATEWAY_PORT=8000
```

---

## 七、强制执行规则

### R1 — 新 Agent 上线前必须登记

在本文件 **四、Agent 注册表** 中登记 `NN` 编号后，才允许在代码中使用端口。
**禁止**自行选取未登记的端口。

### R2 — 代码中的端口必须来自环境变量

所有服务的监听端口通过环境变量注入，代码中只允许写**回退默认值**：

```typescript
// ✅ 正确
const port = Number(process.env.VARDA_BFF_PORT ?? 3121);

// ❌ 错误：硬编码无环境变量覆盖
await app.listen(3121);
```

### R3 — 回退默认值必须与本表一致

代码中 `?? 端口号` 的回退默认值必须与本文件中登记的端口完全一致。
发现不一致时，以本文件为准修正代码。

### R4 — 禁止在 Platform 区间（3010~3099）放 Agent 服务

Platform（NN=01~09）和 Agent（NN=11~99）区间已明确隔离，不得跨区使用。

### R5 — 禁止占用外部项目预留端口

`3210`、`3220`、`3281` 由 ruyin.ai 网站外部项目使用，Vxture 本地服务、Agent、BFF、Portal、Dev Panel 均不得占用。

### R6 — 变更流程

1. 修改本文件（登记新端口或标记迁移）
2. 修改 `.env.local.template`
3. 修改服务代码中的默认值
4. 修改 `tools/dev-panel/src/server.mjs` 的 SERVICES 数组
5. 通知团队（更新 PR 描述）

---

## 八、保留端口说明

以下端口由外部系统管理，不纳入 `3NNX` 规则：

| 端口 | 用途                    |
| ---- | ----------------------- |
| 5432 | PostgreSQL              |
| 6379 | Redis                   |
| 8000 | API Gateway（单独保留） |
| 8090 | Dev Panel（单独保留）   |

---

_版本：1.0.0 | 2026-05-02_
