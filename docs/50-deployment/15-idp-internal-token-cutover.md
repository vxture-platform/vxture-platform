# 内部口令分家切换：IdP 内部面改认 `IDP_INTERNAL_TOKEN`

> 建立：2026-10-04。读者：在主机上执行切换的 owner。设计结论已全部内联到本页（§0 窗口、§1–§2 切换、§4–§6 证明、§8 乱序）；仓里没有另一份设计稿，不要去找。

今天一个值开两张门：auth-bff 的 `/internal/*`（运营账号 / 客户账号管理、step-up）和 platform-api 的 C2/C3 产品面，而那个值发给了产品团队。拆成两把钥匙——产品面继续用 `AUTH_INTERNAL_TOKEN`（旧值不动、不轮换、产品零改动），内部面只认**新键** `IDP_INTERNAL_TOKEN`，只注入 auth-bff / admin-bff / arche-bff / opera-bff 四个容器。切换后产品手里的值开不了运营管理面。

本页只写**怎么切、怎么证明切成了**。每一步都有一条能跑的证明；没有证明的步骤不在这页上。

---

## 0. 一句话看懂窗口

换钥匙那一版里，auth-bff（收）与三个运营 BFF（发）之间**先换谁都会让另一头 401**：窗口 = 四个里第一个被重建到最后一个被重建之间。`docker compose config --services` 的顺序**不是 YAML 顺序、每次不同**（本机 Compose v5.5.1 对同一份 compose 三跑三序，`deploy/scripts/lib/service-order.test.sh` 里存着那三种序），不钉顺序时最坏就是整次部署。

本 PR 把 `30-deploy` 第 [4/4] 步钉成「先 `auth-bff admin-bff arche-bff opera-bff`，再其余」——窗口压成**四次相邻的串行重建**。每次重建在 2C4G 上要多久没量过，这里只说「四次」不说分钟数。窗口里受影响的**只有**运营者的 step-up 与账号管理动作（admin / arche / opera 回 503 `operator_*_unavailable`）；登录、客户面、产品面全不受影响。

**不留回落**：`IDP ?? AUTH` 会在「新键没到位」的每一刻把产品值重新放进这扇门，而没到位正是出事时最常见的状态。生产上「半配」被两道部署闸挡在任何容器被替换之前（§2 步 2）。

---

## 1. 切换前必须成立的事（pre）

- [ ] PR A 已合并、已出 tag、镜像已推到 ACR；**deploy 还没派发**。
- [ ] **新脚本已经在主机上**（§2 步 0）：`34`、新版 `50` / `41` / `30` 只随 deploy bundle 上机，而 `deploy.yml` 的「上传 + 执行」在同一个过审批的 job 里——**不先落脚本，§2 步 1 要跑的文件在主机上根本不存在**。证明：`ls /srv/vxture/deploy/scripts/34-provision-idp-internal-secret.sh`。
- [ ] worker-01 上 `/srv/vxture/runtime/secrets/platform-idp-internal.env` 已由 `34` 铸出（§2 步 1）。旧容器的 compose 定义里没有这个文件，先放着零影响。
- [ ] `/srv/vxture/runtime/.env.arche-bff` 存在——`30-deploy` 新加的 `check_file` 会要它（worker-01 上 arche-bff 在跑，这份文件就在；主机审计也新加了 `arche-bff env` 规则）。
- [ ] `bash /srv/vxture/deploy/scripts/50-backup-runtime-env.sh` 跑过一次——用**落地后的新版**（旧版不认识新文件），34 铸完再跑一次。
- [ ] **对照组**：切换前从 worker-02 用产品值打 tailnet:8081 的内部面一次（§5 的同一条命令），此刻应是 `200`（带 JSON 正文——auth-bff 直接发布在这个口上，产品值开得了门）。没有这个「切换前 200」，切换后的 `404` / `401` 证明不了任何事。

---

## 2. 派发（dispatch）

### 步 0 · 先把脚本落到主机（二选一）

`deploy/scripts` 只随两个 workflow 上机，两个都过 production 审批门；区别是会不会动容器：

