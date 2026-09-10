# 注册一个产品 Runbook（Register a Product）

> 目标：把一个新产品（例：L3 智能体 `tenderforge`）接入**平台侧**目录 + 身份 + 订阅/用量引擎。
>
> **2026-09-10 重写。** 此前这份 runbook 的七件里有五件写着「改 `seed-catalog.mjs` → 走 PR →
> 跑 `db-init` 过审批门」。那条路已经取消：v0.26.132–134 把边缘路由、webhook 密钥、计量指标
> 三处代码化缺口补完，**接一个产品现在是纯页面操作**——不改代码、不发版、不跑 db-init。
> 旧写法留在 §7 备查，只在「产品需要平台代码字面量引用它」时才适用（见那一节的判据）。

## 0. 范围与依据

- **只覆盖平台侧注册**。产品侧建库（`vx_provision` / `local_authz` / `local_usage` + 领域 schema）
  由产品自持，见 `docs/30-design/product_240_repo-template.md` §2.4，本 runbook 不代做。
- 依据：`product_200` §7（三通道接入 checklist）·`product_210`（OIDC 客户端）·
  `product_310`（provisioning / webhook）·`product_220` §1–3（目录值域 / C2 信封）·
  `40-product-registry.md` §5（seed 政策：**什么可以被预置、凭什么**）。
- 值域权威在 `@vxture/core-utils`（`PRODUCT_TYPES` / `RELEASE_STAGES`）与 `@vxture-platform/shared`。
  产品对齐值域，不在任何地方私造。

---

## 1. 全流程一览

八步，**前七步都在页面上**。只有第 6 步要一次边缘同步（随下次 deploy 自动带上）。

| #   | 步骤                         | 在哪做                              | 需要发版？ |
| --- | ---------------------------- | ----------------------------------- | ---------- |
| 1   | DNS A 记录                   | DNS 服务商                          | 否         |
| 2   | 登记产品行                   | opera → 产品目录 → 登记产品         | 否         |
| 3   | 发 OIDC 客户端               | opera → 接入凭据 → 注册客户端       | 否         |
| 4   | 登记 webhook 与边缘上游      | opera → 产品目录 → 该产品 → webhook | 否         |
| 5   | 登记计量指标（要计量才需要） | opera → 产品目录 → 该产品 → 指标    | 否         |
| 6   | 边缘生效                     | 自动（下次 deploy 的边缘同步）      | 借一次发版 |
| 7   | 配套餐与定价                 | admin → 服务套餐                    | 否         |
| 8   | 过上架检查项                 | opera → 产品目录 → 该产品 → 检查项  | 否         |

> **不需要做的事**（这些是旧 runbook 的内容，现在一律不做）：改 `seed-catalog.mjs`、
> 往 `.env` 加 `{CODE}_BASE_URL` / `{CODE}_PROVISION_WEBHOOK_SECRET`、手写一份 nginx vhost、
> 跑 `db-init`。往 `.env.*.example` 加键还有个副作用：**下一次 deploy 的 env 审计会把它变成必需项**。

---

## 2. 第 1 步 · DNS

`{product_code}.vxture.com` 缺省规则（`13-infra-allocation-registry` §4#1）。建一条 A 记录指向边缘。

| 事项           | 结论                                                                                           | 依据            |
| -------------- | ---------------------------------------------------------------------------------------------- | --------------- |
| 要签证书吗     | **不用**。边缘证书是 `*.vxture.com` 通配（Let's Encrypt，SAN = `*.vxture.com` + `vxture.com`） | 2026-09-10 实测 |
| DNS 有通配吗   | **没有**。不存在的子域返 NXDOMAIN，每个新域都要单独建记录                                      | 2026-09-10 实测 |
| 异 apex 的产品 | `anlan.ai` / `xuanzhen.ai` 这类**不走**通配兜底，证书与本域无关，需要各自的 vhost              | —               |

**自检**：`https://{code}.vxture.com` 此时应当 TLS 握手完成后被立刻关闭（444）——那说明请求
到了边缘、通配兜底匹配上了、只是还没登记上游。若是握手直接失败，说明 DNS 还没生效。

---

## 3. 第 2 步 · 登记产品行

opera → **产品目录** → 「登记产品」。

| 字段             | 必填 | 取值 / 约束                                                                                                                        | 填错时                                         |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `productCode`    | ✅   | 全局唯一，**登记后不可改**                                                                                                         | `VALIDATION_REQUIRED`                          |
| `productType`    | ✅   | `general_platform` / `industry_platform` / `general_agent` / `industry_agent` / `undefined`（受管枚举，权威 `@vxture/core-utils`） | `VALIDATION_INVALID_VALUE`，消息列出全部合法值 |
| `productName`    | ✅   | 中文主名                                                                                                                           | `VALIDATION_REQUIRED`                          |
| `productNick`    | —    | 副名 / 英文名                                                                                                                      | —                                              |
| `categoryId`     | —    | 复用现有 `1=智能体` / `2=平台`                                                                                                     | —                                              |
| `origin`         | —    | `self` / `third_party` / `other`，缺省 `self`                                                                                      | `VALIDATION_INVALID_VALUE`                     |
| `originProvider` | 条件 | **`origin=third_party` 时必填**                                                                                                    | `VALIDATION_REQUIRED`                          |
| `description`    | —    | 外部文案                                                                                                                           | —                                              |

