# @vxture/core-oidc-rp

> 2026-11-24：C2 本地实现说明，尚未发布。架构层参考：[Core 层](../../../30-design/architecture/03-core-layer.md)。新增事件协议见[候选接口](../../../30-design/identity/150-event-sync-api.md)，本包当前不提供可靠事件队列或 SSE。

## 包信息

| 项   | 值                             |
| ---- | ------------------------------ |
| 包名 | `@vxture/core-oidc-rp`         |
| 层   | core                           |
| 职责 | OIDC RP 客户端（跨域应用接入） |

## 实现上下文

平台五个 RP（Console、Website、Admin、Opera、Arche）使用本包；Workbench、Customer Portal 各有独立实现，不因本次修改自动升级。基础设施不决定席位、租户或业务权限；BFF 在验证会话后交由所属域判断。

## 公共接口与示例

```typescript
import Redis from "ioredis";
import {
  HttpOidcRpClient,
  RpAuthService,
  RpSessionStore,
  rpAuthFailure,
  type OidcRpConfig,
} from "@vxture/core-oidc-rp";

export function createRp(redis: Redis, config: OidcRpConfig, prefix: string) {
  const client = new HttpOidcRpClient(config);
  const store = new RpSessionStore(
    redis,
    config.clientId,
    prefix,
    config.sessionTtlSec,
  );
  return {
    store,
    auth: new RpAuthService(store, client, config.sessionTtlSec),
  };
}

export function unavailableBody(reauthorizationRequired: boolean) {
  return rpAuthFailure({ status: "unavailable", reauthorizationRequired });
}
```

`RpAuthService.resolve(rpsid)` 返回判别联合：

- `ok`：已验签且身份匹配的 claims、rpsid、refreshed、accessToken。accessToken 仅供 BFF 的 OBO 服务调用，禁止序列化给浏览器。
- `expired`：本地会话缺失、TTL 到期或有撤销标记。调用方沿用未认证响应。
- `unavailable`：暂不可取得安全授权，含 `reauthorizationRequired`。映射 503，保留会话、拒绝本次业务请求；不要转换为全局退出。

`rpAuthFailure` 返回 `{code,message,retryable,statusCode:503}`；代码分别为 `AUTH_UNAVAILABLE` / `AUTH_REAUTHORIZATION_REQUIRED`。网络、Redis、JWKS、刷新锁竞争不会使身份记录被删除。明确 invalid_grant 且旧访问令牌已过期时要求重授权；仍有效的旧 token 仅经重新验签后可用于原有效期内的请求。身份绑定不符直接拒绝，不能回退放行新身份。

## Redis 存储与并发

`RpSessionStore(redis, clientId, prefix = "vx:", maxSessionTtlSec = 86400, authority?)` 要求 standalone Redis 和支持 `EVAL` 的客户端。生产必须按受信环境配置 prefix / 客户端隔离。本实现多 key Lua 不支持 Redis Cluster 的跨 slot 执行。

| 方法                                             | 保证                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `create(rpsid, session, ttl)`                    | 检查 sid 撤销标记后原子创建 NX 会话和 sid 索引；重复 ID / 已撤销 sid 抛错；索引 TTL 不被较短会话缩短                           |
| `get(rpsid)`                                     | 返回会话或 null，同时检查 sid 撤销标记；Redis 故障抛错，由 auth service 归类 unavailable                                       |
| `update(rpsid, next, ttl, expected, lockOwner?)` | 必须传原会话，比较完整 JSON、sid/sub、存在性、撤销标记；提供 owner 时还验证租约；返回 boolean；永不创建会话，永不延长现有 PTTL |
| `destroy(rpsid)`                                 | 删除本地会话并移除索引；后续刷新 CAS 不能重建它；rpsid 必须随机且不可复用                                                      |
| `destroyBySid(sid)`                              | 同一 Lua 中写撤销标记并删除已索引的所有 RP 会话；标记保留 maxSessionTtlSec + 600 秒，覆盖本地寿命与当前回调窗                  |
| `lockRefresh / unlockRefresh`                    | 60 秒租约；旧 owner 不能发布 token，也不能释放后继租约                                                                         |

ttl 必须为正安全整数且不超过配置最大值，配置错误启动失败。刷新同时受进程内 single-flight 与分布式租约约束。等待租约最多约 1 秒（40 × 25 ms），随后返回 unavailable；这是单次请求的并发协调，不是身份后台轮询。token / JWKS 单次请求各有 10 秒超时，禁止跟随重定向。

刷新成功先验 ID token 的 sid/sub，再验 access token 的 sub 和存在时的 sid，最后条件写回。完成验签后再次读取存储，避免 JWKS 网络等待期间已退出仍放行。已发出的业务请求无法被“回滚”；后续请求受撤销标记约束。

## 兼容与发布限制

本次改变 `update` 签名及 resolve 联合类型，所有调用者须一起适配；不能只升级包而保留旧 BFF 的“非 ok 全部 401”。Redis 原会话和索引 key 保持兼容，新增 revoked / refresh key。测试替身必须显式支持 EVAL，不能用内存伪 Lua 测试宣称存储原子性。

同一客户端的新旧实例混跑时，旧实例仍可无条件写会话。因此发布必须停止 / 排空旧写入者后启用新保证。现存无索引会话、过去已漏投退出、Redis 数据丢失、中央不可达都不由本次本地标记自动修复；C3 / C4 必须提供持久事实及恢复。将 maxSessionTtlSec 降低前须先处理仍可能存活的旧长寿命会话，不能让撤销标记早于它们消失。回滚代码也不能删除已建立的撤销事实。

