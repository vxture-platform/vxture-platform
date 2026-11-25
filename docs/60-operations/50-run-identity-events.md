<!--
@package @vxture/repo
@layer Application
@category operations
@author AI-Generated
@date 2026-11-24
-->

# 客户身份事件同步：运行与恢复

> 2026-11-25：主平台 v0.33.17 与 Tenant 镜像对已部署，七 RP 事件能力和主机只读采集已启用；轮询退役保持关闭。最新生产记录见 §17 和 [120 进展页](../70-workplan/120-identity-sync-progress.md)。§1–§16 保留实现、操作和各批次证据；其中历史“尚未部署”只描述记录当时。互动登录/MFA、生产浏览器轮询退役、外部产品及告警送达继续分别验收。

## 1. 部署顺序与旧会话

1. 核对目标数据库、issuer、客户 client_id、release_channel、`slo_participation=back_channel` 和退出地址，分别核对 beta 与 stable。当前 release_channel 是登记通道，不能把它等同候选协议的 environment。
2. 按数据库发布流程执行 `2026-12-15-customer-session-outbox.sql`，再上线 auth-bff；新库已在 `ddl/24_session.sql` 内包含同一结构。核验新表、触发器与服务角色权限。迁移是加法式，不能先上线依赖新列的程序。
3. 排空旧 auth-bff 实例和在途授权码。迁移只从有效客户会话关联的 refresh 记录回填接收方；历史 Redis-only / code-only 绑定无法凭空补齐。试点应建立新中央会话，存量在有证据的范围内重新授权；不得宣称历史覆盖完整。
4. 上线支持 sid 撤销屏障的 RP，再验收 Console 与一个外部客户产品的双向退出。标准退出处理须在实际失效应用完成后回复 200/204，重复退出必须幂等。旧客户端不自动获得新事件、恢复或 SSE 能力。
5. 验证重试、掉线、进程重启、接收地址变更和 DB 不可用；保留既有身份同步，直到 C4 恢复、C5 上下文/授权事件与 C6 页面推送验收后按客户端撤轮询。

未执行以上任何共享环境操作。本地证据不替代目标环境验收，也不据此关闭 #726。

## 2. 运行参数与语义

| 项目         | 当前值 / 行为                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 事实与接收方 | `session.auth_sessions`、`session.oidc_session_clients`；客户持久会话缺失或终止不能继续 SSO                                 |
| 事务边界     | customer 从 active 转 revoked/expired 的同一事务插入 `session.logout_deliveries`；直接 SQL 安全撤销同样覆盖；回滚则全部回滚 |
| 唤醒         | PostgreSQL LISTEN/NOTIFY，提交后通知；启动扫描和每 30 秒补扫恢复丢失提示                                                    |
| 领取         | 每批 10 条，`FOR UPDATE SKIP LOCKED`；60 秒租约，完成更新核验 owner 与有效租期                                              |
| 每轮         | 最多 10 批后让出执行，再续处理积压；到期中央会话每次最多转移 100 条                                                         |
| 连接         | Session pool 至少 2 个连接（LISTEN 占一个）；建连上限 5 秒，SQL 上限 10 秒，空闲事务上限 15 秒                              |
| HTTP         | 5 秒超时，禁止重定向，仅 HTTPS 或已登记的本机 HTTP；不记录 JWT / 响应正文                                                   |
| 成功         | HTTP 200 / 204；中央退出返回成功只表示中央撤销与任务已持久化，不保证此刻全部 RP 已应用                                      |
| 重试         | 网络错误、429、5xx；指数退避加随机抖动，最高 300 秒，Retry-After 最高 300 秒；实际执行还受 30 秒补扫调度影响                |
| 重试窗口     | 默认 24 小时；`retry_until` 是当前重试截止时刻，`created_at` 保留原始事实时间                                               |
| 隔离         | 登记地址 / realm / channel / 状态不再匹配、永久 HTTP 拒绝、无效 URL、重试窗口耗尽 → quarantined                             |
| 签名         | 每次发送新 jti、iat、exp（120 秒）的标准 logout_token；逻辑 event_id 保留在 DB，不向标准 token 塞候选协议                   |

这是至少一次投递。接收方应用后 ACK 丢失会重送；必须允许重复。Redis 恢复需同时启用下文的持久撤销与请求恢复；离线 JWT 的即时全局撤销不由此队列单独解决。既有账号生命周期严格通知路径保留，其重试与队列可能重复到达。

这项后台任务检查的是尚未完成的投递与自然到期事实，不是浏览器持续查询登录状态；SSE 心跳也不得视为用户活动或延长会话寿命。

## 3. 只读排查与告警

```sql
SELECT status, count(*) AS deliveries, min(created_at) AS oldest,
       max(attempts) AS max_attempts
FROM session.logout_deliveries GROUP BY status;

SELECT id, event_id, sid, client_id, release_channel, attempts,
       available_at, retry_until, lease_until, last_error
FROM session.logout_deliveries
WHERE status <> 'delivered'
ORDER BY created_at LIMIT 100;

SELECT count(*) AS overdue_leases FROM session.logout_deliveries
WHERE status='pending' AND lease_until < now();
```

应监控最老 pending 年龄、quarantined 数量及增长、投递延迟、重试原因、过期租约、DB / 连接池错误。当前提供持久状态与错误日志，独立指标面板和告警接线归 C8。登记变更时不能把旧任务自动发送到新环境；需验证收件主体、通道与地址仍属于同一接收方。

## 4. 按任务恢复

先修复原因，再以获准的单条 delivery id 恢复；下例 `$1` 由参数绑定，不拼接用户输入。终止会话不能恢复为 active，不删除队列重建事实，不改 event_id、sid、client_id、原始 created_at 或接收地址。

```sql
BEGIN;
UPDATE session.logout_deliveries
SET status='pending', available_at=now(), retry_until=now()+interval '24 hours',
    lease_id=NULL, lease_until=NULL, last_error=NULL
WHERE id=$1 AND status='quarantined';
SELECT pg_notify('customer_session_logout', '');
COMMIT;
```

重新投递仍会核对当前登记；登记不一致继续隔离。失去租约的旧 worker 不能修改重领任务。`delivered` 只表示接收端返回成功；排查错误 ACK 时须先确认实际 RP 应用状态，不能批量重置整个队列。

尚未建立自动保留/清理任务；本阶段保留绑定和投递记录。外键有意阻止清理父会话时丢失未完成退出，后续清理需与最长 RP 会话、恢复窗口和审计保留共同设计。

## 5. 回退与本地复验

应用回退保留加法迁移、绑定和队列表。旧程序不具备持久绑定与重试保证，应恢复试点前同步策略；不删除触发器、不把已终止 sid 改为 active。目标环境发布和回退均按本仓确认流程单独执行。

真实集成测试用 `IDENTITY_PG_ITEST_URL` 指向本机专用 PostgreSQL（测试账户需 CREATE DATABASE 权限），运行 `pnpm --filter @vxture/bff-auth test -- src/authn/session-logout.itest.spec.ts`。测试只创建/删除随机 `identity_logout_itest_*` 数据库，服务 HTTP 使用系统分配临时端口。缺少该变量时显式跳过，不能把跳过当通过。测试包含升级/重跑迁移、事务回滚、并发绑定与撤销、租约过期、HTTP 故障、启动积压和提交唤醒。

## 6. logout-v1 恢复试点

### 6.1 先决条件与登记

按变更流程确认目标库后，先执行 `2026-12-15-customer-session-outbox.sql`，再执行 `2026-12-16-identity-logout-recovery.sql`；新库按文件名自动应用 DDL24/25，服务角色授权在 DDL97。迁移对五种已有 session 写入角色补齐触发器表权限，未创建角色、未插入能力登记。外部产品须持有自己的本地撤销存储，不直接访问平台库。

auth-bff 上线新接口后，以获准的明确 issuer、environment 和 client 登记；以下为参数化运维 SQL 模板，不是自动执行脚本。确认 client 只属于该环境，URL 正确、机密认证有效且当前用户同意该目标范围后执行。不要把 release_channel 当 environment。

```sql
INSERT INTO session.identity_recovery_streams
  (client_id,issuer,environment,release_channel,logout_uri)
SELECT client_id,$2,$3,release_channel,back_channel_logout_uri
FROM appoidc.oidc_clients
WHERE client_id=$1 AND realm='customer' AND status='active'
  AND token_endpoint_auth_method='client_secret_basic'
  AND slo_participation='back_channel'
  AND back_channel_logout_uri IS NOT NULL;
```

核验恰好登记一行，默认 disabled。不要复制 cursor_key，不要输出到日志或产品配置。作用域不可原地修改；改变 issuer、environment、client、通道或退出 URL 需要新 client/新流及迁移验收。此批没有运营登记 UI/API。

### 6.2 启用与验证

