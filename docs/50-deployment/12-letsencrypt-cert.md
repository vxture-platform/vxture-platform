# Let's Encrypt 通配符证书（worker-01 nginx）

`.github/workflows/deploy-cert.yml` 通过 **DNS-01 challenge（Cloudflare API）** 为
`vxture.com` + `*.vxture.com`（2026-09-18 起另含 `ruyin.work` + `*.ruyin.work`，
见下方「第二个注册域」）签发一张浏览器可信的 Let's Encrypt 通配符证书,并部署到
worker-01 的 nginx。**签发全在 GitHub runner 里完成**,主机只接收两个 PEM 文件并 reload
nginx（最小服务器改动）。

目的:替换现有的 **Cloudflare Origin 证书**(只被 CF 边缘信任、浏览器不信任)。橙色云下换证
零用户影响;换成可信证书后,才能安全把 DNS 切到**灰色云(DNS-only)**,让大陆用户直连源站、
不再绕海外 CF PoP。

---

## 一次性 setup（你来做,只填一个 secret 值）

1. **创建 Cloudflare API Token**：Cloudflare → My Profile → API Tokens → Create Token
   → 用 **"Edit zone DNS"** 模板 → 权限 `Zone:DNS:Edit` + `Zone:Zone:Read` →
   Zone Resources 含 **vxture.com** 与 **ruyin.work** 两个 zone（见下方「第二个注册域」） → Create → 复制 token（只显示一次）。

2. **加为 GitHub secret**：仓库 Settings → Secrets and variables → Actions → New
   repository secret → 名字 **`CLOUDFLARE_DNS_API_TOKEN`** → 值粘贴上面的 token。

> 其余 secret 复用现有 CD 的：`TAILSCALE_OAUTH_CLIENT_ID/SECRET`、`DEPLOY_HOST_TAILNET`、
> `DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_SSH_PASSPHRASE` 与 var `TAILSCALE_OAUTH_CLIENT_TAG`
> —— 无需新增。

---

## 首次签发流程

> 每次运行都会停在 **production 审批门**(工作流用了 `environment: production` 才能拿 SSH
> secret)。到 Actions 里那次 run 的 "Review deployments" → 勾 `production` → Approve 放行。
> dry-run 也会停一次审批,但它只做 LE staging 校验、不碰生产,放心批。

1. **先 dry-run 验证链路**（不消耗真证书、不碰生产）：
   Actions → `deploy-cert` → Run workflow → 勾选 **dry_run = true** → Run → 到 run 里 Approve。
   通过说明 CF token 权限 OK、DNS-01 能建/删 TXT、校验通过。

2. **正式签发 + 部署**：Actions → `deploy-cert` → Run workflow → **dry_run = false** → Run。
   流程：runner 签发通配符证书 → 入 tailnet → scp 证书到 worker-01 →
   备份现证书 → 覆盖 → `nginx -t`（不过则自动回滚)→ `nginx -s reload` → 打印新证书 issuer
   （应为 Let's Encrypt）。

3. **验证**（本地/任意）：
   ```
   echo | openssl s_client -connect 39.103.62.17:443 -servername vxture.com 2>/dev/null \
     | openssl x509 -noout -issuer     # 应为 Let's Encrypt
   ```

## 续期（月度 + 审批门）

`schedule: cron "23 4 6 * *"` 每月 6 号自动**触发**重签 + 部署。因为部署要用的 SSH secret
（`DEPLOY_*`)是 **production 环境级**,工作流声明了 `environment: production`,所以**每次运行
都会停在生产审批门,由 owner 点批**(与"agent 只触发不自审"一致)。

- 每次签发的是一张全新 90 天证书,大缓冲:即便某次月度续期你漏批,上一张证书仍有 ~60 天有效,
  下月再触发;GitHub 的 pending 审批本身也保留 30 天。故审批延迟不会导致证书过期。
- reload 仍由 `nginx -t` 把关,坏证书自动回滚到备份。
- 若你更想要**完全无人值守续期**,可另建一个无 Required reviewers 的专用环境(如 `cert`)、
  把 `DEPLOY_*` secret 放进去、工作流改 `environment: cert`——但这偏离"生产写操作都过审批门"的
  治理约定,取舍自定。

## 第二个注册域（ruyin.work，2026-09-18）

`ruyin.work` 与 `vxture.com` 共用**同一张**证书，SAN 从两项扩成四项：

