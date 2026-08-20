-- 2026-08-20 产品收藏表（console「我的订阅」/产品市场 ★，收藏即排序优先）。
-- 幂等：可对已建库重复执行。对应 DDL：10_account.sql / 90_cross_schema_fk.sql / 98_column_locks.sql。

CREATE TABLE IF NOT EXISTS account.user_product_favorites (
    user_id     uuid         NOT NULL REFERENCES account.users(id) ON DELETE CASCADE,
    product_id  uuid         NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_product_favorites PRIMARY KEY (user_id, product_id)
);

DO $$ BEGIN
  ALTER TABLE account.user_product_favorites ADD CONSTRAINT fk_user_product_favorites_product
    FOREIGN KEY (product_id) REFERENCES product.products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, DELETE ON account.user_product_favorites TO platform_svc;
REVOKE UPDATE ON account.user_product_favorites FROM platform_svc;
