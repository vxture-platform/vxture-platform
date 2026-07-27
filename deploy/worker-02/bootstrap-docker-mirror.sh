#!/usr/bin/env bash
# deploy/worker-02/bootstrap-docker-mirror.sh
# 一次性：worker-02 Docker daemon registry-mirrors 配置。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
#
# worker-01 的 deploy-manual-init/bootstrap/11-bootstrap-host.sh 早就给
# /etc/docker/daemon.json 配了 registry-mirrors（vp6xaxdh.mirror.aliyuncs.com
# 等），worker-02 从未有对应脚本 —— postgres:18-alpine / redis:8-alpine /
# 未来任何 docker.io 基础镜像，都在直连 docker.io，没有走镜像加速。
# 本脚本只做这一件事，不重跑 worker-01 脚本里那套 DNS/UFW/swap/tailscale/
# node 初始化 —— worker-02 已在正常运行 varda，不动其余已验证配置。
#
# 运行：sudo bash bootstrap-docker-mirror.sh
# 幂等：重复运行安全（daemon.json 整份覆盖为同一份内容）
#
# 注意：会 systemctl restart docker，短暂中断 worker-02 上所有运行中的容器
# （varda-pg/varda-redis/varda-server/varda-bff）。建议在低峰期手动执行，
# 执行后用 `docker compose -f /srv/md0/varda/deploy/compose.varda.yml ps`
# 确认容器已自动拉起（restart: unless-stopped）。
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 sudo bash bootstrap-docker-mirror.sh 运行" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "错误：未检测到 docker，worker-02 应已装好 docker（正在跑 varda 栈）。请先确认环境。" >&2
  exit 1
fi

echo "==> 配置 Docker daemon registry mirrors 与日志限制（与 worker-01 同一份）"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://vp6xaxdh.mirror.aliyuncs.com",
    "https://docker.m.daocloud.io",
    "https://dockerhub.icu",
    "https://hub.rat.dev"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

echo "==> 重启 docker（会短暂中断本机所有运行中的容器）"
systemctl restart docker
docker info >/dev/null

echo ""
echo "完成。建议核实 varda 栈已自动拉起："
echo "  docker compose -f /srv/md0/varda/deploy/compose.varda.yml ps"
