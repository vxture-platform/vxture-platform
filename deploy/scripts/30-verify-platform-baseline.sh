#!/usr/bin/env bash
# deploy/scripts/30-verify-platform-baseline.sh
# 活库基线稽查（read-only）——「活库 ↔ DDL ↔ 设计文档」三方一致性 + seed 基线断言。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-05
#
# 依据 = data_platform_320 §9.5-③（2026-07-04 cutover 复盘整改）：所有静态检查器都
# 看不见活库，schema 孤儿 / seed 空洞可静默出网。本脚本对生产库做机器断言：
#   A. schema 集合 == 19 目标集（无孤儿、无缺失）
#   B. 表数 == 权威 DDL 派生（本脚本现场 grep deploy/database/ddl/*.sql，零漂移）
#   C. seed 基线地板（operator/access RBAC 目录、oidc_clients、oauth_providers、
#      kyc/loyalty/product/model catalog）+ super_admin 全授等值
# 断言体 = deploy/database/verify/baseline-assertions.sql（单一 DO 块，一次性列全
# 部失败项）。任一失败 → psql 非零退出 → 本脚本红 → db-init run 红。
# 只读、无确认门；可随时对生产执行。挂载点 = db-init 的 seed/migrate-seed/reset
# 收尾强制跑 + 独立 action=verify。
# DATABASE_URL 来自运行时 secret（/srv/vxture/runtime/secrets/platform.env）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DDL_DIR="$COMPOSE_DIR/database/ddl"
VERIFY_DIR="$COMPOSE_DIR/database/verify"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
# DDL/运维连接:优先 RDS owner 连接串;无则回退 platform.env(2026-08-19 RDS 切换)。
PLATFORM_ENV="$RUNTIME_DIR/secrets/rds-owner.env"
[ -f "$PLATFORM_ENV" ] || PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

check_file "$VERIFY_DIR/baseline-assertions.sql"
check_file "$PLATFORM_ENV"

# 表数期望从权威 DDL 现场派生（不硬编码常数 → DDL 演进时断言自动跟随）。
# 计数口径 = 顶层 `CREATE TABLE`（分区子表在 96 用 PARTITION OF、不顶格匹配，不计入），
# 与断言侧 `relkind IN ('r','p') AND NOT relispartition` 对应。
EXPECTED_TABLES="$(cat "$DDL_DIR"/[0-9]*.sql | grep -cE '^CREATE TABLE' || true)"
if [ -z "$EXPECTED_TABLES" ] || [ "$EXPECTED_TABLES" -eq 0 ]; then
  echo "错误：从 $DDL_DIR 派生表数失败（=0），DDL 目录不完整？" >&2
  exit 1
fi

echo "=== Vxture Platform baseline audit (read-only; expected tables from DDL = $EXPECTED_TABLES) ==="
# DDL 基线指纹在容器内重算（与 apply.sh 打戳同环境同文件同法 → hash 口径一致），
# 比对 public.vx_ddl_baseline：列级漂移（表数不变的演进）也机器可见。
docker run --rm \
  --network vxture-prod \
  --env-file "$PLATFORM_ENV" \
  --env EXPECTED_TABLES="$EXPECTED_TABLES" \
  -v "$DDL_DIR:/ddl:ro" \
  -v "$VERIFY_DIR:/verify:ro" \
  postgres:18-alpine \
  sh -lc 'H="$(cat /ddl/[0-9]*.sql | md5sum | awk "{print \$1}")" && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v expected_tables="$EXPECTED_TABLES" -v expected_ddl_hash="$H" -f /verify/baseline-assertions.sql'

echo "=== Platform baseline audit PASSED ==="
