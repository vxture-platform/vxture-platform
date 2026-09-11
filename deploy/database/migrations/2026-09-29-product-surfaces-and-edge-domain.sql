-- 2026-09-29-product-surfaces-and-edge-domain.sql
-- 接入配置补齐四件（owner 2026-09-11 走查）
--
-- ① 可露出的端（product_surfaces 关系表）
-- ② 边缘域名（product_webhooks.edge_domain）—— 推导不再是唯一规则
-- ③④ icon_url / logo_url / post_logout_redirect_uris 的**列已存在**，本次只补列锁
--     与写入面（应用层），不动表结构。
--
-- ══ ① 可露出的端 ══
-- owner:「平台 N 个产品，但 ruyin 可同步使用的 M 个产品，不是每个都能到 ruyin 端」。
-- 这是**产品自身的形态属性**，与租户无关（owner 明确）。要按租户开关的是权益，
-- 那挂在订阅 / 套餐上。
--
-- **键是「端类型」不是客户端凭据**：一个端可能有多套凭据（iOS / Android 是两个
-- OIDC 客户端），但产品支持的是「移动端」这一件事；反过来换一次凭据也不该让产品的
-- 形态属性跟着晃。
--
-- **也不加 `is_ruyin_available` 这种列**：把具体客户端的名字焊进结构正是
-- `APP_SCOPE_CODES` 犯过的错（那个集合今天明写着 "products never join it going
-- forward, they only leave"——退不掉也扩不了）。
--
-- 用关系表而不是 `text[]` 列：端 × 产品几乎一定会长出属性（某端只开子集功能、
-- 各端上架时间不同）。关系表现在不多花什么，以后不用拆。
--
-- ══ ② 边缘域名 ══
-- 此前域名**全靠推导** `{product_code}.vxture.com`，写死在 render-agent-map.mjs:111。
-- 推导已经在失效：登记表里 anlan → anlan.ai、xuanzhen → xuanzhen.ai，这两个正是
-- 通配兜底要服务的 L3 智能体，而推导会给它们生成 `anlan.vxture.com`——**指向一个
-- 不存在的域名，且不报错**。
--
-- 加这一列后推导降级成**默认值**（表单预填、可改），不再是唯一规则。留空 =
-- 不走通配兜底（自带精确 vhost 的产品，如 vxtpl）。

-- ── ① product_surfaces ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product.product_surfaces (
    product_id  uuid         NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
    surface     varchar(24)  NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_product_surfaces PRIMARY KEY (product_id, surface),
    -- 受管枚举，权威源 @vxture/core-utils 的 PRODUCT_SURFACES。加端要同时改两处。
    CONSTRAINT chk_product_surfaces_value CHECK (surface IN ('web','desktop','app','miniprogram'))
);

COMMENT ON TABLE product.product_surfaces IS
  '产品可露出的端（web/desktop/app/miniprogram）。产品自身的形态属性，与租户无关；按租户的开关属权益，挂订阅/套餐。';

-- 「哪些产品支持桌面端」是本表最主要的查询方向（如影端拉列表）。
CREATE INDEX IF NOT EXISTS ix_product_surfaces_surface ON product.product_surfaces (surface);

-- ── ② edge_domain ───────────────────────────────────────────────────────────
ALTER TABLE product.product_webhooks
  ADD COLUMN IF NOT EXISTS edge_domain varchar(255);

COMMENT ON COLUMN product.product_webhooks.edge_domain IS
  '边缘域名。表单预填 {product_code}.vxture.com 但可改（anlan.ai / xuanzhen.ai 这类异 apex 推导是错的）。空 = 不走通配兜底（自带精确 vhost）。';

-- 形状：主机名。不带协议、路径、端口、空格——这个值会原样进 nginx 的 map。
-- 端口在 edge_upstream 那一列，两者不能混。
ALTER TABLE product.product_webhooks
  DROP CONSTRAINT IF EXISTS chk_product_webhooks_edge_domain;
ALTER TABLE product.product_webhooks
  ADD CONSTRAINT chk_product_webhooks_edge_domain CHECK (edge_domain IS NULL OR edge_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

-- ── 列级锁（TD-018）──────────────────────────────────────────────────────────
-- 98 是**白名单** GRANT：新列不写进去，platform_svc 就 UPDATE 不了它，而症状是
-- 生产上一句 42501、整条事务回滚。98_column_locks.sql 同步已改。
--
-- **白名单是全量替换不是追加**——重写一遍等于按新列表重新授权，漏一列就是收窄。
-- 下面这条是在 2026-09-28 那次的基础上再加 edge_domain，其余逐字保留。
REVOKE UPDATE ON product.product_webhooks FROM platform_svc;
GRANT UPDATE (home_url, webhook_url, webhook_secret_ref, edge_upstream, webhook_secret_enc, edge_domain, updated_at)
  ON product.product_webhooks TO platform_svc;

-- product_surfaces 是「只增删不改」的关系表：没有可 UPDATE 的业务列
-- （两列都是主键的一半，created_at 是锚点）。所以只给 INSERT/DELETE，不给 UPDATE。
REVOKE UPDATE ON product.product_surfaces FROM platform_svc;
GRANT SELECT, INSERT, DELETE ON product.product_surfaces TO platform_svc;

-- ── ③④ 已有列：本次不动授权 ─────────────────────────────────────────────────
-- icon_url / logo_url / post_logout_redirect_uris 三列**早就在表上**，只是没有
-- 任何页面能填（console 应用中心磁贴在读 icon_url、accounts 登出页在读 logo_url、
-- auth-bff 的 endSession 在用 post_logout_redirect_uris）。缺的是**应用层写入面**，
-- 不是授权——三列都已在 98 的白名单里，逐列比对过。
--
-- 我第一版在这里重写了 oidc_clients 的整条 GRANT「顺便确认一下」，结果**漏了
-- client_id**：白名单是全量替换不是追加，那一写就是把 20 列收窄成 19 列。
-- 本次不需要动这张表的授权，整段删掉——**不改比"顺手确认"安全**。
