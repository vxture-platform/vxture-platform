#!/usr/bin/env bash
# deploy/scripts/lib/runtime-file-lists.test.sh
# 「主机上必须有哪些运行参数文件」这张清单住在五处，彼此没有引用，漂了不报错：
#   30-deploy [1/4] check_file · 40-verify check_required_files · 51-alerts check_runtime_files
#   53-backup copy_if_exists（secrets）· 61-restore restore_*（.env.<svc> 与 secrets）
# 2026-10-04 实测漂法：53 备了 idp-internal / sms / identity / app，61 一个都不恢复；30 要
# .env.arche-bff 而 40 / 51 不知道它；compose 短语法引用 sms / identity / app 而 30 不拦。
# 本测试从各脚本**文本**里抽清单（不跑它们——它们要 root / docker / 主机），断言：
#   ① 30 == 40 == 51（$RUNTIME_DIR 相对路径集合）
#   ② compose.platform.yml 引用的每一份 /srv/vxture/runtime/<x> 都在 30 的清单里
#   ③ 53 备的 secrets 集合 == 61 恢复的 secrets 集合
#   ④ 30 要的每一份 .env* 61 都恢复
# 反例：各改一份脚本的临时副本（删一行），同一套断言必须变红——否则这套抽取是瞎的。
# 运行：bash deploy/scripts/lib/runtime-file-lists.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$LIB_DIR/.."
DEPLOY="$LIB_DIR/../.."
S30="$SCRIPTS/30-deploy-platform-stack.sh"
S40="$SCRIPTS/40-verify-platform-runtime.sh"
S51="$SCRIPTS/51-check-platform-alerts.sh"
S53="$DEPLOY/maintenance/53-backup-deploy-params.sh"
S61="$DEPLOY/maintenance/61-restore-deploy-params.sh"
COMPOSE="$DEPLOY/compose.platform.yml"
for f in "$S30" "$S40" "$S51" "$S53" "$S61" "$COMPOSE"; do [ -f "$f" ] || { echo "FAIL - 缺 $f" >&2; exit 1; }; done

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1" >&2; fail=1; }

# ── 抽取（只认脚本里真正会执行的那种写法；注释里提到的路径不算）──
list_30()      { grep -oE '^check_file "\$RUNTIME_DIR/[^"]+"' "$1"            | sed -E 's#.*RUNTIME_DIR/([^"]+)"#\1#' | sort -u; }
list_40()      { grep -oE '^  check_file "\$RUNTIME_DIR/[^"]+"' "$1"          | sed -E 's#.*RUNTIME_DIR/([^"]+)"#\1#' | sort -u; }
list_51()      { grep -oE '^  check_required_file "\$RUNTIME_DIR/[^"]+"' "$1" | sed -E 's#.*RUNTIME_DIR/([^"]+)"#\1#' | sort -u; }
list_compose() { grep -vE '^[[:space:]]*#' "$1" | grep -oE '/srv/vxture/runtime/[^,[:space:]"]+' | sed 's#/srv/vxture/runtime/##' | sort -u; }
list_53_sec()  { grep -oE '^copy_if_exists "\$RUNTIME_DIR/secrets/[^"]+"' "$1" | sed -E 's#.*secrets/([^"]+)"#\1#' | sort -u; }
list_61_sec()  { grep -oE '^restore_(required|optional|minted) "\$BACKUP_DIR/runtime/secrets/[^"]+"' "$1" | sed -E 's#.*secrets/([^"]+)"#\1#' | sort -u; }
list_61_env()  { grep -oE '^restore_(required|optional|minted) "\$BACKUP_DIR/runtime/\.env[^"]*"' "$1" | sed -E 's#.*runtime/([^"]+)"#\1#' | sort -u; }

# missing <label> <expected-list> <actual-list>：expected 里有、actual 里没有的每一项都报
missing() {
  local label="$1" exp="$2" act="$3" diff
  diff="$(comm -23 <(printf '%s\n' "$exp" | sed '/^$/d' | sort -u) <(printf '%s\n' "$act" | sed '/^$/d' | sort -u) | tr '\n' ' ' | sed 's/ $//')"
  [ -z "$diff" ] && return 0
  echo "    $label 缺：$diff"
  return 1
}

