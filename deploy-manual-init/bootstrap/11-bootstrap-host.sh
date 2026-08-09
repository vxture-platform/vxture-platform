#!/usr/bin/env bash
# deploy-manual-init/bootstrap/11-bootstrap-host.sh
# 一次性服务器初始化（VXTURE_DEPLOY_HOST / 阿里云 ECS Ubuntu 26.04 LTS）
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-02
#
# 运行：sudo bash 11-bootstrap-host.sh
# 幂等：重复运行安全
set -euo pipefail

DATA_MOUNT_POINT="${DATA_MOUNT_POINT:-/srv/vxture/data}"
DEPLOY_WORK_DIR="${DEPLOY_WORK_DIR:-/srv/vxture/deploy}"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
BACKUP_DIR="${BACKUP_DIR:-/srv/vxture/backups}"
DATA_DEVICE="${DATA_DEVICE:-}"
TARGET_HOSTNAME="${TARGET_HOSTNAME:-VXTURE_DEPLOY_HOST}"
NODE_MAJOR=24
PNPM_VERSION=10.30.3
OWNER_USER="${SUDO_USER:-}"
POSTGRES_DATA_UID="${POSTGRES_DATA_UID:-70}"
POSTGRES_DATA_GID="${POSTGRES_DATA_GID:-70}"
REQUIRED_UBUNTU_VERSION=26.04
BOOTSTRAP_DNS_SERVERS="${BOOTSTRAP_DNS_SERVERS:-223.5.5.5 119.29.29.29 1.1.1.1 8.8.8.8}"
REQUIRED_DNS_HOSTS="download.docker.com deb.nodesource.com pkgs.tailscale.com github.com"
APT_MIRROR_URL="${APT_MIRROR_URL:-https://mirrors.aliyun.com/ubuntu}"
UBUNTU_SOURCES_FILE="/etc/apt/sources.list.d/ubuntu.sources"

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 sudo bash 11-bootstrap-host.sh 运行"
  exit 1
fi

check_os_baseline() {
  if [ ! -f /etc/os-release ]; then
    echo "错误：无法读取 /etc/os-release"
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "$REQUIRED_UBUNTU_VERSION" ]; then
    echo "错误：当前系统为 ${PRETTY_NAME:-unknown}，本脚本目标系统为 Ubuntu $REQUIRED_UBUNTU_VERSION LTS"
    exit 1
  fi
}

check_dns_hosts() {
  local host
  local failed=0

  for host in $REQUIRED_DNS_HOSTS; do
    if getent hosts "$host" >/dev/null 2>&1; then
      echo "DNS OK: $host"
    else
      echo "DNS MISS: $host"
      failed=1
    fi
  done

  return "$failed"
}

repair_dns_resolution() {
  local primary_interface

  mkdir -p /etc/systemd/resolved.conf.d
  cat > /etc/systemd/resolved.conf.d/10-vxture-bootstrap-dns.conf <<EOF
# Vxture bootstrap DNS fallback
[Resolve]
DNS=$BOOTSTRAP_DNS_SERVERS
FallbackDNS=$BOOTSTRAP_DNS_SERVERS
EOF
  systemctl restart systemd-resolved || true

  primary_interface="$(ip route show default 2>/dev/null | awk 'NR==1 {print $5}')"
  if [ -n "$primary_interface" ] && command -v resolvectl >/dev/null 2>&1; then
    resolvectl dns "$primary_interface" $BOOTSTRAP_DNS_SERVERS || true
    resolvectl domain "$primary_interface" "~." || true
    echo "已设置 $primary_interface DNS：$BOOTSTRAP_DNS_SERVERS"
  fi
}

ensure_dns_resolution() {
  echo "==> [preflight] 检查系统与 DNS"
  check_os_baseline

  if check_dns_hosts; then
    return
  fi

  echo "检测到 DNS 解析失败，尝试写入 bootstrap DNS 并重启 systemd-resolved"
  repair_dns_resolution
  sleep 2

  if ! check_dns_hosts; then
    echo "错误：DNS 仍不可用。请先修复服务器 DNS 后再运行本脚本。"
    echo "当前 /etc/resolv.conf："
    cat /etc/resolv.conf || true
    echo ""
    echo "当前 resolvectl 状态："
    resolvectl status --no-pager 2>/dev/null || true
    exit 1
  fi
}

apt_source_url_from_deb822() {
  awk '
    /^URIs:[[:space:]]*/ {
      print $2
      exit
    }
  ' "$UBUNTU_SOURCES_FILE" 2>/dev/null || true
}

check_url_head() {
  local url="$1"

  curl -fsSI --connect-timeout 8 "$url" >/dev/null 2>&1
}

