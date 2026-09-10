-- 2026-09-28-product-onboarding-configurable.sql
-- 产品接入配置化：边缘上游 + webhook 密钥落库（owner 2026-09-10「零代码改动上线产品」）
--
-- ── 为什么要这两列 ──
-- 接一个 L3 智能体，平台侧此前还剩三处**每次都要改代码**：
--   ① 边缘 vhost —— 每产品一个手写 conf 进仓 + 发版；
--   ② webhook 密钥 —— 解析器是 `process.env[ref]`（provisioning.module.ts），
--      每个新产品都要往容器环境塞一个 `{CODE}_PROVISION_WEBHOOK_SECRET`；
--   ③ 计量指标 —— 只有 seed 有写入口。
-- ①②靠这两列去掉；③不需要新列（`product.product_metrics` 表本来就在，缺的只是
-- 一个写入面）。产品行、OIDC 客户端、webhook 地址、套餐、上架检查项**早就是**
-- opera / admin 页面上的操作，不在此列。
--
-- ── edge_upstream ──
-- 智能体在 tailnet 上的 `host:port`。边缘那份 `*.vxture.com` 兜底 vhost 用
-- `map $host` 查它；精确 server_name 的 vhost（arda/atlas/karda/runos/vxtpl 与
-- 平台自己那几个面）按 nginx 自己的匹配优先级照旧压过通配，**一个都不用迁**。
--
-- 放在 product_webhooks 而不是新开一张表：这张表已经不只装 webhook（`home_url`
-- 就不是），它实际是「产品的端点登记」，每产品至多一行。多开一张表会让 opera 那个
-- 页面多一节、多一次往返，换不来任何东西。表名是历史债，本次不改名——改名要动
-- 的是 FK、seed、四个消费方，与本次目的无关。
--
-- ── webhook_secret_enc ──
-- AES-256-GCM 密文（`v1.<iv>.<tag>.<ct>`，与 admin.operator_mfa.totp_secret 同一
-- 格式与同一实现）。**注意它和 client_secret 不是一回事**：OIDC 的 client secret
-- 存哈希就够（只需验证），而 HMAC 签名密钥**必须能还原原文**，哈希不可用。
--
-- 主密钥走 env（`PLATFORM_WEBHOOK_ENC_KEY`），但它**只有一个、永不随产品增长**——
-- 这正是与旧做法的区别：旧做法是每产品一个 env 键，接一个智能体就得改 .env 并
-- 重新部署；现在密钥由运营者在 opera 页面上填，密文落库，容器环境一动不动。
--
-- `webhook_secret_ref` 保留不删：存量产品（karda/arda/vxtpl）还在用它，投递侧
-- 优先读密文、读不到回落到 ref→env。等存量都迁完再另行退役——一次迁移里既加新路
-- 又拆旧路，出问题时分不清是哪一半。
--
-- 幂等：两条 add column 都带 if not exists；GRANT 重跑无副作用。

alter table product.product_webhooks
  add column if not exists edge_upstream varchar(128);

comment on column product.product_webhooks.edge_upstream is
  'tailnet 上的 host:port；边缘 *.vxture.com 兜底 vhost 按 $host 查它。空 = 该产品不走通配兜底（自带精确 vhost，或尚未接入边缘）。';

alter table product.product_webhooks
  add column if not exists webhook_secret_enc text;

comment on column product.product_webhooks.webhook_secret_enc is
  'provisioning webhook 的 HMAC 密钥密文（AES-256-GCM，v1.<iv>.<tag>.<ct>）。主密钥 PLATFORM_WEBHOOK_ENC_KEY。为空时投递回落到 webhook_secret_ref→env 的旧路径。';

-- 形状校验：host:port。写错了要在**登记的那一刻**报出来——渲进 map 之后才发现，
-- 症状是 nginx -t 失败或整段边缘配置不生效，那时已经离开登记现场了。
-- 允许 IPv4/主机名 + 端口；不允许协议前缀、路径、空格。
alter table product.product_webhooks
  drop constraint if exists chk_product_webhooks_edge_upstream;
alter table product.product_webhooks
  add constraint chk_product_webhooks_edge_upstream
  check (
    edge_upstream is null
    or edge_upstream ~ '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$'
  );

-- 列级锁（TD-018）：98 是**白名单** GRANT——新列不写进去，platform_svc 就 UPDATE
-- 不了它，而症状是生产上一句 42501、整条事务回滚。98_column_locks.sql 同步已改。
REVOKE UPDATE ON product.product_webhooks FROM platform_svc;
GRANT UPDATE (home_url, webhook_url, webhook_secret_ref, edge_upstream, webhook_secret_enc, updated_at)
  ON product.product_webhooks TO platform_svc;

-- product_metrics **一个字都不改**。它的写入面是应用层的事（opera 新增读写端点），
-- 表结构不用动；而 98 里它的 GRANT 已经覆盖了运营者会改的每一列
-- （product_id / metric_key / merge_strategy / consume_mode / metric_unit / reset_period）。
-- 这里原本写了一条「补 GRANT」，实际会把现有白名单**收窄**（漏掉 product_id）——
-- 白名单型的 GRANT 是全量替换，不是追加，重写一遍就等于按新列表重新授权。
