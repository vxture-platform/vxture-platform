#!/usr/bin/env bash
# deploy/scripts/28d-apply-migrations.sh
# 幂等前向迁移执行器：按文件名序 apply deploy/database/migrations/*.sql。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-20
#
# 定位：28 的 baseline apply 只适用于空库（表 create-once），已投产的库做小步
# DDL 演进一直没有运行通道，只能人肉 psql（product_330 收藏表迁移时补上此债）。
# 约定：migrations/*.sql 必须幂等（IF NOT EXISTS / duplicate_object 吞异常），
# 因此本脚本**全量重放**目录内所有文件——已应用过的自然 no-op，新文件生效。
# 执行后 live 结构应与 ddl/ 权威一致，调用方（db-init action=migrate）随即
# 28c restamp 基线 + 30-verify 收口；单跑本脚本不 restamp，verify 会红——有意。
# 运行：CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIG_DIR="$COMPOSE_DIR/database/migrations"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
# DDL/运维连接:优先 RDS owner 连接串;无则回退 platform.env(2026-08-19 RDS 切换)。
PLATFORM_ENV="$RUNTIME_DIR/secrets/rds-owner.env"
[ -f "$PLATFORM_ENV" ] || PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"
MIGRATE_TIMEOUT_SECONDS="${MIGRATE_TIMEOUT_SECONDS:-600}"

if [ "${CONFIRM_MIGRATE:-}" != "yes" ]; then
  echo "错误：迁移需显式确认。" >&2
  echo "  CONFIRM_MIGRATE=yes bash scripts/28d-apply-migrations.sh" >&2
  exit 1
fi
if [ ! -f "$PLATFORM_ENV" ]; then
  echo "错误：缺少 $PLATFORM_ENV" >&2
  exit 1
fi
if ! ls "$MIG_DIR"/*.sql >/dev/null 2>&1; then
  echo "migrations/ 为空——无事可做。"
  exit 0
fi

echo "=== Vxture Platform forward migrations (idempotent replay) ==="
ls -1 "$MIG_DIR"/*.sql | sed 's/^/  • /'

docker run --rm \
  --network vxture-prod \
  --env-file "$PLATFORM_ENV" \
  --env MIGRATE_TIMEOUT_SECONDS="$MIGRATE_TIMEOUT_SECONDS" \
  -v "$MIG_DIR:/migrations:ro" \
  postgres:18-alpine \
  sh -lc '
    set -e
    for f in $(ls /migrations/*.sql | sort); do
      echo "==> $f"
      timeout "$MIGRATE_TIMEOUT_SECONDS" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    done
  '

echo "=== Forward migrations done（调用方须随后 28c restamp + 30-verify）==="
