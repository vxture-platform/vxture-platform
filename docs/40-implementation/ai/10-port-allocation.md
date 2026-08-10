# 端口分配规范 — Port Allocation

> **本文件具有强制约束力。** AI coding 和 human coding 在启动新服务、分配端口时，**必须**查阅本文件并严格遵守。任何端口变更须先改文档，再改代码。
>
> **2026-08-10 重排(owner 拍板)**：本仓从此**只有一套端口方案**——本地开发端口 = 代码内回退默认值 = 生产容器内口。此前"本地一套 3NNX、生产一套分层块"的双轨制已废止：它让 varda 本地占 3120/3121，而同机跑的 runos dev 栈也是 3120，两边撞车，且没人能一眼说出哪个数是对的。
>
> **分配权威 = [`13-infra-allocation-registry.md`](../../50-deployment/13-infra-allocation-registry.md)**（登记表，含 L0–L3 全部产品）。本文只做两件事：给出本地开发的速查表，和写死几条不许违反的规则。

---

## 一、分层分块（千位即层号）

| 块          | 层                       | 说明                                                                           |
| ----------- | ------------------------ | ------------------------------------------------------------------------------ |
| `3000–3099` | **L0** 平台本体          | 5 个面 + 内嵌 varda，见下表                                                    |
| `3100–3199` | **L1** 横向能力平台      | atlas 3100 / ontos 3110 / runos 3120                                           |
| `3200–3299` | **L2** 对象域平台        | vxtpl 3210 / arda 3230 / karda 3240 / terra 3250                               |
| `4000–5999` | **L3** 行业智能体        | raven 4010 / anlan 4020 / forge 4030 / xuanzhen 4040                           |
| `80xx`      | **边缘带**（不占应用块） | gateway-bff 8000（公网）· platform-api 8080（S2S）· auth-bff tailnet 暴露 8081 |

L1/L2/L3 是**外部产品仓**的端口，本仓不启这些服务；列在这里是为了本地同机开发时不撞车（这台机上 atlas/runos/arda 的 dev 栈都在跑）。

## 二、L0：5 个面 + varda

**面 = 有自己域名的门户**，共 5 个。varda 是 L0 内嵌副驾（无域名，经 console/admin `/varda/*` 反代），**不是面**，但单独占一段。

段内规则：**x0 = UI，x1 = BFF，x2–x9 归本面**（该面将来的附属服务：worker / ws / cron 之类），段尾留白。

| 面            | 段            | UI                    | BFF                    | 本地起法                              |
| ------------- | ------------- | --------------------- | ---------------------- | ------------------------------------- |
| website       | **3000–3019** | 3000                  | website-bff 3001       | `pnpm -F @vxture/website dev`         |
| console       | **3020–3029** | 3020                  | console-bff 3021       | `pnpm -F @vxture/console dev`         |
| admin         | **3030–3039** | 3030                  | admin-bff 3031         | `pnpm -F @vxture/admin dev`           |
| opera         | **3040–3049** | 3040                  | opera-bff 3041         | `pnpm -F @vxture/opera dev`           |
| （留白）      | **3050–3079** | —                     | —                      | 30 位，给未来新面；**现有面不得蚕食** |
| accounts(IdP) | **3080–3089** | 3080（登录/账户 UI）  | auth-bff 3081          | `pnpm -F @vxture/accounts dev`        |
| varda（非面） | **3090–3099** | studio 3092（仅本地） | bff 3090 / server 3091 | `pnpm -F @vxture/bff-varda dev`       |

> **accounts 与 auth-bff 是同一张脸的两半**：accounts 是人看的登录/账户 UI（`accounts.vxture.com`），auth-bff 是 IdP 后端（签发令牌、`/oidc/*`、JWKS），由 accounts 域的 `/oidc/*` 反代过去。所以它们是 x0/x1 一对，不是两个面。
>
> website 段留白最多（20 位），因为后续行业门户在本段内取号。

## 三、边缘带 80xx

| 端口   | 服务                       | 性质                                                                   |
| ------ | -------------------------- | ---------------------------------------------------------------------- |
| `8000` | gateway-bff                | 公网 API 边缘（`api.vxture.com`），http-alt 惯例端口                   |
| `8080` | platform-api               | S2S tailnet 边缘；**跨仓契约值**，产品仓 `PLATFORM_API_URL` 写死此地址 |
| `8081` | auth-bff 的 tailnet 暴露口 | 产品仓 S2S 换票入口（容器内口是 3081）                                 |
| `8090` | dev-panel                  | 本地开发工具面板，不部署                                               |

**为什么 tailnet 暴露口不跟 L0 map**：对外契约值一旦等于内部端口，内部每次重排都会破坏跨仓契约——2026-07-24 那次 auth-bff 从 3090 挪到 3061，`product_230` 三处却仍写 3090，契约文档与运行态对不上两周。现在解耦：**内部随便重排都不出 3xxx，对外只暴露 80xx**。

## 四、外部项目预留（本仓不得占用）

`3110`–`3115`、`3210`、`3220`、`3281` 属 `vxture/agentstudio-ruyin` 等外部仓的本地/部署预留，本仓本地服务不得占用。ruyin.ai 网站本地 origin = `http://localhost:3220`，其 SSO 起始地址 = `http://localhost:3020/{locale}/sso/start?ctx=...`（生产 `https://console.vxture.com/...`），`ctx.from` 固定 `ruyin`，`ctx.returnTo` 必须落在 `http://localhost:3220` origin 下。

## 五、环境变量命名约定

```bash
# 门户 BFF（变量名固定格式：{NAME}_BFF_PORT）
WEBSITE_BFF_PORT=3001
CONSOLE_BFF_PORT=3021
ADMIN_BFF_PORT=3031
OPERA_BFF_PORT=3041
AUTH_BFF_PORT=3081

# varda（{AGENT}_BFF_PORT / {AGENT}_SERVER_PORT）
VARDA_BFF_PORT=3090
VARDA_SERVER_PORT=3091
VARDA_SERVER_INTERNAL_URL=http://localhost:3091

# 边缘
GATEWAY_PORT=8000
PLATFORM_API_PORT=8080

# 外部（本地联调指向同机 dev 栈）
ATLAS_API_URL=http://localhost:3100
```

## 六、强制执行规则

### R1 — 先登记，后用号

新服务的端口先写进 [`13-infra-allocation-registry.md`](../../50-deployment/13-infra-allocation-registry.md)（新产品/新面）或本文（L0 段内的附属服务），才允许在代码里用。**禁止自取未登记的端口。**

### R2 — 端口必须来自环境变量

代码里只允许写回退默认值：

```typescript
// ✅ 正确
const port = Number(process.env.OPERA_BFF_PORT ?? 3041);

// ❌ 错误：硬编码，无环境变量覆盖
await app.listen(3041);
```

### R3 — 回退默认值 = 本表 = 生产内口

三者必须是同一个数。这是 2026-08-10 重排要买下的东西：此前代码默认（生产值）和本地值不同，改端口要两边对着看，漏一边不报错、只在运行时表现为"登录转不回来"。发现不一致，以本文与登记表为准修正代码。

### R4 — 段内取号，不得跨段

某个面要加附属服务，在**自己段内**取 x2–x9，不许去别的段或留白区拿号。留白区（3050–3079）只在**新开一个面**时启用，且须同步登记表。
