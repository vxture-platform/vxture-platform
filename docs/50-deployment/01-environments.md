# 环境变量与 env 文件设计

> 更新：2026-06-02
> 范围：仅覆盖 `vxture` 仓库负责的 平台控制面。vx-worker-02/03/04/05 等业务环境由外部业务仓库维护。

本文件是平台 env 文件分工的权威文档。代码与部署环境边界见 [`08-code-environment-map.md`](./08-code-environment-map.md)，Compose 注入方式见 [`04-services.md`](./04-services.md)。

---

## 一、设计原则

平台 env 文件按作用域分层管理：

| 类别             | 文件                                                                 | 作用                                                              | 是否可重复             |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| 本地运行参数     | `runtime/`                                                           | 本机开发真实 env / secrets，结构对应服务器 `/srv/vxture/runtime`  | 可以重复               |
| 前端构建变量     | GitHub Actions Secrets / Docker build args                           | 构建 Next.js 门户镜像时注入 `NEXT_PUBLIC_*`                       | 不进入 worker `.env.*` |
| 部署工具配置     | `/srv/vxture/runtime/.env`                                           | Docker Compose CLI 读取，用于镜像 registry / namespace / tag 插值 | 不进入容器             |
| 基础设施原始密码 | `/srv/vxture/runtime/secrets/pg-password` / `secrets/redis-password` | 数据库和 Redis 容器启动密码                                       | 不进入 env 文件        |
| 平台共享运行配置 | `/srv/vxture/runtime/secrets/platform.env`                           | 注入需要数据库、Redis URL、JWT、内部鉴权的服务                    | 不能复制到服务 env     |
| 平台共享邮件配置 | `/srv/vxture/runtime/secrets/platform-mail.env`                      | 只注入实际发送邮件的 BFF                                          | 不能复制到服务 env     |
| 平台共享短信配置 | `/srv/vxture/runtime/secrets/platform-sms.env`                       | 只注入实际发送短信验证码的 BFF（当前 `auth-bff`）                 | 不能复制到服务 env     |
| 平台签名密钥配置 | `/srv/vxture/runtime/secrets/platform-identity.env`                  | IdP RS256 私钥 + KID，只注入 `auth-bff`                           | 不能复制到服务 env     |
| 服务专属配置     | `/srv/vxture/runtime/.env.<service>`                                 | 只放该服务自己读取或实际需要的配置                                | 不跨服务复制           |

去重规则：

1. `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`JWT_REFRESH_SECRET`、`AUTH_INTERNAL_TOKEN` 只属于 `secrets/platform.env`。
2. Cloudflare Turnstile 的 **site key** 只属于前端构建变量，不放到 VXTURE_DEPLOY_HOST 运行时 env。
3. Cloudflare Turnstile 的 **secret key** 放在实际做服务端校验的 BFF。
4. OAuth provider secret 放在实际处理 OAuth start/callback 的服务。
5. SMTP 配置只属于 `secrets/platform-mail.env`，并且只注入实际发送邮件的 BFF。
6. Provider API Key 归 Atlas（外部仓 `vxture-atlas`）持有，本仓不再持有；业务 worker 也不持有平台 Provider Key。
7. `ALIYUN_SMS_*` 只属于 `secrets/platform-sms.env`，只注入实际发送短信的 BFF（当前 `auth-bff`）。
8. IdP 签名私钥 `OIDC_SIGNING_PRIVATE_KEY`（与 `OIDC_ACTIVE_KID`）只属于 `secrets/platform-identity.env`，只注入 `auth-bff`；公钥 JWK 存 `iam.signing_key`，不入 env。

---

## 二、运行配置定位

部署服务器的运行配置按读取方分层，名字相近但职责不同：

```text
/srv/vxture/runtime/.env
  -> Docker Compose CLI
  -> 只做 compose YAML 插值，例如 VX_IMAGE_TAG

/srv/vxture/runtime/secrets/platform.env
  -> 平台应用容器
  -> DATABASE_URL / REDIS_URL / JWT_SECRET / AUTH_INTERNAL_TOKEN

/srv/vxture/runtime/secrets/platform-mail.env
  -> 发邮件的 BFF 容器
  -> SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM

