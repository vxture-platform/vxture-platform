#!/usr/bin/env bash
# deploy/scripts/lib/env-values.sh
# 读 runtime .env 里的值，按人会怎么写它来读：引号、`=` 后的空格、行尾 CR、逗号两侧的空格
# 都不算数。纯文本函数，不碰主机状态，能在本地喂假数据测（见 env-values.test.sh）。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-29
#
# 为什么要有这个（2026-08-29，v0.26.3 部署在 13 步就停）：
#   31 脚本的契约检查是 `case ",$value," in *,accounts.vxture.com,*`。值里只要有一处
#   引号、`= ` 后的空格、或 Windows 行尾的 \r，就匹配不上——而 runtime .env 是人手维护的，
#   这三样每一样都会出现。它此前检查 console.vxture.com 时碰巧过了，换成 accounts 就
#   撞上了。守卫读值必须按值的语义读，不能按字节碰运气；读不出来要说清是哪一行。

# env_value <file> <KEY>
#   最后一次出现的 KEY= 的值；剥两侧空白、成对的单/双引号、行尾 CR。KEY 不存在输出空。
env_value() {
  local file="$1" key="$2" raw
  raw="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1 || true)"
  [ -n "$raw" ] || { printf ''; return 0; }
  raw="${raw#*=}"
  raw="${raw//$'\r'/}"
  # trim
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  # strip one pair of matching quotes
  case "$raw" in
    \"*\") raw="${raw#\"}"; raw="${raw%\"}" ;;
    \'*\') raw="${raw#\'}"; raw="${raw%\'}" ;;
  esac
  printf '%s' "$raw"
}

# csv_contains <csv-value> <item>
#   逗号分隔的值里有没有这一项；每项两侧空白忽略，大小写不敏感（主机名）。
csv_contains() {
  local csv="$1" want="$2" item
  want="$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')"
  IFS=',' read -r -a parts <<< "$csv"
  for item in "${parts[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    item="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]')"
    [ "$item" = "$want" ] && return 0
  done
  return 1
}