- **路 A（推荐：一次 deploy 切完）**：派发 `db-init.yml`，`ref=<PR A 的 tag>`、`action=verify`、`confirm=yes`（`expected_sha` 只对改库动作必填）。它只同步 `deploy/scripts` / `guardrails` / `*.example`，然后跑只读的 `30-verify-platform-baseline.sh`——**不碰容器、不跑 12-generate**。跑完主机上就有 `34`；做步 1，再批 deploy，deploy 的 [1/4] 一次就绿。
- **路 B（两次审批）**：直接批 deploy。`31 → 13 → 12-generate` 会先从 example 落 `IDP_INTERNAL_TOKEN=CHANGEME_RANDOM_TOKEN`，`30-deploy` 在 [1/4] 以 `env/runtime-placeholder` 停——**容器一个没动，这是预期的、不是故障**。此时脚本已在主机上：做步 1（34 把占位视同不存在，**不需要** FORCE），再 `gh run rerun <run-id> --failed` 并重批一次。

证明（两条路一样）：

```bash
F=/srv/vxture/deploy/scripts/34-provision-idp-internal-secret.sh
ls -l "$F" && grep -c '^is_placeholder()' "$F"   # 存在，且 1（旧版 34 没有这个函数，见它会卡在哪里：§8 第一行）
```

### 步 1 · 铸钥匙（worker-01，owner）

```bash
cd /srv/vxture/deploy
CONFIRM_PROVISION_IDP_INTERNAL=yes bash scripts/34-provision-idp-internal-secret.sh
```

脚本只打印路径、不打印值；值先生成到变量、两条断言过了才落盘（≠ `AUTH_INTERNAL_TOKEN`、32 位 hex）。三种现场：**文件不存在 → 铸**（`ok:`）；**存在但值是空 / CHANGEME 占位（12-generate 落的）→ 视同不存在、铸**（`placeholder:`，不需要 FORCE）；**已有真值 → 拒绝**（`exists:` exit 1，一个字节不动；轮换才用 `FORCE_PROVISION_IDP_INTERNAL=1`，之后要重建四个容器）。三格由 `deploy/scripts/lib/provision-idp-internal.test.sh` 钉住，对改动前的 34 跑它，占位那格是红的。

证明：

```bash
F=/srv/vxture/runtime/secrets/platform-idp-internal.env
ls -l "$F"                                     # -rw------- （0600）
grep -c '^IDP_INTERNAL_TOKEN=' "$F"            # 1
grep -c CHANGEME "$F"                          # 0
[ "$(grep '^IDP_INTERNAL_TOKEN=' "$F" | cut -d= -f2)" != "$(grep '^AUTH_INTERNAL_TOKEN=' /srv/vxture/runtime/secrets/platform.env | cut -d= -f2)" ] && echo "differs: ok"
```

### 步 2 · 在 GitHub UI 批生产门（owner；路 A 是第一次批，路 B 是重批）

证明：deploy run 的 `30-deploy` 第 [1/4] 步**审计绿**——它现在含 `worker platform idp-internal secrets` 规则（占位严格）与跨文件断言 `IDP_INTERNAL_TOKEN ≠ AUTH_INTERNAL_TOKEN`。这一行之前没有任何容器被替换；缺文件 / 占位 / 两值相等都在这里停。

---

## 3. 重建窗口（recreate window）

### 步 3 · 等 deploy 跑完（整栈 14 镜像都变，`packages/core/` 改动触发全量重建；逐服务串行）

四条证明，**按顺序看**：

1. 第 [4/4] 步日志里 `-- <svc>: up -d` 的**前四行**是 `auth-bff admin-bff arche-bff opera-bff`——顺序钉死生效。不是这四行就说明钉死没随这版出去，窗口按 §0 第一段算。
2. 第 [3/4] 步打印的四行 `-- <svc> -> …@sha256:<digest>` 与主机上这四条逐一相等：

   ```bash
   for c in auth admin arche opera; do docker inspect --format '{{.Config.Image}}' vx-platform-$c-bff; done
   ```

   **不要看 `docker ps` 找 tag——它只显示 `@sha256`**（`30-deploy` :159-161 自己的注释）。