/srv/vxture/runtime/.env.<service>
  -> 单个服务容器
  -> 只放该服务专属配置，例如 OAuth、Turnstile、端口
```

本地开发使用同构目录：

```text
runtime/.env
runtime/.env.<service>
runtime/secrets/platform.env
runtime/secrets/platform-mail.env
runtime/secrets/pg-password
runtime/secrets/redis-password
```

`runtime/VXTURE_DEPLOY_HOST` 不提交 Git，不由 CI/CD 上传；它只用于本机开发和本机校验。

基础设施原始密码不属于上述 env 文件，统一放在 `secrets/`：

```text
secrets/pg-password
  -> Postgres 容器启动密码
  -> 派生 platform.env:DATABASE_URL

secrets/redis-password
  -> Redis 容器启动密码
  -> 派生 platform.env:REDIS_URL
```

`DATABASE_URL` 和 `REDIS_URL` 中包含密码是必要的派生配置，因为应用容器按连接串读取数据库和 Redis。禁止再额外放独立 `POSTGRES_PASSWORD` 或 `REDIS_PASSWORD` 到 `.env`、`platform.env` 或 `.env.<service>`，避免形成第二个可编辑密码源。

---

## 三、文件职责总表

| 文件                                                | 是否提交 | 读取方                                     | 内容边界                                        |
| --------------------------------------------------- | -------- | ------------------------------------------ | ----------------------------------------------- |
| `.env.example`                                      | 是       | 人工参考                                   | 本地开发总模板                                  |
| `.env.local`                                        | 否       | 本地 dev-panel / 本地服务                  | 本地真实 all-in-one 配置                        |
| `deploy/.env.example`                               | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | Docker Compose 插值模板                         |
| `/srv/vxture/runtime/.env`                          | 否       | Docker Compose                             | 可选镜像源变量                                  |
| `/srv/vxture/runtime/secrets/pg-password`           | 否       | `vx-platform-pg`                           | PostgreSQL 原始密码文件                         |
| `/srv/vxture/runtime/secrets/redis-password`        | 否       | `vx-platform-redis`                        | Redis 原始密码文件                              |
| `deploy/secrets/platform.env.example`               | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | 平台共享密钥模板                                |
| `/srv/vxture/runtime/secrets/platform.env`          | 否       | 多个平台容器                               | 数据库、Redis URL、JWT、内部鉴权真实密钥        |
| `deploy/secrets/platform-mail.env.example`          | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | 平台共享邮件配置模板                            |
| `/srv/vxture/runtime/secrets/platform-mail.env`     | 否       | 发邮件的 BFF 容器                          | SMTP 真实配置                                   |
| `deploy/secrets/platform-sms.env.example`           | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | 平台共享短信配置模板                            |
| `/srv/vxture/runtime/secrets/platform-sms.env`      | 否       | 发短信的 BFF 容器（`vx-auth-bff`）         | 阿里云短信真实凭证                              |
| `deploy/secrets/platform-identity.env.example`      | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | IdP 签名密钥模板                                |
| `/srv/vxture/runtime/secrets/platform-identity.env` | 否       | `vx-auth-bff`                              | RS256 私钥 + KID（provision 后粘贴）            |
| `deploy/.env.auth-bff.example`                      | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | auth-bff 服务专属模板                           |
| `/srv/vxture/runtime/.env.auth-bff`                 | 否       | `vx-auth-bff`                              | tenant 认证、OAuth、tenant + operator Turnstile |
| `deploy/.env.website-bff.example`                   | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | website-bff 服务专属模板                        |
| `/srv/vxture/runtime/.env.website-bff`              | 否       | `vx-website-bff`                           | 官网 BFF 专属配置                               |
| `deploy/.env.console-bff.example`                   | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | console-bff 服务专属模板                        |
| `/srv/vxture/runtime/.env.console-bff`              | 否       | `vx-console-bff`                           | 租户控制台 BFF 专属配置                         |
| `deploy/.env.admin-bff.example`                     | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | admin-bff 服务专属模板                          |
| `/srv/vxture/runtime/.env.admin-bff`                | 否       | `vx-admin-bff`                             | operator realm RP 会话（RP-only，无 Turnstile） |
| `deploy/.env.gateway-bff.example`                   | 是       | 人工参考 / `12-generate-env-files.sh` 对齐 | gateway-bff 服务专属模板                        |
| `/srv/vxture/runtime/.env.gateway-bff`              | 否       | `vx-gateway-bff`                           | 上游 BFF origin、CORS 白名单                    |

---

## 四、Compose 注入模型

部署服务器的平台服务通过 `compose.platform.yml` 注入 env：

| 服务                            | env 注入                                                                                                                              | 说明                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `postgres`                      | Docker secret `platform_pg_password`                                                                                                  | PostgreSQL 密码文件 `secrets/pg-password`         |
| `redis`                         | Docker secret `platform_redis_password`                                                                                               | Redis 密码文件 `secrets/redis-password`           |
| `auth-bff`                      | `secrets/platform.env` + `secrets/platform-mail.env` + `secrets/platform-sms.env` + `secrets/platform-identity.env` + `.env.auth-bff` | 共享密钥 + 邮件 + 短信 + 签名密钥 + auth 专属配置 |
| `website-bff`                   | `secrets/platform.env` + `secrets/platform-mail.env` + `.env.website-bff`                                                             | 共享密钥 + 邮件配置 + website 专属配置            |
| `console-bff`                   | `secrets/platform.env` + `secrets/platform-mail.env` + `.env.console-bff`                                                             | 共享密钥 + 邮件配置 + console 专属配置            |
| `admin-bff`                     | `secrets/platform.env` + `secrets/platform-mail.env` + `.env.admin-bff`                                                               | 共享密钥 + 邮件配置 + admin 专属配置              |
| `gateway-bff`                   | `.env.gateway-bff`                                                                                                                    | 纯代理，不需要平台共享密钥                        |
| `website` / `console` / `admin` | Compose `environment` + 镜像构建变量                                                                                                  | Next.js 公开变量主要在构建期注入                  |

`secrets/platform.env` 先加载，`secrets/platform-mail.env` 只对发邮件 BFF 加载，服务专属 `.env.<service>` 最后加载。服务专属文件不得覆盖共享密钥或 SMTP 配置。

---

## 五、平台共享运行配置：secrets/platform.env

文件：`/srv/vxture/runtime/secrets/platform.env`

| 变量                  | 必填 | 说明                                             | 禁止重复位置          |
| --------------------- | ---- | ------------------------------------------------ | --------------------- |
| `DATABASE_URL`        | 是   | 平台 PostgreSQL 连接串                           | 所有 `.env.<service>` |
| `REDIS_URL`           | 是   | Redis 连接串                                     | 所有 `.env.<service>` |
| `JWT_SECRET`          | 是   | access token 签名密钥，至少 32 字符              | 所有 `.env.<service>` |
| `JWT_REFRESH_SECRET`  | 是   | refresh token 签名密钥，必须不同于 `JWT_SECRET`  | 所有 `.env.<service>` |
| `AUTH_INTERNAL_TOKEN` | 是   | BFF 内部调用共享令牌，例如 `/auth/internal/sign` | 所有 `.env.<service>` |

这些变量是平台应用共享运行配置，不是某个 BFF 的服务专属配置。即使只有 `auth-bff` 签发 JWT，其他 BFF 仍需验证 JWT，所以统一从 `secrets/platform.env` 注入。

`REDIS_PASSWORD` 不放入任何 env 文件。Redis 原始密码只属于 `/srv/vxture/runtime/secrets/redis-password`，应用容器通过包含该密码的 `REDIS_URL` 连接 Redis。

---

## 六、平台共享邮件配置：secrets/platform-mail.env

文件：`/srv/vxture/runtime/secrets/platform-mail.env`

| 变量          | 必填 | 说明                                  | 禁止重复位置          |
| ------------- | ---- | ------------------------------------- | --------------------- |
| `SMTP_HOST`   | 是   | SMTP 服务 host，当前阿里云 DirectMail | 所有 `.env.<service>` |
| `SMTP_PORT`   | 是   | SMTP 端口，默认 `465`                 | 所有 `.env.<service>` |
| `SMTP_SECURE` | 是   | 是否启用 TLS，465 端口为 `true`       | 所有 `.env.<service>` |
| `SMTP_USER`   | 是   | SMTP 登录账号                         | 所有 `.env.<service>` |
| `SMTP_PASS`   | 是   | SMTP 登录密码或授权码                 | 所有 `.env.<service>` |
| `SMTP_FROM`   | 是   | 默认发件人                            | 所有 `.env.<service>` |

该文件只注入 `auth-bff`、`website-bff`、`console-bff`、`admin-bff`。`gateway-bff` 不发送邮件，不应获得 SMTP 密钥。

如果未来需要不同发件人身份，不直接在 `.env.<service>` 复制整套 SMTP 配置；应先补充设计，再决定是否拆分 `platform-mail.env` 或新增更细粒度的邮件 env。

---

## 七、部署工具配置：.env

文件：`/srv/vxture/runtime/.env`

| 变量                 | 必填 | 说明                         |
| -------------------- | ---- | ---------------------------- |
| `VX_IMAGE_REGISTRY`  | 否   | 手动部署时覆盖镜像 registry  |
| `VX_IMAGE_NAMESPACE` | 否   | 手动部署时覆盖镜像 namespace |
| `VX_IMAGE_TAG`       | 否   | 手动部署时覆盖镜像 tag       |

`.env` 只服务 Docker Compose YAML 插值，不等同于业务服务运行环境。基础设施原始密码不放 `.env`；Redis 原始密码在 `secrets/redis-password`，并派生为 `secrets/platform.env` 中的 `REDIS_URL`。

私有镜像仓库认证不进入 `.env`。手动发布前如需访问私有 registry，应先在服务器上完成人工认证；自动发布由 GitHub Actions 的部署 job 通过远程命令处理临时认证。

---

## 八、服务专属 env

四个会发送事务邮件的 BFF 统一通过 `secrets/platform-mail.env` 获取 `SMTP_*`。服务专属 env 不再保存 SMTP 配置。

### auth-bff

文件：`/srv/vxture/runtime/.env.auth-bff`

职责：租户认证源、OAuth 回调处理、JWT/Cookie 统一签发源、tenant **与 operator（admin surface）** Turnstile 服务端校验（运营登录 UI 在 accounts surface，由 IdP 校验）。

| 变量                                    | 必填   | 说明                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------- |
| `NODE_ENV`                              | 是     | `production`                                            |
| `AUTH_BFF_PORT`                         | 是     | 默认值见端口登记表                                      |
| `DB_POOL_MAX`                           | 否     | DB pool 上限                                            |
| `JWT_ACCESS_EXPIRES_IN`                 | 否     | access token 有效期                                     |
| `JWT_REFRESH_EXPIRES_IN`                | 否     | refresh token 有效期                                    |
| `AUTH_COOKIE_DOMAIN`                    | 是     | 平台 cookie domain，当前 `.vxture.com`                  |
| `WEBSITE_BASE_URL`                      | 是     | 官网基址，用于邮件跳转和 allowlist                      |
| `CONSOLE_BASE_URL`                      | 是     | console 基址，用于邮件跳转和 allowlist                  |
| `ADMIN_BASE_URL`                        | 是     | admin 基址，用于 allowlist                              |
| `CF_TURNSTILE_ENABLED`                  | 是     | 是否强制 Turnstile 校验                                 |
| `CF_TURNSTILE_TENANT_SECRET_KEY`        | 是     | tenant surface Turnstile secret                         |
| `CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES` | 是     | tenant Turnstile 允许 hostname                          |
| `CF_TURNSTILE_ADMIN_SECRET_KEY`         | 是     | operator/admin surface Turnstile secret                 |
| `CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES`  | 是     | operator Turnstile 允许 hostname（accounts.vxture.com） |
| `DINGTALK_APP_KEY`                      | 视功能 | DingTalk OAuth app key                                  |
| `DINGTALK_APP_SECRET`                   | 视功能 | DingTalk OAuth secret                                   |
| `DINGTALK_REDIRECT_URI`                 | 视功能 | DingTalk OAuth callback                                 |
| `FEISHU_APP_ID`                         | 视功能 | Feishu OAuth app id                                     |
| `FEISHU_APP_SECRET`                     | 视功能 | Feishu OAuth secret                                     |
| `FEISHU_REDIRECT_URI`                   | 视功能 | Feishu OAuth callback                                   |

禁止放入：

- `SMTP_*`
- `ALIYUN_SMS_*`（归 `secrets/platform-sms.env`）
- `OIDC_SIGNING_PRIVATE_KEY` / `OIDC_ACTIVE_KID`（归 `secrets/platform-identity.env`）

operator/admin Turnstile 现由 `auth-bff`(IdP) 校验（运营登录迁到 accounts surface，admin-bff 已 RP-only 无 Turnstile）。`OIDC_ISSUER` / `LOGIN_UI_BASE_URL`（均为 accounts surface）属本文件的非密钥配置；RS256 签名密钥本身走 `secrets/platform-identity.env`。

### website-bff

文件：`/srv/vxture/runtime/.env.website-bff`

职责：官网 BFF、认证请求代理、邮箱验证码、租户初始化代理、当前用户资料。

| 变量                     | 必填 | 说明                             |
| ------------------------ | ---- | -------------------------------- |
| `NODE_ENV`               | 是   | `production`                     |
| `WEBSITE_BFF_PORT`       | 是   | 默认值见端口登记表               |
| `DB_POOL_MAX`            | 否   | DB pool 上限                     |
| `JWT_ACCESS_EXPIRES_IN`  | 否   | middleware 验证 JWT 时的运行参数 |
| `JWT_REFRESH_EXPIRES_IN` | 否   | 与共享 auth 配置保持一致         |
| `AUTH_COOKIE_DOMAIN`     | 是   | `.vxture.com`                    |
| `AUTH_BFF_URL`           | 是   | `http://vx-auth-bff:3090`        |
| `WEBSITE_BASE_URL`       | 是   | 官网基址                         |
| `CONSOLE_BASE_URL`       | 是   | console 基址                     |