configure_docker_daemon() {
  echo "==> 配置 Docker daemon registry mirrors 与日志限制"
  mkdir -p /etc/docker

  # 阿里云加速器端点是账号级标识，不入公开仓。运行时传入以保持原有镜像源集合
  # （sudo 需 -E 透传）：ALIYUN_DOCKER_MIRROR=https://<id>.mirror.aliyuncs.com
  # 不传也能跑，只是少了阿里云这一跳，下面三个公共镜像源照常生效。
  local aliyun_mirror_entry=""
  if [ -n "${ALIYUN_DOCKER_MIRROR:-}" ]; then
    aliyun_mirror_entry="    \"${ALIYUN_DOCKER_MIRROR}\",
"
  else
    echo "提示：未设置 ALIYUN_DOCKER_MIRROR，跳过阿里云加速器，仅配置公共镜像源。" >&2
  fi

  cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
${aliyun_mirror_entry}    "https://docker.m.daocloud.io",
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
  systemctl restart docker
}

ensure_apt_sources_reachable() {
  local current_url
  local release_url
  local fallback_release_url
  local timestamp

  echo "==> [preflight] 检查 Ubuntu apt 源可达性"
  current_url="$(apt_source_url_from_deb822)"
  if [ -z "$current_url" ]; then
    echo "错误：无法从 $UBUNTU_SOURCES_FILE 读取 Ubuntu apt 源"
    exit 1
  fi

  release_url="${current_url%/}/dists/$VERSION_CODENAME/InRelease"
  if check_url_head "$release_url"; then
    echo "APT 源 OK: $current_url"
    return
  fi

  fallback_release_url="${APT_MIRROR_URL%/}/dists/$VERSION_CODENAME/InRelease"
  if ! check_url_head "$fallback_release_url"; then
    echo "错误：当前 apt 源不可达，备用源也不可达"
    echo "当前源: $current_url"
    echo "备用源: $APT_MIRROR_URL"
    exit 1
  fi

  timestamp="$(date +%Y%m%d%H%M%S)"
  cp -a "$UBUNTU_SOURCES_FILE" "${UBUNTU_SOURCES_FILE}.bak-${timestamp}"
  sed -i -E "s#^URIs:[[:space:]].*#URIs: ${APT_MIRROR_URL}#g" "$UBUNTU_SOURCES_FILE"
  echo "已切换 Ubuntu apt 源: $current_url -> $APT_MIRROR_URL"
  echo "备份文件: ${UBUNTU_SOURCES_FILE}.bak-${timestamp}"
}

detect_data_device() {
  if [ -n "$DATA_DEVICE" ]; then
    printf '%s\n' "$DATA_DEVICE"
    return
  fi

  lsblk -rpno NAME,TYPE,FSTYPE,MOUNTPOINT | awk '
    $2 == "part" && $3 != "" && $4 == "" {
      print $1
      exit
    }
  '
}

ensure_data_disk_mount() {
  local device
  local fstype
  local uuid

  echo "==> [preflight] 检查数据盘挂载"
  if findmnt -n "$DATA_MOUNT_POINT" >/dev/null 2>&1; then
    echo "数据目录已挂载：$DATA_MOUNT_POINT"
    return
  fi

  device="$(detect_data_device)"
  if [ -z "$device" ]; then
    echo "未发现可挂载的数据分区，$DATA_MOUNT_POINT 将使用系统盘目录。"
    return
  fi

  fstype="$(lsblk -no FSTYPE "$device" | head -n 1)"
  if [ -z "$fstype" ]; then
    echo "错误：$device 未格式化。本脚本不会自动格式化磁盘，请人工确认后处理。"
    exit 1
  fi

  mkdir -p "$DATA_MOUNT_POINT"
  if [ "$(find "$DATA_MOUNT_POINT" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" -gt 0 ]; then
    echo "错误：$DATA_MOUNT_POINT 非空且未挂载。为避免遮蔽已有数据，请先人工处理。"
    exit 1
  fi

  uuid="$(blkid -s UUID -o value "$device")"
  if [ -z "$uuid" ]; then
    echo "错误：无法读取 $device 的 UUID"
    exit 1
  fi

  if ! grep -q "UUID=$uuid[[:space:]]" /etc/fstab; then
    printf 'UUID=%s %s %s defaults,nofail 0 2\n' "$uuid" "$DATA_MOUNT_POINT" "$fstype" >> /etc/fstab
    echo "已写入 /etc/fstab：$device -> $DATA_MOUNT_POINT"
  else
    echo "/etc/fstab 已存在 $device 的挂载项"
  fi

  systemctl daemon-reload
  mount "$DATA_MOUNT_POINT"
  echo "数据盘已挂载：$device -> $DATA_MOUNT_POINT"
}

