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
#   · 仓里别处（.github/workflows、deploy/scripts）不得再长一份「拆 tag + compose up --force-recreate」
#     ——db-init.yml 的 provision-secrets / sync-env 曾各抄一份，修 33 时没人看见；负例喂旧块
#   · tailnet :8081 的前置门（E1 PR D）：auth-bff 在目标里、主机还在切换中（auth-bff 直接发布着 :8081、
#     compose 已无 ports:）→ 在任何 compose 动作之前拒绝、指向 31；nginx 已接（docker 会把它的 8080+8081
#     折成一个区间，假 docker 按同样的绑定喂）/ 旧 bundle 的 compose 仍带 ports: / 目标不含 auth-bff → 放行
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
#   containers/<容器名>  内容 = 该容器的 Config.Image；文件不存在 = 容器不在（`docker ps --format '{{.Names}}'` 列的就是这些）
#   bindings.txt         宿主口绑定 <容器名>\t<宿主 IP>\t<宿主口>\t<容器口/协议>，一绑定一行；
#                        `docker inspect --format <NetworkSettings.Ports 模板> <名>…` 按它吐行（lib/nginx-idp-port.sh 的判据）
#   images.txt           本地有的镜像引用，一行一个（`docker image inspect <ref>` 按整行精确匹配）
#   calls.log            每次 docker 调用的 argv（断言「拒绝发生在任何 docker 动作之前」用）
#   compose.args         每次 `docker compose …` 的 argv
#   pinned.yml           compose 收到的最后一个 -f 文件的副本——脚本用完即删，所以在这里截
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
D="${FAKE_DOCKER_DIR:?}"
printf '%s\n' "$*" >> "$D/calls.log"
case "${1:-}" in
  ps)
    [ "$*" = "ps --format {{.Names}}" ] || { echo "fake docker: 未预期的 ps 参数 $*" >&2; exit 99; }
    ls "$D/containers"
    ;;
  inspect)
    shift
    fmt=""
    if [ "${1:-}" = "--format" ]; then fmt="$2"; shift 2; fi
    case "$fmt" in
      *NetworkSettings.Ports*)
        rc=0
        for c in "$@"; do
          [ -f "$D/containers/$c" ] || { echo "Error: No such object: $c" >&2; rc=1; continue; }
          awk -F'\t' -v OFS='\t' -v n="$c" '$1 == n { print "/" $1, $2, $3, $4 }' "$D/bindings.txt" 2>/dev/null
          echo
        done
        exit $rc
        ;;
    esac
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
  FX="$T/fx/$1"; rm -rf "$FX"; mkdir -p "$FX/containers"; : > "$FX/images.txt"; : > "$FX/bindings.txt"
}
container() { # container <容器名> <Config.Image> [local=yes|no]
  printf '%s\n' "$2" > "$FX/containers/$1"
  [ "${3:-yes}" = "yes" ] && printf '%s\n' "$2" >> "$FX/images.txt"
  return 0
}
binding() { # binding <容器名> <宿主 IP> <宿主口> <容器口/协议>
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$FX/bindings.txt"
}
# run33 <服务…>：在当前夹具上真跑脚本；stdout+stderr 进 $OUT，退出码进 $RC。
# RUN33_COMPOSE_DIR 可指向别的 bundle 目录（第 9 组用一份 auth-bff 仍带 ports: 的旧 compose）。
OUT=""; RC=0
run33() {
  set +e
  OUT="$(env PATH="$T/bin:$PATH" FAKE_DOCKER_DIR="$FX" COMPOSE_DIR="${RUN33_COMPOSE_DIR:-$DEPLOY_DIR}" RUNTIME_DIR="$T/runtime" \
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

# ── 7. 重建的调用方只认 33：仓里别处不得再长一份「拆 tag + compose up --force-recreate」──────
# db-init.yml 的 provision-secrets / sync-env 两步曾各抄一份旧机制（`VX_IMAGE_TAG="${IMG##*:}"` +
# `compose up --force-recreate`，没有 --pull never）：digest 钉死后它们解析出本地 / 仓里都没有的
# `img:<hex>`，而且是在 27 已经铸完密钥之后才失败——新值永远加载不进去。修 33 时只修了 33，
# 这两份抄本没人看见。这里扫 workflow 与 deploy/scripts：凡自带 --force-recreate 或从镜像引用
# 拆 VX_IMAGE_TAG 即红（33 本身与 *.test.sh 除外）；负例喂旧块证明扫描器看得见。
scan_recreate_callers() { # scan_recreate_callers <file…> → 命中行 file:line:text
  grep -n -H -E -e '--force-recreate' -e 'VX_IMAGE_TAG=.*##\*:' "$@" 2>/dev/null || true
}
callers=(); n_wf=0
for f in "$DEPLOY_DIR/../.github/workflows/"*.yml "$DEPLOY_DIR/scripts/"*.sh "$DEPLOY_DIR/scripts/lib/"*.sh; do
  [ -f "$f" ] || continue
  case "$f" in */33-recreate-service.sh|*.test.sh) continue ;; esac
  case "$f" in */.github/workflows/*) n_wf=$((n_wf + 1)) ;; esac
  callers+=("$f")
done
hits="$(scan_recreate_callers "${callers[@]}")"
if [ -d "$DEPLOY_DIR/../.github/workflows" ]; then
  # 仓内跑：曾经长着抄本的那份 workflow 必须在扫描范围里，否则「零命中」只是没看。
  printf '%s\n' "${callers[@]}" | grep -q '/db-init\.yml$' && ok "扫描范围含 db-init.yml（workflow $n_wf 份）" || bad "扫描范围漏了 db-init.yml：workflow 只扫到 $n_wf 份"
fi
[ "${#callers[@]}" -gt 0 ] && [ -z "$hits" ] && ok "重建调用方只认 33（扫了 ${#callers[@]} 个 workflow / 脚本，零处自带 --force-recreate 或拆 tag）" || bad "别处仍长着旧重建机制（扫了 ${#callers[@]} 个）：$hits"

mkdir -p "$T/fx/neg"
cat > "$T/fx/neg/old-db-init-block.yml" <<'EOF'
                IMG="$(docker inspect --format '{{.Config.Image}}' vx-platform-auth-bff)"
                export VX_IMAGE_TAG="${IMG##*:}"
                REPO="${IMG%:*}"
                docker compose -f compose.platform.yml up -d --force-recreate --no-deps \
                  auth-bff website-bff console-bff admin-bff
EOF
neg="$(scan_recreate_callers "$T/fx/neg/old-db-init-block.yml")"
[ "$(printf '%s\n' "$neg" | grep -c .)" = "2" ] && ok "负例：旧 db-init 块被扫出 2 行（拆 tag + --force-recreate）" || bad "负例：扫描器没看见旧块：[$neg]"

# ── 8. db-init.yml 真正传给 33 的那几行：逐名在册，且整条命令在假主机上跑通 ─────────────────
# 名字打错一个（或加了服务没登记）→ 33 exit 2，而那时 27 已经铸完密钥、29 已经重 seed——
# 和旧抄本一样的后果。所以不只扫「有没有调 33」，还把每次调用的参数原样喂给 33 跑一遍。
# RECREATE_DBINIT 可指向别的副本（对照：指向改动前的 db-init.yml → 「只找到 0 处」红）。
DBINIT="${RECREATE_DBINIT:-$DEPLOY_DIR/../.github/workflows/db-init.yml}"
if [ -f "$DBINIT" ]; then
  # 取每次 `bash scripts/33-recreate-service.sh …` 的参数（含 `\` 续行），一次调用一行
  invocations="$(tr -d '\r' < "$DBINIT" | awk '
    function flush() { gsub(/[[:space:]]+/, " ", acc); sub(/^ /, "", acc); sub(/ $/, "", acc); if (acc != "") print acc; acc = "" }
    /bash scripts\/33-recreate-service\.sh/ {
      sub(/.*33-recreate-service\.sh/, ""); acc = $0
      if (acc ~ /\\[[:space:]]*$/) { sub(/\\[[:space:]]*$/, "", acc); cont = 1 } else { cont = 0; flush() }
      next
    }
    cont {
      line = $0
      if (line ~ /\\[[:space:]]*$/) { sub(/\\[[:space:]]*$/, "", line); acc = acc " " line } else { acc = acc " " line; cont = 0; flush() }
    }
  ')"
  n_inv="$(printf '%s\n' "$invocations" | grep -c . || true)"
  [ "$n_inv" -ge 2 ] && ok "db-init.yml 调 33 共 $n_inv 处（provision-secrets + sync-env）" || bad "db-init.yml 调 33 只找到 $n_inv 处：[$invocations]"
  i=0
  while IFS= read -r inv; do
    [ -n "$inv" ] || continue
    i=$((i + 1))
    fixture "dbinit$i"
    for s in $inv; do
      c="$(printf '%s\n' "$script_pairs" | sed -n "s/^$s=//p")"
      [ -n "$c" ] || { bad "db-init 第 $i 处传了册外服务 '$s'——33 会 exit 2，密钥已铸、容器没重建"; continue; }
      container "$c" "$REG/platform_$s@sha256:$DIG_A"
    done
    # shellcheck disable=SC2086
    run33 $inv
    n_svc="$(printf '%s\n' $inv | sort -u | grep -c .)"
    [ "$RC" -eq 0 ] && [ "$(grep -c '^    image: ' "$FX/pinned.yml" 2>/dev/null || true)" = "$n_svc" ] && ok "db-init 第 $i 处（$inv）→ 33 exit 0，覆盖钉 $n_svc 个服务" || bad "db-init 第 $i 处（$inv）：rc=$RC out=[$OUT]"
  done <<EOF
$invocations
EOF
fi

# ── 9. tailnet :8081 的前置门（E1 PR D）：切换中的主机上不许重建 auth-bff ──────────────────────
# 现场 = PR D 的 bundle 已上机（compose.platform.yml 不再给 auth-bff ports:），31 却没走到 30 的 auth-bff
# 那步：auth-bff 还直接发布着 :8081。此时 db-init 的 provision-secrets / sync-env（都经 33 重建 auth-bff）
# 或手跑 33 会把宿主口放掉而没人接——产品换票口无人服务，直到有人重跑 31。
echo "== 第 9 组：切换中的主机"
fixture cutover_legacy
container vx-platform-auth-bff  "$IMG_AUTH"
container vx-platform-admin-bff "$IMG_ADMIN"
binding vx-platform-auth-bff 203.0.113.1 8081 3081/tcp
run33 auth-bff
[ "$RC" -eq 1 ] && [ "$(compose_calls)" = "0" ] && printf '%s' "$OUT" | grep -q "31" && printf '%s' "$OUT" | grep -q "8081" \
  && ok "切换中 + 目标 auth-bff → exit 1、零 compose 动作、指向 31" || bad "cutover_legacy：rc=$RC compose=$(compose_calls) out=[$OUT]"
run33 auth-bff admin-bff
[ "$RC" -eq 1 ] && [ "$(compose_calls)" = "0" ] && ok "切换中 + 一批里含 auth-bff → 整批不动" || bad "cutover_legacy·batch：rc=$RC compose=$(compose_calls)"
run33 admin-bff
[ "$RC" -eq 0 ] && [ "$(compose_calls)" = "1" ] && ok "切换中 + 目标不含 auth-bff → 不问 :8081，照常重建" || bad "cutover_legacy·admin：rc=$RC compose=$(compose_calls) out=[$OUT]"

fixture cutover_done                                                             # 已交接：nginx 发布 8080+8081（docker 会折成一个区间，判据不读那一列）
container vx-platform-auth-bff "$IMG_AUTH"
container vxture-nginx "nginx:1.29-alpine"
binding vxture-nginx 203.0.113.1 8080 8080/tcp
binding vxture-nginx 203.0.113.1 8081 8081/tcp
run33 auth-bff
[ "$RC" -eq 0 ] && [ "$(compose_calls)" = "1" ] && printf '%s' "$OUT" | grep -q "现场：nginx" && ok "已交接（nginx 发布 :8081）+ 目标 auth-bff → 放行、恰一次 compose up" || bad "cutover_done：rc=$RC compose=$(compose_calls) out=[$OUT]"

fixture cutover_none                                                             # 没人发布：33 不是修这个的地方
container vx-platform-auth-bff "$IMG_AUTH"
run33 auth-bff
[ "$RC" -eq 0 ] && [ "$(compose_calls)" = "1" ] && ok "没人发布 :8081 + 目标 auth-bff → 放行（重建不改变它）" || bad "cutover_none：rc=$RC out=[$OUT]"

# 旧 bundle：compose 仍给 auth-bff ports:（db-init 的 ref 新、deploy 的 ref 旧时会这样）→ 重建后它自己再发布一次，放行
OLD_BUNDLE="$T/oldbundle"; mkdir -p "$OLD_BUNDLE/scripts"; cp -R "$DEPLOY_DIR/scripts/lib" "$OLD_BUNDLE/scripts/lib"
awk '{ print } /^    container_name: vx-platform-auth-bff$/ { print "    ports:"; print "      - \"${VX_WORKER01_TAILNET_IP:?set it in runtime/.env}:8081:3081\"" }' "$COMPOSE_YML" > "$OLD_BUNDLE/compose.platform.yml"
grep -q ':8081:3081' "$OLD_BUNDLE/compose.platform.yml" || bad "旧 bundle 夹具没插进 ports:（compose 的 auth-bff 段形状变了？）"
fixture cutover_oldcompose
container vx-platform-auth-bff "$IMG_AUTH"
binding vx-platform-auth-bff 203.0.113.1 8081 3081/tcp
RUN33_COMPOSE_DIR="$OLD_BUNDLE" run33 auth-bff
[ "$RC" -eq 0 ] && [ "$(compose_calls)" = "1" ] && ok "切换中 + 旧 bundle 的 compose 仍带 ports: → 放行" || bad "cutover_oldcompose：rc=$RC out=[$OUT]"

# 接线：33 source 了库，门在 [1/3] 之后、compose up 之前
l_src="$(grep -n 'lib/nginx-idp-port.sh' "$SCRIPT" | grep -v '^[0-9]*:#' | head -1 | cut -d: -f1)"
l_guard="$(grep -n 'idp_alias_guard_recreate "\$COMPOSE_FILE"' "$SCRIPT" | head -1 | cut -d: -f1)"
l_up="$(grep -n 'up -d --pull never --no-deps --force-recreate' "$SCRIPT" | head -1 | cut -d: -f1)"
[ -n "$l_src" ] && [ -n "$l_guard" ] && [ -n "$l_up" ] && [ "$l_src" -lt "$l_guard" ] && [ "$l_guard" -lt "$l_up" ] \
  && ok "33 接线：source 库（:$l_src）→ 门（:$l_guard）→ compose up（:$l_up）" || bad "33 接线：src=$l_src guard=$l_guard up=$l_up"

if [ "$fail" -eq 0 ]; then
  echo "recreate-service.test: 全部通过"
else
  echo "recreate-service.test: 有失败" >&2
  exit 1
fi
