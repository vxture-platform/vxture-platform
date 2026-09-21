# ⚠️ 这个目录不会被执行

**别往这里加迁移。** 新迁移放进 `deploy/database/migrations/`。

## 为什么

跑迁移的是 `deploy/scripts/28d-apply-migrations.sh`，它挂载并按文件名顺序重放的是：

```
deploy/database/migrations/*.sql        ← 活的，扁平文件，YYYY-MM-DD-简述.sql
```

本目录属于已退役的 Prisma runner（`22-migrate` / `23-seed` / `26-reset`）。
`.github/workflows/db-init.yml` 的头注写着：

> The legacy prisma runners (22-migrate / 23-seed / 26-reset) are SUPERSEDED and
> no longer called.

`deploy/` 与 `.github/` 里**没有任何东西**引用这个目录。留着只是历史快照
（`0000_baseline` 记录了建库当时的形态）。

## 它骗过一次人

2026-09-21：给「运营备注」写迁移时放进了这里（`0013_tenant_operator_notes/`）。
这个目录看着太像真的了——编号递增、`0000_baseline` 在、最近一个 `0012` 还很新。

那份迁移**过了所有门**：本机真库验过幂等、36 条守卫全绿、PR 九条 CI 全绿、合并，
然后派发生产 `migrate`——60 条真迁移照常重放，它从没被执行，紧接着 28d 重跑
`98_column_locks.sql` 时死在：

```
psql:/column_locks.sql:516: ERROR: relation "admin.tenant_operator_notes" does not exist
```

列锁走 `-1` 单事务整体回滚，库没被改坏，但那次生产 migrate 白跑一趟。

现在有 `pnpm lint:migration-placement` 盯着：这个目录的 `.sql` 份数一涨就红。

## 写新迁移

```
deploy/database/migrations/YYYY-MM-DD-简述.sql
```

要求：

- **幂等**。`migrate` 是全量重放，每份都会被反复执行（`IF NOT EXISTS` /
  `DO $$ ... EXCEPTION WHEN duplicate_object`）。
- **建新表要自带 GRANT**。`97_service_roles.sql` 的 `GRANT ... ON ALL TABLES` 只
  覆盖它执行当时存在的表，而 28d 只重跑 `98_column_locks.sql`、不重跑 97。
  授权块用 `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_svc')`
  包起来——本机库没有这个角色。
- **不要断言「全库某类共 N 个」**。理由见
  `scripts/guardrails/check-migration-absolute-counts.mjs` 的头注。
- 同一改动的全量 DDL 要同步落进 `deploy/database/ddl/`（新建库走那条路）。
