# @vxture/bff-platform-api

> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

## 包信息

| 项       | 值                                        |
| -------- | ----------------------------------------- |
| 包名     | `@vxture/bff-platform-api`                |
| 路径     | `bff/platform-api/`                       |
| @layer   | `Application`                             |
| 框架     | NestJS                                    |
| 端口     | 3041（容器内；宿主不发布端口）            |
| 服务对象 | 产品侧 S2S（arda 为首个消费方），非浏览器 |

## 职责

产品面 S2S 宿主（product_310 D13，2026-07-13 自 auth-bff/admin-bff 拆出）：

- **C2 读面**：`GET /platform/entitlements`（权益视图）+ `GET /platform/sharing/visible-set`（可见集）；
- **C3 写面**：`POST /usage/consume`（瀑布扣减）+ `PUT /usage/gauge`（水位快照）；
- **commerce 后台作业**：provisioning webhook 派发（`ProvisioningDispatchJob`）、sharing 到期扫描、trial 到期扫描（自 admin-bff 迁入；引擎模块自持连接池，跨实例 DB 租约防叠加）。

拆分后分工：auth-bff = 纯身份（OIDC/authn/operator），admin-bff = 运营治理面，platform-api = commerce 单一宿主。

**接入路径**：产品侧经 nginx 内网别名 `http://<worker-01-tailnet-ip>:8080`（Tailscale 接口绑定，`deploy/nginx/sites-enabled/platform-internal.conf` 路由 `/platform/*`、`/usage/*`），公网 nginx 不路由这些前缀（边界对称）。

## 鉴权

三个业务端点统一走 `PlatformAuthGuard` 双凭证（迁移期并行，任一满足）：

1. **legacy**：`x-vxture-internal-auth: ${AUTH_INTERNAL_TOKEN}`（platform.env 共享键；arda 现行）；
2. **S2S bearer**（product_210 T1/T2）：`Authorization: Bearer <token>`，`aud=vxture`、`act.sub`=调用方产品码；经 `S2sTokenVerifier` 以 IdP JWKS（`${AUTH_BFF_URL}/oidc/jwks`，kid 缓存）验签——**签名私钥不出 auth-bff**（D13 凭证分权）。

## 接口契约

契约权威不在本文（本文只是宿主说明）：

- C2/C3 端点形状 = ADR-11 §11.7 + [`docs/20-specs/arda/arda_200_interface.md`](../../../20-specs/210-arda/30-arda_200_interface.md)；
- 三通道标准 = [`docs/30-design/product_200_integration.md`](../../../30-design/product_200_integration.md)；
- 契约收缩（信封 v2）产品侧最终要求 = [`docs/20-specs/arda/arda_300_integration-final.md`](../../../20-specs/210-arda/40-arda_300_integration-final.md) §1。

## 运行环境

- env：`/srv/vxture/runtime/.env.platform-api`（example 登记 + 39-audit-env 规则）；共享五键经 `secrets/platform.env`；DB 走 `platform_svc`（platform-app.env 覆盖层，TD-018 模式）；
- `ARDA_PROVISION_WEBHOOK_SECRET` 随派发作业自 .env.admin-bff 迁入本 env（placeholder-optional，不阻塞部署）；
- 作业节奏：`PROVISION_DISPATCH_INTERVAL_MS`（默认 10s）/ `SHARING_EXPIRY_SWEEP_INTERVAL_MS` / `TRIAL_EXPIRY_SWEEP_INTERVAL_MS`（默认 60s）。