禁止放入：

- `CF_TURNSTILE_*`
- `DINGTALK_*`
- `FEISHU_*`
- `SMTP_*`

website-bff 只透传 `turnstileToken` 到 `auth-bff`，不做 Turnstile 服务端校验；OAuth start/callback 也由 `auth-bff` 处理。

### console-bff

文件：`/srv/vxture/runtime/.env.console-bff`

职责：租户控制台 BFF、认证请求代理、租户/成员/账单/订阅聚合、Model Platform 代理。

| 变量                     | 必填 | 说明                                                         |
| ------------------------ | ---- | ------------------------------------------------------------ |
| `NODE_ENV`               | 是   | `production`                                                 |
| `CONSOLE_BFF_PORT`       | 是   | 默认值见端口登记表                                           |
| `DB_POOL_MAX`            | 否   | DB pool 上限                                                 |
| `JWT_ACCESS_EXPIRES_IN`  | 否   | middleware 验证 JWT 时的运行参数                             |
| `JWT_REFRESH_EXPIRES_IN` | 否   | 与共享 auth 配置保持一致                                     |
| `AUTH_COOKIE_DOMAIN`     | 是   | `.vxture.com`                                                |
| `AUTH_BFF_URL`           | 是   | `http://vx-auth-bff:3090`                                    |
| `MODEL_PLATFORM_URL`     | 是   | 外部 Atlas 主机地址（`vxture-atlas` 仓，不再是本仓内部容器） |