# check_all <30> <40> <51> <compose> <53> <61> → 0 全过 / 1 有缺；每条断言单独一行
check_all() {
  local s30="$1" s40="$2" s51="$3" compose="$4" s53="$5" s61="$6" rc=0
  local l30 l40 l51 lc l53 l61s l61e
  l30="$(list_30 "$s30")"; l40="$(list_40 "$s40")"; l51="$(list_51 "$s51")"
  lc="$(list_compose "$compose")"; l53="$(list_53_sec "$s53")"; l61s="$(list_61_sec "$s61")"; l61e="$(list_61_env "$s61")"
  [ -n "$l30" ] && [ -n "$l40" ] && [ -n "$l51" ] && [ -n "$lc" ] && [ -n "$l53" ] && [ -n "$l61s" ] && [ -n "$l61e" ] \
    || { echo "    某份清单抽出来是空的（30=$(echo "$l30" | wc -l) 40=$(echo "$l40" | wc -l) 51=$(echo "$l51" | wc -l) compose=$(echo "$lc" | wc -l) 53=$(echo "$l53" | wc -l) 61s=$(echo "$l61s" | wc -l) 61e=$(echo "$l61e" | wc -l)）—— 抽取瞎了，不是通过"; return 1; }
  missing "① 40-verify（相对 30）" "$l30" "$l40" || rc=1
  missing "① 30-deploy（相对 40）" "$l40" "$l30" || rc=1
  missing "① 51-alerts（相对 30）" "$l30" "$l51" || rc=1
  missing "① 30-deploy（相对 51）" "$l51" "$l30" || rc=1
  missing "② 30-deploy（相对 compose env_file）" "$lc" "$l30" || rc=1
  missing "③ 61-restore secrets（相对 53）" "$l53" "$l61s" || rc=1
  missing "③ 53-backup secrets（相对 61）" "$l61s" "$l53" || rc=1
  missing "④ 61-restore .env*（相对 30）" "$(printf '%s\n' "$l30" | grep '^\.env')" "$l61e" || rc=1
  return $rc
}

echo "== 真仓"
if check_all "$S30" "$S40" "$S51" "$COMPOSE" "$S53" "$S61"; then
  ok "五处清单一致（30 清单 $(list_30 "$S30" | wc -l | tr -d ' ') 项；compose 引用 $(list_compose "$COMPOSE" | wc -l | tr -d ' ') 项；secrets 备/恢 $(list_53_sec "$S53" | wc -l | tr -d ' ') 项）"
else
  bad "五处清单不一致（见上）"
fi

# 对照组：抽出来的清单里要有本次登记的那几份，否则「一致」可能是「一致地空」
for want in .env.arche-bff .env.opera-bff secrets/platform-idp-internal.env secrets/platform-sms.env; do
  list_30 "$S30" | grep -qx "$want" && ok "30 的清单里有 $want" || bad "30 的清单里没有 $want"
done
list_61_sec "$S61" | grep -qx "platform-idp-internal.env" && ok "61 恢复 platform-idp-internal.env" || bad "61 不恢复 platform-idp-internal.env"

# ── 反例：各删一行，断言要红 ──
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mutate() { grep -vF "$2" "$1" > "$3"; }

mutate "$S61" 'runtime/.env.arche-bff"' "$T/61a.sh"
check_all "$S30" "$S40" "$S51" "$COMPOSE" "$S53" "$T/61a.sh" >/dev/null && bad "反例：61 不恢复 .env.arche-bff 却绿" || ok "反例：61 少恢复 .env.arche-bff → 红"

mutate "$S61" 'secrets/platform-idp-internal.env"' "$T/61b.sh"
check_all "$S30" "$S40" "$S51" "$COMPOSE" "$S53" "$T/61b.sh" >/dev/null && bad "反例：61 不恢复 idp-internal 却绿" || ok "反例：61 少恢复 secrets/platform-idp-internal.env → 红"

mutate "$S40" 'secrets/platform-idp-internal.env"' "$T/40.sh"
check_all "$S30" "$T/40.sh" "$S51" "$COMPOSE" "$S53" "$S61" >/dev/null && bad "反例：40 不查 idp-internal 却绿" || ok "反例：40 少查 secrets/platform-idp-internal.env → 红"

mutate "$S51" '.env.arche-bff"' "$T/51.sh"
check_all "$S30" "$S40" "$T/51.sh" "$COMPOSE" "$S53" "$S61" >/dev/null && bad "反例：51 不查 .env.arche-bff 却绿" || ok "反例：51 少查 .env.arche-bff → 红"

mutate "$S30" 'secrets/platform-sms.env"' "$T/30.sh"
check_all "$T/30.sh" "$S40" "$S51" "$COMPOSE" "$S53" "$S61" >/dev/null && bad "反例：30 不拦 compose 引用的 sms 却绿" || ok "反例：30 少拦 compose 引用的 secrets/platform-sms.env → 红"

mutate "$S53" 'secrets/platform-app.env"' "$T/53.sh"
check_all "$S30" "$S40" "$S51" "$COMPOSE" "$T/53.sh" "$S61" >/dev/null && bad "反例：53 不备 app 却绿" || ok "反例：53 少备 secrets/platform-app.env → 红"

# compose 新引用一份文件而 30 不知道
{ cat "$COMPOSE"; printf '\n      - /srv/vxture/runtime/secrets/zz-new.env\n'; } > "$T/compose.yml"
check_all "$S30" "$S40" "$S51" "$T/compose.yml" "$S53" "$S61" >/dev/null && bad "反例：compose 多引用一份 30 不拦却绿" || ok "反例：compose 新引用 secrets/zz-new.env 而 30 不拦 → 红"

exit $fail
