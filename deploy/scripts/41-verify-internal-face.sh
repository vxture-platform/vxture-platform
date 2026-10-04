#!/usr/bin/env bash
# deploy/scripts/41-verify-internal-face.sh
# 切换后的运行态证明：IdP 内部面只认 IDP_INTERNAL_TOKEN，产品面只认 AUTH_INTERNAL_TOKEN。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
#
# 运行（worker-01，owner 手跑；**不接进 31-regular-upgrade**——它读 secrets 值，而 40-verify 刻意不碰 env）：
#   bash scripts/41-verify-internal-face.sh
#   VX_VERIFY_WORKSPACE_ID=<真实 workspace uuid> VX_VERIFY_PRODUCT=arda bash scripts/41-verify-internal-face.sh
#
# 七条探针，只打印状态码与错误码，正文丢到 0700 私有目录后删除（200 的正文是会话引用，不该进终端）：
#   1 internal-face old value   → 401   旧值（产品面的 AUTH_INTERNAL_TOKEN）开不了内部面
#   2 internal-face new value   → 200   新值开得了（env → 容器那一半只有运行态证得了）
#   3 internal-face no header   → 401
#   4 product-face old value    → 非 401 产品不受影响（工作区不存在时可能是 400/404，判据是「不是 401」）
#   5 product-face new value    → 401   新钥匙开不了产品面：拆分是双向的
#   6 public edge               → 404   api.vxture.com 对 /auth-api/internal/ 仍是 404
#   7 container-net old value   → 401   发送方真正走的地址（容器网 vx-platform-auth-bff:3081）
#
# 口令**绝不进 argv**（ps 看得见）：curl 用 `-H @file` 读 0600 头文件；容器内那一条用 `-H @-`
# 从 stdin 读。脚本自己先断言两值非空且不等——「读不到要抛，不要通过」。
# 探针用 `/internal/operator/sessions`（GET、只读、actor none），是这个面上最安全的一条。
#
# **本脚本自己会在 auth-bff 日志里留下 `invalid_internal_auth` warn**：探针 1/3 故意送旧值 / 无头
# （来源 = 本机，限速后一条）、探针 7 故意从 $SENDER_CONTAINER 容器送旧值（来源 = 容器 IP，一条）。
# 所以「切换后还有谁拿旧值敲门」的 `docker logs --since` 要用本脚本结尾打印的 `finished_at`
# 之后的时刻（半径探针 §5 也会留一条，--since 取它之后）。拿 deploy 完成时刻当基线会数进这几条。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env

PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"
IDP_ENV="$RUNTIME_DIR/secrets/platform-idp-internal.env"
PUBLIC_EDGE="${VX_VERIFY_PUBLIC_EDGE:-https://api.vxture.com}"
WORKSPACE_ID="${VX_VERIFY_WORKSPACE_ID:-00000000-0000-0000-0000-000000000000}"
PRODUCT="${VX_VERIFY_PRODUCT:-arda}"
AUTH_BFF_CONTAINER="${VX_VERIFY_AUTH_BFF_CONTAINER:-vx-platform-auth-bff}"
SENDER_CONTAINER="${VX_VERIFY_SENDER_CONTAINER:-vx-platform-admin-bff}"