**产品码是唯一需要在提交前想清楚的**：它是 `{code}.vxture.com`、容器前缀 `{code}-*`、
库名 `vx_{code}_db` 的同一个值，登记后不可改。

新产品默认落**草稿**状态，确认无误后从操作菜单切「启用」。

> **L3 智能体不要碰 `APP_SCOPE_CODES`。** 那是 D12 之前的遗留豁免集，代码里明写
> 「products never join it going forward, they only leave」——token 不携带任何商业字段，
> 权益一律走 C2。

---

## 4. 第 3 步 · 发 OIDC 客户端

opera → **接入凭据** → 「注册客户端」。产品行必须已登记（外键要求，两个页面天然串联）。

| 字段             | 说明                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `clientId`       | 惯例等于产品码                                                                               |
| `productId`      | 指向第 2 步登记的行                                                                          |
| `realm`          | **恒为 `customer`**。workforce realm 留给平台自己的门户，不对产品开放                        |
| `redirectUris`   | 一行一条，产品的回调地址                                                                     |
| `allowed_scopes` | D12 之后的四段式：`openid` / `profile` / `email` / `phone`。**不要加 `{code}:subscription`** |
| `pkce_required`  | 按产品形态                                                                                   |

**client secret 只在创建与轮换两个动作里明文返回一次**，别处（含列表）永不下发。
拿到后立即交给产品侧——控制台零持有明文。

`client_id` 撞名返 `409`。

---

## 5. 第 4 步 · webhook 与边缘上游

opera → **产品目录** → 该产品 → webhook 登记。**五个字段都可以留空**（常见的是先拿到回调地址、
密钥还没签发），检查项会区分「没有登记行」「配了一半」「配齐」三态。

| 字段                | 取值 / 约束                                                      | 填错时                                   |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `homeUrl`           | 产品主页（展示用，不参与投递）。必须是 http/https 绝对地址       | `VALIDATION_INVALID_URL`                 |
| `webhookUrl`        | 平台→产品的推送目标。同上                                        | `VALIDATION_INVALID_URL`                 |
| **`webhookSecret`** | 签名密钥**原文**，只进不出。**至少 16 位**                       | `VALIDATION_TOO_SHORT`                   |
| **`edgeUpstream`**  | tailnet 上的 `host:port`，**不带协议、路径或空格**；端口 1–65535 | `VALIDATION_FORMAT` / `VALIDATION_RANGE` |
| `webhookSecretRef`  | **旧路径，新产品不填**。见下                                     | `VALIDATION_TOO_LONG`（>128）            |

### 签名密钥的两条路径

- **新路径（填 `webhookSecret`）**：原文进来，AES-256-GCM 加密落库。主密钥
  `PLATFORM_WEBHOOK_ENC_KEY` **只有一个、永不随产品增长**——这正是接一个产品不用改 env 的原因。
  读接口只回「配没配」这个布尔，**密文和原文都不回传**；要换就重填，不提供「看一眼现在是什么」。
- **旧路径（`webhookSecretRef`）**：引用名 → 容器环境变量，每接一个产品都要改 `.env` + 重新部署。
  存量产品（karda / arda / vxtpl）还在用，保留到它们迁完为止。

投递侧**密文优先**，为空回落 ref→env。**密文解不开时不静默回落**——那会用另一个密钥去签名，
产品侧收到一批验签失败的投递，而平台这边一句话都没有。

若平台未配置主密钥，填写签名密钥会被明确拒绝（`SECRET_KEY_UNCONFIGURED`），
**不会静默存明文**。

### 边缘上游

填了它，边缘那份 `*.vxture.com` 兜底 vhost 下次同步就把该子域转到这里。留空 = 不走通配兜底
（自带精确 vhost 的产品就该留空）。

**既有产品不受影响**：nginx 的 server_name 匹配优先级是精确名 > 通配，
arda / atlas / karda / runos / vxtpl 与平台自己那几个面照旧走各自的 vhost。

---

## 6. 第 5 步 · 计量指标（要计量才需要）

opera → **产品目录** → 该产品 → 指标。**指标键是跨仓契约**：产品按这个键上报用量（C3 consume），
平台按这个键建配额池。键不存在时 `POST /usage/consume` 直接拒收——所以它必须先于套餐配置存在。

