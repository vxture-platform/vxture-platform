-- 0013_tenant_operator_notes
-- 运营备注：运营对某租户的内部记录。全量 DDL 在
-- deploy/database/ddl/80_admin.sql，本文件是已有库的增量路径。
--
-- 为什么要新建一张表：库里没有运营备注这一列。admin 详情页一直拿
-- tenancy.tenant_profiles.description（**租户自己写的简介**）当运营备注显示。
--
-- 为什么带 GRANT：97_service_roles.sql 的 `GRANT ... ON ALL TABLES` 只覆盖它
-- 执行当时存在的表，而 28d-apply-migrations.sh 只重跑 98_column_locks.sql，
-- 不重跑 97。新表不在这里自带授权，活库上 platform_svc 就一个字段都读不到。

CREATE TABLE IF NOT EXISTS "admin"."tenant_operator_notes" (
    "tenant_id"  uuid        PRIMARY KEY,
    "body"       text        NOT NULL DEFAULT '',
    "updated_by" uuid        REFERENCES "admin"."operator_account"("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tenant_operator_notes_updated_by"
    ON "admin"."tenant_operator_notes" ("updated_by");

-- 基础授权（见上）。列级 UPDATE 白名单由 98_column_locks.sql 收口，
-- 28d 重放完迁移后会在同一次 migrate 里跑它。
GRANT SELECT, INSERT, UPDATE, DELETE ON "admin"."tenant_operator_notes" TO platform_svc;
