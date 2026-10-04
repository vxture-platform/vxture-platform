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
- [ ] **对照组**：切换前从 worker-02 用产品值打内部面一次（§5 的同一条命令），此刻应是 `200`。没有这个「切换前 200」，切换后的 `401` 证明不了任何事。

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
4. `bash /srv/vxture/deploy/scripts/40-verify-platform-runtime.sh` 全 OK——**含新加的 `arche-bff` 健康行**（此前清单里没有第三个发送方），以及 Required files 里新加的 `.env.opera-bff` / `.env.arche-bff` / `.env.platform-api` 与 sms / identity / app / idp-internal 四份 secrets（此前 40 与日巡检 51 的文件清单都停在五个 RP 时代，缺这些文件要到下次 deploy 才被 30 拦下；`lib/runtime-file-lists.test.sh` 钉住 30 / 40 / 51 三处一致）。

### deploy 中途失败怎么办

**不是 `33-recreate-service.sh`**：它在 2026-09-01 digest 钉死后已经坏了（从 `…@sha256:<hex>` 引用里拆 tag 得到裸 hex；多服务时 digest 各不相同直接「拒绝混批」），而且就算能跑，它钉在**容器正在跑的旧镜像**上——没轮到的发送方还是旧代码、读旧键，给它注入新文件也不读。修法另立 PR A2，切换不依赖它。

正确的收尾是**重跑 deploy（31 → 30）**：digest 钉死正是为此——已换好的服务 digest 不变、compose 跳过，只有还没换的那几个被重建。证明：第二次 run 的 [4/4] 日志里已换好的服务没有 `Recreate`。

---

## 4. 运行态证明（41-verify）

### 步 4 · 跑 `41-verify-internal-face.sh`（worker-01，owner）

```bash
cd /srv/vxture/deploy
VX_VERIFY_WORKSPACE_ID=<一个真实存在的 workspace uuid> VX_VERIFY_PRODUCT=arda \
  bash scripts/41-verify-internal-face.sh
```

七条探针，只打印状态码与错误码（正文落在 0700 私有目录、退出即删；口令经 `-H @file` / `-H @-` 传递，不进 argv）。脚本自己先断言两值非空且不等，否则拒跑——「读不到不是通过」。

| #   | 探针                                     | 期望         | 它证明什么                                  |
| --- | ---------------------------------------- | ------------ | ------------------------------------------- |
| 1   | 内部面 · 旧值                            | `401`        | 产品值开不了内部面                          |
| 2   | 内部面 · 新值                            | `200`        | env → 容器那一半真的接上了                  |
| 3   | 内部面 · 无头                            | `401`        | 没有不带凭据的路                            |
| 4   | 产品面 · 旧值                            | **非** `401` | 产品不受影响（工作区不存在时 400/404 都算） |
| 5   | 产品面 · 新值                            | `401`        | 拆分是双向的：新钥匙开不了产品面            |
| 6   | 公网 `api.vxture.com/auth-api/internal/` | `404`        | 边缘那道墙还在                              |
| 7   | 容器网 · 旧值                            | `401`        | 发送方真正走的地址上，旧值也死了            |

第 4 条的 `(workspace, product)` 要填真实存在的；填错会得到 400，判据写的是「不是 401」，所以 400 仍然 PASS——但那就没证到「产品能读到权益」，要用真的。

---

## 5. 半径证明（worker-02 radius probe）

### 步 5 · 从产品主机用产品值打内部面（worker-02，owner；上机方式见 owner 自己的记录）

```bash
TOK="$(docker exec <arda-container> printenv PLATFORM_INTERNAL_AUTH_TOKEN)"
# 内部面：切换前 200（§1 对照组），切换后期望 401
curl -s -o /dev/null -w '%{http_code}\n' -H "x-vxture-internal-auth: $TOK" \
  http://<worker-01-tailnet-ip>:8081/internal/operator/sessions
# 产品面：期望非 401（产品没受影响）
curl -s -o /dev/null -w '%{http_code}\n' -H "x-vxture-internal-auth: $TOK" \
  "http://<worker-01-tailnet-ip>:8080/platform/entitlements?workspace_id=<真实>&product=arda"
```

**这一条才是 E1 的半径证明**：拿着产品值的 tailnet 对端，切换前能打到 `/internal/operator/accounts/*`，切换后不能。只有 §1 的对照组是 200、这里是 401，才算。

---

## 6. 功能验证（functional check）

### 步 6 · 在 admin（`y.vxture.com`）做一次 step-up + 一次**客户账号**「停用 / 启用」（owner）

运营者的停用 / 启用不在 admin——admin-bff 的路由只委托客户账号的停用 / 启用 / 强制下线三动作（`accounts.router.ts`），运营者六动作在 arche 的 `platform-admins.router.ts`；要顺手验 arche 这个发送方，就在 arche 再做一次运营者「停用 / 启用」。两个动作成功即三个发送方里至少 admin 的新值在送、auth-bff 的新值在收。再看日志——**基线取在步 5 之后**，不是 deploy 完成时刻：

