# Arda 对接交接总纲（arda_100_handoff）

> 版本：**v2.0** · 状态：定稿（三通道已定型上产） · 受众：**线 B（arda 独立仓）开发**
> 性质：**汇编与索引**——语义以权威文档为准。接口契约本体 = [`arda_200_interface.md`](./30-arda_200_interface.md)；最终对接要求与决策留痕 = [`arda_300_integration-final.md`](./40-arda_300_integration-final.md)；产品定义 = [`arda_000_definition.md`](./10-arda_000_definition.md)。
> 边界：两线唯一同步点 = 契约文档，**arda 仓不引用 vxture 仓代码**（可包依赖 `@vxture/shared` 取值域，非源码引用）。

---

## 1. 文档包清单（建议整包拷贝进 arda 仓留档）

| 文件                                                                                             | 作用                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`arda_000_definition.md`](./10-arda_000_definition.md)                                          | Arda 产品定义——v1 功能切片依据（目录四元组、连接器类型；不含 P 级供给/跨 WS 共享）                               |
| [`arda_200_interface.md`](./30-arda_200_interface.md)                                            | **本产品对接接口契约**：C1/C2/C3/webhook 端点、请求响应形状、值域、鉴权——散落各权威的接口点收敛成一份可实现契约  |
| [`arda_300_integration-final.md`](./40-arda_300_integration-final.md)                            | **最终对接要求 + 决策留痕**：三通道定型后的产品侧义务清单 + 关键架构决策（含被否决的旧方案，防回退）             |
| [`product_200_integration.md`](../../30-design/product_200_integration.md)                       | 三通道对接契约权威；§7 = 新产品接入 checklist（验收清单）                                                        |
| [`product_220_catalog-resource-model.md`](../../30-design/product_220_catalog-resource-model.md) | 目录·权益与资源模型权威：C2 信封形状、L0 共享资源目录、消费方义务                                                |
| [`identity-platform-rp-integration.md`](../../30-design/identity/080-rp-integration.md)          | C1 RP 接入通则（五端点、PKCE、RS256 验签、服务端会话、back-channel logout）；§5 = provisioning webhook wire 契约 |
| [`data_platform_100_architecture.md`](../../30-design/data_platform_100_architecture.md) §2.3    | 业务面模板硬约束：库名/四 schema/`workspace_id` 隔离键/不读平台库                                                |
| [`product_210_tool-protocol.md`](../../30-design/product_210_tool-protocol.md)                   | L0 工具协议（"agent 调 Arda"目标态，v1 不要求实现，仅预留见 §4）                                                 |

## 2. 对接参数速查

### C1 OIDC（IdP = `accounts.vxture.com`，已上生产）

| 项                  | prod                                    | beta                                         |
| ------------------- | --------------------------------------- | -------------------------------------------- |
| client_id           | `arda`                                  | `arda-beta`                                  |
| 站点                | `https://arda.vxture.com`（nginx→3230） | `https://beta-arda.vxture.com`（nginx→3231） |
| redirect_uri        | `{站点}/auth/callback`                  | 同左                                         |
| back_channel_logout | `{站点}/auth/backchannel-logout`        | 同左                                         |
| realm               | `customer`                              | `customer`（release_channel=beta）           |
| scopes              | `openid profile email phone`            | 同左                                         |

- **access_token 只带治理上下文**（`active_org`/`active_workspace`/`roles`/`account_status`），**权益/商业字段永不入 token**；RP 验签后读，refresh 后重取（切租户即时对齐）；
- client secret 经 owner 手动转运，不进聊天/CI/仓库。

### C2 / C3 平台 API（仅内网可达，公网 nginx 不路由 `/platform/*`、`/usage/*`）

| 项      | 值                                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base    | 平台内网别名 `http://<worker-01-tailnet-ip>:8080`（tailnet 接口绑定；平台重构拓扑产品零改动）                                                                                                                                                     |
| C2 权益 | `GET /platform/entitlements?workspace_id={W}&product=arda`（批量 `products=`）；短 TTL 缓存（`Cache-Control: private, max-age=45`）                                                                                                               |
| C3 用量 | `POST /usage/consume`（counter）+ `PUT /usage/gauge`（storage 水位快照）                                                                                                                                                                          |
| 鉴权    | 请求头 `x-vxture-internal-auth`（= 平台 `AUTH_INTERNAL_TOKEN`，arda 侧键名 `PLATFORM_INTERNAL_AUTH_TOKEN`，owner 手动转运）——过渡 S2S 凭证，[`product_210`](../../30-design/product_210_tool-protocol.md) token exchange 落地后迁移，端点契约不变 |

信封形状、值域、门控公式见 [`arda_200_interface.md`](./30-arda_200_interface.md) §2/§5。

### C3 provisioning webhook（arda 作接收方）

| 项          | 值                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 接收端点    | `{ARDA_WEBHOOK_BASE_URL}/provisioning/webhook`（tailnet 投递）                                                                                                                                                                |
| 验签 secret | arda 侧 `PROVISION_WEBHOOK_SECRET` ↔ 平台侧 `ARDA_PROVISION_WEBHOOK_SECRET`，**同值**（owner 派发）                                                                                                                           |
| wire 契约   | RP 通则 §5：headers `x-vxture-event` / `x-vxture-delivery` / `x-vxture-signature: t=<ts>,v1=<hex>`（HMAC-SHA256 over `"{t}.{raw_body}"` 原始字节）                                                                            |
| 产品端义务  | ①验签；②按 `id` 幂等；③按 `seq`（per (workspace, product) 单调）弃旧，不依赖到达顺序；④`tenant.provisioned`→建 WS 空间，`tenant.deprovisioned`→拆除；⑤2xx 回执（默认 8 次退避后死信）；⑥按 `payload.plan` 忽略 beta plan 事件 |

## 3. 验收口径

- C1 完成 = SSO e2e（登录→会话→登出→back-channel）；
- 全链 e2e = **登录 → 开通（provisioning）→ 门控（C2）→ consume → 缓存过期重拉**，对照 `product_200` §7 checklist；
- 数据面过检：库名 `vxturebiz_arda_{beta,prod}`、四 schema、业务表带 `workspace_id`。

## 4. v1 架构预留（不加工作量，只影响代码切分）

L0 工具协议（S2S "agent 调 Arda"）是后置目标态，v1 不实现，但按下三点切分可零成本对接：

1. **RP 的 JWT 验签写成可复用模块**——未来 S2S token 验签是同一 JWKS / 同套路，只换 `aud` 与 `act` 检查；
2. **数据服务面查询入口与 Web 会话解耦**——未来同一入口同时接受用户会话与 S2S token 两种主体；
3. **工具面路由预留 `/.well-known/vxture-tools` 命名位**。

## 5. 边界纪律

1. arda 仓为独立授权范围，建仓与首次部署须 owner 显式授权；
2. 不读平台库、不持 Provider Key、不复制平台主数据（只持 `org_id/workspace_id/user_id` 引用）；
3. entitlement 不入 token、不落 arda 库（每次 C2 实时拉取 + 短 TTL 缓存）；
4. 用量唯一写入方 = 平台 consume 服务，arda 只缓冲与上报；
5. 所有 secret 经 owner 手动转运，不经聊天/CI/仓库。