# 2G swapfile + vm.swappiness=10 —— worker-01 仅 ~1.6GB 物理内存，swap 作应急缓冲，
# 让内存尖峰换页而非直接触发 host OOM-killer（曾两次打爆全机）。与容器 mem_limit 配套。
# 幂等：已存在则跳过；创建失败（磁盘不足）非致命，警告后继续。
ensure_swapfile() {
  echo "==> [preflight] 配置 swap（应急内存缓冲，2G）"
  local swapfile=/swapfile

  if [ -f "$swapfile" ] || grep -q "$swapfile" /proc/swaps 2>/dev/null; then
    echo "swapfile 已存在，跳过创建"
  elif dd if=/dev/zero of="$swapfile" bs=1M count=2048 status=none \
    && chmod 600 "$swapfile" && mkswap "$swapfile" >/dev/null; then
    echo "已创建 $swapfile（2048MB）"
  else
    echo "warning: swapfile 创建失败（磁盘空间不足？），跳过 swap 配置"
    rm -f "$swapfile"
    return 0
  fi

  # swapon：未激活才启用（dd 建的是真实文件，非 fallocate holey 文件，mkswap 才接受）
  if ! swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$swapfile"; then
    swapon "$swapfile" || echo "warning: swapon $swapfile 失败"
  fi

  # fstab：仿数据盘范式，缺项才追加（幂等）
  if ! grep -qE "^[[:space:]]*$swapfile[[:space:]]" /etc/fstab; then
    echo "$swapfile none swap sw 0 0" >> /etc/fstab
    echo "已写入 /etc/fstab：$swapfile"
  fi

  # vm.swappiness：drop-in 覆盖式（与 resolved/docker daemon 同风格，非 tee -a 追加，幂等）
  mkdir -p /etc/sysctl.d
  cat > /etc/sysctl.d/60-vxture-swappiness.conf <<'EOF'
# Vxture: only lean on swap when physical memory is tight (emergency buffer, not routine paging)
vm.swappiness=10
EOF
  sysctl --system >/dev/null 2>&1 || true
  echo "vm.swappiness=10（当前 $(cat /proc/sys/vm/swappiness 2>/dev/null || echo '?')）"
}

ensure_dns_resolution
ensure_apt_sources_reachable
ensure_data_disk_mount
ensure_swapfile

echo "==> [1/7] 系统更新"
if [ "$(hostname)" != "$TARGET_HOSTNAME" ]; then
  hostnamectl set-hostname "$TARGET_HOSTNAME"
  echo "hostname 已设置为：$TARGET_HOSTNAME"
else
  echo "hostname 已符合要求：$TARGET_HOSTNAME"
fi
apt-get update -y && apt-get upgrade -y

echo "==> [2/7] 安装 Docker CE + Compose plugin"
apt-get install -y ca-certificates curl git gnupg openssl
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "Docker 安装完成: $(docker --version)"
else
  echo "Docker 已安装，跳过"
fi
systemctl enable --now docker
configure_docker_daemon
docker info >/dev/null
if [ -n "$OWNER_USER" ] && id "$OWNER_USER" >/dev/null 2>&1; then
  usermod -aG docker "$OWNER_USER"
  echo "已确保 $OWNER_USER 加入 docker 用户组；如当前会话无法直接执行 docker，请重新登录 SSH。"
fi

echo "==> [3/7] 安装 Node.js ${NODE_MAJOR}.x + pnpm"
current_node_major=""
if command -v node &>/dev/null; then
  current_node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
fi

if [ "$current_node_major" = "$NODE_MAJOR" ]; then
  echo "Node.js 已满足要求: $(node --version)"
else
  if [ -n "$current_node_major" ]; then
    echo "Node.js 当前主版本为 ${current_node_major}，切换到 ${NODE_MAJOR}.x"
  else
    echo "Node.js 未安装，安装 ${NODE_MAJOR}.x"
  fi

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    | tee /etc/apt/sources.list.d/nodesource.list > /dev/null
  apt-get update -y
  apt-get install -y nodejs
  echo "Node.js 安装完成: $(node --version)"
fi

if ! command -v corepack &>/dev/null; then
  echo "错误：Node.js 安装后未找到 corepack" >&2
  exit 1
fi
corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
if [ -n "$OWNER_USER" ] && id "$OWNER_USER" >/dev/null 2>&1; then
  sudo -u "$OWNER_USER" corepack enable
  sudo -u "$OWNER_USER" corepack prepare "pnpm@${PNPM_VERSION}" --activate
  echo "$OWNER_USER pnpm 已准备: $(sudo -u "$OWNER_USER" pnpm --version)"
fi
echo "root pnpm 已准备: $(pnpm --version)"