```
CERT_DOMAINS = -d vxture.com -d *.vxture.com -d ruyin.work -d *.ruyin.work
CERT_NAME    = vxture.com    ← 不变。它是 certbot 的 --cert-name，是这张证书的
                               「名字」而不是覆盖范围；PEM 仍落 ssl/live/vxture.com/，
                               全部 vhost（含 ruyin.work 那份）继续指这一个路径。
```

`CERT_DOMAINS` 本来就是仓库变量，所以这次扩容**没有改一行代码**。要动的两处都在仓外：

1. 仓库变量 `CERT_DOMAINS` 改成上面那一行。
2. Cloudflare API token（secret `CLOUDFLARE_DNS_API_TOKEN`）的 Zone Resources 必须
   **同时包含 ruyin.work**——DNS-01 要在每个域各自的 zone 里建 TXT。只限 vxture.com 的
   token 会让**整次**签发失败，不是只失败新域那一半。

**取舍（owner 2026-09-18 选「一张证书」）**：一条续期线、巡检不用加第二份、workflow
零改动；代价是两个注册域**耦合**——任一 zone 的 DNS-01 失败会让整张证书（含
`vxture.com`）续不上。缓冲仍是 90 天证书 + 每月触发，漏一次还剩约 60 天。若日后
`ruyin.work` 成为独立产品面，再拆成第二张证书（`ssl/live/ruyin.work/`）不迟。

**顺序要紧**：先改变量与 token → 跑一次 `dry_run=true` 验 DNS-01 能在新 zone 建 TXT →
正式签发 → **最后**才让带 `ruyin.work` 的 vhost 上生产。反过来的话，新证书落地之前
访客拿到的是「证书名不匹配」的整页警告；而在 vhost 上线之前，该域的现状是 TLS 握手
直接被拒（`00-default.conf` 的 `ssl_reject_handshake`）——后者对访客更像「站点不存在」，
前者更像「站点被劫持」。

**防静默失败**：少写一个 `-d` 的后果是隐蔽的——证书照样签成、到期检查照样过、
`vxture.com` 照样好，只有被漏掉的那个域撞名不匹配。`51-check-platform-alerts.sh` 因此
不只查有效期，还**逐项断言 SAN 覆盖**这四个域；读不到 SAN 时报 high 而不是放过。

## 回滚

每次部署前自动备份到 `/srv/vxture/data/nginx/ssl/backup-<时间戳>/`。手动回滚:

```
ssh vxture-worker-01
SSLDIR=/srv/vxture/data/nginx/ssl/live/vxture.com
cp -a /srv/vxture/data/nginx/ssl/backup-<时间戳>/. "$SSLDIR/"
docker exec vxture-nginx nginx -t && docker exec vxture-nginx nginx -s reload
```

## 之后：切灰色云（拿延迟收益,你决定时机）

确认源站已是可信 LE 证书后,再在 Cloudflare 把要直连的域名 DNS 记录切 **DNS-only（灰色云）**。
⚠️ 灰色云后源站 IP 直接暴露(失去 CF WAF/DDoS)——安全权衡自评估;可只切受众在大陆的域名
(console/vxture/api),把需要 CF 防护的留橙色云。切后直连即 HTTP/2（源站已开）。

### 源站滥用加固（灰色云后已补）

灰色云失去 CF 兜底后,`deploy/nginx/conf.d/00-hardening.conf` 在 nginx 层补了最基本护栏:
每 IP 请求限速(50r/s,burst 100)+ 并发连接上限(50)+ slowloris 慢速超时;内部 S2S
监听器(:8080)经空 key 豁免、绝不被限。经 `20-sync-nginx-config.sh` 随 nginx 配置一起
部署(该脚本现一并同步 `conf.d/`)。限速 key 按直连客户端 IP——**若把某域名切回橙色云,
需为其启用 real_ip 信任层**(见该文件顶部注释),否则该域名全部用户会共用一个限速桶。
阈值可按实际流量在该文件调。

## 备注

- 首次排障时我曾在 worker-01 直接 `apt install certbot`（Phase 1）——本 CI/CD 方案**不用**它
  （签发在 runner 里),它只是无害的闲置包,可 `sudo apt-get remove certbot python3-certbot-dns-cloudflare` 清掉。
- LE 速率限:相同 SAN 重复证书 5/周。月度续期远低于;手动重触发别在一周内跑太多次真签发(测试用 dry-run)。
- 证书为 ECDSA（`--key-type ecdsa`,更小更快,浏览器与 CF 均支持)。