## 可选持久撤销与 logout-v1 恢复（C4 本地试点）

公共扩展导入：`import { HttpIdentityRecoveryClient, type IdentityRecoveryClient, type RpSessionAuthority } from "@vxture/core-oidc-rp";`。核心只定义协议与调用顺序，PostgreSQL 生命周期、环境配置和恢复策略由宿主 BFF 提供；Console 示例见 `bff/console-bff/src/oidc/session-recovery.authority.ts`。

`authority.accepts(session)`：仅已确认无效返回 false；存储、网络、恢复失败抛错，auth service 转 unavailable。create 写入前后均检查，get / update 检查；destroyBySid 先等待 authority.revoke 持久提交，再执行 Redis Lua。destroy 只做本地清理，不因中心恢复故障无法退出，也不记中央撤销。

`new HttpIdentityRecoveryClient(config, environment)` 提供 snapshot(sids) / events(cursor)，受信绑定精确匹配 issuer/client/customer/environment/logout-v1；请求与响应边界见[接口与 OpenAPI](../../../30-design/identity/150-event-sync-api.md#22-logout-v1-恢复子集本地实现默认关闭)。仅实现不可逆退出，不提供完整授权事件 inbox 或 SSE；不得用定时器循环调用 events。

第五参数可省略，既有消费者仍只有 Redis 撤销保证。Console 显式试点启用时，在每个进程/连接代次首次请求做快照+有界补拉，每次读取仍查本地持久 receipt。其他产品要自行实现并验证 authority，升级核心包不会自动获得恢复能力。本地集成验证包括恢复旧 Redis 数据和重建适配器；未模拟独立 OS 进程 kill 或持久数据库丢失。

## 流连接的只读剩余寿命

`RpSessionStore.remainingLifetimeMs(rpsid): Promise<number>` 通过 Redis PTTL 读取原键剩余寿命，不写入或续期。键缺失/已到期返回 0，无过期时间或非法 TTL、适配器缺少 PTTL 则抛错。`RpRedis.pttl` 是可选扩展，不影响既有只使用会话读写的适配器；需要限制 SSE 寿命的宿主必须提供它。

该方法只提供时长，不执行身份鉴权。示例：`import { RpSessionStore } from "@vxture/core-oidc-rp";`；通过既有注入取得 store，在成功鉴权后 `await store.remainingLifetimeMs(rpsid)`，并与宿主持有的可信中央绝对到期取较早值。Console C6 使用这一 accessor，业务事件与 SSE 协调仍留在 BFF。

## changes-v1 通用传输（本地未发布）

`HttpIdentityChangesClient` 提供严格校验的变化快照与有限补拉；`IdentityEventVerifier` 校验独立 typ 的 RS256 封套，绑定 issuer/client/customer/environment。使用示例：`import { HttpIdentityChangesClient, IdentityEventVerifier } from "@vxture/core-oidc-rp";`。HTTP 请求有超时、禁止重定向和响应大小上限；不包含轮询调度或业务授权。

`IdentityEventVerificationError.unavailable` 区分 JWKS 暂时失败与签名/形状拒绝；未知 kid 拉取合并，冷却期返回可重试错误，不能因冷却误暂停接收方。公共类型 `IdentityChangeEvent/IdentityChangeSnapshot/IdentityChangesClient/IdentityChangeScope` 均从 index 导出。版本保持十进制字符串，用 BigInt 比较。候选中的 workforce/产品范围尚未开放。现行协议见 [150 §2.5](../../../30-design/identity/150-event-sync-api.md#25-changes-v1-签名投递与-console-应用本地实现默认关闭)。

## 验证与边界

```powershell
$env:REDIS_ITEST_URL = 'redis://127.0.0.1:6379'
pnpm --filter @vxture/core-oidc-rp test
pnpm --filter @vxture/core-oidc-rp type-check
pnpm --filter @vxture/core-oidc-rp exec tsup
```

未设置 REDIS_ITEST_URL 时 9 个 Redis 测试会跳过，不能据此宣告并发验证通过。集成测试使用 UUID 前缀，仅清理自己的测试键，从不 FLUSHDB。覆盖两个独立 Redis 连接 / 两个服务实例并发刷新、晚到回调、退出与写回竞争、旧锁 owner、索引 TTL、绝对寿命。真实 HTTP 测试覆盖 token 服务断连、10 秒超时、异常响应和禁止重定向。独立 OS 进程崩溃 / Redis 恢复及真实产品双向联调仍在后续门槛内。

## N6 共用会话同步基础设施（2026-11-24）

新增公开导出 SessionRecoveryAuthority、IdentityChangesAuthority、SessionEventsHub、SessionEventsEndpoint、IdentitySyncRuntime 及 IdentitySqlPool/IdentityNotificationClient 结构端口。宿主提供连接、配置与 realm，核心包不引用 BFF 或业务服务；事件仅使宿主重新读取领域事实。独立 RP 可提供已有 cookieName，不能从请求选择 Cookie。IdentitySyncRuntime 当前用于 customer Workbench/Customer Portal；运营 BFF 通过各组件显式传 workforce。

示例：

```ts
import {
  IdentitySyncRuntime,
  SessionEventsEndpoint,
} from "@vxture/core-oidc-rp";
import { startSessionSync } from "@vxture/core-identity-sdk";
```

前端 SDK 协调完整视图、15 秒读截止、通知顺序、同源 Cookie 切换与断流兼容。开关/域约束和 Cookie 契约见 [150 §2.8](../../../30-design/identity/150-event-sync-api.md#28-n6-平台全入口与运营域v07本地实现默认关闭)。
