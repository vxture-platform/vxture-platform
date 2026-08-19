#!/usr/bin/env bash
# deploy/scripts/28c-restamp-ddl-baseline.sh
# 重打 DDL 基线指纹（public.vx_ddl_baseline），用于"safe live ALTER"场景。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-30
#
# 背景：apply.sh 是 clean-baseline（只在 --reset 时建表），对已有真实数据的活库不可用；
# 但某些 DDL 演进是安全的、可在不 --reset 的前提下用一条幂等 ALTER 直接打进活库（例如
# 单纯放宽列宽——seed-catalog.mjs 的 seedCatalog() 已经在做这类"live column-width patch"）。
# 这类改动结构上确实改了 deploy/database/ddl/*.sql，但活库并非经 apply.sh 建出来，
# 30-verify 的 [B0] 指纹比对会因此永久红——除非把 public.vx_ddl_baseline 重新打戳到与
# 当前 DDL 文件一致。本脚本只做这一件事：不建表、不改表结构，只重算 hash 并 UPSERT。
#
# ⚠️ 危险操作纪律：只在你已经手动核实"活库结构确实等价于当前 DDL 文件声明"之后运行——
#   典型场景 = 配合一次 seedCatalog() 里新增的、经审查确认安全的 ALTER 一起用。
#   对任何"真结构变更但活库未跟上"的场景运行本脚本 = 关闭漂移检测器，绝不允许。
#
# 运行：CONFIRM_RESTAMP=yes bash scripts/28c-restamp-ddl-baseline.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DDL_DIR="$COMPOSE_DIR/database/ddl"
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

if [ "${CONFIRM_RESTAMP:-}" != "yes" ]; then
  echo "错误：重打 DDL 基线指纹只允许在已核实活库结构与当前 DDL 一致后手动执行。" >&2
  echo "请确认后运行：CONFIRM_RESTAMP=yes bash scripts/28c-restamp-ddl-baseline.sh" >&2
  exit 1
fi

check_file "$PLATFORM_ENV"

echo "=== Vxture Platform DDL baseline re-stamp ==="
# 同 apply.sh/30-verify 同法同口径重算 hash（容器内现场 cat+md5sum，避免宿主机
# 换行符/工具链差异产生不同 hash）。$H 是 32 位十六进制 md5，直接拼进 SQL 字面量安全
# （无引号/注入风险），故不借道 psql -v。
docker run --rm \
  --network vxture-prod \
  --env-file "$PLATFORM_ENV" \
  -v "$DDL_DIR:/ddl:ro" \
  postgres:18-alpine \
  sh -lc 'H="$(cat /ddl/[0-9]*.sql | md5sum | awk "{print \$1}")" && echo "hash=$H" && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "insert into public.vx_ddl_baseline (id, ddl_hash) values (1, '"'"'$H'"'"') on conflict (id) do update set ddl_hash = excluded.ddl_hash, applied_at = now();"'

echo "=== DDL baseline re-stamp done ==="
