#!/usr/bin/env bash
# deploy/scripts/lib/pin-image-digests.sh
# 把一个「按 tag」的镜像引用解析成「按 amd64 内容 digest」的引用。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
#
# 为什么存在（2026-09-01 事故 + 坐实）：
#   平台栈 14 个服务共用一个全局 ${VX_IMAGE_TAG}。每次发版 tag 前移，未变更镜像
#   走 B11 retag（`imagetools create`）把上一版的**单 manifest 重新包成一个新
#   多架构 index** —— 顶层 digest 每版必变，尽管里面真正跑的 amd64 子镜像一字未改
#   （实测：platform_admin v0.26.19 单 manifest = sha256:5b50da…；v0.26.20 顶层
#   index = 43d4e8…，但其 amd64 子 = 5b50da…，与上一版同）。docker compose 判是否
#   recreate 看的是「服务配置（含 image 串/引用 digest）」是否变，于是**14 个全被
#   认成变了 → 全量重建**，在 2C2G 上一次齐重建把内存打爆、CPU 焊死、SSHD 饿死。
#
#   根治：部署时把每个服务钉到它 amd64 平台 manifest 的 digest（内容没变则该 digest
#   不变 → compose 配置不变 → 不重建；内容变了则该 digest 变 → 只那个重建）。钉的
#   必须是 **amd64 平台 manifest digest（稳定）**，不是顶层 index digest（retag 会变）。
#
# 用法：
#   . lib/pin-image-digests.sh
#   pinned_ref="$(pin_image_ref "registry/ns/platform_admin:v0.26.20")"
#     -> "registry/ns/platform_admin@sha256:5b50da…"
# 也可当 CLI 直接跑（便于离线核验稳定性）：
#   bash lib/pin-image-digests.sh registry/ns/platform_admin:v0.26.20
#
# 依赖：docker buildx（imagetools）+ node（宿主机有，无 jq）。已对目标 registry
# 完成 docker login（deploy 里 ACR/GHCR 均已 login）。
set -o pipefail

# resolve_amd64_digest <image-ref> -> 打印 sha256:...（amd64/linux 平台 manifest 的 digest）
# 处理三种形态：
#   - 多架构 index：取 platform.architecture=="amd64" && os=="linux" 的子 .digest，
#     显式排除 attestation/unknown（architecture=="unknown" 或 platform 缺失）。
#   - 单 manifest（无 .manifests）：该 ref 自身的 descriptor digest 即内容 digest，
#     用 --format '{{.Manifest.Digest}}' 取（对单 manifest 它就是内容 digest）。
resolve_amd64_digest() {
  local ref="$1"
  local raw digest

  raw="$(docker buildx imagetools inspect "$ref" --raw 2>/dev/null)" || {
    echo "pin-image-digests: 无法 inspect $ref（未 login 或 tag 不存在？）" >&2
    return 1
  }

  # node 解析 --raw JSON：是 index 就吐 amd64 子 digest；是单 manifest 就吐空串 + 退 2。
  digest="$(
    printf '%s' "$raw" | node -e '
      let s = "";
      process.stdin.on("data", d => (s += d));
      process.stdin.on("end", () => {
        let m;
        try { m = JSON.parse(s); } catch (e) { process.stderr.write("bad json\n"); process.exit(3); }
        if (Array.isArray(m.manifests)) {
          const amd = m.manifests.find(
            x => x && x.platform &&
                 x.platform.architecture === "amd64" &&
                 x.platform.os === "linux"
          );
          if (!amd || !amd.digest) { process.stderr.write("no amd64/linux child\n"); process.exit(4); }
          process.stdout.write(String(amd.digest));
        } else {
          // 单 manifest：无子列表，交给 shell 走 --format 兜底。
          process.exit(2);
        }
      });
    '
  )"
  local rc=$?

  if [ "$rc" -eq 2 ]; then
    # 单 manifest：descriptor digest 即内容 digest。
    digest="$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}' 2>/dev/null)" || {
      echo "pin-image-digests: 单 manifest 取 digest 失败 $ref" >&2
      return 1
    }
  elif [ "$rc" -ne 0 ]; then
    echo "pin-image-digests: 解析 $ref 的 amd64 digest 失败（rc=$rc）" >&2
    return 1
  fi

  case "$digest" in
    sha256:*) printf '%s' "$digest" ;;
    *) echo "pin-image-digests: $ref 解析出的 digest 非法：'$digest'" >&2; return 1 ;;
  esac
}

# pin_image_ref <image-ref-with-tag> -> "<name-without-tag>@sha256:..."
# 只接受带 tag 的引用（registry[:port]/ns/name:tag）；已是 @sha256 的原样返回。
pin_image_ref() {
  local ref="$1" name_no_tag digest

  case "$ref" in
    *@sha256:*) printf '%s' "$ref"; return 0 ;;  # 已钉，幂等
  esac

  # 去掉最后一个 ":tag"（registry 的 :port 在更前面，不受影响）。
  name_no_tag="${ref%:*}"
  if [ "$name_no_tag" = "$ref" ]; then
    echo "pin-image-digests: $ref 不含 tag，无法钉" >&2
    return 1
  fi

  digest="$(resolve_amd64_digest "$ref")" || return 1
  printf '%s@%s' "$name_no_tag" "$digest"
}

# 直接执行时当 CLI：对每个参数打印「原引用 -> 钉后引用」。
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  for arg in "$@"; do
    printf '%s -> %s\n' "$arg" "$(pin_image_ref "$arg")"
  done
fi
