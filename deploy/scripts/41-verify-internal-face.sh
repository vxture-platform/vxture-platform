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
# 八条探针，只打印状态码与错误码，正文丢到 0700 私有目录后删除（200 的正文是会话引用，不该进终端）。
# 内部面**真正住的地方**是容器网 vx-platform-auth-bff:3081（三个发送方走的地址）；tailnet:8081 自
# E1 PR D 起是 nginx 别名，/internal/* 在边缘就 404、根本到不了 guard——所以 1/2/3 从 $SENDER_CONTAINER
# 里打容器网，7/8 打 tailnet 别名证「门不在路边、而产品的口还在」：
#   1 internal-face (container net) old value → 401   旧值（产品面的 AUTH_INTERNAL_TOKEN）开不了内部面
#   2 internal-face (container net) new value → 200   新值开得了（env → 容器那一半只有运行态证得了）
#   3 internal-face (container net) no header → 401
#   4 product-face old value                   → 非 401 产品不受影响（工作区不存在时可能是 400/404，判据是「不是 401」）
#   5 product-face new value                   → 401   新钥匙开不了产品面：拆分是双向的
#   6 public edge                              → 404   api.vxture.com 对 /auth-api/internal/ 仍是 404
#   7 tailnet alias /internal/ (new value)     → 404   nginx 的 404、不是 auth-bff 的 401：**带着真钥匙也进不了**，门已不在 tailnet 上
#   8 tailnet alias /oidc/jwks                 → 200   产品换票口照旧（地址不变、只是经 nginx）
#
# 口令**绝不进 argv**（ps 看得见）：curl 用 `-H @file` 读 0600 头文件；容器内那几条用 `-H @-`
# 从 stdin 读。脚本自己先断言两值非空且不等——「读不到要抛，不要通过」。
# 探针用 `/internal/operator/sessions`（GET、只读、actor none），是这个面上最安全的一条。
#
# **本脚本自己会在 auth-bff 日志里留下 `invalid_internal_auth` warn**：探针 1/3 故意从 $SENDER_CONTAINER
# 容器送旧值 / 无头（来源 = 该容器 IP，限速后一条）。探针 7 在 nginx 就被 404、到不了 auth-bff，不留 warn。
# 所以「切换后还有谁拿旧值敲门」的 `docker logs --since` 要用本脚本结尾打印的 `finished_at`
# 之后的时刻。拿 deploy 完成时刻当基线会数进这一条。
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

# probe_in_container <label> <url> <hdr-file|""> <expect>：从发送方容器里打容器网地址。
# 头从 stdin 进容器（-H @-），不进 docker exec 的 argv；无头那条干脆不传 -H。
probe_in_container() {
  local label="$1" url="$2" hdr="$3" expect="$4" code
  if [ -n "$hdr" ]; then
    code="$(docker exec -i "$SENDER_CONTAINER" curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @- "$url" \
      < "$hdr" 2>/dev/null || echo "000")"
  else
    code="$(docker exec "$SENDER_CONTAINER" curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo "000")"
  fi
  if [ "$code" = "$expect" ]; then
    echo "PASS $label -> $code"
  else
    echo "FAIL $label -> got $code want $expect"
    FAILED=1
  fi
}

IFACE="http://$AUTH_BFF_CONTAINER:3081/internal/operator/sessions"
ALIAS="http://$VX_WORKER01_TAILNET_IP:8081"
PFACE="http://$VX_WORKER01_TAILNET_IP:8080/platform/entitlements?workspace_id=$WORKSPACE_ID&product=$PRODUCT"

echo "=== Vxture IdP internal-face verification ==="
probe_in_container "1 internal-face (container net) old value" "$IFACE" "$WORK/hdr-old" 401
probe_in_container "2 internal-face (container net) new value" "$IFACE" "$WORK/hdr-new" 200
probe_in_container "3 internal-face (container net) no header" "$IFACE" ""              401
probe "4 product-face old value"  "$PFACE" "$WORK/hdr-old" "!401"
probe "5 product-face new value"  "$PFACE" "$WORK/hdr-new" 401
probe "6 public edge still 404"   "$PUBLIC_EDGE/auth-api/internal/operator/sessions" "$WORK/hdr-old" 404
# 7 带着**真钥匙**打 tailnet 别名的 /internal/：nginx 在边缘 404（不转发、头不出宿主）。得 401 = auth-bff 又被
#   直接发布 / nginx 转了 /internal/，门回到了路边；得 000 = 别名没起来（此时 8 也会红）。
probe "7 tailnet alias /internal/ is 404 (nginx, not auth-bff)" "$ALIAS/internal/operator/sessions" "$WORK/hdr-new" 404
# 8 产品真正打的口还在：/oidc/jwks 是公开的公钥集，经 nginx 到 auth-bff。
probe "8 tailnet alias /oidc/jwks still serves products" "$ALIAS/oidc/jwks" "" 200

echo ""
# 结束时刻（UTC、可直接喂 `docker logs --since`）：本脚本的探针 1/3 自己在 auth-bff 日志里留下了
# invalid_internal_auth warn（$SENDER_CONTAINER 容器 IP 一条），切换后找「还有谁拿旧值敲门」要从这一刻之后数。
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "finished_at=$FINISHED_AT"
echo "（本脚本留下的 invalid_internal_auth warn 来源：$SENDER_CONTAINER 容器 IP（探针 1/3）；探针 7 在 nginx 就被 404，不留 warn。"
echo "  之后看「谁还在敲门」：docker logs $AUTH_BFF_CONTAINER --since $FINISHED_AT 2>&1 | grep invalid_internal_auth）"
if [ "$FAILED" -eq 0 ]; then
  echo "=== Internal face verified: old value is dead on /internal/*, new value does not open the product face, /internal/ is off the tailnet ==="
else
  echo "=== Internal face verification FAILED ==="
  exit 1
fi