3. `cat /srv/vxture/runtime/.last-deploy-tag` = 本次 tag。
   3b. （PR D 在本 tag 里时）第 [4/4] 步日志里 `-- auth-bff: tailnet :8081 交接给 nginx` 之后紧跟一行 `交接完成：:8081 由 vxture-nginx 发布`，且主机上 `docker port vxture-nginx 8081` 打印 `<worker-01 tailnet ip>:8081`、`docker port vx-platform-auth-bff` 打印空。**不要用 `docker ps` 的 PORTS 列去 grep `:8081->`**：那一列把同一 IP 上连号且宿主口 == 容器口的发布折成一个区间，交接后 nginx 那行是 `…:8080-8081->8080-8081/tcp`，子串永远不出现——grep 空 ≠ 没交接（`lib/nginx-idp-port.sh` 第一版就栽在这里，判据自此只读 `docker inspect` 的端口绑定）。更早的「20 同步 Nginx 配置」步里应有一句 `仍由 vx-platform-auth-bff 直接发布（切换中）→ 本次落盘**不带**别名发布`——那是 20 把交接让给 30 的证据；少了它而 31 的「启动或更新 Nginx」又重建了 nginx，就要看 nginx 有没有 `port is already allocated`（机制见 `deploy/scripts/lib/nginx-idp-port.sh` 头注）。
4. `bash /srv/vxture/deploy/scripts/40-verify-platform-runtime.sh` 全 OK——**含新加的 `arche-bff` 健康行**（此前清单里没有第三个发送方），以及 Required files 里新加的 `.env.opera-bff` / `.env.arche-bff` / `.env.platform-api` 与 sms / identity / app / idp-internal 四份 secrets（此前 40 与日巡检 51 的文件清单都停在五个 RP 时代，缺这些文件要到下次 deploy 才被 30 拦下；`lib/runtime-file-lists.test.sh` 钉住 30 / 40 / 51 三处一致）。

### deploy 中途失败怎么办

**不是 `33-recreate-service.sh`**：它在 2026-09-01 digest 钉死后已经坏了（从 `…@sha256:<hex>` 引用里拆 tag 得到裸 hex；多服务时 digest 各不相同直接「拒绝混批」），而且就算能跑，它钉在**容器正在跑的旧镜像**上——没轮到的发送方还是旧代码、读旧键，给它注入新文件也不读。修法另立 PR A2，切换不依赖它。

正确的收尾是**重跑 deploy（31 → 30）**：digest 钉死正是为此——已换好的服务 digest 不变、compose 跳过，只有还没换的那几个被重建。证明：第二次 run 的 [4/4] 日志里已换好的服务没有 `Recreate`。

PR D 在本 tag 里而 31 死在 30 的 auth-bff 那步**之前**（13 / 契约检查 / 20 / nginx up / 21）时，主机处在「bundle 已是 PR D、auth-bff 还直接发布着 :8081」的切换中状态。这时**不要跑 db-init 的 `provision-secrets` / `sync-env`，也不要手跑 `33-recreate-service.sh auth-bff`**：它们用 bundle 里不带 `ports:` 的 compose 重建 auth-bff，宿主口放掉而没人接。33 自己会拒绝这种现场并指向 31（`idp_alias_guard_recreate`，`lib/recreate-service.test.sh` 第 9 组）；收尾仍是重跑 31。

### 回滚到 PR D 之前的 tag

走正常的 deploy（`deploy.yml` → `31`），**不要单跑旧 30**。旧 bundle 的 20-sync 是裸 cp、旧 `compose.nginx.yml` 没有 :8081 那一行 → 31 的「启动或更新 Nginx」重建 nginx 摘掉 :8081（80/443 闪断一次）→ 旧 30 用带 `ports:` 的 compose 重建 auth-bff，它把 :8081 拿回去。:8081 的不可用窗口从 nginx 重建起、到旧 30 走到 auth-bff 为止（旧 30 的服务顺序不钉死，最坏整次 30）。只跑旧 30、不走 20 与 nginx up → nginx 还发布着 :8081，auth-bff 起不来：`Bind for <ip>:8081 failed: port is already allocated`，auth-bff 下线。两条路都在 `lib/nginx-idp-port.test.sh` 的「回滚」两组里用假 docker 走过。回滚后 `/internal/*` 重新对整个 tailnet 可达——那是 PR D 之前的状态，不是新口子。