read_kv() {
  local file="$1" key="$2" line
  [ -f "$file" ] || return 0
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

[ -f "$PLATFORM_ENV" ] || { echo "错误：缺少 $PLATFORM_ENV" >&2; exit 1; }
[ -f "$IDP_ENV" ] || { echo "错误：缺少 $IDP_ENV（先跑 34-provision-idp-internal-secret.sh）" >&2; exit 1; }
[ -n "$VX_WORKER01_TAILNET_IP" ] || { echo "错误：VX_WORKER01_TAILNET_IP 为空（runtime/.env）" >&2; exit 1; }

OLD="$(read_kv "$PLATFORM_ENV" AUTH_INTERNAL_TOKEN)"
NEW="$(read_kv "$IDP_ENV" IDP_INTERNAL_TOKEN)"
if [ -z "$OLD" ] || [ -z "$NEW" ]; then
  echo "错误：AUTH_INTERNAL_TOKEN 或 IDP_INTERNAL_TOKEN 读不到 —— 读不到不是通过。" >&2
  exit 1
fi
if [ "$OLD" = "$NEW" ]; then
  echo "错误：两把钥匙的值相同 —— 拆分是空操作，产品值仍开得了内部面。先重铸（34 脚本 FORCE）。" >&2
  exit 1
fi

# 0700 私有工作目录：头文件（0600）+ 每次探针的正文。退出时整目录删掉。
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
umask 077
printf 'x-vxture-internal-auth: %s\n' "$OLD" > "$WORK/hdr-old"
printf 'x-vxture-internal-auth: %s\n' "$NEW" > "$WORK/hdr-new"
chmod 600 "$WORK/hdr-old" "$WORK/hdr-new"

FAILED=0
# probe <label> <url> <hdr-file|""> <expect>   expect = 三位状态码，或 "!401"
probe() {
  local label="$1" url="$2" hdr="$3" expect="$4"
  local body="$WORK/body" code msg ok=0
  if [ -n "$hdr" ]; then
    code="$(curl -s -o "$body" -w '%{http_code}' --max-time 15 -H "@$hdr" "$url")"
  else
    code="$(curl -s -o "$body" -w '%{http_code}' --max-time 15 "$url")"
  fi
  msg="$(grep -o '"message":"[^"]*"' "$body" 2>/dev/null | head -1 || true)"
  rm -f "$body"
  case "$expect" in
    "!"*) [ "$code" != "${expect#!}" ] && [ "$code" != "000" ] && ok=1 ;;
    *)    [ "$code" = "$expect" ] && ok=1 ;;
  esac
  if [ "$ok" = "1" ]; then
    echo "PASS $label -> $code $msg"
  else
    echo "FAIL $label -> got $code want $expect $msg"
    FAILED=1
  fi
}

IFACE="http://$VX_WORKER01_TAILNET_IP:8081/internal/operator/sessions"
PFACE="http://$VX_WORKER01_TAILNET_IP:8080/platform/entitlements?workspace_id=$WORKSPACE_ID&product=$PRODUCT"

echo "=== Vxture IdP internal-face verification ==="
probe "1 internal-face old value" "$IFACE" "$WORK/hdr-old" 401
probe "2 internal-face new value" "$IFACE" "$WORK/hdr-new" 200
probe "3 internal-face no header" "$IFACE" ""              401
probe "4 product-face old value"  "$PFACE" "$WORK/hdr-old" "!401"
probe "5 product-face new value"  "$PFACE" "$WORK/hdr-new" 401
probe "6 public edge still 404"   "$PUBLIC_EDGE/auth-api/internal/operator/sessions" "$WORK/hdr-old" 404

# 7 容器网那一面：发送方真正走的地址。头从 stdin 进容器（-H @-），不进 docker exec 的 argv。
code="$(docker exec -i "$SENDER_CONTAINER" curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @- \
  "http://$AUTH_BFF_CONTAINER:3081/internal/operator/sessions" < "$WORK/hdr-old" 2>/dev/null || echo "000")"
if [ "$code" = "401" ]; then
  echo "PASS 7 container-net old value -> 401"
else
  echo "FAIL 7 container-net old value -> got $code want 401"
  FAILED=1
fi

echo ""
# 结束时刻（UTC、可直接喂 `docker logs --since`）：本脚本的探针 1/3/7 自己在 auth-bff 日志里留下了
# invalid_internal_auth warn（本机一条 + 容器 IP 一条），切换后找「还有谁拿旧值敲门」要从这一刻之后数。
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "finished_at=$FINISHED_AT"
echo "（本脚本留下的 invalid_internal_auth warn 来源：本机（探针 1/3）、$SENDER_CONTAINER 容器 IP（探针 7）。"
echo "  之后看「谁还在敲门」：docker logs $AUTH_BFF_CONTAINER --since $FINISHED_AT 2>&1 | grep invalid_internal_auth）"
if [ "$FAILED" -eq 0 ]; then
  echo "=== Internal face verified: old value is dead on /internal/*, new value does not open the product face ==="
else
  echo "=== Internal face verification FAILED ==="
  exit 1
fi
