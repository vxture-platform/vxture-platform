# 管理面契约:运营授权方 ↔ 能力提供方(product_250)

> 版本:**v0.1 草案** · 日期:2026-07-28 · 状态:**设计稿,待 owner 评审后定稿**(设计先行,未实施)
> 定位:产品三角(运营授权方 platform / 能力提供方 L1 / 业务消费方 L2·L3)中,**platform↔L1 这条边的编号契约**。
> 另两条边已契约化——platform↔消费方 = C1/C2/C3([`product_200_integration.md`](./product_200_integration.md)),
> L1↔消费方 = S2S 供给面([`product_210_tool-protocol.md`](./product_210_tool-protocol.md) §3/§4/§11)。
> 本文补齐第三条边:操作者身份传递、权限词表、管理 API、管理 UI 交付(能力控制台)、审计归属,共五条款(M-1…M-5)。
> 上游:`product_100_matrix.md`(分层,v1.1 ontos 重定位为本文伴生修订)、`product_240_repo-template.md` §2.5(仓形态槽)、
> [`platform/41-atlas-integration-topology.md`](./platform/41-atlas-integration-topology.md) §1/§7、operator 身份安全设计(identity 线,workforce realm 已实现)。
> 触发:`vxture-platform#148`(atlas 管理 UI 两次滞后 + 架构追问)。
> 下游:`product_240` §2.5 修订、`docs/20-specs/000-platform/admin/45-menu-design.md` 演进、atlas/runa 仓各自 admin-module 实施、`bff/admin-bff` model-platform 代理退役。

---

## 0. 背景:三条边,两条已契约化,病发的这条没有

| 边                              | 契约现状                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| platform ↔ 业务消费方           | ✅ C1 身份 / C2 权益 / C3 计量(product_200,有编号、有检查单) |
| 能力提供方 ↔ 业务消费方         | ✅ S2S 供给面 + 能力发现 + §11 变更检查单(product_210)       |
| **platform ↔ 能力提供方(本文)** | ❌ 无编号契约——全部症状长在这条边上                          |

症状清单(2026-07 观测,均为事实):

1. **管理 UI 两次滞后**:atlas 后端能力(provider-keys、taskProfile)上产后,平台侧 admin 无对应界面(atlas 仓 TD-007/TD-009,`vxture-platform#148` Part 1)。
2. **管理链路第二跳凭证真空**:`bff/admin-bff/src/routers/model-platform.router.ts` 对 atlas 控制面 API 裸 fetch(仅 content-type,零凭证);拆仓+拆主机后该跳走 tailnet,等效"能路由到 worker-02:3100 即可未经认证 CRUD 模型注册表"。
3. **凭证语义错位**:atlas 新建 provider-keys 端点挂 `S2sAuthGuard`(服务身份)守密钥轮换(人事操作)——`41-atlas-integration-topology.md` §1 明文预言过"运营台调管理 API 不应与产品互调用同一套凭证语义";且 platform 无凭证代理反而调不通该端点。
4. **BSS/OSS 混装**:现 admin 门户主体是业务后台(租户/账单/订阅/工单/促销,即 BSS);「能力与服务」域(model-platform/model-grants/skills)是误植其中的基础设施运维(OSS)种子——`45-menu-design.md` 自注该域"操作主体为平台运维/技术团队",画像分野早已被感知,只是当时体量小合住了。