禁止放入：

- `CF_TURNSTILE_*`
- `DINGTALK_*`
- `FEISHU_*`
- `SMTP_*`

console-bff 只透传 tenant 登录请求到 `auth-bff`。

### admin-bff

文件：`/srv/vxture/runtime/.env.admin-bff`

职责：平台运营管理 BFF、operator realm OIDC RP、运营业务邮件。

| 变量                     | 必填 | 说明                             |
| ------------------------ | ---- | -------------------------------- |
| `NODE_ENV`               | 是   | `production`                     |
| `ADMIN_BFF_PORT`         | 是   | 默认值见端口登记表               |
| `DB_POOL_MAX`            | 否   | DB pool 上限                     |
| `JWT_ACCESS_EXPIRES_IN`  | 否   | middleware 验证 JWT 时的运行参数 |
| `JWT_REFRESH_EXPIRES_IN` | 否   | 与共享 auth 配置保持一致         |
| `AUTH_COOKIE_DOMAIN`     | 是   | `.vxture.com`                    |
| `AUTH_BFF_URL`           | 是   | `http://vx-auth-bff:3090`        |

禁止放入：

- `CF_TURNSTILE_ENABLED`
- `CF_TURNSTILE_ADMIN_SECRET_KEY`
- `CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES`
- `CF_TURNSTILE_TENANT_SECRET_KEY`
- `CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES`
- `DINGTALK_*`
- `FEISHU_*`
- `SMTP_*`