---

## 4. 运行态证明（41-verify）

### 步 4 · 跑 `41-verify-internal-face.sh`（worker-01，owner）

```bash
cd /srv/vxture/deploy
VX_VERIFY_WORKSPACE_ID=<一个真实存在的 workspace uuid> VX_VERIFY_PRODUCT=arda \
  bash scripts/41-verify-internal-face.sh
```

八条探针，只打印状态码与错误码（正文落在 0700 私有目录、退出即删；口令经 `-H @file` / `-H @-` 传递，不进 argv）。脚本自己先断言两值非空且不等，否则拒跑——「读不到不是通过」。内部面**真正住的地方**是容器网 `vx-platform-auth-bff:3081`（三个发送方走的地址），1–3 从 `vx-platform-admin-bff` 容器里打它；tailnet:8081 自 PR D 起是 nginx 别名，`/internal/*` 在边缘就 404，7–8 打它证「门不在路边、而产品的口还在」。

| #   | 探针                                      | 期望         | 它证明什么                                                                  |
| --- | ----------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| 1   | 内部面（容器网）· 旧值                    | `401`        | 产品值开不了内部面                                                          |
| 2   | 内部面（容器网）· 新值                    | `200`        | env → 容器那一半真的接上了                                                  |
| 3   | 内部面（容器网）· 无头                    | `401`        | 没有不带凭据的路                                                            |
| 4   | 产品面 · 旧值                             | **非** `401` | 产品不受影响（工作区不存在时 400/404 都算）                                 |
| 5   | 产品面 · 新值                             | `401`        | 拆分是双向的：新钥匙开不了产品面                                            |
| 6   | 公网 `api.vxture.com/auth-api/internal/`  | `404`        | 边缘那道墙还在                                                              |
| 7   | tailnet 别名 `:8081/internal/` · **新值** | `404`        | nginx 的 404、不是 auth-bff 的 401：带着真钥匙也进不了，门已不在 tailnet 上 |
| 8   | tailnet 别名 `:8081/oidc/jwks`            | `200`        | 产品换票口照旧（地址不变，只是经 nginx）                                    |

第 4 条的 `(workspace, product)` 要填真实存在的；填错会得到 400，判据写的是「不是 401」，所以 400 仍然 PASS——但那就没证到「产品能读到权益」，要用真的。

---

## 5. 半径证明（worker-02 radius probe）

### 步 5 · 从产品主机用产品值打内部面（worker-02，owner；上机方式见 owner 自己的记录）

```bash
TOK="$(docker exec <arda-container> printenv PLATFORM_INTERNAL_AUTH_TOKEN)"
# 内部面：切换前 200（§1 对照组）。切换后期望值看 PR D 在不在本 tag 里（下表）；-D - 把响应头一起打出来，
# 因为 404 与 401 的**出处**不同：404 是 nginx（Server: nginx、HTML 正文），401 是 auth-bff（JSON 正文 invalid_internal_auth）。
curl -s -D - -o /dev/null -H "x-vxture-internal-auth: $TOK" \
  http://<worker-01-tailnet-ip>:8081/internal/operator/sessions
# 产品面：期望非 401（产品没受影响）
curl -s -o /dev/null -w '%{http_code}\n' -H "x-vxture-internal-auth: $TOK" \
  "http://<worker-01-tailnet-ip>:8080/platform/entitlements?workspace_id=<真实>&product=arda"
# 换票口：期望 200（PR D 之后它经 nginx 到 auth-bff，地址一个字没变）
curl -s -o /dev/null -w '%{http_code}\n' http://<worker-01-tailnet-ip>:8081/oidc/jwks
```

| 本 tag 里有什么 | 切换前（§1 对照组） | 切换后 `/internal/operator/sessions`                    | 它证明什么                                                                 |
| --------------- | ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| PR A，无 PR D   | `200`               | **`401`**（auth-bff，JSON `invalid_internal_auth`）     | 门还在路边，只是钥匙换了：产品值开不了                                     |
| PR A + PR D     | `200`               | **`404`**（nginx，`Server: nginx`、HTML 正文、无 JSON） | 门不在 tailnet 上了：钥匙对错都一样，`/internal/*` 从 worker-02 根本到不了 |

