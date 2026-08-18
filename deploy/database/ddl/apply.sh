#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# apply.sh — 平台库 SQL DDL 单一权威 apply runner（取代 prisma db push）
# 按文件名排序顺序 apply deploy/database/ddl/*.sql：
#   00_schemas → 10..80 各域(表+域内FK) → 90 跨schema FK → 95 触发器 → 96 分区
# 运营模型：clean-baseline（开发阶段，铁律三）——reset 后 apply 一次性建全。
#   00_schemas / 90_fk 幂等（IF NOT EXISTS / duplicate_object）；10-80 表为 create-once
#   （不 IF NOT EXISTS，重复建报错=有意，防静默漂移）。故非 reset 的重复 apply 会在已存在表处停。
# 正式上线后（铁律三开关）改增量迁移机制，本 runner 仅 dev。
# 用法：CONFIRM_RESET=yes DATABASE_URL=postgres://... ./apply.sh --reset
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

DDL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DATABASE_URL:?DATABASE_URL required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

if [[ "${1:-}" == "--reset" ]]; then
  echo "⚠ --reset: dropping all 19 platform schemas + any residual non-target schemas (CASCADE). Data loss."
  [[ "${CONFIRM_RESET:-}" == "yes" ]] || { echo "refusing: set CONFIRM_RESET=yes"; exit 1; }
  # ① 19 目标 schema（显式清单 = 目标态文档；幂等）
  "${PSQL[@]}" -c "DROP SCHEMA IF EXISTS account,identity,credential,kyc,tenancy,access,appoidc,session,loyalty,metering,billing,provisioning,promotion,product,safety,support,admin,sharing CASCADE;"
  # ② 动态清任意残留（旧 8-schema 遗留如 commerce/iam，或历史演进遗留）——按实际状态清，不硬编码。
  #    保留系统 schema（public / pg_* / information_schema）。见 data_platform_320 §8。
  "${PSQL[@]}" -c "DO \$\$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT nspname FROM pg_namespace
         WHERE nspname NOT LIKE 'pg_%'
           AND nspname NOT IN ('public','information_schema',
             'account','identity','credential','kyc','tenancy','access','appoidc','session','loyalty',
             'metering','billing','provisioning','promotion','product','safety','support','admin','sharing')
      LOOP
        RAISE NOTICE 'dropping residual schema %', r.nspname;
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.nspname);
      END LOOP;
    END \$\$;"
fi

shopt -s nullglob
for f in "$DDL_DIR"/[0-9]*.sql; do
  echo "── apply $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

# ── DDL 基线指纹（data_platform_320 §9.5-③）───────────────────────────────────
# 把本次 apply 的 DDL 内容 hash 打戳进库（public 跨 reset 存活，每次 apply 覆写）。
# 30-verify 用同法重算比对：任何漂移（含列改名这类"表数不变"的演进）机器可见。
# 表数/计数断言抓不到列级差异——2026-07-04 cutover 复盘（§9）的直接教训。
DDL_HASH="$(cat "$DDL_DIR"/[0-9]*.sql | md5sum | awk '{print $1}')"
"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS public.vx_ddl_baseline (
    id int PRIMARY KEY, ddl_hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.vx_ddl_baseline (id, ddl_hash) VALUES (1, '$DDL_HASH')
  ON CONFLICT (id) DO UPDATE SET ddl_hash = excluded.ddl_hash, applied_at = now();"
echo "✓ DDL apply complete (baseline hash = $DDL_HASH)"