行业参照(旁观校准,详细论证见 #148 讨论过程):三平面模型(管理面横向唯一/控制·数据面每能力纵向一个);AWS Bedrock/Azure OpenAI 型能力服务**是产品但无独立 portal**,管理页活在共享控制台,由服务团队自己交付(联邦);Microsoft(M365 Admin vs Azure Portal)/Google(Workspace Admin vs Cloud Console)按**操作者画像**而非按产品分立双控制台;控制台永不以自身身份调服务,永远传播操作者身份(AWS Console/SigV4)。

## 1. 适用范围

- **适用**:L1 能力平台——当前 **atlas(模型)、runa(技能/工具)**。二者同构:API-first、零端用户界面、控制面需持续人工运维(provider/密钥/路由策略;技能注册/上下线/验签)。
- **不适用**:L2/L3(自有 portal、customer realm、app/agent profile,走 `product_240` §2.5);ontos(2026-07-28 owner 拍板重定位 L2,见 `product_100` v1.1 修订记录);umbra/ruyin/hermes(层外)。
- L1 判据收紧后的类别不变量:**L1 = API-first、无端用户 UI、管理面统一按本契约交付**——无例外,无特判。

## 2. 契约五条款

### M-1 操作者身份传递

**铁律:管理链路上任何中间件(控制台外壳/BFF/代理)永不以自身身份调 provider 控制面 API,永远传播操作者本人的身份。**

- 形态:platform workforce realm 签发的 operator token(RS256,provider 经 JWKS 验签;`aud` = provider;`realm=workforce`)。workforce realm OIDC 为已实现设施(`appoidc.oidc_clients` CHECK 含 workforce;auth-bff operator 流程/refresh/挑战已在产),非新建。
- provider 义务:验签 + 校 `aud`/`realm`/`exp`;**高危端点(密钥轮换/激活停用等)额外校 step-up 新鲜度(`acr`/`amr` claim)**——platform 侧 operator MFA/step-up 栈(P0–P4)经此传导,不因跨仓降级。
- 现状缺口与切换:admin-bff 裸 fetch 与 atlas `S2sAuthGuard` 守 admin 路由均不合本条;目标态一步切换(operator token 透传 + provider 侧换验签守卫)。过渡期姿态由实施批次定(§4 批B),契约只定目标态;S2S token(`product_210` §3)回归其本职——仅用于产品互调供给面,不再出现在管理链路。
- **实施绑定(批B 落地,2026-07-28)**:铸币复用既有 RFC 8693 token 端点,新增 **operator-OBO 模式**——workforce RP(admin,后续控制台外壳)以自己的 client 凭证 + 操作者 access token 为 subject*token 调 `POST /oidc/token`(grant_type=token-exchange),单受众纪律(subject 的 `aud` 必须=调用方 client_id)。铸出 claims:`aud`=provider product_code · `sub`=`opr*<id>`·`act.sub`=workforce client_id · `mode="operator"`·`userType="operator"`·`realm="workforce"`·`scope="mgmt:{aud}"`(与 S2S `tool:{aud}`结构性互斥,管理票过不了供给面守卫,反之亦然) ·`amr`/`operator_role`自 subject 镜像(step-up 新鲜度凭`amr` 判) · TTL 300s · jti 入 audit(`mode='operator'`)。平台 sentinel 受众拒绝。BFF 侧按 (subject,aud) 缓存 240s;exchange 失败在过渡期降级为无凭证上游调用(provider 未验签时无感,验签后表现为 provider 401)。

### M-2 权限词表注册

- provider 定义自己的操作码词表 `{product_code}.{resource}.{action}`(如 `atlas.provider_key.rotate`、`runa.skill.publish`),**注册进 platform operator RBAC 目录**;每个操作码标注是否要求 step-up。
- 分工(行业参照 IAM actions 模式):**词表内容归 provider**(随其能力演进,platform 不代拟);**评估、授予、step-up 策略、审计归 platform**(横向管理面,全 L1 一视同仁)。
- 现状退役映射:`platform.model.manage` 单一 capability 一刀切,随 atlas 词表注册后退役。

### M-3 管理 API 面

- provider 拥有并演进自己的 admin API;结构化错误封套;版本纪律对齐 `product_210` §4.3。
- 响应/日志永不含密钥明文(atlas `model-admin.service.ts` 的 secret-shaped-field 剥离护栏为本条既有实现,保留不动)。
- **密钥托管归属(2026-07-28 owner 拍板)**:provider 凭证一律存 provider 自己库的加密 vault(atlas = `key.provider_api_keys` 信封加密),**能力控制台零持有**——控制台密钥页面只是经 M-1 通道调 provider admin API 的 UI,明文仅 create/rotate 写入时过一次网,此后只见掩码元数据与轮换日志;信封加密主密钥留 provider 主机 env(owner 手动转运)。详见 [`platform/42-model-provider-registry-plan.md`](./platform/42-model-provider-registry-plan.md) §8.6。

### M-4 管理 UI 交付:能力控制台(BSS/OSS 分立)

- **admin 门户定位收敛为纯 BSS**(租户/账号/订阅/订单/账单/工单/促销);「能力与服务」域整体迁出。
- **新立 OSS 侧「能力控制台」,独立于 admin**,分立理由:操作者画像分离(客服商务 vs 平台工程)、安全姿态不同(小受众全量 step-up vs 大受众流程密集)、发布节奏不同(provider 各自节奏 vs BSS 列车)。
  - 命名 = **能力控制台(Capability Console)**;域名 **2026-07-28 已拍板**——按加固方案**真名不入公开仓**(仅落 owner 侧记录/部署主机 env);仓内文档/配置一律以占位符 `x.vxture.com` 指代本控制台域名。
- **外壳归 platform,模块归 provider**(三平面铁律:外壳=横向管理面设施):
  - 外壳:workforce realm OIDC RP + 导航 + 设计系统 + 审计钩子;复用 `shell-template`(console/admin 已共用)与既有 nginx 边缘模式,边际成本低。
  - 模块:atlas/runa 各自仓内开发、独立部署,外壳只管挂载。
- **联邦一档起步 = 路径挂载**:各 provider 部署自己的小型 admin 应用,nginx 同 vhost 挂 `/atlas/*`、`/runa/*`,共享 workforce SSO cookie;零 module-federation 构建机械(行业背书:Azure Portal 即 iframe 联邦)。升档(build-time 组装/runtime MF)仅当模块数量或融合度要求触发,不预建。
- **同周期强制**:联邦后 module UI 与 backend 同仓——provider 新增 admin 可配置字段的 PR **同批携带模块 UI,或同批开自仓 TD 并在 PR 描述引用**;此要求在联邦结构下同仓同 PR 即可满足,结构性消除 #148 类滞后(对比现状需跨仓第二个 PR)。
- **部署位(2026-07-28 owner 定向)**:外壳随平台栈落 **worker-01**(身份局部性:workforce OIDC 签发方 auth-bff 同机;平台 CD 顺路);**模块与各自 backend 同机**——atlas admin-module 落 worker-02(同仓同 CD,对 atlas admin API localhost 跳),runa 模块随 runa 主机;边缘 nginx(worker-01)在 ops vhost 上按路径反代模块(`/atlas/*`→worker-02 tailnet 内网,operator token 随请求)。约束:worker-01 内存压力已知(性能审计根因之一),外壳必须薄(单小容器+内存限额)。**访问形态 2026-07-28 已拍板 = 公网 vhost + 加固必做清单**(批C 硬性项,非建议):复用通配符证书(单签证书会经 CT 日志即时公开主机名)/公开仓一律占位符不写真名/外壳 SSO 前置(任何路径未认证零内容)/nginx default-server 兜底(裸 IP 扫描不回显 vhost)/限流。
- **毕业条件**(何时允许某 provider 独立 portal,行业判据):直接外售有自有计费关系,或出现专职运维团队,或操作者画像全天驻留该域。当前无一满足。
- **BSS 侧保留**:订阅/用量的 C2 权益商务视图不迁(商务画像要看);console(租户端)model-platform 页不动(客户面,C2 形状)。

### M-5 审计归属

- provider 域内审计表(如 atlas `key.key_rotation_logs`)**必须记录 M-1 传入的 operator `sub`**——数据面事实与操作者归属同落。
- 控制台外壳级操作审计落 platform 审计域(既有 audit-logs 线)。
- 跨仓审计聚合视图**延后**,不阻塞本契约实施。

## 3. admin(BSS)侧变化清单

| 项        | 变化                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 菜单      | 「能力与服务」域迁出(model-platform / model-grants / skills 三页;service-monitor 归属批E 定)。先例:`45-menu-design.md` 既有"工单→独立客服工作台"演进路径,本次为第二实例 |
| admin-bff | `model-platform.router.ts` 代理退役(凭证真空第二跳随之消灭)                                                                                                             |
| 权限目录  | `platform.model.manage` 退役,换 M-2 注册的 `atlas.*`/`runa.*` 词表                                                                                                      |
| 文档      | `45-menu-design.md` 增演进记录;`product_240` §2.5 增 L1 admin-module 槽位说明                                                                                           |
| 不动      | C2 权益/用量商务视图;console 租户页;varda 调用链                                                                                                                        |

## 4. 实施批次(设计先行,每批独立授权,G6)

| 批  | 内容                                                                                                                              | 仓/边界                                            | 前置     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------- |
| A   | 本契约评审定稿 + 能力控制台命名/域名拍板 + ontos 重定位伴生修订落地                                                               | platform docs                                      | —        |
| B   | **无悔项**:operator token 端到端透传(admin-bff 过渡期先透传,后由控制台外壳接管)+ atlas 侧 provider-keys 及 admin 路由守卫切换验签 | platform + atlas(atlas 侧改动走 issue 交办,不代做) | A        |
| C   | 能力控制台外壳(workforce RP + 导航 + 挂载约定)                                                                                    | platform 仓                                        | A        |
| D   | atlas admin-module(首个模块;**#148 Part 1 两缺口——provider-keys UI、taskProfile 表单——落此**)                                     | atlas 仓(issue 交办)                               | B、C     |
| E   | admin 迁出退役(三页下线、代理删除、菜单/权限目录修订)                                                                             | platform 仓                                        | D 验收后 |
| F   | runa admin-module(随 runa 产品线启动排期)                                                                                         | runa 仓                                            | C        |

跨仓边界纪律:atlas/runa 仓内实施一律 issue 交办(`liaison` 标签,per `140-repo-governance-standard.md` §10),platform 不代做、不代拟对方执行步骤。

## 5. 与既有标准的关系

- `product_210` §11 **不改**(其管供给面 L1↔消费方);本文 M-4 自带管理面同周期检查项,两单并行不重叠。
- `product_240` §2.5 修订:L1 槽位 = "无 portals 不变 + 管理面以 admin-module 交付至能力控制台(本文 M-4)"。
- `product_100` v1.1:ontos L1→L2 重定位(伴生修订,使 L1 类别不变量成立)。
- `41-atlas-integration-topology.md` §1:其"任务5 鉴权升级为运营态凭证"表述与 M-1 同向,加指针指向本文。
- `vxture-platform#148` 回复口径:Part 2 决策 = 本契约(既非原 Option 1 也非 Option 2:自治单位是词表+API+模块,不是 portal;强制机制是联邦同仓同批,不是跨仓门禁);Part 1 两缺口落批D。

## 6. 边界之外

不在本文拍板:ontos 产品定义本身(重定位只改层,定义仍空白);能力控制台视觉/DS 细节;atlas/runa 仓内实施方案(契约只管边界行为);跨仓审计聚合;L2/L3 portal 形态(归 `product_240`);`key.provider_api_keys` 信封加密的 KMS 选型(atlas 仓自决,契约只要求 M-3 密钥不出响应)。