```bash
# 步 4（41-verify 探针 1/3/7）与步 5（半径探针）自己故意送旧值 / 无头，各留下一条 warn。
# 41-verify 结尾打印 finished_at=<UTC>，步 5 的 curl 打完记一下时间；--since 取两者中靠后的那个。
docker logs vx-platform-auth-bff --since <步 5 完成时刻> 2>&1 | grep -c invalid_internal_auth   # 期望 0

# 只有 deploy 完成时刻可用时：按 remote 分组，期望恰好三个 remote 各 1 条——
#   worker-01 宿主（探针 1/3，同 IP 限速成一条）、vx-platform-admin-bff 容器 IP（探针 7）、worker-02 tailnet IP（步 5）。
docker logs vx-platform-auth-bff --since <deploy 完成时刻> 2>&1 | grep -o 'invalid_internal_auth remote=[^ ]*' | sort | uniq -c

# PR C（主体绑定，在 PR A 之后的 tag 里）之后再看一行：绑定门的拒绝。基线之后期望 0。
# PR C 自己的部署窗口里（§8 末条）会有 actor_token_missing remote=<admin-bff / arche-bff 容器 IP>——
# 那是旧发送方，不是攻击；基线取在步 5 之后就不会数到它。
docker logs vx-platform-auth-bff --since <步 5 完成时刻> 2>&1 | grep -c 'actor_token_'   # 期望 0
```

这条 `warn`（`invalid_internal_auth remote=<ip> route=<router.handler>`，每 IP 每分钟至多一条）随 PR A 出；此前 401 路径一行日志都没有，所以这一步的可观测物就是它。步 4 / 步 5 必然留下上面那三条——**数到 3 不是泄漏**；基线之后再出现一条才是「谁还拿着旧值在敲门」，按 `remote` 去找是哪台机器。绑定门的三条 warn（`actor_token_missing` / `actor_token_invalid` / `actor_token_mismatch`，格式 `<码> route=<Router.handler> remote=<ip>`，同一套每 IP 每分钟一条的限速）随 PR C 出，与上面那条**分开数**：它们不是「谁拿着旧值」，是「谁没带 / 带错会话票」——部署窗口里的旧发送方（§8 末条），或一个只持口令、拿不出运营者会话票的调用方。

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

- **D7 / PR D**：tailnet:8081 直通不变——拆钥匙只换了开门的值，门还在路边。把 8081 像 8080 一样前置 nginx、只放 `/oidc/*` `/.well-known/*`、`/internal/*` 404，需要 owner 确认 worker-02 上没有别的进程打 8081 的其他路径。
- **PR A2**：修 `33-recreate-service.sh`（E3a 轮换值、未来改 secrets 都要它）。
- ~~**PR B**：删 `@vxture/core-auth` 里零消费方的 `resolveInternalAuthToken` / `assertInternalAuth` / `InternalAuthGuard`，并把 `check-internal-auth-key-usage.mjs` 里 `packages/core/auth` 那条 EXPECTED 一起删掉（留着会红）。~~ **已做（2026-10-04，PR B）**：三件已删，两个活 guard 改调 core-auth 的 `sharedSecretMatches`，EXPECTED 表项已删（自检 (vi) 改用合成期望表盯同一条性质）；同 PR 带 E6 旧凭据计数（platform-api 写、opera 读，TD-038 进展）。它改了 `packages/core/`，随下一个 tag 整栈 14 镜像重建——与本页切换本身无关，但那次 deploy 的时长按 §3 算。
- ~~**PR C**：主体绑定（`declaredUnbound` 8 → 0）。~~ **已做（2026-10-04，PR C landed: actor bound）**：auth-bff 两个账号 router 挂 `ActorBindingGuard`，admin / arche-bff 随委托带 `x-vxture-actor-token`（运营者自己的会话票），快照 `declaredUnbound` 8 → 0。**无 env 改动，但它自己有一个混版窗口**（与钥匙窗口不是一回事）：PR A 已在 v0.26.307 里，PR C 在之后的 tag——那次 deploy 仍按 §0 钉死的「收方先」序走，从 auth-bff `up -d` 到 admin-bff、arche-bff 各自 `up -d` 之间，**账号动作** 503 `operator_admin_unavailable`（admin 的停用 / 启用 / 强制下线，arche 的建号 / 停用 / 启用 / 强制下线 / 重置 MFA / 重置密码；auth-bff 日志 `actor_token_missing`，见 §8 末条），登录 / step-up / 客户面 / 产品面不受影响，两个发送方换上新镜像即自愈，**中途不要停**。反向顺序（发方先）本来是零窗口——旧 auth-bff 不认识多出来的头、照常放行——但换钥匙真需要收方先，`service-order.sh` 不改。
- CI 副本审计 `scripts/guardrails/audit-env.mjs` 没有 opera / arche / platform-api 三条服务 env 规则（也没有主机副本的 `OIDC_FUTURE_APP_HASH_KEYS` 与 `forbidsClientSecretHashes`），所以 arche 那条只能补在主机副本——它不审运行时文件，这里拦的本来就是主机副本。两份的其余差异是旧债，不在本线合并。
- 本地开发：根 `.env.local` 要补 `IDP_INTERNAL_TOKEN=`（与 `AUTH_INTERNAL_TOKEN` 不同值），否则本地 step-up / 运营动作 503。
