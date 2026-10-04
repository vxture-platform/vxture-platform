#!/usr/bin/env bash
# deploy/scripts/lib/recreate-service.test.sh
# 33-recreate-service.sh 的离线证明：PATH 上放一个假 docker，喂它两种 Config.Image 形态，
# 断言它真正交给 `docker compose up` 的 pinned 覆盖与参数——真跑脚本，不读源码判断。
#   · digest 形态（30-deploy 钉死后生产的样子；两服务 digest 各不相同）→ 各钉各的，不再「拒绝混批」
#   · tag 形态（钉死前 / 别的主机）→ 原样钉 tag
#   · 一次混传两种形态 → 照样过（旧版这里拆出裸 hex、再被一致性检查拒绝）
#   · 同一服务传两遍 → 覆盖里只出现一次
#   · 容器不在 / 本地缺镜像 / 册外服务 / 无参 → 在任何 compose 动作之前拒绝；
#     一批里有一个不在 → 整批不动（不会先重建前面几个）
#   · CONTAINER_OF 与 compose.platform.yml 的 service → container_name 一一对账（加服务忘记登记即红）
# 运行：bash deploy/scripts/lib/recreate-service.test.sh
# 对照：RECREATE_SCRIPT 指向改动前的 33（`git show <rev>:deploy/scripts/33-recreate-service.sh > /tmp/x.sh`）
#       时，digest / 混批两组要红——它们就是 2026-09-01 之后生产上的现场。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$LIB_DIR/../.." && pwd)"
SCRIPT="${RECREATE_SCRIPT:-$DEPLOY_DIR/scripts/33-recreate-service.sh}"
COMPOSE_YML="$DEPLOY_DIR/compose.platform.yml"
[ -f "$SCRIPT" ] || { echo "FAIL - 缺 $SCRIPT" >&2; exit 1; }
[ -f "$COMPOSE_YML" ] || { echo "FAIL - 缺 $COMPOSE_YML" >&2; exit 1; }

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1" >&2; fail=1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/runtime" "$T/fx"

# runtime/.env：只要让 load_compose_env 有值可读。地址取文档保留段 203.0.113.0/24，不是任何真机。
cat > "$T/runtime/.env" <<'EOF'
VX_IMAGE_REGISTRY=registry.example.test
VX_IMAGE_NAMESPACE=vxture
VX_IMAGE_TAG=latest
VX_WORKER01_TAILNET_IP=203.0.113.1
VX_WORKER02_TAILNET_IP=203.0.113.2
EOF

# 假 docker：夹具目录 $FAKE_DOCKER_DIR 里
#   containers/<容器名>  内容 = 该容器的 Config.Image；文件不存在 = 容器不在
#   images.txt           本地有的镜像引用，一行一个（`docker image inspect <ref>` 按整行精确匹配）
#   calls.log            每次 docker 调用的 argv（断言「拒绝发生在任何 docker 动作之前」用）
#   compose.args         每次 `docker compose …` 的 argv
#   pinned.yml           compose 收到的最后一个 -f 文件的副本——脚本用完即删，所以在这里截
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
D="${FAKE_DOCKER_DIR:?}"
printf '%s\n' "$*" >> "$D/calls.log"
case "${1:-}" in
  inspect)
    shift
    fmt=""
    if [ "${1:-}" = "--format" ]; then fmt="$2"; shift 2; fi
    cname="${1:?}"
    [ -f "$D/containers/$cname" ] || { echo "Error: No such object: $cname" >&2; exit 1; }
    case "$fmt" in
      "") exit 0 ;;
      "{{.Config.Image}}") cat "$D/containers/$cname" ;;
      *State.Health*) echo healthy ;;
      *) echo "fake docker: 未预期的 inspect --format $fmt" >&2; exit 99 ;;
    esac
    ;;
  image)
    [ "${2:-}" = "inspect" ] || { echo "fake docker: 未预期的 image 子命令 ${2:-}" >&2; exit 99; }
    grep -Fxq -- "${3:?}" "$D/images.txt"
    ;;
  compose)
    shift
    printf '%s\n' "$*" >> "$D/compose.args"
    last=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "-f" ]; then last="$2"; shift; fi
      shift
    done
    if [ -n "$last" ]; then cp "$last" "$D/pinned.yml"; fi
    exit 0
    ;;
  *) echo "fake docker: 未预期的子命令 ${1:-}" >&2; exit 99 ;;
esac
EOF
chmod +x "$T/bin/docker"