**这一条才是 E1 的半径证明**：拿着产品值的 tailnet 对端，切换前能打到 `/internal/operator/accounts/*`，切换后不能。只有 §1 的对照组是 200、这里是上表对应的那个码，才算。PR D 在场时，「钥匙换了」这一半的运行态证明在 §4 探针 1（容器网 401）——tailnet 上已经看不到 guard 了。**`/oidc/jwks` 那条必须是 200**：它证明 PR D 没有顺手把产品的换票口也堵掉。

---

## 6. 功能验证（functional check）

### 步 6 · 在 admin（`y.vxture.com`）做一次 step-up + 一次**客户账号**「停用 / 启用」（owner）

运营者的停用 / 启用不在 admin——admin-bff 的路由只委托客户账号的停用 / 启用 / 强制下线三动作（`accounts.router.ts`），运营者六动作在 arche 的 `platform-admins.router.ts`；要顺手验 arche 这个发送方，就在 arche 再做一次运营者「停用 / 启用」。两个动作成功即三个发送方里至少 admin 的新值在送、auth-bff 的新值在收。再看日志——**基线取在步 5 之后**，不是 deploy 完成时刻：

```bash
# 步 4（41-verify 探针 1/3）与步 5（半径探针）自己故意送旧值 / 无头，会留下 warn（哪几条见下）。
# 41-verify 结尾打印 finished_at=<UTC>，步 5 的 curl 打完记一下时间；--since 取两者中靠后的那个。
docker logs vx-platform-auth-bff --since <步 5 完成时刻> 2>&1 | grep -c invalid_internal_auth   # 期望 0

# 只有 deploy 完成时刻可用时：按 remote 分组——
#   PR D 在本 tag 里：期望恰好 1 个 remote（vx-platform-admin-bff 容器 IP，探针 1/3 限速成一条）；
#     步 5 与探针 7 在 nginx 就被 404，根本到不了 auth-bff，不留 warn。
#   PR D 不在：期望恰好三个 remote 各 1 条——worker-01 宿主（探针 1/3）、admin-bff 容器 IP（探针 7）、worker-02 tailnet IP（步 5）。
docker logs vx-platform-auth-bff --since <deploy 完成时刻> 2>&1 | grep -o 'invalid_internal_auth remote=[^ ]*' | sort | uniq -c

# PR C（主体绑定，在 PR A 之后的 tag 里）之后再看一行：绑定门的拒绝。基线之后期望 0。
# PR C 自己的部署窗口里（§8 末条）会有 actor_token_missing remote=<admin-bff / arche-bff 容器 IP>——
# 那是旧发送方，不是攻击；基线取在步 5 之后就不会数到它。
docker logs vx-platform-auth-bff --since <步 5 完成时刻> 2>&1 | grep -c 'actor_token_'   # 期望 0
```

这条 `warn`（`invalid_internal_auth remote=<ip> route=<router.handler>`，每 IP 每分钟至多一条）随 PR A 出；此前 401 路径一行日志都没有，所以这一步的可观测物就是它。步 4 / 步 5 必然留下上面那几条——**数到那个数不是泄漏**；基线之后再出现一条才是「谁还拿着旧值在敲门」，按 `remote` 去找是哪台机器。PR D 之后，一条来自 tailnet 地址的 warn 本身就不该再出现——tailnet 上的 `/internal/*` 在 nginx 就 404 了，能到 guard 的只有容器网。

---

## 7. 收尾（close-out）

### 步 7 · 登记

- [ ] 本页顶部加一行「切换完成：<日期>，tag <x>」。
- [ ] `docs/60-operations/10-tech-debt.md` TD-038 的「进展」段已随 PR A 写了方向③兑现一半；切换完成后把「窗口仍在」改成实测的四次重建用时（这次量一下，下次就有数了）。
- [ ] 旧文件 `secrets/platform.env` 的 `AUTH_INTERNAL_TOKEN` **不动**——它仍是产品面的钥匙，轮换它是 E3a、要与产品团队同窗。
- [ ] 把 §5 的两个状态码（切换前 / 切换后）记进本页，作为下一次审计的对照组。

---

## 8. 乱序会怎样（每一行都有拦它的地方）

