-- 2026-10-11-product-reviews.sql
-- 客户评价落库：support.product_reviews（owner 2026-09-20 裁定）
--
-- 起因：admin 运营总览要展示「服务评价 / 产品评价 / 价格评价」三个卡，而平台
-- **根本没有评价采集**——全库 rating|review|score|feedback|csat|survey 一张表
-- 都没有，唯一的评分是 support.tickets.satisfaction_score（工单级、单维度、1..5）。
-- 三个卡此前一直显示 `—`（TD-036 如实标注"数据源待建设"）。
-- 所以这一批补的不是展示，是整条链路：本表 + 两个入口（console 订阅页操作菜单、
-- 工单完成）。
--
-- **5 分制**（与 tickets.satisfaction_score 同一量表，owner 2026-09-20 定）。
-- 10 分制被否：平台已有 1-5 的 CHECK 与 RatingStars 星级呈现，另起一套会让同一次
-- 服务出现两个口径、聚合时无法合并；且一次三项在面板里 15 个点击目标优于 30 个。
-- 呈现用五角星（行业惯例，与 5 档天然吻合）。
--
-- 三项分数**均可空**：客户可以只评其中一两项；但三项全空的行没有信息量，由
-- chk_product_reviews_any_score 挡掉。
--
-- 评价次数：「一次订阅评一次、一个工单评一次，续订可重新评价」。用两个**部分唯一
-- 索引**落地而不是 (account_id, product_id) 唯一——续订会产生新的 subscription_id，
-- 因而天然可以再评一次，不需要额外的"轮次"字段。软删的行不占唯一位。
--
-- account_id 裸值不建 FK（边界#3）：评价人注销后，他留下的评价不该跟着消失。
-- tenant_id / product_id / subscription_id 跨 schema 真 FK（三者皆软删，FK 安全）。
--
-- **98 列锁必须同步**（本迁移已含 GRANT）：锚点只有 id 与 created_at，其余列全部
-- 授权。少授权换不来保护，只会让任何一次带上该列的 UPDATE 整条 42501 回滚
-- （invoices.transaction_no 那次生产实测）。
--
-- 幂等：建表 / 加约束 / 建索引 / 授权全部可重放（migrate 是全量重放）。

CREATE TABLE IF NOT EXISTS support.product_reviews (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid          NOT NULL,
    account_id      uuid,
    product_id      uuid          NOT NULL,
    subscription_id uuid,
    ticket_id       uuid,
    product_score   smallint,
    price_score     smallint,
    service_score   smallint,
    comment         varchar(512),
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT fk_product_reviews_ticket
    FOREIGN KEY (ticket_id) REFERENCES support.tickets(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT fk_product_reviews_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT fk_product_reviews_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT fk_product_reviews_subscription
    FOREIGN KEY (subscription_id) REFERENCES metering.subscriptions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT chk_product_reviews_product_score
    CHECK (product_score IS NULL OR product_score BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT chk_product_reviews_price_score
    CHECK (price_score IS NULL OR price_score BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT chk_product_reviews_service_score
    CHECK (service_score IS NULL OR service_score BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT chk_product_reviews_origin
    CHECK ((subscription_id IS NOT NULL) <> (ticket_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE support.product_reviews ADD CONSTRAINT chk_product_reviews_any_score
    CHECK (product_score IS NOT NULL OR price_score IS NOT NULL OR service_score IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_subscription
  ON support.product_reviews (subscription_id) WHERE subscription_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_ticket
  ON support.product_reviews (ticket_id) WHERE ticket_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_live
  ON support.product_reviews (product_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_reviews_tenant
  ON support.product_reviews (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_account
  ON support.product_reviews (account_id) WHERE account_id IS NOT NULL;

REVOKE UPDATE ON support.product_reviews FROM platform_svc;
GRANT SELECT, INSERT, DELETE ON support.product_reviews TO platform_svc;
GRANT UPDATE (tenant_id, account_id, product_id, subscription_id, ticket_id, product_score, price_score, service_score, comment, updated_at, deleted_at) ON support.product_reviews TO platform_svc;