admin-bff 已 RP-only（Batch 8）：运营登录与其 Turnstile 在 IdP(`auth-bff`) 完成，admin-bff 读取 operator RP 会话，自身不校验任何 Turnstile。

### gateway-bff

文件：`/srv/vxture/runtime/.env.gateway-bff`

职责：公网 API 代理，只保存上游 origin 和 CORS allowlist。

| 变量                      | 必填 | 说明                         |
| ------------------------- | ---- | ---------------------------- |
| `NODE_ENV`                | 是   | `production`                 |
| `GATEWAY_PORT`            | 是   | 默认值见端口登记表           |
| `WEBSITE_BFF_ORIGIN`      | 是   | `http://vx-website-bff:3011` |
| `CONSOLE_BFF_ORIGIN`      | 是   | `http://vx-console-bff:3021` |
| `ADMIN_BFF_ORIGIN`        | 是   | `http://vx-admin-bff:3031`   |
| `AUTH_BFF_ORIGIN`         | 是   | `http://vx-auth-bff:3090`    |
| `GATEWAY_ALLOWED_ORIGINS` | 是   | 逗号分隔的允许 Origin        |

---

## 九、前端构建变量

Next.js 的 `NEXT_PUBLIC_*` 在构建期固化进镜像。它们不应放在 VXTURE_DEPLOY_HOST BFF `.env.*` 中。