1. 先部署新 Console 代码，开关保持 false。保证其数据库已迁移且使用正确角色、issuer、clientId、Redis prefix；排空不具备持久撤销能力的旧实例。自定义 client_id 现在用于 RP Redis 会话命名空间，若旧版本硬编码 console，须预先迁移/重新登录，不能直接切配置后期待原 Cookie 继续可用。
2. 对获准客户端 `UPDATE session.identity_recovery_streams SET enabled=true WHERE client_id=$1`。用 Basic 凭据从后端检查 snapshot 空请求成功且 binding 精确匹配；检查外部环境凭据不能读取该流。
3. Console 设置 `OIDC_RP_ENABLED=true`、现有有效 `OIDC_CLIENT_SECRET`、`RP_IDENTITY_RECOVERY_ENABLED=true` 及明确 `RP_IDENTITY_ENVIRONMENT=prod|beta|dev` 后重启。缺少机密 RP 或合法环境启动失败；新开关默认 false。不要将密钥放浏览器、URL 或日志。
4. 用测试账号建立新会话，验证中央退出→Console 持久 receipt→标准 ACK。重复退出只留一条 receipt；恢复旧 Redis 数据及重启 Console 后仍不可访问。对未收到通知的存量 sid，首次访问走快照+补拉；不受信/历史无绑定不能直接放行，需要重新登录。
5. 验证中心503、本地DB不可用时受保护请求503且 Cookie 不清；持久写入失败不能 ACK。恢复期间重连不能复用上一代结果。Redis ready/close 清确认，手工在不断连的 Redis 内加载旧数据不会自动触发重连恢复；已确认的撤销仍受每请求本地 receipt 保护。

没有连续中心轮询。每个进程/Redis 代次首次读取 sid 会远程恢复；恢复确认上限 10,000 个 sid。每次 store.get 查询本地撤销表，普通鉴权通常读取两次；本地 PG 成为该试点请求路径依赖，连接池/延迟必须压测。每次远程请求10秒，最多20页；高积压可能超过网关超时而保持不可用。暂不启用大规模客户端。

### 6.3 保留、故障与回退

`identity_recovery_streams` 行锁保证同客户端事件提交顺序，会增加同流并发撤销的串行成本；跨多行事务仍可能死锁，PostgreSQL 回滚失败事务，不能把失败当退出成功。观察死锁/锁等待、请求恢复耗时、503、receipt/事件表增长；批量安全操作应有受控事务重试，正式容量验证归 C8。

游标7天有效；事件记录和撤销 receipt 本阶段均无自动清理。标准 token 不含稳定逻辑 event_id，receipt 按 scoped sid 幂等；已撤销 sid 永不复用，不能因队列 delivered 或停用能力就清除 receipt。snapshot / events 不返回 cursor_key。

```sql
SELECT client_id,issuer,environment,release_channel,enabled,last_sequence
FROM session.identity_recovery_streams;
SELECT stream_id,count(*) AS events,min(sequence),max(sequence)
FROM session.identity_recovery_events GROUP BY stream_id;
SELECT issuer,client_id,environment,count(*) AS receipts
FROM session.rp_revocation_receipts GROUP BY issuer,client_id,environment;
```

410：丢弃本次恢复游标，重新快照；403：修复真实登记和版本，不能静默关闭校验；503：保留身份、暂停受保护请求，排查持久存储和中心。仅关闭中央 enabled 会让尚未确认的会话失败，不是健康回退。回退应先停止试点流量、处理现有 RP 会话及旧实例，再按审批恢复旧同步；保留表、触发器、终态和投递任务。关闭 RP 开关会失去持久读取保护，不能据此宣称原安全保证仍在。

本地复验：auth 的 `src/routers/identity-recovery.itest.spec.ts` 使用 `IDENTITY_PG_ITEST_URL`；Console 的 `src/oidc/session-recovery.itest.spec.ts` 同时需要它与 `REDIS_ITEST_URL`，只使用本机随机库及随机 Redis 前缀，不能指向共享服务。核心 HTTP 用例不需外部环境。若 node_modules 链接其他 checkout，必须把 `@vxture/core-oidc-rp` 指向本工作区源文件再测；本次临时配置位于 output/identity-validation，不发布到生产。

## 7. Console 退出 SSE 试点