- 先批 deploy、主机没文件 → `31 → 13 → 12-generate` 先从 example 落 CHANGEME 占位，`30-deploy` 在 [1/4] 以 `env/runtime-placeholder` 停（主机审计占位严格），容器一个没动。**停它的是审计的占位规则，不是 `check_file`**——`check_file` 只在手工跑 30、没经过 12 的时候才是那道停。然后跑 34（占位视同不存在、不要 FORCE）、重批，见 §2 步 0 路 B。改动前的 34 在这一格会说 `exists:` 拒绝——owner 被卡在审计拒占位与脚本拒覆盖之间，这就是补「占位视同不存在」的原因。
- 文件有、值是占位 → 同上（主机审计占位严格）。
- 有人把 `IDP_INTERNAL_TOKEN` 复制进某个 `.env.<svc>` → 主机审计 `env/forbidden-key`，**七份服务 env 全覆盖**：arche 的规则随本 PR 补上（此前只有六份，复制进 `.env.arche-bff` 静默放过），它同时把 `OIDC_CLIENT_SECRET` 空值 / 文件缺失也拦住——12-generate 现在会从 example 补出 `.env.arche-bff`，没有这条规则「缺文件停」就变成「带占位起」。
- 备份恢复到新主机（53 → 61）→ 61 现在恢复 `.env.opera-bff` / `.env.arche-bff` / `.env.platform-api` 与 sms / identity / app / idp-internal 四份 secrets（主机铸的三份在旧备份里没有时只打印去哪重铸，不卡恢复）；`lib/runtime-file-lists.test.sh` 钉住 30 / 40 / 51 / 53 / 61 五处清单一致。
- 值 == 产品值 → 主机审计跨文件断言红；就算绕过去，§4 第 5 条「新值打产品面 → 401」会红。
- deploy 中途失败、四个里只换了一部分 → 没换的那几个 503，直到它们也换上新镜像；**重跑 31→30**，不会锁死登录。
- 顺序钉死没合进 PR A → §3 证明 1 当场看出来，窗口回到最坏整次部署。
- 只改了 CI 副本审计、没改主机副本 → 主机把新文件当未知文件静默放过（identity 文件今天就是这样）；本 PR 两份逐字一样，diff 两份是 PR 里的证明。
- 忘了 `12-generate` 配对 → 下次新主机 13-prepare 补不出这个文件；`30-deploy` 的 `check_file` 兜底，且 `GENERATE_ENV_REQUIRED_GLOBAL_TOKENS` 加了就红。
- **PR C 的镜像出去那次**（主体绑定，不换钥匙；PR A 已在 v0.26.307 里，PR C 在之后的 tag）：auth-bff 先于 admin-bff / arche-bff 重建的那几分钟里，**账号动作** 503 `operator_admin_unavailable`——旧发送方不带 `x-vxture-actor-token`，新 auth-bff 回 401 `actor_token_missing`，发送方把 400/403/404/409/422 之外的状态一律压成 503。auth-bff 日志是 `actor_token_missing route=<Router.handler> remote=<发送方容器 IP>`（**不是** `invalid_internal_auth`，§6 第一条 grep 看不见它，所以 §6 多了一条）。两个发送方换上新镜像即自愈；反向顺序（发方先）无影响——旧 auth-bff 不认识多出来的头、照常放行；step-up（`operator-stepup` 不挂绑定门）、登录、客户面、产品面不受影响。**这一条没有拦它的地方**：它是接受下来的窗口，与钥匙窗口同一个「收方先」序（换钥匙真需要那个序，`lib/service-order.sh` 不改），写在这里是让看日志的人认得它、不去怀疑发送方；同类「收方新增必填头」的改动下次可把发方那一半先一个 tag 出去，就是零窗口。

---

## 9. 还没做、要 owner 定的

