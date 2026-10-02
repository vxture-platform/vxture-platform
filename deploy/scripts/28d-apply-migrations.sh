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
#
# MIGRATE_UNTIL=<文件名>（可选）：**跑到这一份为止**，它之后的一律不跑并逐条列出来。
#   给 expand/contract 用：「一份加列、一份换主键，中间夹一次部署」这种改动，新旧代码
#   必须共存一段时间，而全量重放会把两份一起跑掉、把那段共存期压成零。
#   值可以是全名也可以是前缀（`2026-11-29` 即可）；**匹配不到就报错退出**，不静默跑全量
#   ——打错一个字就变成「我以为只跑了一份」是这里唯一要防的事。
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

MIGRATE_UNTIL="${MIGRATE_UNTIL:-}"
if [ -n "$MIGRATE_UNTIL" ]; then
  # 匹配不到就退出：静默跑全量比不跑更坏（调用方会以为只跑了一份）。
  #
  # **不要用 `… | xargs -n1 basename | grep -q`**：grep -q 一命中就关管道，xargs 吃
  # SIGPIPE（signal 13），在 pipefail 下整条管道非零，于是这个分支会在**命中时**误触发。
  # 2026-10-02 生产第一次派发就是这样假红的；本机与 runner 上它只是间歇复现（竞态），
  # 所以别换成「加个 || true」——那会把真正的匹配不到也一起吞掉。纯 for + case，不开管道。
  _until_hit=0
  for _m in "$MIG_DIR"/*.sql; do
    case "$(basename "$_m")" in *"$MIGRATE_UNTIL"*) _until_hit=1; break ;; esac
  done
  if [ "$_until_hit" != "1" ]; then
    echo "错误：MIGRATE_UNTIL=$MIGRATE_UNTIL 在 migrations/ 里匹配不到任何文件。" >&2
    exit 1
  fi
  echo "    MIGRATE_UNTIL=$MIGRATE_UNTIL —— 跑到这一份为止"
  WILL_RUN=1
  for b in $(ls -1 "$MIG_DIR"/*.sql | xargs -n1 basename | sort); do
    if [ "$WILL_RUN" = "1" ]; then
      echo "  • $b"
      case "$b" in *"$MIGRATE_UNTIL"*) WILL_RUN=0 ;; esac
    else
      echo "  · $b   （本次跳过）"
    fi
  done
else
  ls -1 "$MIG_DIR"/*.sql | sed 's/^/  • /'
fi

docker run --rm \
  --network vxture-prod \
  --env-file "$PLATFORM_ENV" \
  --env MIGRATE_TIMEOUT_SECONDS="$MIGRATE_TIMEOUT_SECONDS" \
  --env MIGRATE_UNTIL="$MIGRATE_UNTIL" \
  -v "$MIG_DIR:/migrations:ro" \
  -v "$COMPOSE_DIR/database/ddl/98_column_locks.sql:/column_locks.sql:ro" \
  postgres:18-alpine \
  sh -lc '
    set -e
    for f in $(ls /migrations/*.sql | sort); do
      echo "==> $f"
      timeout "$MIGRATE_TIMEOUT_SECONDS" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
      # MIGRATE_UNTIL：跑完这一份就停（它之后的留给下一次派发）。
      if [ -n "${MIGRATE_UNTIL:-}" ]; then
        case "$(basename "$f")" in
          *"$MIGRATE_UNTIL"*)
            echo "=== 到 MIGRATE_UNTIL=$MIGRATE_UNTIL 为止，其余本次不跑 ==="
            break
            ;;
        esac
      fi
    done
    # 列级锁随迁移重放（2026-09-07 事故）：迁移能加列，却没有任何东西把新列授给
    # platform_svc——98_column_locks.sql 只在 28-apply（全量 DDL）里跑，已有库永远不
    # 重放。product_330 新增的 metering.subscriptions.paid_amount/current_order_id 等
    # 5 张表的列就这样在生产缺了授权，履约写它们时 42501，订阅已生效而订单停在 paid。
    # 文件本身幂等（REVOKE + GRANT 白名单），-1 单事务：中途出错整体回滚，绝不会把表
    # REVOKE 掉却没 GRANT 回去。
    echo "==> /column_locks.sql（列级锁重放，随 DDL 保持一致）"
    timeout "$MIGRATE_TIMEOUT_SECONDS" psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f /column_locks.sql
  '

echo "=== Forward migrations done（调用方须随后 28c restamp + 30-verify）==="