接口见 [150 §2.3](../30-design/identity/150-event-sync-api.md#23-console-退出-sse本地实现默认关闭) 及 [OpenAPI](../30-design/identity/150-console-session-events.openapi.json)。本地已验证，尚未执行目标环境迁移、代理重载或启用。

### 7.1 启用顺序

1. 先完成 §6 的中央能力登记、持久撤销及新会话验收。保持 `RP_SESSION_EVENTS_ENABLED=false`；仅新增前端时，端点返回 204 会停止可选流，不清身份。
2. 在 Console receipt 所在 PostgreSQL 执行 `2026-12-17-rp-session-notifications.sql`，在前一恢复迁移之后执行；新库使用 `ddl/26_rp_session_notifications.sql`。迁移只增加函数/AFTER INSERT 触发器，不登记客户端、不清数据。按既有数据库发布流程审批，不能让程序启动时自动跑共享库迁移。
3. 每个 Console BFF 实例预留一条独占 LISTEN 连接，另计既有恢复连接池预算。连接必须长期绑定同一数据库会话：直接连接 PostgreSQL 或使用 session pooling，不能经 transaction pooling。启动会核验通知触发器启用，缺失时 SSE 保持 503 并退避重连，不静默假装支持推送。
4. 配置同源 `/auth/events` 到 Console BFF。仓内 nginx 精确 location 已关闭缓存、缓冲及 gzip，使用 HTTP/1.1，75 秒上游读取/发送超时；25 秒心跳需穿过所有网关/CDN，不能只改最后一层。部署前 `nginx -t` 后再按发布流程重载。当前本机无可用 nginx 运行时，未验证生产代理。
5. 核对 `CONSOLE_BASE_URL` 为浏览器实际 origin（含协议/端口）；请求 Origin 不一致会 403。本地使用现有 Next `/auth/:path*` 同源 rewrite，配置 `CONSOLE_BFF_DEV_URL` 或 `LOCAL_BFF_PROXY_URL`，后端地址应为登记的本地 BFF；不要让浏览器直接跨源访问。HTTPS 使用 Secure Cookie，本地 HTTP 依现有 `RP_COOKIE_INSECURE` 规则，client_id 后缀要一致。
6. 保持 `RP_IDENTITY_RECOVERY_ENABLED=true`、显式环境与机密 RP 配置，设置 `RP_SESSION_EVENTS_ENABLED=true` 后滚动重启相关实例。缺少恢复 authority 会启动失败。旧实例返回 204 会让当前页面停止流，混合版本期间不能承诺推送覆盖；排空旧实例后重新载入验收页面。

### 7.2 验收与故障行为

| 检查                                               | 预期                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 两个 BFF 实例、同 sid 多页面；另一产品触发中央退出 | 标准退出持久提交后，所有实例的相关连接收到提示；持久复核后发 session-ended，页面重读当前 Cookie 后确认匿名 |
| 回滚 receipt 事务；直接伪造 NOTIFY                 | 回滚没有退出通知；伪提示可触发复核但不能使有效会话失效                                                     |
| PG listener 断开或 Redis 代次变化                  | 关闭连接并清进程恢复确认；重连做快照/补拉，补上未送达的退出；503 不清 Cookie                               |
| 旧连接尚在，浏览器已登录新账号                     | 事件只触发当前 Cookie 读取，不清新账号；身份以服务器当前视图为准                                           |
| 中央或 Redis 到期                                  | 连接只存活到已验证期限；心跳不续期，连接重建不是用户活动                                                   |
| 空闲且连接健康                                     | 新增流只有注释心跳，无定时身份查询；Console 既有 300 秒/焦点刷新仍运行，须分开统计                         |
| 慢客户端/超连接限额                                | 写背压关闭连接；每实例 5000、每 sid 32 上限，超限 429 + Retry-After:5                                      |
| 休眠或网络黑洞                                     | 前端 75 秒无字节中止，指数退避含抖动总上限 30 秒；健康连接恢复可见时不额外查身份                           |

浏览器每标签页独立连接，没有主标签页选举。无 SSE id/页面历史；每次重连重新鉴权、重新读取视图。只适用于不可逆退出；完整权限/上下文恢复按后续协议实现。监听 PG 连接异常有告警日志；连接数、重连率、慢客户端、恢复503及资源占用的独立指标接线仍归 C8。上限是防护默认值，未做 5000 并发容量认证。

本地测试 `bff/console-bff/src/routers/session-events.itest.spec.ts` 使用本任务真实 PG、Redis、两个独立 BFF listener 与真实 HTTP/SSE，并通过真实 RS256/JWKS 验证标准 logout；中心恢复 HTTP 使用受控事实夹具。门户 transport/provider 测试使用受控流及虚拟时钟。它们不能替代实际浏览器、目标代理和跨产品双向验收。

### 7.3 回退与轮询退役门槛

回退页面推送只关闭 `RP_SESSION_EVENTS_ENABLED` 并按发布流程重启；保留 `RP_IDENTITY_RECOVERY_ENABLED`、中央退出任务、事件、receipt 及触发器。关闭 SSE 不应回滚持久撤销。没有本批新增的数据清理任务。

当前 Console 原定时/focus/visibility 刷新同时刷新租户上下文和权限，尚不能删除。下一步先实现 C5 事实事件、完整恢复及页面失效，再完成真实浏览器/代理/跨产品与容量验收，按客户端移除旧轮询。不得以退出 SSE 测试成功推定全平台无需轮询。

## 8. changes-v1 事实记录与恢复读取

本节记录上一批的事实与恢复基线：上下文版本与十类授权事实表触发器、主体版本、持久 outbox、按客户端提交排序的恢复事件、两条后端恢复接口。契约见 [150 §2.4](../30-design/identity/150-event-sync-api.md#24-changes-v1客户上下文与授权变化恢复本地实现默认不登记)，进度见 [120](../70-workplan/120-identity-sync-progress.md)。本轮签名投递、Console 持久接收及页面失效在 §9；不能定时调用 changes/events 代替主动通知。

### 8.1 迁移与显式能力登记

1. 迁移顺序：既有 `2026-12-16-identity-logout-recovery.sql` 之后执行 `2026-12-18-identity-changes.sql`；Console SSE 的 12-15 迁移继续保留。新库按现有 runner 排序执行 `96_identity_changes.sql`，在事实表、跨域 FK 和基础触发器之后；本轮已验证全量 29 个 DDL 文件可建库。
2. 迁移在十类授权表及中央会话/绑定表加事务触发器，立即记录新事实。新增四张表但不回填历史事件、不创建/启用客户端；主体无历史版本时基线为 0，首次快照以现行事实为准。空间/组织上下文必须成对；同值更新不推进版本。正式迁移需评估触发器 DDL 锁和所有写入角色，按数据库发布流程执行。
3. 触发函数以固定 search_path 执行，应用角色不能直接调用特权事件写函数；原业务表权限不变。迁移向已存在的 platform_svc / svc_auth_bff 授予新表 SELECT；后续登记操作由获准的管理角色执行。新库既有 DDL97 的宽表权限仍按现行平台政策生效，此批不重构全库权限。
4. 仅获准的 customer、`client_kind=platform`、机密 back_channel 客户端可试点；先核验 §6 的 issuer、realm、environment、channel、URL 与绑定，再登记 changes 流。下例 `$1` 由参数绑定，不把用户输入拼入 SQL：

```sql
INSERT INTO session.identity_change_streams(stream_id,enabled)
SELECT r.stream_id,false FROM session.identity_recovery_streams r
JOIN appoidc.oidc_clients c USING(client_id)
WHERE r.client_id=$1 AND c.realm='customer' AND c.client_kind='platform'
  AND c.status='active' AND c.token_endpoint_auth_method='client_secret_basic'
  AND c.slo_participation='back_channel' AND c.release_channel=r.release_channel
  AND c.back_channel_logout_uri=r.logout_uri
ON CONFLICT(stream_id) DO NOTHING;
```

5. 单独批准后启用该流，恢复接口还要求原 recovery stream.enabled=true。先测试空快照和准确 binding，再建立测试会话并核对两个版本。客户端的 logout-v1 与 changes-v1 游标必须分开，互换返回 403。读取不签发 token，不更新 Cookie，也不授权业务。

### 8.2 故障与诊断

```sql
SELECT type,count(*),min(occurred_at),max(occurred_at)
FROM session.identity_change_outbox GROUP BY type;
SELECT r.client_id,r.environment,c.enabled,c.last_sequence,count(e.sequence) AS retained
FROM session.identity_change_streams c
JOIN session.identity_recovery_streams r USING(stream_id)
LEFT JOIN session.identity_change_events e USING(stream_id)
GROUP BY r.client_id,r.environment,c.enabled,c.last_sequence;
```

outbox 是持久事实，没有投递状态；数量不能解释为“未送达积压”，本轮投递状态见 §9 的 deliveries 表。`identity_fact_changed` 只传 event_id，丢失提示时事实仍在。禁用能力或临时登记不匹配会拒绝读取，但按原精确持久绑定继续捕获，恢复后补拉；更换环境用新 client/stream，不能重用旧水位。

主体版本行、会话绑定行和客户端流头会增加事务锁。大量角色/权限批改会扇出到多个用户，可能与其他批量操作产生死锁；PostgreSQL 回滚整笔，调用方必须把失败视为未完成并使用受控事务重试。当前没有自动吞错或把失败当成功，也未完成生产并发容量认证。监测死锁、锁等待、事务延迟、四张表增长及 403/410/503。

410 表示事件缺口或游标过期，重新快照；403 修复登记或协议，不要静默跳校验；503 保留身份但拒绝不能验证的操作。快照 active 不是业务准入允许，权限始终重读事实。时间边界、套餐/产品配置和手工权益覆盖已在 §9 补入；仍需 C2 实时准入与实际环境验收。

### 8.3 回退与保留

只关闭变化读取能力时，设置所选 `identity_change_streams.enabled=false`；不要删除 outbox、版本、流头或事件，不影响已交付的 logout-v1/退出 SSE。触发器写入已成为事实事务的一部分，若要回退触发器须单独审查遗漏变化的恢复方案，不能在发生写入故障时自动绕过。当前无自动清理策略。

本地复验：`src/routers/identity-changes.itest.spec.ts` 与退出恢复测试使用本机 `IDENTITY_PG_ITEST_URL`；随机数据库自动清理，禁止指向共享服务。Windows 上并行删除临时库可能等待 PG checkpoint/ProcSignalBarrier，建议数据库集成回归串行执行，明确设置清理 hook 时限；不能把清理超时记作全部检查通过。

## 9. 变化投递、Console 接收与多类型推送

本地实现见 [150 §2.5](../30-design/identity/150-event-sync-api.md#25-changes-v1-签名投递与-console-应用本地实现默认关闭)，新接收契约为 [150-identity-receiver.openapi.json](../30-design/identity/150-identity-receiver.openapi.json)。全部开关默认关闭，本次未执行共享库迁移或发布。

### 9.1 迁移与启用顺序

1. 在 §8 迁移之后执行 `2026-12-19-identity-change-delivery.sql`、`2026-12-20-identity-extended-facts.sql`。新库顺序是 `96_identity_changes.sql` → `96_identity_delivery.sql` → `96_identity_extended_facts.sql` → DDL97/98。迁移按固定正文创建表/触发器，并授予 auth 队列权限、Console inbox/版本权限、auth 到期发射函数权限；不改变业务授予规则。
2. 核对 issuer、customer realm、环境、client/channel 与既有退出绑定。先创建 **禁用** receiver；URL 必须为预审的 HTTPS 地址（本机开发允许 loopback HTTP），不含 userinfo/hash。数据库不从请求 Host 推断地址。一个 stream 只能有一个不可变地址，更换时创建新 client，不能把旧待投事件重新定向到新环境。

```sql
INSERT INTO session.identity_change_receivers(stream_id,receiver_uri,enabled)
SELECT stream_id,$2,false FROM session.identity_change_streams
WHERE stream_id=$1 ON CONFLICT(stream_id) DO NOTHING;
```

3. Console 设置 `RP_IDENTITY_CHANGES_ENABLED=true`，同时保留 `OIDC_RP_ENABLED`、`RP_IDENTITY_RECOVERY_ENABLED`、`RP_SESSION_EVENTS_ENABLED` 及显式环境。已存在的变化读取流要启用，先验证首次 Cookie 请求可做可信快照+补拉，验证 `/auth/identity-events` 拒绝无签名和错环境，暂不向它发业务事件。未知 kid 使用配置 backchannel issuer 的 `/oidc/jwks`；必须可连且与公开 issuer 一致。
4. auth 设置 `IDENTITY_CHANGE_DELIVERY_ENABLED=true`，要求已经配置 RS256 active signing key；再显式启用已登记 receiver。用一次真实上下文或治理变更验证：outbox/任务同事务、接收后 204、Console 两实例均通知、浏览器读取当前 Cookie、权限视图收敛。
5. 登记前已有变化不自动补造投递；首次恢复建立现行基线。禁用期间的新变化仍入队；超 24 小时进入隔离，恢复登记后按审查步骤重放或使用快照，不抹掉已应用版本。

### 9.2 运行与失败处理

```sql
SELECT r.client_id,d.status,count(*),min(d.available_at),max(d.attempts)
FROM session.identity_change_deliveries d
JOIN session.identity_recovery_streams r USING(stream_id)
GROUP BY r.client_id,d.status;
SELECT source,count(*),min(due_at)
FROM session.identity_time_boundaries WHERE NOT emitted AND due_at<=now() GROUP BY source;
SELECT kind,count(*) FROM session.rp_identity_versions GROUP BY kind;
```

worker 启动补扫、LISTEN 唤醒及 30 秒任务补扫；这些扫描的是持久工作队列，不是产品/页面身份轮询。每次最多 100 个到期边界和 100 条投递任务，剩余积压让出事件循环后继续。每次发送超时 5 秒；429/5xx/网络故障重试；非 204 的其他 2xx/4xx/3xx 隔离且不跟随重定向。401/403 还会暂停 receiver，修复登记/密钥前禁止自动恢复。超窗、隔离和处理失败有安全错误码/日志，不记录 token、响应体或用户资料。

投递队列的 `event_payload` 保存逻辑事件和首投 cursor，不保存签名 JWT。重试重新签发短封套。同 event_id 的事实冲突返回 409；恢复接口重新生成 cursor 不算事实变化。接收端先事务落库再 ACK，ACK 丢失可重投。新请求先读本地持久版本，授权变化一律失效该主体全部缓存；事实读完成后再次比较版本，挡住旧请求回填。暂时故障返回 503，不清 Cookie。

时间边界覆盖订阅开始、结束、试用结束和手工覆盖到期；变更日期会重新排程，删除来源会删除对应待处理边界，重复执行不重复发同一边界。只发失效事件，不修改订阅生命周期状态。通知延迟受 30 秒扫描、队列、数据库和投递影响；实时业务准入仍检查当前状态/日期。

### 9.3 回退与验收边界

回退新链路时先暂停 receiver 和 auth 变化发送，再关闭 Console `RP_IDENTITY_CHANGES_ENABLED`；若同时关闭 SSE，必须先关闭 changes，否则启动会拒绝缺少依赖的配置。保留 logout 恢复、标准退出、既有收据、inbox、版本、outbox 和事实触发器。不能删除数据来规避重放或版本问题。暂停发送会使到期队列暂缓发射，恢复后按已持久期限继续；业务实时判断仍有效。

必须跟踪积压年龄、隔离/暂停接收方、到期队列最老延迟、重建 503、版本表增长、权限事实查询负载及触发器锁等待。当前诊断提供 SQL 和日志，独立指标仪表盘、5000 连接容量认证、生产 key 轮换演练仍待后续完成。

本节为 N1–N3 的验证边界；N4 已补充真实浏览器/本机 nginx 与可选轮询退役，N5 补充独立进程和本机容量证据。目标部署和外部产品仍未验收，不能以此宣告所有门户/产品已无需轮询。

## 10. Console 轮询退役（N4，本地默认关闭）

1. 先完成 §6–§9 的迁移、接收方登记、签名/JWKS、恢复与投递验收；再执行 `2026-12-21-identity-presentation.sql`。该迁移覆盖用户姓名/头像、组织/空间名称和组织主 logo，避免停止轮询后展示字段不收敛。
2. 在目标环境验证退出、上下文、撤权/再授权、资料变化均能通过签名接收/SSE 更新；检查隔离、错绑、代理不缓冲、断线补拉、重启和告警。中央投递暂停/隔离必须有监控处置，不能凭本地 SSE 心跳断言中央健康。
3. 仅对通过验收的 Console 设置 `RP_SESSION_POLLING_RETIREMENT_ENABLED=true`。要求 `OIDC_RP_ENABLED`、`RP_IDENTITY_RECOVERY_ENABLED`、`RP_IDENTITY_CHANGES_ENABLED`、`RP_SESSION_EVENTS_ENABLED` 全为 true；不满足则启动失败。本文不是部署授权。
4. 核对 `/auth/events` 的 200 响应有 `X-Vxture-Session-Sync: events-v1`。当前 Cookie 完整视图确认成功后，页面应停止 300 秒和 focus/visibility 身份刷新；启动/重连后的有限确认读取属于正常恢复。闲置安全时钟继续存在。
5. 空闲至少 650 秒，记录 `/auth/session`、`/api/me`、`/api/tenant-context`、`/api/tenant-context/options`、`/api/capabilities` 请求数：初始收敛后增量应为 0。多标签页分别建立流；正常切标签不应增加身份查询。不要把 25 秒注释心跳或后台持久任务补扫统计成身份轮询。
6. 断线/缺失心跳/读取失败时兼容刷新恢复，SSE 以退避重连。会话聚合总截止 15 秒，任何子视图 503 都保留上次确认身份。重连成功后再停止兼容刷新。
7. 回退时关闭退役开关并重建现有 SSE 连接（已有连接的能力头不会动态改变）。页面回落到旧同步方式。保留恢复表、撤销屏障和接收记录，不清空数据库或 Redis。

本地证据及准确边界见 `docs/70-workplan/120-identity-sync-progress.md` / 110 §12。真实 nginx 传输与实际前端测试使用可控服务端事实；持久链路另以 PG/Redis 集成测试覆盖。它们不能代替目标环境、其他产品或容量验收。

## 11. N5 部署预检、监控与独立进程验收

### 11.1 只读数据库预检

入口为 `scripts/identity/inspect-sync.mjs`，非秘密范围样例为 `deploy/identity-sync/console.example.json`。样例不是部署登记：必须按获准目标核对 clientId、issuer、realm、environment、releaseChannel、logoutUri、receiverUri 七项；禁止从浏览器或请求 Host 推导。HTTPS 为默认要求，仅 dev 允许 loopback HTTP。URL 不含凭据、query 或 fragment；issuer 为精确 origin，不含尾斜杠或路径。省略 realm 仅兼容 customer，平台批配置必须显式填写。

```powershell
# Inject IDENTITY_INSPECT_DATABASE_URL using the target secret mechanism.
node scripts/identity/inspect-sync.mjs --config deploy/identity-sync/console.example.json
node scripts/identity/inspect-sync.mjs --config deploy/identity-sync/console.example.json --prometheus
```

也可在仓库工具中使用 `import { inspectSync, prometheus } from './scripts/identity/inspect-sync.mjs'`。`inspectSync(pool, scope)` 接收已有 pg Pool，不导入或启动 BFF 应用。

预检以 REPEATABLE READ / READ ONLY 事务执行，单语句 3 秒、事务空闲 5 秒、连接 5 秒超时，CLI 连接池上限 1。不修改登记、表结构或任务。部署时使用专用只读凭据，授予所查表的 SELECT 和相应 schema 的 USAGE；不得给它迁移或启用权限。需要读取 appoidc 客户登记、session 的恢复/变化/投递/inbox/版本/时间边界表及系统触发器元数据；相关事实表仅检查触发器定义。

| 退出码 | 输出 / 含义                                               | 采集处理                                                      |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| 0      | 检查通过，`databaseReady=true`                            | 保存结果；仍需下述运行证据                                    |
| 2      | 检查已完成但不就绪，含失败项；Prometheus 输出 readiness=0 | 正常发布本次指标并触发告警，不能当作采集失败丢弃              |
| 1      | 配置、数据库连接、权限或查询失败；stderr 仅安全摘要       | 不输出“健康零积压”；保留上一份指标，由采集失败/时间戳陈旧告警 |

检查覆盖必需表、启用中的事实/展示/通知触发器、客户机密 platform 登记、不可变作用域、recovery/changes/receiver 启用、隔离任务与重试耗尽。错误 issuer、停用 receiver 和停用展示触发器在隔离库有反例验证。表缺失时只输出失败检查，不伪造队列零值。预检不验证函数正文哈希、生产角色完整权限、代码版本、JWKS 轮换、运行开关或目标 URL 可达性；`databaseReady` 不能用作发布成功标记。

### 11.2 指标采集与告警模板

N7 使用 `scripts/identity/collect-sync.mjs` 批量采集，配置样例为 `deploy/identity-sync/platform.example.json`，告警为 `deploy/identity-sync/alerts.example.yml`。批量工具会原子发布所有已配置范围的单份快照，具体退出码与失败语义见 §13.2；§11.1 的单客户端 CLI 保留原行为。目标采集调度、textfile exporter、仪表盘与告警路由尚未安装。采集建议间隔 30 秒且不得重叠，按实际完整批耗时调整；故障检测阈值须配套调整。

指标前缀为 `vxture_identity_`，标签为 client_id / environment / realm / release_channel，不输出 sid、sub、event_id、游标、token 或用户资料。N7 前的双标签指标文件须由新采集器整份替换，避免同一范围并存两种序列：

| 指标后缀                                                              | 含义 / 模板阈值                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `database_ready`、`inspection_timestamp_seconds`                      | DB 预检是否就绪及采集时间；缺失/超过 120 秒陈旧持续 1 分钟告警          |
| `{logout,changes}_pending`、`{logout,changes}_oldest_pending_seconds` | 所选客户端未送达数量及最老事实年龄；超过 60 秒持续 2 分钟告警           |
| `{logout,changes}_quarantined`、`{logout,changes}_exhausted`          | 隔离、仍 pending 但重试窗口已过；非零告警，修复后按已有受控恢复步骤操作 |
| `{logout,changes}_retried_pending`、`{logout,changes}_expired_leases` | 仍在重试的任务、待回收租约；用于诊断，不是累计错误计数                  |
| `global_due_boundaries`、`global_oldest_due_seconds`                  | 全库已到期但未发射的边界；最老超过 90 秒持续 2 分钟告警                 |

全局边界指标虽带所选采集范围标签，其值仍是全库统计；跨客户端汇总取 max，不能求和。告警通过 scope_expected 检查每个配置范围，并单独检查采集完全缺失和采集失败，无需复制 console/prod 选择器。阈值是初始模板，不能当作服务 SLA。数据库不可用时不能用旧数值判断健康，必须同时检查采集状态和时间戳。

这是独立的队列运维观测，不按用户轮询身份。页面无需为指标建立请求；`/healthz` 不增加数据库依赖。SSE 活着只证明 RP 到页面的链路活着，中央发送停机/隔离要靠队列告警发现；因此停止兼容轮询前必须接通告警处置。连接数、重连率、慢客户端、恢复 503、数据库锁等待/写延迟和磁盘增长仍须接入目标运行平台。

### 11.3 可复跑的独立进程验收

```powershell
# Explicit disposable loopback services; never use shared storage.
$env:IDENTITY_ACCEPTANCE_PG_URL='postgres://postgres@127.0.0.1:12620/postgres'
$env:IDENTITY_ACCEPTANCE_REDIS_URL='redis://127.0.0.1:40705'
$env:IDENTITY_ACCEPTANCE_CONNECTIONS='256'
node scripts/tests/identity-sync-acceptance.mjs
node --test scripts/identity/inspect-sync.test.mjs
```

端口为本次隔离运行示例，不是端口分配表。使用已准备的本机 PG/Redis；PG 凭据必须允许创建/删除随机临时数据库。依赖来自当前 workspace 的 auth/Console/iam 安装，未引入额外依赖。连接数须为 32 的倍数，范围 32–512；默认 256。

脚本随机建 `identity_acceptance_<runId>` 数据库、`identity-acceptance:<runId>:` Redis 前缀和临时 RS256 密钥。父进程通过 IPC 传递凭据，独立运行中央恢复 HTTP、发送器和两个 Console 接收/SSE 进程。调用实际 SessionService、仓储、签名/验签、恢复、投递、持久接收和 SSE 源码；仅装配容器与初始登录会话为验收夹具。

覆盖六组：数据库预检及反例、双实例真实 socket 容量/心跳、单实例单 sid 32 条连接边界、接收提交后 ACK 丢失的发送进程强杀、接收进程强杀/发送仍停机时的最新版本恢复、中央标准退出到双实例和相同 Cookie 401。租约测试等待真实 60 秒，不改数据库时间。报告保存到 `output/identity-acceptance/<runId>/report.json`，另存脱敏预检、指标、DDL 哈希和进程日志。脚本正常结束清理自己的进程、临时库和命名空间，不使用 FLUSHDB 或修改共享数据库角色。

本机测量不是 5000 并发/目标环境 P95 认证；未覆盖互动 OIDC 登录/MFA、真实浏览器/目标代理、OS 真正休眠或外部产品。N4 提供独立的实际前端/本机 nginx 证据；两者不能合称为真实线上端到端验收。

### 11.4 逐客户端差距与下一批交付

| 客户端                          | 已核对范围                                                                                                            | 下一批可合并工作 / 退出条件                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Console / customer              | 完整链路与可选轮询退役本地通过                                                                                        | 目标登记/运行开关/签名/代理/告警/容量同批验收；再启用退役                                                                                     |
| Website / customer              | N6 已接入恢复/接收/SSE、完整视图与协商退役                                                                            | 目标登记及真实浏览器/代理验收后启用                                                                                                           |
| Admin、Opera、Arche / workforce | N6 已实现独立事实/退出、三门户接收与协商退役                                                                          | 先迁移并安排旧会话重新登录，再按 workforce 精确登记验收                                                                                       |
| vxtpl → Karda、Arda             | 产品矩阵指定模板先行；本批未验证其接收或页面实现                                                                      | 先成对更新通则/范本的 v0.6 引用，明确 product 类型能力与 scope，再模板接收/恢复/前端验收，按产品逐个迁移；当前 platform-only 恢复限制不能绕过 |
| Atlas / API 基础设施            | 独立仓 `service/src/runtime/guards/jwt-shared.ts` 为 JWT/JWKS 路径；本次未发现浏览器身份刷新入口                      | 核对服务授权与必要吊销机制，不新增浏览器 SSE，也不删除业务定时任务                                                                            |
| Runos / API 基础设施            | 独立仓 `service/src/governance/grant-snapshot.service.ts` 的 30 秒刷新为 product grant 镜像；其他扫描是用量/目录/对账 | 保留业务同步；若要事件化产品授权镜像，另定事实源/恢复契约，不计入本次登录轮询退役                                                             |

Website、workforce、外部产品是三组独立交付边界，可以在各组内合并实现与验证。此次只读核对其他仓库，没有修改产品源码。发布准备可以继续，正式共享迁移、登记启用、提交/推送/PR/部署仍需对应步骤授权。Website 与 workforce 已合并入 N6 平台全入口批，实施边界与上线次序见 §12。

## 12. N6 平台全入口部署与回退

N6 将 Console、Website、Admin、Opera、Arche、Accounts、Workbench、Customer Portal 一起接入；代码、接口、代理样例及本地验证一并交付。v0.7 契约见 [150 §2.8](../30-design/identity/150-event-sync-api.md#28-n6-平台全入口与运营域v07本地实现默认关闭)，逐项进展见 [120](../70-workplan/120-identity-sync-progress.md)。默认全部关闭，未执行任何共享迁移或发布。

### 12.1 上线次序与登记

1. 在目标库执行前序身份迁移，再执行 `2026-12-22-identity-workforce.sql`。**新代码即使关闭运营开关，也依赖客户投递表新增 realm 列，必须先迁移。** 新库对应 DDL96，迁移与新库定义一致。预检确认 7 个运营事实触发器、中央通知触发器、门户绑定触发器均启用。
2. 上线 auth 与 RP，先保持功能开关关闭。运营批次启用 `WORKFORCE_IDENTITY_SYNC_ENABLED=true` 前安排存量运营人员重新登录；Redis-only 历史会话不能转换为持久授权事实。所有 auth 实例必须使用一致开关，不能让旧实例继续签发无持久记录的运营会话。
3. 每个客户端按 issuer/client_id/realm/environment/release_channel/logout_uri/receiver_uri 精确登记并预检；参考 §6/§8 的 SQL 时将 customer 显式替换为该客户端已核验的 realm，不能仅换 URL。workforce 必须是 platform 机密客户端。预检 JSON 中传 `realm: "workforce"`；省略只默认 customer，不推断身份域。
4. 启用 RP_RECOVERY → CHANGES + SESSION_EVENTS → 最后 POLLING_RETIREMENT。实际变量全名为 `RP_IDENTITY_RECOVERY_ENABLED`、`RP_IDENTITY_CHANGES_ENABLED`、`RP_SESSION_EVENTS_ENABLED`、`RP_SESSION_POLLING_RETIREMENT_ENABLED`，并设置 `RP_IDENTITY_ENVIRONMENT=prod|beta|dev`。不完整组合启动失败。Accounts 使用独立 `ACCOUNTS_SESSION_EVENTS_ENABLED`，运营流同时要求中央 workforce 开关。
5. 各入口通过真实登录/MFA、跨标签、撤权/改密、代理断流及恢复验收后才启用退役。验证正常闲置不产生身份查询；保留普通业务刷新、真实请求授权检查和闲置退出。

### 12.2 独立 RP 数据库与代理

Workbench 和 Customer Portal 使用 `RP_IDENTITY_DATABASE_URL` 独立连接存储本地收据/inbox/版本。DDL97/2026-12-22 迁移创建无密码的 `svc_rp_identity`：只授予 session schema 使用及这三张表的必要读写；不授予账号/组织/业务表写入，不复用只读业务角色。凭证由目标环境配置。共享角色适用于平台可信 BFF；不向外部产品授予平台库连接。

Website、Admin、Opera、Arche、Workbench 的 /auth/events 与 Accounts 的 /oidc/session-events 使用 HTTP/1.1、关闭缓存/缓冲/gzip、75 秒读取超时。Customer Portal 经过 Next.js 转发：25 秒只约束 SSE 建连，响应体继续透传并跟随请求取消；/auth/identity-events 独立允许 64 KiB，其他认证请求保持原限制。客户门户读取其既有独立 Cookie，host/发布绑定/成员检查仍为业务访问前提。

### 12.3 回退与验收边界

先关闭各 RP 的轮询退役开关，断开现有流以触发浏览器恢复兼容检查，再逐步关闭流/变化功能；保留持久撤销收据、版本、outbox 和迁移结构。中央已撤销会话不能复活。关闭 workforce 持久校验会改变授权依据，不是无风险的 UI 开关：必须排空运营会话并统一 auth 实例后按发布方案操作。

本地复验：双 Console 进程 256 连接，通知 P95 817 ms、心跳身份读取增量 0；发送进程 inbox 提交后强杀、真实 60 秒租约重投、接收进程强杀/发送停机恢复、退出终态全部通过。它证明共享后端链路，不替代八个入口的目标代理、互动登录/MFA、跨产品与生产容量认证。验收报告见 `output/identity-acceptance/739ac4e8fd1a401e9f706e2d548698d9/report.json`。

外部通则/范本仍须在发布前成对补充 v0.7 引用；独立产品接入、目标监控告警及发布是下一组合步骤。不得把本地通过标为已上线。

### 12.4 BFF 工程名称与部署配置（2026-11-25）

Workbench 使用 `bff/workbench-bff`、`@vxture/bff-workbench`、`platform_bff-workbench`。
租户组织门户使用 `bff/tenant-bff`、`@vxture/bff-tenant`、`platform_bff-tenant`。
前端 `portals/customer-portal` 与领域服务 `@vxture/service-customer-portal` 的对应关系见 [BFF 架构](../30-design/architecture/05-bff-layer.md#1-location--packages)。

- 专属配置源为 `/srv/vxture/runtime/.env.tenant-bff`；部署脚本和 nginx 同步脚本使用同一默认文件，显式覆盖入口仍为 `CUSTOMER_PORTAL_ENV_FILE`。
- 配置模板见 `deploy/.env.customer-portal.example`。镜像使用 `TENANT_BFF_IMAGE`，前端与 BFF 共用 `TENANT_BFF_TOKEN`；Compose 为前端注入 `TENANT_BFF_URL`，为 BFF 注入 `TENANT_BFF_PORT`。必填项缺失即启动失败，不读取兼容别名。
- 专属工作流 `customer-portal-build.yml` 产出 `customer_portal_frontend` 与 `platform_bff-tenant`；Compose 和 `36-deploy-customer-portal.sh` 管理这一对镜像。新 BFF 不加入平台主镜像发布集合。
- 发布前须同时准备新前端、新 BFF 与上述配置文件，执行脚本的 `check`；nginx 同步也须读取同一配置源。`check`、部署及回退均拒绝非 `platform_bff-tenant` 仓库的 BFF 镜像；已有容器的 BFF 镜像也必须通过校验后才能进入托管升级。跨命名版本迁移须单独制定切换方案，不能将新配置与其他身份的旧镜像混用。
- 回退仅在使用该配置契约的一对不可变镜像之间执行。不会还原旧配置/旧秘密，也不回退数据库迁移。
- OIDC client、Cookie、Redis key、HTTP 头和 `svc_customer_portal` 等仍标识客户门户业务契约；业务数据库和 Redis 连接变量也沿用 `CUSTOMER_PORTAL_DATABASE_URL`、`CUSTOMER_PORTAL_REDIS_URL`。它们不作为 BFF 包、目录或镜像名。

本批仅完成仓库命名与本地验证。目标环境文件、镜像、登记及发布尚未修改，执行上线时按本节配套切换。

## 13. N7 本地发布准备包（2026-11-25）

本节交付登记计划生成、七 RP 批量预检/指标、告警验证及八入口验收步骤。所有示例配置均需替换并复核为目标环境，`platform.example.json` 使用 `example.test`，不是实际部署登记。Accounts 是中央入口，不伪造第八个 RP 登记。

### 13.1 一份范围配置生成登记计划

1. 以 `platform.example.json` 为格式，明确七个 RP 的七维作用域。Console/Website/Workbench/Tenant 属于 customer，Admin/Opera/Arche 属于 workforce；Tenant 的 clientId 仍是实际登记的 `customer-portal` 或环境变体。
2. 核对目标 issuer、已登记客户端和端点、realm、环境与通道。环境不从域名推断；同一数据库内每个 client 仅有一个不可变恢复绑定。
3. 离线生成 SQL 并审阅：

```sh
node scripts/identity/prepare-registration.mjs --config runtime/identity-sync/scopes.json > output/identity-registration.sql
```

该命令不读取数据库凭证、不连接或执行 SQL。生成的事务核对 active/platform/机密客户端、realm、通道和既有退出地址，再创建默认禁用的 recovery/changes/receiver。重复执行不重复登记、不启用也不禁用既有记录；作用域或接收地址冲突令整个事务失败。客户端、密钥和迁移仍按既有流程准备，不能用此计划补造客户端或重新绑定待投队列。

应用是独立发布步骤：先审阅实际目标配置和 SQL，在已迁移目标库用发布凭据执行，SQL 客户端必须遇错停止（例如 `psql -X --set ON_ERROR_STOP=1 --file ...`）。本批只在随机命名的本机隔离数据库验证了生成 SQL，未对目标环境执行。

### 13.2 批量采集与故障语义

```sh
# Inject IDENTITY_INSPECT_DATABASE_URL through the target secret mechanism.
node scripts/identity/collect-sync.mjs --config runtime/identity-sync/scopes.json --output runtime/metrics/identity-sync.prom
```

输出目录需事先存在；使用专属 `.prom` 文件，单写者目录锁、同目录临时文件和 rename 原子发布，最大 32 个范围，单连接顺序采集。部署调度器负责重复调用，应用和浏览器不参与采集。

| 结果                                 | 退出码       | 指标文件与处理                                                                                                    |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 全部可读且就绪                       | 0            | 原子发布完整快照，仍需运行/浏览器证据                                                                             |
| 可读但登记、迁移或任务不就绪         | 2            | 正常发布 `database_ready=0` 和失败项，不丢弃本次观测                                                              |
| 某个范围数据库不可用                 | 1            | 正常发布整批快照；该范围 `collection_success=0`，不输出其 queue/readiness/inspection 时间戳；其他范围保留本次结果 |
| 配置错误、锁冲突、写盘失败或进程中断 | 1 或进程失败 | 不覆盖上一份完整快照；通过陈旧/缺失告警发现，不把旧数据当最新健康数据                                             |

每个范围固定输出 `scope_expected=1`、`collection_success` 和 `collection_timestamp_seconds`；只有成功读取才输出 inspection 时间戳和数据库指标。stdout 为脱敏结果，stderr 不带原始数据库错误。队列统计约束 realm/channel/已登记端点；缺少 realm 迁移列会报告不就绪，不运行依赖该列的队列查询。

进程被强杀可能留下 `.prom.lock`；工具不会按超时抢锁。确认该文件没有在运行的写者后，由运维移除这一个锁目录再恢复。配置变更通过下一次完整快照替换移除不再采集的范围；发布检查必须确认七个 RP 齐全，不能通过删除配置来消除告警。

### 13.3 七类告警、八种本地演练与看板接线

```sh
promtool check rules deploy/identity-sync/alerts.example.yml
promtool test rules deploy/identity-sync/alerts.test.yml
```

本地覆盖无采集、健康、陈旧、数据库不可用、登记/迁移不就绪、积压、耗尽重试和到期延迟八种场景。实际告警接线需验证：采集文件被 exporter 读取、Prometheus 同时抓到七组四维标签、规则持续时间正确、告警路由和恢复通知实际到达。这里只验证规则，不发送消息。

看板至少按四维标签显示采集成功/新鲜度、database_ready、pending 数、最老 pending 秒数、quarantined/exhausted；全局到期边界取 max。保留实例标签用于定位多个采集器。收到告警先看采集是否可用，再查登记/队列，不清理会话或队列来使指标归零。

### 13.4 八入口目标验收矩阵

每行都记录目标版本/digest、实际 origin、执行时间、操作者和证据位置。2026-11-25 已完成 §17 的生产镜像、协议和公开代理检查；下表的完整行为验收仍单列，不能用本机 SQL、HTTP 或规则测试替代。

| 入口      | 身份域 / SSE 地址                                     | 必须核验的特殊边界                                             | 目标状态     |
| --------- | ----------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| Console   | customer / `/auth/events`                             | 完整权限与上下文视图，切组织/工作区和撤权收敛                  | 待验收       |
| Website   | customer / `/auth/events`                             | 当前 Cookie 资料、匿名状态、登录/退出及账号展示                | 待验收       |
| Admin     | workforce / `/auth/events`                            | MFA、运营角色/权限、安全变更持久退出                           | 待验收       |
| Opera     | workforce / `/auth/events`                            | 平台平面隔离、权限撤销、运营退出                               | 待验收       |
| Arche     | workforce / `/auth/events`                            | 平台平面隔离、权限撤销、运营退出                               | 待验收       |
| Workbench | customer / `/auth/events`                             | 固定原组织/工作区；中央上下文不能越界切换                      | 待验收       |
| Tenant    | customer / `/auth/events`                             | 发布 hostname、租户/成员绑定、Next.js SSE 透传及 Tenant 配置名 | 待验收       |
| Accounts  | customer + workforce / `/oidc/session-events?realm=…` | 分别验证 vx_sid/vx_sid_op、同 UUID 两域隔离、改密/MFA 后退出   | 两域均待验收 |

每个入口按同一顺序执行：真实登录（需要时含 MFA）→ 两标签且一页隐藏 → 资料/权限变化 → 主动退出/强制下线 → 新登录后旧标签重读 Cookie → 代理断流/进程重启后恢复 → 真实系统休眠唤醒 → 禁用轮询退役开关后恢复兼容。验证通知后重新读取完整视图；401 退出、503 保持展示但拒绝未完成授权的请求；事件和心跳均不能续期或直接授权。

代理证据须包含 SSE 协商头、禁缓冲/缓存、HTTP/1.1 和超时配置，以及连接稳定期间没有周期身份请求的网络记录。平台采集器查队列不属于浏览器身份轮询；验收时分别统计。

### 13.5 分阶段启用与回退包

| 阶段   | 成组动作                                                                                        | 进入下一阶段的证据                                              |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| A 准备 | 精确目标配置、不可变镜像对和前版 digest；前序迁移至 2026-12-22；SQL 登记默认禁用；采集/告警接线 | 迁移/范围检查通过；禁用登记阶段 database_ready=false 属于预期   |
| B 部署 | 上线 auth 和七 RP，轮询退役保持 false；Tenant 镜像/配置成对切换；运营域启用前安排重新登录       | 实际版本、运行变量、密钥/JWKS、基础登录及代理核验               |
| C 事件 | 按 §12.1 启用持久恢复、receiver/changes、发送及 SSE；运营开关与 Accounts 开关独立核对           | 七 RP 预检通过；Accounts 双域真实会话通过；无隔离/耗尽/陈旧指标 |
| D 退役 | 已通过矩阵的入口逐个开启 POLLING_RETIREMENT，观测实际流量和告警                                 | 各入口正常闲置身份查询为零，故障仍能恢复；保留有时间戳的证据    |

回退先关闭受影响入口的轮询退役，断开旧流以恢复兼容读取，再按 §12.3 暂停事件功能；保留持久撤销、inbox/版本和队列。代码回退只使用同一配置/迁移契约的不可变镜像；Tenant 还必须通过 §12.4 的镜像身份校验。运营身份校验不能混跑新旧实例或恢复旧 Redis-only 会话，须按统一版本与重新登录方案处理。

本地准备完成后仍待：确定目标环境与发布范围、实际目标预检、八入口九组身份域验收、告警送达、灰度观测及发布。外部产品和通则/范本仍按原计划另行接入。

## 14. N8 八入口本地浏览器联调（2026-11-25）

用户选择继续本地联调，暂不连接目标环境。证据保存在 `output/playwright/identity-n8/`；这里的通过状态不更新 §13.4 的目标验收列。

### 14.1 联调边界与复跑顺序

每个入口使用独立的 loopback 动态端口。浏览器请求限制在 `127.0.0.1`；Cookie 为专用的合成 HttpOnly Cookie，后端只提供可控 HTTP/SSE 事实，不连接数据库、IdP 或外部产品。浏览器实测使用真实时间，未加速定时器。构建报告保存全部打包输入和原始组件 SHA-256。

| 入口                          | 实际运行的代码                                             | 展示边界                                                       |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Console / Admin               | 原始 Provider、API 聚合器、SDK、idle watcher               | 子组件输出 context                                             |
| Opera / Arche                 | 原始 Provider、身份/权限双读、SDK、idle watcher            | 子组件输出 context                                             |
| Website                       | 原始 AuthSessionBootstrap、Axios API、Zustand store、SDK   | pathname 固定为 `/`，输出 store                                |
| Accounts customer / workforce | 原始组件会话 hooks、各域 API、请求期限、SDK                | 构建时截断后续展示；菜单/过期通知和语言 hooks 使用稳定替身     |
| Workbench                     | 原始组件会话 hooks、loadWorkData 全部请求/解析、SDK        | 保留会话及前置 effects，省略后续应用交互；locale/pathname 替身 |
| Tenant                        | 原始 WorkspacePage 会话 hook、workspace 请求/形状检查、SDK | 仅省略筛选与展示；初始属性由本地服务提供                       |

构建使用明确的源码截断标记，找不到标记即失败；保留部分不重写会话逻辑。截断后的模块单独保存，便于核查。以上不覆盖 Accounts 外层壳的跳转实现、完整页面交互、真实登录/MFA、跨域 Cookie 策略、Next.js/目标 nginx 转发、操作系统休眠或实际授权裁决。

复跑顺序：`build.cjs` 打包 → `server.cjs` 启动九个动态端口 → Playwright CLI 命名会话 → `initialize.js` → 真实空闲至少 310 秒 → `idle.js` → `scenarios.js` → `stall-start.js` → 等待读取期限生效（至少 16 秒）→ `stall-recover.js` → 真实等待至少 80 秒 → `stall-finish.js` → `report.cjs`。使用 `run-cli.cjs` 传递多行代码，避免 Windows shell 再解释引号；CLI 路径需按本机安装位置调整。一次运行只使用本次 `server.json`，结束后关闭专属浏览器并停止该文件记录且命令行匹配的本机 Node 进程。

主要判据：协商成功且完整视图确认后，300 秒身份定时器与焦点重读消失；事件触发事实重读；503 保留身份并恢复兼容；恢复后重新协商；新 Cookie 优先于旧流；新登录标签触发旧标签重读；确定 401 后双标签退出；204 或无协商头的旧流继续保留兼容读取。业务时钟与闲置退出定时器不属于身份轮询。

### 14.2 本次结果与下一步

九组初始化与 126 项行为检查通过：99 项组合场景、9 项空闲/焦点、9 项读取期限恢复、9 项无心跳恢复。真实空闲 338–339 秒，每组额外请求为 0；无心跳 100–108 秒，每组重连 1 次且保持身份。完整结果在 `output/playwright/identity-n8/report.json`，构建输入指纹已在验收结束时核对。

本批没有新增生产实现或变更接口契约，不重复 N6/N7 已通过的后端存储与容量检查。下一本地合并包连接实际 BFF、Next.js/本地代理和完整页面；目标环境的 §13.4 仍全部待验收，不能用受控事实填写真实登录/MFA、代理或发布结论。

## 15. N9 两入口完整本地链路（2026-11-25）

### 15.1 组成与可复跑边界

本地工具和证据在 `output/playwright/identity-n9/`。`build.cjs` 从当前源码构建 Workbench / Tenant BFF 与中央验收服务，并复制两套完整前端；`next-deps.cjs` 只修复隔离副本的依赖链接，设计系统使用本仓锁定的 12.17.0。`runtime.cjs` 创建随机验收库、应用 33 份 DDL、启动独立 Redis、真实 BFF、Next dev 和 nginx，记录所有本次端口及所有者。只注入合成账号/成员/发布绑定/中央会话与 RP Cookie；不读取原工程 `.env`，也不执行互动登录。

浏览器经 HTTPS loopback 访问，专属浏览器会话忽略本地自签证书；不修改系统信任或 hosts。Tenant 代理向 Next 传递精确的已登记 Host；服务端投递使用专属 loopback HTTP nginx 入口，再经 Next 转发。不能把回调登记为私有 Tenant BFF 的 `/auth/backchannel-logout`：该路由还需要可信代理凭据和已发布 host，会按设计拒绝直连。

复跑顺序：确认专属本机 PG 可用 → `build.cjs` → `next-deps.cjs` → `runtime.cjs` 就绪 → Playwright CLI 专属会话 → `initialize.js` → `scenarios.js` → `boundaries.js` → `denial-regression.js` → `report.cjs`。修复后需从 `reset.js` 恢复本次合成数据与两个页面，再运行场景；各脚本由 `run-cli.cjs` 传参，CLI 和本机二进制路径需按安装位置调整。以 `runtime.json` 当前 runId/端口为准，不混用历史 Cookie 或库名。

### 15.2 验收判据与已知边界

- 真实资料变更必须产生持久 inbox，四个完整页面随后重读；两个 BFF 重启不能直接清除有效身份，重连后仍能接收变更。
- 中央撤销必须让两 RP 的旧 Cookie 均返回 401，并使四个标签退出。成员撤销必须拒绝领域访问；Workbench 的 403 清除旧视图，同时保持事件订阅以支持再授权。
- Tenant 的 Next 转发保留协商与 SSE 内容；本次收到 25 秒连接期限之后的真实心跳。四标签真实空闲超过 31 秒并触发焦点事件，新增身份请求 0，中央恢复查询增量 0；N8 的 338–339 秒长空闲证据另行保留。
- 伪 JWT/退出令牌、错误媒体类型、超限内容、无私有凭据、未知 host 均拒绝；数据库停用门户后两个 Tenant 标签离开工作区，接口返回 404。
- 原 Workbench 错误将 403 当作故障保留旧数据；`denial-before-fix.json` 为失败证据，`denial-regression.json` 为修复后的双标签撤权/无重连/再授权结果。

本批 29 项行为检查及两入口初始化通过；51 项既有前端回归和 strict TS 通过。完整当前源码、原始构建指纹、修复前后指纹、截图、日志和汇总报告保存在证据目录。开发 HMR 的 Upgrade 未转发，会有开发工具请求 404；不把它算作身份链路失败或生产代理结论。语言与活动池未配置的 503、未授予账务权限的 403 不代表相关业务功能完成验收。

结束时先关闭 `identity-n9` 浏览器，再向本次 loopback 控制服务发送 `stop`，等待状态 `stopped`；它仅停止自有子进程、删除精确随机验收库并清理本批新增角色。若 PG 本批启动，最后使用其精确 data 路径停止，并验证端口/进程和验收库清理。不得为清理测试进程使用全局 Node/数据库强杀。

目标环境 §13.4 继续待验收；N10 承接其余六入口完整本地链路。没有 Git 提交、共享迁移、监控外发或发布。

Workbench 的语言偏好仍有独立焦点同步：`/auth/language` 请求单独记录，不属于本批登录状态/权限轮询统计，也未宣称全页所有网络请求为零。

## 16. N10 六入口完整链路与运营域配置（2026-11-25）

证据与工具位于 `output/playwright/identity-n10/`。六个实际 BFF（含完整 Auth）与六套完整页面分客户/运营组启动；33 份 DDL、随机 PG 库、独立 Redis、本机 nginx 与浏览器 allowlist 隔离。按 build → runtime → setup → accounts/customer/customer-scenarios → workforce/workforce-scenarios → boundaries/final-state → 清理 → report 顺序执行，使用本次 runtime.json 的端口与所有权。夹具使用合成会话；不读取工程秘密或代替互动 OIDC/MFA。

运营 RP 必须在恢复 authority、变化 authority、验证器及 SSE hub 四处一致使用 realm=workforce。仅修验证器不足：错误接收作用域会返回 503，错误 hub 作用域会丢弃运营通知。Admin、Opera、Arche 已补齐变化 authority 与 hub 参数，并在真实签名投递、撤权恢复和退出链路验证。

本批 32 项行为检查、35 条变化/5 条退出投递、三个模块类型/Lint/格式及源码指纹全部通过。客户/运营同 UUID 独立隔离，完整页面在事件后收敛；语言偏好和通知业务读取单独计数。Website 检查真实 API 重读，菜单展开展示不在结果内；最终登录落点受本地浏览器 allowlist 限制。

清理仅针对记录且命令行匹配的 Next 子进程树、运行器拥有的 BFF/Redis/nginx、精确随机验收库及新增角色；运行器停止后再停本批启动的 PG。不要全局强杀 Node。生产矩阵 §13.4 仍需目标证据；最新授权已允许进入 N11 发布阶段。

## 17. N11 生产运行记录与后续门禁（2026-11-25）

### 17.1 当前版本和开关

主平台 v0.33.17 / `9b569005` 已部署；独立 Tenant 前端/BFF 为同树源码 `e9b3fb0` 构建的 digest 对，完整引用见 [120 N11](../70-workplan/120-identity-sync-progress.md)。18 个应用容器全部健康。精确八份迁移、停写后备份及 PostgreSQL 18 owner/ACL 恢复验证已完成，保留加法结构与原事实。

七 RP（Console、Website、Admin、Opera、Arche、Workbench、Tenant）使用 `RP_IDENTITY_ENVIRONMENT=prod`，RECOVERY、CHANGES、SESSION_EVENTS 均 true，POLLING_RETIREMENT 均 false。Console 还必须设置 `OIDC_RP_ENABLED=true`。Auth 的 WORKFORCE_IDENTITY_SYNC、ACCOUNTS_SESSION_EVENTS、IDENTITY_CHANGE_DELIVERY 均 true。三个运营 RP 的 realm 为 workforce，历史 Redis-only 运营会话需重新登录，不能以旧缓存伪造持久身份或 MFA。

七 RP 的机密恢复协议通过，5 条真实变化投递完成；18 项公开首页/匿名事件边界检查与标准运行态检查通过。真实浏览器验证 Console/Workbench 既有登录页面、Tenant 品牌页及登录跳转；没有完成用户验证码/MFA、生产撤权/改密或完整跨标签退出测试，§13.4 不标为完整通过。轮询退役须等待该矩阵的实际证据，Accounts 的双域推送已上线也不等于整站停止所有查询。

### 17.2 部署及回退顺序修正

- 先在运行态完成镜像解析及 Compose 只读预演，再进入迁移停写窗口。若停写后预演/发布失败，及时按备份容器清单恢复已有应用服务，保留加法迁移；不能让生产无限等待工作流，也不能通过回灌数据库覆盖后续真实写入。
- Docker/Buildx 使用部署账号；需要 root 执行的独立备份操作不要以该账号的 DOCKER_CONFIG 运行 Buildx。若已出现该目录下单个状态文件属主漂移，检查真实属主后精确修复；不要输出登录凭据或整体放宽目录权限。本次仅修复 `buildx/current`。
- Tenant 命名迁移时，新 `.env.tenant-bff` 必须在 nginx 读取 CUSTOMER_PORTAL_HOSTS 前就绪；完成成对切换后运行 `20-sync-nginx-config.sh`，验证精确域名 vhost、`nginx -t`、公开页面和 `/auth/events`。缺少精确 vhost 会落入拒绝未知子域的通配规则，HTTP/2 可能表现为协议错误，不能凭容器健康判定入口可用。
- 主平台 31 流程会回收没有容器引用的 `platform_*` 镜像，可能回收预拉取但尚未启用的 Tenant BFF；Tenant 切换前重新核对两个 digest 的本机存在性，必要时按既定 digest 拉取。不得更换为浮动 tag 或放宽旧 BFF 身份 guard。
- 原版本镜像、配置及数据备份保留在 `/srv/vxture/backups/identity-20261125/`。应用回退先恢复兼容读取，保留持久撤销与事实；Tenant 必须保持镜像/compose/env 成对恢复。原镜像可能已由标准流程清理，不能只假设它仍在 Docker cache，应先核验备份与所需镜像。

### 17.3 主机采集与剩余验收

主机 `vxture-identity-observer.service` / `.timer` 每 30 秒运行，专用 `svc_identity_observer` 默认只读；七个范围必须完整。输出在 `/srv/vxture/runtime/identity-sync/identity-sync.prom` 与 `status.json`，包含采集时间、就绪状态和有范围的队列指标。service 失败或快照超过 120 秒必须按不可用处理，不可把旧的健康文件当现状。用 `systemctl show vxture-identity-observer.service -p Result -p ExecMainStatus`、timer 状态和快照时间共同检查；日志仅写本机 journal。

这不是 Prometheus 抓取或外部告警送达，后两项尚未接线。本次没有发送邮件、聊天通知或替用户完成验证码/MFA。当前剩余合并批为：完整目标浏览器矩阵 → 按入口开启轮询退役并记录正常闲置请求 → 外部告警接线/演练 → 独立产品接入。外部产品 #726/#731 与通则/范本引用仍分别保留待办，平台上线不能替代产品侧迁移。

## 18. N12 部署工具加固（2026-11-25）

本节替代 §17.2 中依靠人工重拉 Tenant 候选镜像的临时处理。主平台镜像清理仅接受本次 `compose.platform.yml config --images` 声明的完整仓库名；运行中和停止容器引用的镜像、其他栈的候选/回退镜像，以及同时具有外部仓库别名的镜像均保留。取消全局 dangling prune；容器、Compose 或镜像清单任一读取失败则跳过清理，不使用部分清单作删除依据，也不使用强制删除。独立 Tenant 发布仍由 36 脚本管理。

Nginx 同步发现已有 `customer-portal-*.conf` 或 `runtime/customer-portal-releases/current` 时，必须读到 `.env.tenant-bff` 中非空且合法的 `CUSTOMER_PORTAL_HOSTS`。指定的 env 路径不存在也会拒绝。拒绝发生在 compose 写入、站点清理和 reload 之前；未安装门户的新主机仍可不配置租户入口。停用已有门户必须走明确的退役操作，不能通过删除配置文件或清空主机列表隐式完成。`NGINX_CONFIG_DIR` 用于隔离配置检查，生产默认路径不变。

30 脚本成功时清理临时预演目录；失败时保留本次 `vx-stack-plan.*` 目录，并打印路径及退出码。目录权限 0700，日志和 pin 文件 0600。Compose 配置错误的 stderr 与预演的 stdout/stderr 只留主机私有文件，不写入 CI 输出。原始诊断可能含凭据，不上传或粘贴到问题单；由部署账号在主机内检查，脱敏后归档证据，再按精确路径清理。临时目录不替代正式备份，也不保证跨重启持久。

验证覆盖独立 Tenant 候选/回退镜像、跨仓库别名、停止容器、部分清单失败、已安装入口缺文件/缺主机键/空主机列表、Compose 失败日志权限与输出脱敏。20 个部署脚本测试全部通过；环境审计测试通过。首次 Linux 整组执行暴露旧 Ruyin 预检夹具读取宿主真实路由，已改用隔离配置目录后通过。真实生产复查在 10:09 CST 确认 18 个应用容器健康且 digest 匹配、七范围采集健康无延迟、18 项公开边界通过；这些检查不替代 §13.4 的完整互动验收。
