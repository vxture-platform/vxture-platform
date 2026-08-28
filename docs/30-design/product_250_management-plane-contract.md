# 管理面契约:运营授权方 ↔ 能力提供方(product_250)

> 版本:**v0.4** · 日期:2026-07-28(v0.1 草案)/ 2026-08-11(v0.2 归属反转)/ 2026-08-12(v0.3 需求方向)/ 2026-08-13(v0.4 step-up 执行位) · 状态:批 C 已落地,批 D/F 归属改写
>
> **v0.4 修订(owner 2026-08-13)——step-up 的执行位**:判据归 platform 目录(`admin.operator_permission.requires_step_up`,本次补列)、执行归 console/BFF、**provider 不做这个判断**。条款见 §2 M-2 补注。
> 连带撤销 §M-1「provider 义务」里的 step-up 新鲜度校验一条(原文划线保留)。atlas 侧同日执行完毕(#167/#169:删 `StepUpRequiredGuard`/`amr`/`operator_role`,留 7 条有拒绝分支的校验);**平台侧同日停铸** `amr` / `operator_role`(owner 2026-08-13 决定,`exchangeOperator`)——operator **会话** token 上的 `operator_role` 不受影响,admin/opera 仍在读。
>
> **v0.3 修订(owner 2026-08-12 纠正)——需求定义方向**:管理面需求由 opera 按产品设计文档定义、向 provider 提要求;**不得反过来由 provider 的既有接口决定管理面有哪些页面**。条款与事故记录见 §4「需求定义方向」。
>
> **v0.2 修订(owner 决定 2026-08-11)——模块归属反转:`外壳归 platform,模块归 provider` 改为 `外壳与模块均归 opera 统一创建`。**
> 口径原文:「联邦挂载为核心路线,挂载内容归 opera 统一创建」。**定性 = 归属改写,不是路线反转**——M-4 的联邦路径挂载(nginx `/{product_code}/*`)、M-1 operator-OBO 传票、M-5 审计归属三项**全部不变**,变的只是"谁写模块代码"。
> 影响面:§2 M-4「模块归 provider」条目、§4 批次表 D/F 行、跨仓边界纪律、[`../20-specs/000-platform/opera/10-shell-mount-contract.md`](../20-specs/000-platform/opera/10-shell-mount-contract.md) §2——四处均已就地标注,原文保留可追溯。
> 补记缘由:该口径此前**只存在于 `bff/opera-bff/src/routers/runos.router.ts` 的文件头注释,docs/ 全目录 0 处**(2026-08-12 全仓核查),导致照契约行事的人会得出与实际路线相反的结论。补记以消除这个歧义。
> 定位:产品三角(运营授权方 platform / 能力提供方 L1 / 业务消费方 L2·L3)中,**platform↔L1 这条边的编号契约**。
> 另两条边已契约化——platform↔消费方 = C1/C2/C3([`product_200_integration.md`](./product_200_integration.md)),
> L1↔消费方 = S2S 供给面([`product_210_tool-protocol.md`](./product_210_tool-protocol.md) §3/§4/§11)。
> 本文补齐第三条边:操作者身份传递、权限词表、管理 API、管理 UI 交付(能力控制台)、审计归属,共五条款(M-1…M-5)。
> 上游:`product_100_matrix.md`(分层,v1.1 ontos 重定位为本文伴生修订)、`product_240_repo-template.md` §2.5(仓形态槽)、
> [`platform/41-atlas-integration-topology.md`](./platform/41-atlas-integration-topology.md) §1/§7、operator 身份安全设计(identity 线,workforce realm 已实现)。
> 触发:`vxture-platform#148`(atlas 管理 UI 两次滞后 + 架构追问)。
> 下游:`product_240` §2.5 修订、`docs/20-specs/000-platform/admin/45-menu-design.md` 演进、atlas/runos 仓各自 admin-module 实施、`bff/admin-bff` model-platform 代理退役。

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

- **适用**:L1 能力平台——当前 **atlas(模型)、runos(技能/工具)**。二者同构:API-first、零端用户界面、控制面需持续人工运维(provider/密钥/路由策略;技能注册/上下线/验签)。
- **不适用**:L2/L3(自有 portal、customer realm、app/agent profile,走 `product_240` §2.5);ontos(2026-07-28 owner 拍板重定位 L2,见 `product_100` v1.1 修订记录);umbra/ruyin/hermes(层外)。
- L1 判据收紧后的类别不变量:**L1 = API-first、无端用户 UI、管理面统一按本契约交付**——无例外,无特判。

## 2. 契约五条款

### M-1 操作者身份传递

**铁律:管理链路上任何中间件(控制台外壳/BFF/代理)永不以自身身份调 provider 控制面 API,永远传播操作者本人的身份。**

- 形态:platform workforce realm 签发的 operator token(RS256,provider 经 JWKS 验签;`aud` = provider;`realm=workforce`)。workforce realm OIDC 为已实现设施(`appoidc.oidc_clients` CHECK 含 workforce;auth-bff operator 流程/refresh/挑战已在产),非新建。
- provider 义务:验签 + 校 `aud`/`realm`/`exp`。~~高危端点额外校 step-up 新鲜度(`acr`/`amr` claim)~~ **本条 v0.4 撤销**——见 §M-2 补注:step-up 的执行位归 console,provider 跑不了仪式,`amr` 是会话级语义冒充操作级。atlas 已随 vxture-atlas#167/#169 撤除 `StepUpRequiredGuard` 与 `amr` 解析;runos 本就没实现,不再补。
- 现状缺口与切换:admin-bff 裸 fetch 与 atlas `S2sAuthGuard` 守 admin 路由均不合本条;目标态一步切换(operator token 透传 + provider 侧换验签守卫)。过渡期姿态由实施批次定(§4 批B),契约只定目标态;S2S token(`product_210` §3)回归其本职——仅用于产品互调供给面,不再出现在管理链路。
- **实施绑定(批B 落地,2026-07-28)**:铸币复用既有 RFC 8693 token 端点,新增 **operator-OBO 模式**——workforce RP(admin,后续控制台外壳)以自己的 client 凭证 + 操作者 access token 为 subject*token 调 `POST /oidc/token`(grant_type=token-exchange),单受众纪律(subject 的 `aud` 必须=调用方 client_id)。铸出 claims:`aud`=provider product_code · `sub`=`opr*<id>`·`act.sub`=workforce client_id · `mode="operator"`·`userType="operator"`·`realm="workforce"`·`scope="mgmt:{aud}"`(与 S2S `tool:{aud}`结构性互斥,管理票过不了供给面守卫,反之亦然) ·~~`amr`/`operator_role`自 subject 镜像(step-up 新鲜度凭`amr` 判)~~ **v0.4 起不再铸**(owner 2026-08-13:atlas#169 删掉解析、runos 从未读,零消费方;留在票里等于宣称有一道其实不存在的校验) · TTL 300s · jti 入 audit(`mode='operator'`)。平台 sentinel 受众拒绝。BFF 侧按 (subject,aud) 缓存 240s;exchange 失败在过渡期降级为无凭证上游调用(provider 未验签时无感,验签后表现为 provider 401)。

### M-2 权限词表注册

- provider 定义自己的操作码词表 `{product_code}.{resource}.{action}`(如 `atlas.provider_key.rotate`、`runos.skill.publish`),**注册进 platform operator RBAC 目录**;每个操作码标注是否要求 step-up。
- 分工(行业参照 IAM actions 模式):**词表内容归 provider**(随其能力演进,platform 不代拟);**评估、授予、step-up 策略、审计归 platform**(横向管理面,全 L1 一视同仁)。
- 现状退役映射:`platform.model.manage` 单一 capability 一刀切,随 atlas 词表注册后退役。

#### M-2 补注(2026-08-13):step-up 的**执行位**归 console,不归 provider

原文只说了"step-up 策略归 platform",没说**谁执行**。实测发现这个留白被填成了相反的样子,后果具体:

| 现状                                                                                              | 问题                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ~~atlas 在 `StepUpRequiredGuard` 里**硬编码** 9 个写操作要 step-up~~ **已撤除**(vxture-atlas#167) | "什么算高危"没有唯一定义处,变成各 provider 自决                                                       |
| runos **一条都没有**(`operator-auth.guard.ts` 注释:"StepUpRequiredGuard is not ported")           | 曾是"两边保护等级不同且无人决策"的证据;**结论反过来了**——不是 runos 该补,是 atlas 该撤,两边现在都不判 |
| `admin.operator_permission` **没有 `requires_step_up` 列**                                        | M-2 要求的标注无处可落,"危"字只活在 seed 注释与 description 末尾的 `(high-risk)` 里,机器读不到        |

**因此明确三条**:

1. **判据归 platform 目录**——`admin.operator_permission.requires_step_up`(2026-08-13 补列)是"什么算高危"的**唯一定义处**。
2. **执行归 console/BFF**——`admin-bff` / `opera-bff` 读目录,命中即在**动作发生的那一刻**跑 step-up 仪式(IdP 签 300s 短时凭证,`auth-bff` 的 `issueOperatorStepUp`;admin-bff 的 `OperatorStepUpGuard` + 门户 `StepUpProvider` 已是这个形态),过了再放行代理。
3. **provider 不做这个判断**——provider 无 UI、**跑不了仪式**,只能拒绝;且它能拿到的 `amr` 是**会话级**语义("登录时用过 MFA",可能是 8 小时前),而非**操作级**("此刻本人在键盘前")。用 `amr` 当 step-up 判据,是在用一个弱得多的性质冒充强性质。

**关于防御纵深的反驳,以及为什么它不足以支撑现状**:provider 侧校验能挡"绕过 console 直接拿 operator token 打 provider"。但该防护对**失窃 token 无效**——盗来的 token 里 `amr` 一样是全的;而能拿到 operator-OBO token 的合法用户,本来就能登录 console 点按钮。若确需纵深,正确形态是 console 代理时携带**它跑过仪式**的短时标记(绑操作、绑 operator),provider 校验那个标记——**不是** `amr`。此为目录落地后的第二步,本次不做。

**过渡态(诚实标注)**:本次只标了**已经是操作级**的 14 个码(不可逆的钱相关动作、身份/凭证材料、数据主体权益)。`model:provider.manage` / `capability:runos.manage` 这类**粗粒度码刻意未标**——它们同时覆盖"改简介"(无害)与"轮换密钥"(凭证材料),整码标 `true` 会把无害编辑也卡上二次验证。拆分归 provider(词表内容归 provider),已 issue 交办;落地后补标。

**闭环(2026-08-13,atlas 侧执行完毕)**:atlas 按本补注逐条复核了 operator token 上的校验,判据统一为**"这个 claim 有没有拒绝分支"**——解析进 context 却无人读的,一律删。

- **删 3 条**:`StepUpRequiredGuard`(#167,唯一消费 `amr` 的地方)、`amr` 解析、`operator_role` 解析(两者 #169)。
- **留 7 条**(全部有真实拒绝分支):验签 / `iss` / `exp`、`aud`、`scope=mgmt:atlas`、`realm=workforce`、`userType=operator`、`sub`(审计记名)、`act.sub`(来源模块)。

注意判据的措辞:**不是**"授权域的数据不该由 provider 持有"。若照那条推,`userType` / `realm` / `scope` 也该删,而它们恰恰是 7 条里的 3 条——它们留下不是因为归属不同,是因为 provider 拿它们做了拒绝决定。`operator_role` 被删也不是因为"角色属于平台",是因为 atlas 侧读了不判:粗粒度访问已由 `scope`+`userType` 挡住,细粒度授权在 console 侧按 `admin.operator_permission` 判完才发代理请求。

**平台侧同步执行(owner 2026-08-13 决定)**:`exchangeOperator` 停铸 `amr` 与 `operator_role`。理由是同一条判据——零消费方的 claim 留在票里,会让下一个读 token 的人以为有一道校验,而那道校验已经不存在了。

- 影响面:operator-OBO token(`aud`=provider)的形状变小两个 claim。现有 provider(atlas/runos)都不读,无回归。
- **不涉及 operator 会话 token**:`oidc.service.ts` 签发的会话 access token 仍带 `operator_role`,admin-bff / opera-bff 在读,那是授权域内部的事,与跨仓契约无关。这两处同名不同物,改动时别一起删。
- 未来 provider 若确需纵深防御,正确形态见上一段:console 携带**它跑过仪式**的短时标记(绑操作、绑 operator),provider 校验那个标记——**不是**把 `amr` 加回来。

### M-3 管理 API 面

- provider 拥有并演进自己的 admin API;结构化错误封套;版本纪律对齐 `product_210` §4.3。
- **封套与形状的细则见[产品接入通则](https://claude.ai/code/artifact/20e37039-ea59-4c5d-9fab-ba3ca3ad54f0)**(2026-08-16 补,2026-08-29 权威由 `product_251` 迁至此):本条原文只给了「结构化错误封套」这个槽位,没给内容——实测三方长出了三种错误码形状(atlas 带前缀大写、runos 无前缀小写、platform **没有 code**)。`product_251` 的适用范围经 owner 拍板**含 platform 自身管理面**,是对本文 §1 的实质扩张。
- 响应/日志永不含密钥明文(atlas `model-admin.service.ts` 的 secret-shaped-field 剥离护栏为本条既有实现,保留不动)。
- **密钥托管归属(2026-07-28 owner 拍板)**:provider 凭证一律存 provider 自己库的加密 vault(atlas = `key.provider_api_keys` 信封加密),**能力控制台零持有**——控制台密钥页面只是经 M-1 通道调 provider admin API 的 UI,明文仅 create/rotate 写入时过一次网,此后只见掩码元数据与轮换日志;信封加密主密钥留 provider 主机 env(owner 手动转运)。详见 [`platform/42-model-provider-registry-plan.md`](./platform/42-model-provider-registry-plan.md) §8.6。

### M-4 管理 UI 交付:能力控制台(BSS/OSS 分立)

- **admin 门户定位收敛为纯 BSS**(租户/账号/订阅/订单/账单/工单/促销);「能力与服务」域整体迁出。
- **新立 OSS 侧「能力控制台」,独立于 admin**,分立理由:操作者画像分离(客服商务 vs 平台工程)、安全姿态不同(小受众全量 step-up vs 大受众流程密集)、发布节奏不同(provider 各自节奏 vs BSS 列车)。
  - 命名 = **能力控制台(Capability Console)**;域名 **2026-07-28 已拍板**——按加固方案**真名不入公开仓**(仅落 owner 侧记录/部署主机 env);仓内文档/配置一律以占位符 `x.vxture.com` 指代本控制台域名。
- ~~**外壳归 platform,模块归 provider**~~ → **外壳与模块均归 opera 统一创建**(owner 决定 2026-08-11,见头部 v0.2 修订):
  - 外壳:workforce realm OIDC RP + 导航 + 设计系统 + 审计钩子;复用 `shell-template`(console/admin 已共用)与既有 nginx 边缘模式,边际成本低。
  - ~~模块:atlas/runos 各自仓内开发、独立部署,外壳只管挂载。~~ **v0.2 起:模块 UI 由 opera 统一创建(`portals/opera` 内页面 + `bff/opera-bff` 内代理路由),消费 provider 的管理 API**。provider 仓的义务收窄为**交付并维护管理 API 契约**(M-3),不再负责管理 UI。
  - **随之失效的推论**:下方"同周期强制"原假设 module UI 与 backend 同仓(同 PR 即可满足),v0.2 后二者不同仓——provider 新增 admin 可配置字段时,**必须以 `liaison` issue 通知 platform 补 UI**,否则 #148 类滞后会以新形态复现(provider 加了字段、opera 不知道)。这是本次归属改写引入的**新协作债**,不是原文遗漏。
- **联邦一档起步 = 路径挂载**:各 provider 部署自己的小型 admin 应用,nginx 同 vhost 挂 `/atlas/*`、`/runos/*`,共享 workforce SSO cookie;零 module-federation 构建机械(行业背书:Azure Portal 即 iframe 联邦)。升档(build-time 组装/runtime MF)仅当模块数量或融合度要求触发,不预建。
- **同周期强制**:联邦后 module UI 与 backend 同仓——provider 新增 admin 可配置字段的 PR **同批携带模块 UI,或同批开自仓 TD 并在 PR 描述引用**;此要求在联邦结构下同仓同 PR 即可满足,结构性消除 #148 类滞后(对比现状需跨仓第二个 PR)。
- **部署位(2026-07-28 owner 定向)**:外壳随平台栈落 **worker-01**(身份局部性:workforce OIDC 签发方 auth-bff 同机;平台 CD 顺路);**模块与各自 backend 同机**——atlas admin-module 落 worker-02(同仓同 CD,对 atlas admin API localhost 跳),runos 模块随 runos 主机;边缘 nginx(worker-01)在 ops vhost 上按路径反代模块(`/atlas/*`→worker-02 tailnet 内网,operator token 随请求)。约束:worker-01 内存压力已知(性能审计根因之一),外壳必须薄(单小容器+内存限额)。**访问形态 2026-07-28 已拍板 = 公网 vhost + 加固必做清单**(批C 硬性项,非建议):复用通配符证书(单签证书会经 CT 日志即时公开主机名)/公开仓一律占位符不写真名/外壳 SSO 前置(任何路径未认证零内容)/nginx default-server 兜底(裸 IP 扫描不回显 vhost)/限流。
- **实施绑定(批C 落地,2026-07-28)**:外壳=`portals/opera`+`bff/opera-bff`(workforce RP `opera`,nginx `auth_request` 门实现"未认证零内容"并对模块路径注入 operator-OBO 票);挂载契约与接入步骤固化于 [`../20-specs/000-platform/opera/10-shell-mount-contract.md`](../20-specs/000-platform/opera/10-shell-mount-contract.md)(批D/F 对接依据)。
- **真名不入仓政策扩至 admin(2026-07-28 owner 追加拍板)**:owner 判定 admin 门户域名与本控制台域名"同一性质"(均为高权限运营面公网 hostname,域名本身可随时轮换,代码只应固定引用方式不固定真名)——两者一并纳入加固:仓内占位符统一为 **`x.vxture.com` = opera(能力控制台)、`y.vxture.com` = admin**(区分标记,避免暗示同一主机);admin 侧落地=`deploy/nginx/templates/admin.vhost.template`(20-sync-nginx-config.sh 从 `.env.admin-bff` 的 `ADMIN_BASE_URL` 渲染,**缺失即报错退出**,不同于 opera 未上产时的可选跳过)+ `NEXT_PUBLIC_ADMIN_BFF_URL` 改由 CI `vars.ADMIN_BASE_URL`(GitHub Actions 仓库变量,不入 git 历史)注入构建,不再硬编码于 `images.mjs`。
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
| 权限目录  | `platform.model.manage` 退役,换 M-2 注册的 `atlas.*`/`runos.*` 词表                                                                                                     |
| 文档      | `45-menu-design.md` 增演进记录;`product_240` §2.5 增 L1 admin-module 槽位说明                                                                                           |
| 不动      | C2 权益/用量商务视图;console 租户页;varda 调用链                                                                                                                        |

## 4. 实施批次(设计先行,每批独立授权,G6)

| 批  | 内容                                                                                                                              | 仓/边界                                                          | 前置     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| A   | 本契约评审定稿 + 能力控制台命名/域名拍板 + ontos 重定位伴生修订落地                                                               | platform docs                                                    | —        |
| B   | **无悔项**:operator token 端到端透传(admin-bff 过渡期先透传,后由控制台外壳接管)+ atlas 侧 provider-keys 及 admin 路由守卫切换验签 | platform + atlas(atlas 侧改动走 issue 交办,不代做)               | A        |
| C   | 能力控制台外壳(workforce RP + 导航 + 挂载约定)                                                                                    | platform 仓                                                      | A        |
| D   | atlas 管理模块(首个模块;**#148 Part 1 两缺口——provider-keys UI、taskProfile 表单——落此**)                                         | ~~atlas 仓(issue 交办)~~ → **platform 仓(`portals/opera`)**,v0.2 | B、C     |
| E   | admin 迁出退役(三页下线、代理删除、菜单/权限目录修订)                                                                             | platform 仓                                                      | D 验收后 |
| F   | runos 管理模块(随 runos 产品线启动排期)                                                                                           | ~~runos 仓~~ → **platform 仓(`portals/opera`)**,v0.2             | C        |

~~跨仓边界纪律:atlas/runos 仓内实施一律 issue 交办,platform 不代做、不代拟对方执行步骤。~~

### 需求定义方向（v0.3，owner 2026-08-12 纠正）—— **不得由 provider 的既有接口反推管理面**

**正向**：opera 按**产品设计文档**定义管理面需要哪些板块、每个板块要哪些能力，**向 provider 提出接口要求**；provider 交付接口来满足。设计文档是需求源，`liaison` issue 是传递渠道。

**反向（禁止）**：读 provider 的交付公告 → 看它这轮给了什么接口 → 照着接口建页面。这样建出来的管理面是 provider 实现进度的投影，不是产品的管理面。

**本次事故（触发本条纪律）**：opera 的 Atlas 板块一直按「这轮 liaison issue 新交付了什么」做增量，从未拿 `portals/opera/docs/opera-atlas-design.md` §13「Atlas 1.0 范围」逐条验收。后果两类，**方向相反但同源**：

| 后果                                                      | 实例                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **漏接**——provider 早已交付、需求也早已定义，但没人对账   | `opera-atlas-design.md` §11 要求 Observability = Metrics + Logs；Atlas 的 `/capability/logs`（请求级检索、多维过滤、游标分页）与 `/capability/logs/summary`（窗口聚合含 p95）**早就在线**，opera **全站 0 处引用**，可观测两页显示的一直是平台自己的后台作业数据     |
| **多建**——provider 明说没有的资源，照设计概念先把页面建了 | `/atlas/router`：Atlas 在交付说明里明确写「**No independent Router resource**」并要求「please confirm before wiring the page as if it exists」，opera 未确认即建页，最终是 Endpoint 页的只读副本，且真实 failover 驱动（`models.config.fallbackModelCodes`）从不展示 |

两者都因为**没有一份"需求 vs 交付"的对账清单**。

**因此要求**：每个 L1 provider 板块须维护一份产品设计文档（如 `opera-atlas-design.md`），并以它为准做周期性验收；发现 provider 未满足的条目，**发 `liaison` issue 提要求**，不是默默把页面缩到接口的形状。**缺口要在页面上显式可见**（横幅/说明），但**绝不以渲染估算或拼凑数据的方式"补齐"**。

**跨仓边界纪律(v0.2 改写)**:管理 UI 归 platform 自建,不再 issue 交办;**但管理 API 契约仍归 provider 仓**——platform 不代写、不代改 provider 的 API,发现契约缺口/歧义/形状变更一律 `liaison` issue 回报(`140-repo-governance-standard.md` §10)。**方向纪律**:UI 侧"缺什么接口"必须主动发 issue 问,不得**照 provider 的内部设计文档推演端点路径然后先把页面建好**——2026-08-12 教训:opera 曾据此建出 6 个声明路由,与真实契约核对**命中 0**(`/capability/credentials` 实为 `/governance/credentials`、`/capability/supply-catalogs` 实为 `/commerce/grants`,其余四条文档中不存在)。**契约是问出来的,不是推出来的。**

## 5. 与既有标准的关系

- `product_210` §11 **不改**(其管供给面 L1↔消费方);本文 M-4 自带管理面同周期检查项,两单并行不重叠。
- `product_240` §2.5 修订:L1 槽位 = "无 portals 不变 + 管理面以 admin-module 交付至能力控制台(本文 M-4)"。
- `product_100` v1.1:ontos L1→L2 重定位(伴生修订,使 L1 类别不变量成立)。
- `41-atlas-integration-topology.md` §1:其"任务5 鉴权升级为运营态凭证"表述与 M-1 同向,加指针指向本文。
- `vxture-platform#148` 回复口径:Part 2 决策 = 本契约(既非原 Option 1 也非 Option 2:自治单位是词表+API+模块,不是 portal;强制机制是联邦同仓同批,不是跨仓门禁);Part 1 两缺口落批D。

## 6. 边界之外

不在本文拍板:ontos 产品定义本身(重定位只改层,定义仍空白);能力控制台视觉/DS 细节;atlas/runos 仓内实施方案(契约只管边界行为);跨仓审计聚合;L2/L3 portal 形态(归 `product_240`);`key.provider_api_keys` 信封加密的 KMS 选型(atlas 仓自决,契约只要求 M-3 密钥不出响应)。