| 变量                                       | 来源                                         | 用途                                         |
| ------------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                      | workflow build args / compose environment    | 前端 API base URL                            |
| `NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY` | GitHub Secret `CF_TURNSTILE_TENANT_SITE_KEY` | website / console tenant Turnstile widget    |
| `NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_ID`   | GitHub Secret `CF_TURNSTILE_ADMIN_SITE_KEY`  | operator (accounts surface) Turnstile widget |

Turnstile site key 可以公开给浏览器；secret key 只能放服务端运行时 env。

---

## 十、Cloudflare Turnstile 分工

| 安全域   | 前端             | 服务端校验点 | Secret 所在文件 | Action          |
| -------- | ---------------- | ------------ | --------------- | --------------- |
| tenant   | accounts surface | `auth-bff`   | `.env.auth-bff` | `tenant_auth`   |
| operator | accounts surface | `auth-bff`   | `.env.auth-bff` | `operator_auth` |

两个安全域的服务端校验点都在 IdP(`auth-bff`)，secret 同在 `.env.auth-bff`（tenant 与 admin 两套 key）。admin-bff 已 RP-only，不校验 Turnstile。

链路（operator）：

```text
accounts surface（运营登录 UI）
  -> IdP /oidc/authorize/login 校验 operator Turnstile + 运营账号
  -> IdP 签发授权码
  -> admin-bff RP 回调建立 operator 会话
```

---

## 十一、禁止重复清单

| 重复项                                         | 正确位置                                                               | 错误位置                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `JWT_SECRET` / `JWT_REFRESH_SECRET`            | `secrets/platform.env`                                                 | 任意 `.env.<service>`                                      |
| `DATABASE_URL` / `REDIS_URL`                   | `secrets/platform.env`                                                 | 任意 `.env.<service>`                                      |
| `AUTH_INTERNAL_TOKEN`                          | `secrets/platform.env`                                                 | 任意 `.env.<service>`                                      |
| `REDIS_PASSWORD`                               | `secrets/redis-password` 原始文件；`platform.env` 只放派生 `REDIS_URL` | `.env` / `secrets/platform.env` / 任意 `.env.<service>`    |
| `SMTP_*`                                       | `secrets/platform-mail.env`                                            | `.env` / `secrets/platform.env` / 任意 `.env.<service>`    |
| `ALIYUN_SMS_*`                                 | `secrets/platform-sms.env`                                             | `.env` / `secrets/platform.env` / 任意 `.env.<service>`    |
| `OIDC_SIGNING_PRIVATE_KEY` / `OIDC_ACTIVE_KID` | `secrets/platform-identity.env`                                        | `secrets/platform.env` / 任意 `.env.<service>`             |
| tenant CF secret                               | `.env.auth-bff`                                                        | `.env.website-bff` / `.env.console-bff` / `.env.admin-bff` |
| operator/admin CF secret                       | `.env.auth-bff`                                                        | `.env.admin-bff` / `.env.website-bff` / `.env.console-bff` |
| Turnstile site key                             | GitHub Actions Secrets / build args                                    | VXTURE_DEPLOY_HOST `.env.*`                                |
| OAuth provider secret                          | `.env.auth-bff`                                                        | `.env.website-bff` / `.env.console-bff` / `.env.admin-bff` |
| Provider API Key                               | 归 Atlas（外部仓，本仓不再持有）                                       | BFF env / business worker env                              |

