#!/usr/bin/env bash
# deploy/scripts/31-test-delivery.sh
# 手动向已登记 product_webhooks 的产品发一条测试 C3 投递（version-less
# subscription_changed 通知），验证"平台能否真的把事件送到对方 webhook_url"。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-27
#
# 背景：product.product_webhooks 登记只保证平台知道往哪投；真正验证闭环需要一条
# 真实经过签名/派发/HTTP POST 的事件。既有代码只有真实业务流程（订阅生效/共享授权
# 变更）会调用 ProvisioningService.enqueueEvent，没有 admin 触发端点。本脚本直接向
# provisioning.webhook_deliveries 插入一条事件（deploy/database/verify/test-delivery.sql），
# 复用既有 platform-api 的 dispatch 定时任务（默认 10s 一轮）派发——走的是真实签名/HTTP
# 路径，不是伪造响应。
#
# 主体（workspace/tenant）取自 TEST_DELIVERY_ACCOUNT 的默认 workspace，默认为种子
# 测试用户 zhangsan，不凭空造租户。
#
# DATABASE_URL 只存在于容器内（--env-file 注入），本脚本用 `sh -lc` 把 psql 调用留给
# 容器自己的 shell 解析，宿主 bash 不直接引用 $DATABASE_URL（同 30-verify 的做法）。
#
# 运行：
#   CONFIRM_TEST_DELIVERY=yes TEST_DELIVERY_PRODUCT=karda bash scripts/31-test-delivery.sh
# 可选：TEST_DELIVERY_ACCOUNT（默认 zhangsan）、TEST_DELIVERY_EVENT
#   （subscription_changed|grant.invalidated，默认 subscription_changed）、
#   TEST_DELIVERY_POLL_SECONDS（轮询等待投递结果的总秒数，默认 30）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY_DIR="$COMPOSE_DIR/database/verify"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"

PRODUCT_CODE="${TEST_DELIVERY_PRODUCT:-}"
ACCOUNT="${TEST_DELIVERY_ACCOUNT:-zhangsan}"
EVENT="${TEST_DELIVERY_EVENT:-subscription_changed}"
POLL_SECONDS="${TEST_DELIVERY_POLL_SECONDS:-30}"

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

if [ "${CONFIRM_TEST_DELIVERY:-}" != "yes" ]; then
  echo "错误：需要显式确认。CONFIRM_TEST_DELIVERY=yes TEST_DELIVERY_PRODUCT=<code> bash scripts/31-test-delivery.sh" >&2
  exit 1
fi
if [ -z "$PRODUCT_CODE" ]; then
  echo "错误：TEST_DELIVERY_PRODUCT 未设置（目标产品的 product_code，如 karda）。" >&2
  exit 1
fi
case "$EVENT" in
  subscription_changed | grant.invalidated) ;;
  *)
    echo "错误：TEST_DELIVERY_EVENT 只能是 subscription_changed 或 grant.invalidated（version-less 事件，见 provisioning.types.ts）。" >&2
    exit 1
    ;;
esac
check_file "$PLATFORM_ENV"
check_file "$VERIFY_DIR/test-delivery.sql"

echo "=== 测试投递：product=$PRODUCT_CODE event=$EVENT account=$ACCOUNT ==="

DELIVERY_ID="$(
  docker run --rm \
    --network vxture-prod \
    --env-file "$PLATFORM_ENV" \
    --env PRODUCT_CODE="$PRODUCT_CODE" \
    --env ACCOUNT="$ACCOUNT" \
    --env EVENT="$EVENT" \
    -v "$VERIFY_DIR:/verify:ro" \
    postgres:18-alpine \
    sh -lc 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -A -t \
      -v product_code="$PRODUCT_CODE" -v account="$ACCOUNT" -v event="$EVENT" \
      -f /verify/test-delivery.sql'
)"

if [ -z "$DELIVERY_ID" ]; then
  echo "错误：未插入任何行——account='$ACCOUNT' 无默认 workspace、product_code='$PRODUCT_CODE' 不存在，或该产品未登记 product_webhooks（webhook_url 为空）。" >&2
  exit 1
fi
echo "✓  已入队：delivery id=$DELIVERY_ID（等待 platform-api 定时任务派发，默认 10s 一轮）"

echo "==> 轮询投递结果（最长 ${POLL_SECONDS}s）"
elapsed=0
while [ "$elapsed" -lt "$POLL_SECONDS" ]; do
  sleep 5
  elapsed=$((elapsed + 5))
  STATUS_LINE="$(
    docker run --rm \
      --network vxture-prod \
      --env-file "$PLATFORM_ENV" \
      --env DELIVERY_ID="$DELIVERY_ID" \
      -v "$VERIFY_DIR:/verify:ro" \
      postgres:18-alpine \
      sh -lc 'psql "$DATABASE_URL" -X -q -A -t \
        -v delivery_id="$DELIVERY_ID" -f /verify/delivery-status.sql'
  )"
  ST="${STATUS_LINE%%|*}"
  ATT="${STATUS_LINE##*|}"
  echo "  [$elapsed s] status=$ST attempts=$ATT"
  case "$ST" in
    delivered)
      echo "✓  投递已确认送达（HTTP 2xx）。"
      exit 0
      ;;
    failed)
      echo "✗  投递重试耗尽仍失败——检查目标 webhook_url 是否可达（见 product.product_webhooks）。" >&2
      exit 1
      ;;
  esac
done
echo "•  ${POLL_SECONDS}s 内仍是 pending/retrying——不代表失败，继续查 provisioning.webhook_deliveries.status 即可（定时任务持续重试到 maxAttempts）。"