echo "==> [4/7] 配置 UFW 防火墙"
apt-get install -y ufw
# 不执行 reset，只补充缺失规则；已有规则 ufw allow 会自动跳过重复
ufw default deny incoming  2>/dev/null || true
ufw default allow outgoing 2>/dev/null || true
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
# auth-bff:3090 仅 Tailscale 子网可达（外部业务 SSO / JWT 契约调用）
ufw allow from 100.64.0.0/10 to any port 3090 proto tcp comment 'auth-bff Tailscale only'
ufw --force enable
ufw status verbose

echo "==> [5/7] 安装 Tailscale"
if ! command -v tailscale &>/dev/null; then
  tailscale_codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${tailscale_codename}.noarmor.gpg" \
    -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${tailscale_codename}.tailscale-keyring.list" \
    -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -y
  apt-get install -y tailscale
  systemctl enable --now tailscaled
  echo ""
  echo "  !! 手动步骤：运行以下命令将此机器加入 Tailscale 网络"
  echo "     sudo tailscale up --authkey=<your-auth-key> --hostname=$TARGET_HOSTNAME"
  echo ""
else
  echo "Tailscale 已安装: $(tailscale --version | head -1)"
  tailscale status || true
fi

echo "==> [6/7] 创建 Docker 网络与数据目录"
docker network create vxture-prod 2>/dev/null || echo "Docker network vxture-prod 已存在，跳过"
docker network create vxture-beta 2>/dev/null || echo "Docker network vxture-beta 已存在，跳过"

mkdir -p "$DATA_MOUNT_POINT/platform-pg"
mkdir -p "$DATA_MOUNT_POINT/platform-redis"
mkdir -p "$DATA_MOUNT_POINT/nginx/conf/sites-enabled"
mkdir -p "$DATA_MOUNT_POINT/nginx/conf/snippets"
mkdir -p "$DATA_MOUNT_POINT/nginx/ssl/live/vxture.com"
mkdir -p "$DATA_MOUNT_POINT/nginx/logs"
if [ -n "$OWNER_USER" ] && id "$OWNER_USER" >/dev/null 2>&1; then
  chown -R "$OWNER_USER:$OWNER_USER" "$DATA_MOUNT_POINT/nginx"
fi
chown "$POSTGRES_DATA_UID:$POSTGRES_DATA_GID" "$DATA_MOUNT_POINT/platform-pg"
chmod 700 "$DATA_MOUNT_POINT/platform-pg"
find "$DATA_MOUNT_POINT/nginx" -type d -exec chmod 755 {} +
chmod 775 "$DATA_MOUNT_POINT/nginx/logs"
echo "目录结构:"
find /srv/vxture -maxdepth 4 -type d | sort

echo "==> [7/7] 准备部署工作目录"
mkdir -p "$DEPLOY_WORK_DIR/scripts"
mkdir -p "$DEPLOY_WORK_DIR/maintenance"
mkdir -p "$DEPLOY_WORK_DIR/nginx"
mkdir -p "$DEPLOY_WORK_DIR/guardrails"
mkdir -p "$DEPLOY_WORK_DIR/secrets"
touch "$DEPLOY_WORK_DIR/secrets/.gitkeep"
mkdir -p "$RUNTIME_DIR/secrets"
mkdir -p "$BACKUP_DIR"
if [ -n "$OWNER_USER" ] && id "$OWNER_USER" >/dev/null 2>&1; then
  chown -R "$OWNER_USER:$OWNER_USER" /srv/vxture/deploy
  chown -R "$OWNER_USER:$OWNER_USER" "$RUNTIME_DIR" "$BACKUP_DIR"
fi
echo "部署工作目录已准备：$DEPLOY_WORK_DIR"
echo "运行参数目录已准备：$RUNTIME_DIR"
echo "部署备份目录已准备：$BACKUP_DIR"

echo ""
echo "======================================================"
echo "  初始化完成。下一步（手动操作）："
echo ""
echo "  A. 完成 Tailscale auth（如未完成）："
echo "     sudo tailscale up --authkey=<key> --hostname=$TARGET_HOSTNAME"
echo ""
echo "  B. 恢复部署参数（env、secrets、nginx、证书）："
echo "     cd $DEPLOY_WORK_DIR && sudo bash maintenance/61-restore-deploy-params.sh"
echo ""
echo "  C. 通过 CI/CD 同步 deploy bundle 到：$DEPLOY_WORK_DIR"
echo ""
echo "  D. CI/CD 运行 13-prepare-runtime-env.sh 后，手动补齐 $RUNTIME_DIR 下的真实 env / secrets"
echo ""
echo "  E. runtime env 审计通过后，再通过 CI/CD 进入应用部署"
echo "======================================================"
