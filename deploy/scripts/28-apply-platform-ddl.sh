#!/usr/bin/env bash
# deploy/scripts/28-apply-platform-ddl.sh
# 手动 apply 平台库 SQL DDL 单一权威（deploy/database/ddl/），取代旧 22 的 `prisma db push`。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-04
#
# 机制 = clean-baseline（开发阶段，铁律三；见 docs/design/data_platform_320_target-cutover.md §2）。
# 两种模式（幂等确认门控，风格同旧 22/26）：
#   • baseline apply（默认，非破坏）：CONFIRM_APPLY=yes bash scripts/28-apply-platform-ddl.sh
#       按文件名序 apply ddl/*.sql（00_schemas→各域→90跨FK→95触发器→96分区）。表 create-once
#       （非 IF NOT EXISTS，重复建报错=有意，防静默漂移）——仅在空库 / reset 之后 baseline apply。
#   • reset apply（破坏）：CONFIRM_RESET=yes bash scripts/28-apply-platform-ddl.sh
#       apply.sh 先 DROP 全 18 schema（CASCADE）再重建全量。所有 iam 之外数据丢失，仅数据可弃环境。
#       跨-reset 存活的 appoidc 业务数据由 28b-restore-appoidc.sh 备份/恢复（§6）。
# DATABASE_URL 来自运行时 secret（/srv/vxture/runtime/secrets/platform.env，--env-file 注入容器）。
# 容器 = postgres:18-alpine（自带 psql，无 bash → apk add bash 后再跑 ddl/apply.sh）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DDL_DIR="$COMPOSE_DIR/database/ddl"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
# DDL/运维连接:优先 RDS owner 连接串;无则回退 platform.env(2026-08-19 RDS 切换)。
PLATFORM_ENV="$RUNTIME_DIR/secrets/rds-owner.env"
[ -f "$PLATFORM_ENV" ] || PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"
DDL_TIMEOUT_SECONDS="${DDL_TIMEOUT_SECONDS:-900}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

# 模式判定：CONFIRM_RESET=yes → reset（破坏，优先）；否则须 CONFIRM_APPLY=yes → baseline。
if [ "${CONFIRM_RESET:-}" = "yes" ]; then
  APPLY_MODE="reset"
elif [ "${CONFIRM_APPLY:-}" = "yes" ]; then
  APPLY_MODE="baseline"
else
  echo "错误：DDL apply 需显式确认。" >&2
  echo "  baseline（空库 / reset 后建全）：CONFIRM_APPLY=yes bash scripts/28-apply-platform-ddl.sh" >&2
  echo "  reset（破坏，DROP 18 schema 后重建）：CONFIRM_RESET=yes bash scripts/28-apply-platform-ddl.sh" >&2
  exit 1
fi

echo "=== Vxture Platform DDL apply (mode: $APPLY_MODE) ==="
check_file "$DDL_DIR/apply.sh"
check_file "$PLATFORM_ENV"

if [ "$APPLY_MODE" = "reset" ]; then
  echo "  ⚠️ reset：即将 DROP 全 18 schema（CASCADE），所有 iam 之外数据丢失。"
fi

echo "==> apply deploy/database/ddl/*.sql via postgres:18-alpine（network vxture-prod）"
docker run --rm \
  --network vxture-prod \
  --env-file "$PLATFORM_ENV" \
  --env CONFIRM_RESET="${CONFIRM_RESET:-}" \
  --env APPLY_MODE="$APPLY_MODE" \
  --env DDL_TIMEOUT_SECONDS="$DDL_TIMEOUT_SECONDS" \
  -v "$DDL_DIR:/ddl:ro" \
  postgres:18-alpine \
  sh -lc '
    set -e
    apk add --no-cache bash >/dev/null
    if [ "$APPLY_MODE" = "reset" ]; then
      timeout "$DDL_TIMEOUT_SECONDS" bash /ddl/apply.sh --reset
    else
      timeout "$DDL_TIMEOUT_SECONDS" bash /ddl/apply.sh
    fi
  '

echo "=== Platform DDL apply done (mode: $APPLY_MODE) ==="
