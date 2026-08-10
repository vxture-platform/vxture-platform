# 产品目录定名迁移 runbook(product_300)

> 版本:v1.1 · 日期:2026-07-07 · 状态:**U 线 + M6 执行完成**(owner 2026-07-07 拍板一次切换并当日完成:活库 seed + worker-04 对端 env + 探针验证;M1/M2/M5 亦已销号——见 §1 状态列)。剩余 M3/M4 随各自工作线排期。
> 定位:产品架构族 3**(实施位)——[`product_100_matrix.md`](./product_100_matrix.md) §6 登记的定名迁移项的实施规划与授权点。文档族路由见 product_100 §0。
> 纪律:任何实施动作(seed/DB/env/外部仓)须**逐项单独授权**;worker-04(umbra 外部仓)为只读写边界,涉其动作须显式授权窗口;当前开发阶段适用铁律三(重灌重构为主),正式上线后迁移成本上升——**建议全部定名迁移在正式上线前完成\*\*。

---

## 1. 迁移项总表

| #     | 项                            | 动作概要                                                                                                                                                                                           | 阶段 | 前置                                       | 风险                                                  |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------ | ----------------------------------------------------- |
| M1    | seed `data` → `arda`          | ✅ **完成**(PR #663,2026-07-07 落活库:守卫 UPDATE 原地改码,UUID 锚点不变)                                                                                                                          | 低   | 无(占位行,无订阅引用)                      | 无                                                    |
| M2    | `nocus` OIDC client 处置      | ✅ **完成**(PR #663,2026-07-07 落活库:seed 清单移除 + 活库行置 disabled 留审计;karda 接入时按 checklist 新注册,不复用旧行)                                                                         | 低   | 无                                         | 无                                                    |
| M3    | `karda` / `terra` 目录新增    | product + client + 域名/DNS/证书                                                                                                                                                                   | 中   | 各自产品接入排期                           | 无                                                    |
| M4    | `products.layer` 加列         | l1/l2/l3/client/external/internal,CHECK 收敛                                                                                                                                                       | 低   | `data_product_200` 修订 + seed 回填        | 无                                                    |
| M5    | `sharing` 域建库              | ✅ **DDL 完成**(2026-07-07:`82_sharing.sql` 3 表 grants/visible_set_current/visible_set_refresh + 00/90/95/97/98 配套;设计 data_sharing_100/200 已定稿 #675;**生产建库已完成 2026-07-07**,M5 销号) | 中   | 已满足(设计先行)                           | 无                                                    |
| **U** | **现 `ruyin` code → `umbra`** | ✅ **完成**(2026-07-07:#680 上产+活库 seed 生效+worker-04 对端 env 切换;验证=authorize 正负探针、`umbra-free`、目录四产品)                                                                         | 中   | 无(对端 umbra 栈已就位,无在线流量)         | 切换窗口对端 env 未跟上前 ruyin.ai 登录不可用(已接受) |
| M6    | 新 `ruyin`(client 端)目录注册 | ✅ **完成**(2026-07-07 与 U 线同窗落活库:product type=client + client `ruyin.vxture.com`,scopes=openid profile email;plan 与产品定义仍待建)                                                        | 低   | 与 U 线同一 seed 事务(先改码后插入,无撞名) | 无                                                    |

## 2. U 线:ruyin → umbra 改名专项规划

### 2.1 现状盘点(引用面)

| 面          | 现状                                                                                                                                                         | 备注                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 目录 seed   | `product.products` 行 `code='ruyin'`(如影/Ruyin,type=agent)、`plans` 行 `ruyin-free`                                                                         | live seed;当前无真实订阅债务                                       |
| OIDC        | client `client_id='ruyin'`,redirect `https://ruyin.ai/auth/callback`,back-channel logout URI,scope `openid profile email phone ruyin` + `ruyin:subscription` | 契约=`identity-platform-ruyin-contract.md`(已加 umbra 消歧 banner) |
| token/claim | access_token 内 `ruyin` scope 驱动的订阅 claim 面                                                                                                            | entitlement 下发暂缓中(契约 §8.1)                                  |
| env(平台侧) | `RUYIN_BASE_URL` 等 seed 变量                                                                                                                                | 本仓                                                               |
| env(对端)   | `OIDC_CLIENT_ID=ruyin` / secret / 回调实现                                                                                                                   | **worker-04 外部仓,只读边界;umbra 栈已就位(2026-07-07 确认)**      |
| 文档        | 已全量消歧(2026-07-06):glossary umbra 条、契约 banner、product_100 §2/§3                                                                                     | ✅ 完成(=U0)                                                       |

**不变项(硬约束)**:域名 `ruyin.ai`、redirect/back-channel URI、RP 契约条款、租户级订阅模式(豁免新引擎)、行 UUID(铁律二:id 锚点不动,code 可改)。

### 2.2 目标态

`product_code='umbra'`、plan `umbra-free`、`client_id='umbra'`、scope `umbra`/`umbra:subscription`(redirect/back-channel 仍 `ruyin.ai`,secret 沿用);同窗注册新 `ruyin`(client 端)product + OIDC client,base = **`ruyin.vxture.com`**(mode A 跨子域,prod+beta 双 URI;不带 subscription scope——client 端产品不进权益引擎,product_100 §5;plan 待产品定义)。

### 2.3 一次切换(v1.1 修订,弃方案 A 双注册)

**改判依据**(owner 2026-07-07 拍板):v1.0 弃选一次切换的前提是"跨仓锁步发版、失败双向回滚"。现状三条依据使该前提不成立:① worker-04 umbra 栈已就位但 RP 无在线登录流量(切换打断不了任何人);② 活库无订阅债务;③ secret 沿用原 hash(§2.4),对端改动缩为两行 env——双注册的保险不再有对象。

单窗口动作(平台侧一个 PR + 一次 db-init seed):

| #   | 动作                                                                                                                                                                                                                      | 载体                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | seed 迁移 SQL(守卫幂等,以 ruyin.ai redirect 识别旧行):删旧 `ruyin` client 的 consents(FK 无 ON UPDATE CASCADE,用户重同意)→ 原行 `client_id` 改 `umbra`(secret hash 随行保留)→ 常规 upsert 刷新 scope/URI 并插入新 `ruyin` | `seed-catalog.mjs`        |
| 2   | 目录改码:products `ruyin`→`umbra`(UUID 不变,M1 同模式,type=external)+ plans `ruyin-free`→`umbra-free`;同事务插入新 `ruyin` product(新 UUID,type=client)                                                                   | `seed-catalog.mjs`        |
| 3   | claim resolver:`APP_SCOPE_CODES` 中 `ruyin`→`umbra`(新 ruyin 不进权益引擎,不留双兼容)                                                                                                                                     | auth-bff                  |
| 4   | env 键迁移:`OIDC_CLIENT_SECRET_HASH_RUYIN`→`_UMBRA`(值搬移,**旧键必须清空**防误绑到新 ruyin)、`RUYIN_BASE_URL` 变意(→ruyin.vxture.com)+ 新增 `UMBRA_BASE_URL`(=https://ruyin.ai);db-init 内置运行时迁移 shim              | 27/29 脚本、db-init、审计 |
| 5   | 断言:baseline 加"归属断言"——`umbra` redirect 必含 ruyin.ai、新 `ruyin` redirect 必不含 ruyin.ai(防 env 变意错配静默过关)                                                                                                  | baseline-assertions       |
| 6   | ✅(2026-07-07 完成)对端:worker-04 env `OIDC_CLIENT_ID=umbra` + 请求 scope 改 `umbra umbra:subscription`;secret/回调实现不动;owner 验证通过                                                                                | worker-04                 |

**切换窗口影响**:平台 seed 落库后、对端 env 跟上前,ruyin.ai 登录不可用(旧 client_id 已不存在)——无在线流量,已接受;回滚 = 反向守卫 UPDATE(改回 ruyin)+ 删新行。

### 2.4 风险与专项约束(v1.1 修订)

- **secret 沿用**:umbra 沿用原 ruyin 的 secret(同一对接方、同一信任边界,换绑新 client_id 不降低安全性);平台侧仅 bcrypt hash 随行/随 env 键搬移,**免去明文转运环节**;可在切换稳定后按契约 §13 机制择机轮换(可选)。新 `ruyin` client 的 secret 待其应用部署时经 27-provision 单独派发(runos 等"先注册无 hash"同模式);
- **`RUYIN_BASE_URL` 变意是本窗口最大 footgun**:运行时 `.env.auth-bff` 存量值为 ruyin.ai,若只发代码不迁运行时 env,新 `ruyin` client 的 redirect 会错挂 ruyin.ai。防线三层:db-init 迁移 shim(检测 ruyin.ai 值→搬到 `UMBRA_BASE_URL` 并改写)、seed fail-fast(`RUYIN_BASE_URL` 含 ruyin.ai 即中止)、baseline 归属断言;
- **audit/登录流水**:历史 `client_id='ruyin'` 记录不改写,报表按"umbra=原 ruyin 同一产品"口径解读(U0 已消歧);历史 refresh_token/session 记录的 client_id 裸值(无 FK)随旧 client 消失自然失效;
- **契约文档**:`identity-platform-ruyin-contract.md` 的 client_id/scope 字面量在切换落库后回填为 umbra(条款本身不变)。

## 3. 排序建议与授权点

```
先行(可即做,单独授权):M1(data→arda) + M2(nocus 退役)     —— ✅ 完成(PR #663)
随设计线:M4(layer 列,随 data_product_200 修订) · M5(sharing 域,随 data_sharing 设计)
随产品接入:M3(karda/terra)
专项窗口:U 线一次切换 + M6 同窗                              —— ✅ 2026-07-07 全窗完成(含对端 env)
```

每项实施完成后回填本文状态列并同步 `product_100_matrix.md` §6。