REG="registry.example.test/vxture"
# 假 digest：64 位 hex，形状对、内容一眼假；两个不同，正是生产上两服务的样子。
DIG_A="$(printf '%064d' 1)"
DIG_B="$(printf '%064d' 2)"
IMG_AUTH="$REG/platform_bff-auth@sha256:$DIG_A"
IMG_ADMIN="$REG/platform_bff-admin@sha256:$DIG_B"
IMG_WEB_TAG="$REG/platform_website:v0.26.20"

FX=""
fixture() { # fixture <名> → 空夹具
  FX="$T/fx/$1"; rm -rf "$FX"; mkdir -p "$FX/containers"; : > "$FX/images.txt"
}
container() { # container <容器名> <Config.Image> [local=yes|no]
  printf '%s\n' "$2" > "$FX/containers/$1"
  [ "${3:-yes}" = "yes" ] && printf '%s\n' "$2" >> "$FX/images.txt"
  return 0
}
# run33 <服务…>：在当前夹具上真跑脚本；stdout+stderr 进 $OUT，退出码进 $RC
OUT=""; RC=0
run33() {
  set +e
  OUT="$(env PATH="$T/bin:$PATH" FAKE_DOCKER_DIR="$FX" COMPOSE_DIR="$DEPLOY_DIR" RUNTIME_DIR="$T/runtime" \
            bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  set -e
}
pinned_body() { grep -v '^#' "$FX/pinned.yml" 2>/dev/null || true; }
compose_calls() { if [ -f "$FX/compose.args" ]; then grep -c . "$FX/compose.args"; else echo 0; fi; }

# ── 1. digest 形态、两服务、digest 各不相同（钉死后的生产现场）────────────────────────
fixture digest
container vx-platform-auth-bff  "$IMG_AUTH"
container vx-platform-admin-bff "$IMG_ADMIN"
run33 auth-bff admin-bff
expected="$(printf 'services:\n  auth-bff:\n    image: %s\n  admin-bff:\n    image: %s\n' "$IMG_AUTH" "$IMG_ADMIN")"
[ "$RC" -eq 0 ] && ok "digest 两服务 → exit 0（不再「拒绝混批」）" || bad "digest 两服务：rc=$RC out=[$OUT]"
[ "$(pinned_body)" = "$expected" ] && ok "digest 两服务 → 覆盖逐服务 image 原样 = Config.Image" || bad "digest 两服务：覆盖=[$(pinned_body)]"
[ "$(grep -c 'image: .*@sha256:' "$FX/pinned.yml" 2>/dev/null || true)" = "2" ] && ok "digest 两服务 → 两行 image 都保住 @sha256:（没有被拆成裸 hex 的 tag）" || bad "digest 两服务：@sha256: 行数不是 2"
[ "$(compose_calls)" = "1" ] && ok "digest 两服务 → 恰一次 compose up" || bad "digest 两服务：compose 调了 $(compose_calls) 次"
args="$(cat "$FX/compose.args" 2>/dev/null || true)"
case "$args" in
  "-f compose.platform.yml -f "*" up -d --pull never --no-deps --force-recreate auth-bff admin-bff") ok "digest 两服务 → base + 覆盖两份 -f，--pull never --no-deps --force-recreate，只点名目标" ;;
  *) bad "digest 两服务：compose 参数=[$args]" ;;
esac
printf '%s' "$OUT" | grep -q "拒绝混批" && bad "digest 两服务：仍在「拒绝混批」" || ok "digest 两服务 → 输出里没有「拒绝混批」"

# ── 2. tag 形态（钉死前 / 别的主机）──────────────────────────────────────────────
fixture tag
container vx-platform-website "$IMG_WEB_TAG"
run33 website
expected="$(printf 'services:\n  website:\n    image: %s\n' "$IMG_WEB_TAG")"
[ "$RC" -eq 0 ] && [ "$(pinned_body)" = "$expected" ] && ok "tag 形态 → 原样钉 $IMG_WEB_TAG" || bad "tag 形态：rc=$RC 覆盖=[$(pinned_body)] out=[$OUT]"

# ── 3. 混传两种形态 ─────────────────────────────────────────────────────────────
fixture mixed
container vx-platform-website  "$IMG_WEB_TAG"
container vx-platform-auth-bff "$IMG_AUTH"
run33 website auth-bff
expected="$(printf 'services:\n  website:\n    image: %s\n  auth-bff:\n    image: %s\n' "$IMG_WEB_TAG" "$IMG_AUTH")"
[ "$RC" -eq 0 ] && [ "$(pinned_body)" = "$expected" ] && ok "tag + digest 混传 → 各钉各的、按传入顺序" || bad "混传：rc=$RC 覆盖=[$(pinned_body)] out=[$OUT]"

