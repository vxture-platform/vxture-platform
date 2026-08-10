# 能力控制台:外壳与模块挂载契约(批C 交付)

> 上游:`docs/30-design/product_250_management-plane-contract.md` M-1/M-4。
> 本文=外壳实现说明 + **L1 admin-module 的挂载契约**(atlas 批D / runos 批F 的对接依据)。
> 域名纪律:仓内一律以占位符 `x.vxture.com` 指代本控制台域名,真实主机名仅存在于部署主机 runtime env。

## 1. 外壳(platform 仓交付,worker-01)

| 件    | 位置                                          | 说明                                                                                                                                |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 前端  | `portals/opera`(`vx-platform-opera`:3040)     | Next.js 薄壳:workforce 会话头 + 侧栏导航 + 总览页;复用 shell-template CSS;**零本地 CSS、零 NEXT_PUBLIC 域名**(BFF 一律同源相对路径) |
| BFF   | `bff/opera-bff`(`vx-platform-opera-bff`:3041) | workforce realm OIDC RP(client_id=`opera`)+ nginx `auth_request` 门 + operator-OBO 换票(M-1);RP 会话 Redis,默认 TTL 12h;不连库      |
| vhost | `deploy/nginx/templates/opera.vhost.template` | 20-sync 脚本从 `.env.opera-bff` 的 `OPERA_BASE_URL` 渲染真实 `server_name`;env 缺失即跳过                                           |
| 兜底  | `deploy/nginx/sites-enabled/00-default.conf`  | default_server:80→444、443→`ssl_reject_handshake`(未知 SNI 不出证书)                                                                |

加固硬性项落点(批A 拍板):通配符证书(复用 `*.vxture.com`)/真名不入仓(模板渲染)/SSO 前置零内容(`auth_request` 全路径门,仅 `/auth/*` 匿名可达)/default-server 兜底/限流(继承 `conf.d/00-hardening.conf` 全局 zone)。

## 2. 挂载契约(provider admin-module 必须满足)

联邦一档 = **nginx 路径挂载**:模块是独立小应用,与自家 backend 同仓同机同 CD;外壳不参与其构建。

1. **挂载位**:`/{product_code}/*`(`/atlas/*`、`/runos/*`)。模块的一切路由、静态资源、API 调用必须收在自己的前缀下(Next.js 用 `basePath`,其他框架等价物)。
2. **身份(M-1)**:每个到达模块的请求携带 `Authorization: Bearer <operator-OBO token>`(边缘 `auth_request` 门铸造,`aud={product_code}`、`scope=mgmt:{product_code}`、`realm=workforce`、TTL 300s)。模块义务:JWKS 验签 + 校 `aud`/`realm`/`exp`;高危端点加验 step-up 新鲜度(`amr`)。**模块不做自己的登录**——浏览器侧 SSO 完全由外壳 vhost 承担,未认证请求到不了模块。
3. **审计(M-5)**:模块域内审计表记录传入 token 的 `sub`(`opr_<id>`)。
4. **健康**:模块暴露自己的健康端点,由自家 compose/healthcheck 消费(边缘不探测)。
5. **接入步骤**(平台侧,每模块一次):
   - `bff/opera-bff/src/routers/oidc-auth.router.ts` 的 `MODULE_AUD_BY_PREFIX` 加一行;
   - vhost 模板取消对应 `location /{code}/` 注释,填模块的 tailnet 地址(worker-02 等);
   - `portals/opera/src/config/navigation.ts` 对应项 `pending` 置 false。

## 3. 部署序(批C 上产时,owner-gated)

1. `27-provision-client-secrets.sh`(opera 已入 CLIENTS_ALL)→ `.env.opera-bff` 得 `OIDC_CLIENT_SECRET`,`.env.auth-bff` 得 hash;
2. 主机 `.env.opera-bff` 填真实 `OPERA_BASE_URL`(参照 `deploy/.env.opera-bff.example`);
3. reseed(23/29,`appoidc.oidc_clients` 落 opera redirect;两脚本已白名单该 env);
4. `20-sync-nginx-config.sh`(渲染 vhost + default-server 兜底)+ compose up opera/opera-bff;
5. 收尾:`deploy/guardrails/39-audit-env.mjs` 把 opera-bff 条目 `requiredActual` 翻成 `STRICT_RUNTIME`、`OIDC_CLIENT_SECRET_HASH_OPERA` 移入 required 集(首部署后 fail-closed)。

## 4. 边界

- admin(BSS)三页迁出/代理退役 = 批E,不在本文;
- 模块自身实施方案归各 provider 仓(atlas#52 线);
- 跨仓审计聚合延后(M-5)。