- ~~**D7 / PR D**：tailnet:8081 直通不变——拆钥匙只换了开门的值，门还在路边。把 8081 像 8080 一样前置 nginx、只放 `/oidc/*` `/.well-known/*`、`/internal/*` 404。~~ **已做（2026-10-04，PR D）**：`compose.nginx.yml` 发布 tailnet :8081、`sites-enabled/idp-internal.conf` 只转 `/oidc/` `/.well-known/` `/healthz` 到 auth-bff、其余 404；`compose.platform.yml` 摘掉 auth-bff 的 `ports:`。端口交接在同一次 deploy 里完成：20-sync 判到 auth-bff 还占着 :8081 就先落**不带**别名发布的 nginx compose（31 的 `up -d` 因此不重建 nginx），30-deploy 在 auth-bff `up -d` 之后立刻重落终态 compose、重建 nginx 一次并断言发布者恰是 vxture-nginx；交接不成（auth-bff 仍占 / 别人占 / 宿主进程在听 / up 后没接上）即中止，不静默跳过（`lib/nginx-idp-port.sh`，离线证明 `lib/nginx-idp-port.test.sh` 跑两种主机现场 + 裸 cp 的失败控制组）。:8081 的不可用窗口 = 旧 auth-bff 停到 nginx 重建完成，几秒；nginx 重建让 80/443/8080 同时闪断同一量级（与此前每次改 compose.nginx.yml 同一类）。40-verify 新增别名探针，51 日巡检核发布者，41 的探针改成 §4 那八条。**仍要 owner 确认**：worker-02 上没有别的进程在打 :8081 的 `/oidc/` `/.well-known/` `/healthz` 以外的路径（平台这边看不见 worker-02 的调用方；切换后在 nginx 的 access.log 里 grep `:8081` 的 404 行可以回答）。
- **PR A2**：修 `33-recreate-service.sh`（E3a 轮换值、未来改 secrets 都要它）。
- ~~**PR B**：删 `@vxture/core-auth` 里零消费方的 `resolveInternalAuthToken` / `assertInternalAuth` / `InternalAuthGuard`，并把 `check-internal-auth-key-usage.mjs` 里 `packages/core/auth` 那条 EXPECTED 一起删掉（留着会红）。~~ **已做（2026-10-04，PR B）**：三件已删，两个活 guard 改调 core-auth 的 `sharedSecretMatches`，EXPECTED 表项已删（自检 (vi) 改用合成期望表盯同一条性质）；同 PR 带 E6 旧凭据计数（platform-api 写、opera 读，TD-038 进展）。它改了 `packages/core/`，随下一个 tag 整栈 14 镜像重建——与本页切换本身无关，但那次 deploy 的时长按 §3 算。
- ~~**PR C**：主体绑定（`declaredUnbound` 8 → 0）。~~ **已做（2026-10-04，PR C landed: actor bound）**：auth-bff 两个账号 router 挂 `ActorBindingGuard`，admin / arche-bff 随委托带 `x-vxture-actor-token`（运营者自己的会话票），快照 `declaredUnbound` 8 → 0。**无 env 改动，但它自己有一个混版窗口**（与钥匙窗口不是一回事）：PR A 已在 v0.26.307 里，PR C 在之后的 tag——那次 deploy 仍按 §0 钉死的「收方先」序走，从 auth-bff `up -d` 到 admin-bff、arche-bff 各自 `up -d` 之间，**账号动作** 503 `operator_admin_unavailable`（admin 的停用 / 启用 / 强制下线，arche 的建号 / 停用 / 启用 / 强制下线 / 重置 MFA / 重置密码；auth-bff 日志 `actor_token_missing`，见 §8 末条），登录 / step-up / 客户面 / 产品面不受影响，两个发送方换上新镜像即自愈，**中途不要停**。反向顺序（发方先）本来是零窗口——旧 auth-bff 不认识多出来的头、照常放行——但换钥匙真需要收方先，`service-order.sh` 不改。
- CI 副本审计 `scripts/guardrails/audit-env.mjs` 没有 opera / arche / platform-api 三条服务 env 规则（也没有主机副本的 `OIDC_FUTURE_APP_HASH_KEYS` 与 `forbidsClientSecretHashes`），所以 arche 那条只能补在主机副本——它不审运行时文件，这里拦的本来就是主机副本。两份的其余差异是旧债，不在本线合并。
- 本地开发：根 `.env.local` 要补 `IDP_INTERNAL_TOKEN=`（与 `AUTH_INTERNAL_TOKEN` 不同值），否则本地 step-up / 运营动作 503。