# ── 4. 同一服务传两遍 → 只出现一次 ──────────────────────────────────────────────
fixture dup
container vx-platform-auth-bff "$IMG_AUTH"
run33 auth-bff auth-bff
expected="$(printf 'services:\n  auth-bff:\n    image: %s\n' "$IMG_AUTH")"
[ "$RC" -eq 0 ] && [ "$(pinned_body)" = "$expected" ] && ok "重复传同一服务 → 覆盖里只一次（YAML 不会重键）" || bad "重复：rc=$RC 覆盖=[$(pinned_body)]"
args="$(cat "$FX/compose.args" 2>/dev/null || true)"
case "$args" in *" --force-recreate auth-bff") ok "重复传同一服务 → up 只点名一次" ;; *) bad "重复：compose 参数=[$args]" ;; esac

# ── 5. 拒绝路径：都要在任何 compose 动作之前 ──────────────────────────────────────
fixture absent
run33 opera-bff
[ "$RC" -eq 1 ] && [ "$(compose_calls)" = "0" ] && printf '%s' "$OUT" | grep -q "未运行" && ok "容器不在 → exit 1、零 compose 动作" || bad "容器不在：rc=$RC compose=$(compose_calls) out=[$OUT]"

fixture noimage
container vx-platform-opera-bff "$REG/platform_bff-opera@sha256:$DIG_A" no
run33 opera-bff
[ "$RC" -eq 1 ] && [ "$(compose_calls)" = "0" ] && printf '%s' "$OUT" | grep -q "本地缺少镜像" && ok "本地缺镜像 → exit 1、零 compose 动作" || bad "缺镜像：rc=$RC compose=$(compose_calls) out=[$OUT]"

fixture partial
container vx-platform-auth-bff  "$IMG_AUTH"
container vx-platform-admin-bff "$IMG_ADMIN"
run33 auth-bff opera-bff admin-bff
[ "$RC" -eq 1 ] && [ "$(compose_calls)" = "0" ] && ok "一批里一个不在 → 整批不动（前面的也没重建）" || bad "半批：rc=$RC compose=$(compose_calls)"

fixture unknown
run33 postgres
[ "$RC" -eq 2 ] && [ ! -e "$FX/calls.log" ] && ok "册外服务 postgres → exit 2、一次 docker 都没碰" || bad "册外：rc=$RC calls=[$(cat "$FX/calls.log" 2>/dev/null || true)]"

fixture noargs
run33
[ "$RC" -eq 2 ] && [ ! -e "$FX/calls.log" ] && printf '%s' "$OUT" | grep -q "用法" && ok "无参 → usage、exit 2、一次 docker 都没碰" || bad "无参：rc=$RC out=[$OUT]"

# ── 6. CONTAINER_OF 与 compose.platform.yml 对账 ────────────────────────────────────
compose_pairs="$(tr -d '\r' < "$COMPOSE_YML" | awk '
  /^  [a-z][a-z0-9-]*:[[:space:]]*$/ { svc=$1; sub(/:$/, "", svc) }
  /^    container_name:[[:space:]]/  { print svc "=" $2 }
' | sort)"
script_pairs="$(sed -n '/^declare -A CONTAINER_OF=(/,/^)/p' "$SCRIPT" | grep -oE '^[[:space:]]*\[[a-z0-9-]+\]=[a-z0-9-]+' | sed -E 's/^[[:space:]]*\[([^]]+)\]=/\1=/' | sort || true)"
n_compose="$(printf '%s\n' "$compose_pairs" | grep -c . || true)"
[ -n "$compose_pairs" ] && [ "$compose_pairs" = "$script_pairs" ] && ok "CONTAINER_OF == compose 的 service→container_name（$n_compose 个）" || bad "CONTAINER_OF 与 compose 不一致：compose=[$(printf '%s ' $compose_pairs)] script=[$(printf '%s ' $script_pairs)]"
printf '%s\n' "$script_pairs" | grep -qx 'arche-bff=vx-platform-arche-bff' && ok "arche-bff 在册" || bad "arche-bff 不在册"

if [ "$fail" -eq 0 ]; then
  echo "recreate-service.test: 全部通过"
else
  echo "recreate-service.test: 有失败" >&2
  exit 1
fi