| 字段            | 取值                                | 约束                                   |
| --------------- | ----------------------------------- | -------------------------------------- |
| `metricKey`     | 如 `karda.ingest`                   | 非空，≤64 字符                         |
| `mergeStrategy` | `max` / `union` / `pool` / `tiered` | 四选一                                 |
| `consumeMode`   | `divisible` / `atomic`              | **仅 `pool` 型必填，非 pool 型不许填** |
| `metricUnit`    | `docs` / `calls` / `GB` / `seats`   | ≤32 字符                               |
| `resetPeriod`   | `none` / `day` / `month`            | **仅 `pool` 型可非 `none`**            |

逐个 upsert，不做整表替换——整表替换会让两个运营者互相抹掉对方新加的指标，而且谁都不会收到提示。

删除时若已被套餐组件引用会被挡住（先查再报，不是让外键抛 500）。

---

## 7. 第 6 步 · 边缘生效

边缘路由表由 `deploy/nginx/render-agent-map.mjs` 在**每次 deploy 的边缘同步**时从产品登记渲染，
产出 `conf.d/agents-upstream.map`。所以第 5 步填完后，**下一次任意发版**都会自动带上，不必为它单独发版。

想立刻生效：在 worker-01 上跑 `sudo bash /srv/vxture/deploy/scripts/20-sync-nginx-config.sh`
（它自带 `nginx -t` + 热重载；测试失败则不 reload，运行中的 nginx 不受影响）。

**渲染失败不会中断部署**：读不到库时保留上一版 map 并告警（写空表会让所有已接入的智能体
一起 444，那是把一次读库失败放大成一次全线故障）。deploy 日志里那一行写明了后果，别只看退出码。

---

## 8. 第 7–8 步 · 套餐、定价、上架

- **套餐与定价**：admin → 服务套餐。`plan_versions.status` = `draft` | `published`。
- **上架检查项**：opera → 产品目录 → 该产品 → 检查项。`verification_policy` 与 `pricing_set`
  两门归 admin 消费，其余归 opera。两门满足才算可售。
- **认证策略**（可选）：不配则继承平台默认。

---

## 9. 验收

### 不用登录就能验的

```bash
# 1. DNS 解析到边缘
nslookup {code}.vxture.com

# 2. 边缘已登记上游 → 200 / 产品自己的响应；未登记 → TLS 握手后立刻关闭（444）
curl -sS -o /dev/null -w "code=%{http_code} 耗时=%{time_total}s\n" https://{code}.vxture.com/
```

> **`000` 这个码不区分两件事**：「立刻被关」（444，耗时 ~0.01s）与「打到不可达上游等超时」
> （耗时接近 curl 的 `--max-time`）。**看耗时才分得开**——2026-09-10 就是靠这个才确认
> 既有产品没被通配抢走。

### 要登录 / 要库的

```sql
-- 目录行在、active
select product_code, product_type, status, release_stage from product.products where product_code = '<code>';
-- OIDC client 已挂到产品上
select client_id, product_id, realm from appoidc.oidc_clients where client_id like '<code>%';
-- 端点登记（密文只看在不在，不取值）
select home_url, webhook_url, edge_upstream, (webhook_secret_enc is not null) as has_secret
  from product.product_webhooks
 where product_id = (select id from product.products where product_code = '<code>');
```

- **C2 探针**：platform-api `GET /entitlements?workspace_id=<ws>&product=<code>`——未订阅的 ws
  返回 `status:null` / `tier:null` / 空 `limits`+`quota_pools`。
- 产品侧 OIDC 登录闭环；provisioning webhook 实测 `delivered` / `200`。
- console 的应用中心会**自动出现**这块磁贴（`product.products ∩ 该工作空间的有效订阅`，纯查库，
  写死目录已于 2026-08-30 退役）。

---

## 10. 什么时候才需要动代码

只有一种情况：**平台代码需要以字面量引用这个产品码**——token-exchange 的 audience、
opera 的模块挂载前缀、app-scope 豁免集。全仓目前只有 7 处这样的引用，**全是 atlas / runos
这类 L1 平台级集成**，普通 L3 智能体一处都不沾。

判据见 `40-product-registry.md` §5：一行产品能进 `seed-catalog.mjs` 的 `PRODUCTS`，
必须满足 A（代码依赖）或 B（seed 内 FK 依赖）**并且**满足 C（形状一致）。
**D2 明令禁止预建规划中的产品**——定义完成后由运营者在产品目录登记。

---

## 11. 关联

- `docs/30-design/product_200_integration.md` §7 — 三通道接入 checklist（本 runbook 是它的操作面）。
- `docs/20-specs/000-platform/opera/40-product-registry.md` §5 — seed 政策与三条禁止项。
- `docs/50-deployment/13-infra-allocation-registry.md` — 主机 / 域名 / stack_root / 端口的 SoT。
- `docs/30-design/product_240_repo-template.md` §2.4 — 产品侧数据契约。
- `deploy/nginx/render-agent-map.mjs` — 边缘路由表的渲染器（含失败时的降级策略）。
- `deploy/scripts/27-provision-client-secrets.sh` — `PLATFORM_WEBHOOK_ENC_KEY` 的铸造
  （两个 host 必须同值，任一边有值即复制而非新铸）。