---

## 十二、检查命令

推荐优先使用审计脚本：

```bash
# 本机：检查模板、已有真实 env、Compose 注入、13/12 runtime env 脚本和旧变量残留
pnpm audit:env

# VXTURE_DEPLOY_HOST：额外要求真实运行 env 存在，且不能留空或保留 CHANGE_ME / CHANGEME
cd /srv/vxture/deploy
VX_ENV_AUDIT_STRICT_RUNTIME=1 VX_WORKER_DIR=/srv/vxture/deploy VX_RUNTIME_DIR=/srv/vxture/runtime node guardrails/39-audit-env.mjs
```

脚本不会输出真实 env 值，只输出文件、行号、变量名和规则 ID。

在本机检查模板和真实 env 是否变量结构一致：

```powershell
$pairs = @(
  @("platform-mail", "/srv/vxture/runtime/secrets/platform-mail.env", "deploy/secrets/platform-mail.env.example"),
  @("auth-bff", "/srv/vxture/runtime/.env.auth-bff", "deploy/.env.auth-bff.example"),
  @("website-bff", "/srv/vxture/runtime/.env.website-bff", "deploy/.env.website-bff.example"),
  @("console-bff", "/srv/vxture/runtime/.env.console-bff", "deploy/.env.console-bff.example"),
  @("admin-bff", "/srv/vxture/runtime/.env.admin-bff", "deploy/.env.admin-bff.example")
)
foreach ($pair in $pairs) {
  $real = @(Get-Content $pair[1] | Where-Object { $_ -match '^\s*[A-Z0-9_]+=' } | ForEach-Object { ($_ -split '=', 2)[0].Trim() })
  $example = @(Get-Content $pair[2] | Where-Object { $_ -match '^\s*[A-Z0-9_]+=' } | ForEach-Object { ($_ -split '=', 2)[0].Trim() })
  "$($pair[0]): $(($real -join '|') -eq ($example -join '|'))"
}
```

在 VXTURE_DEPLOY_HOST 检查重复项：

```bash
cd /srv/vxture/runtime

grep -R -nE '^(JWT_SECRET|JWT_REFRESH_SECRET|DATABASE_URL|REDIS_URL|AUTH_INTERNAL_TOKEN)=' .env.* || true
grep -R -nE '^REDIS_PASSWORD=' .env .env.* secrets/platform.env || true
grep -R -nE '^SMTP_' .env.* secrets/platform.env || true
grep -R -nE '^CF_TURNSTILE_ADMIN_' .env.admin-bff .env.website-bff .env.console-bff || true
grep -R -nE '^CF_TURNSTILE_TENANT_' .env.website-bff .env.console-bff .env.admin-bff || true
grep -R -nE '^(DINGTALK_|FEISHU_)' .env.website-bff .env.console-bff .env.admin-bff || true
```

期望：以上命令无输出。

---

## 十三、未来平台 beta

当前本仓只部署 VXTURE_DEPLOY_HOST prod。未来若启用平台 beta，必须使用临时按量服务器 `vxture-beta`，并复制本文件的分工模型：

- 独立 `secrets/platform.env`
- 独立 `secrets/platform-mail.env`
- 独立 `.env.<service>`
- 独立 Turnstile widget 或明确复用策略
- 独立数据库和 Redis

平台 beta 不得复用 vx-worker-02，也不得与业务 beta/prod 环境混放。
