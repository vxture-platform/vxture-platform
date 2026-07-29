# Atlas Integration Topology — platform / varda / karda / L3 agent

> 定位：本文回答"Atlas 独立成仓后，platform、varda、karda（及 arda/terra 同构）、L3 四 agent
> 各自怎么接 Atlas"——是本仓（vxture-platform）侧的对接设计文档，不是 Atlas 自己的产品文档
> （Atlas 侧契约正本在 `vxture-atlas` 仓 `docs/30-design/200-s2s-provider-surface.md`）。
> 上游依据：`product_100_matrix.md` §2/§3、`product_240_repo-template.md` §3 模块×层矩阵、
> `product_210_tool-protocol.md`（S2S token exchange）、`platform/40-model-platform.md`。
> 承接：任务5/6/7（对接 Atlas 的 BFF 切换/平台侧登记/旧代码退役）的设计前提。

## 0. 为什么 Atlas 的对接关系跟其它产品不一样

其它产品（karda/arda/terra 等 L2，raven/anlan/forge/xuanzhen 等 L3）都是**平台之上的业务产品**：
它们消费平台的身份/权益/计量三通道（C1/C2/C3），是"平台的客户"。

Atlas 不是这种关系。Atlas 是**L1 模型供给能力**——大模型/专用小模型的唯一宿主，唯一 LLM 出口，
唯一推理计量入口（`product_240` §3："C3 consume atlas ✔ 推理计量唯一入口"）。它对其它产品来说，
不是"平台卖给你的一个业务功能"，而是**其它产品自己实现业务功能时必须经过的底层管道**——
类似其它产品都要连平台的身份系统，但换成了"模型能力"这条管道。

这带来两层关系，必须分开看，不能混为一谈：

| 层                                                   | 关系性质                                                                                                                                         | 例子                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Atlas 作为产品**（面向平台的 C2/C3）               | 和其它 L1 一样，也在 `product.products`/`product.plans` 里登记、走 C2 权益、C3 provisioning——这条线是"Atlas 自己作为一个可被订阅/计量的平台产品" | 已在本仓 seed-catalog.mjs 补齐 PRODUCTS 行+plan骨架（任务8待提交） |
| **Atlas 作为供给方**（S2S provider，被其它产品调用） | karda/varda/L3 agent 调 Atlas 的 embedding/parse/rerank/generation，这是**产品间的模型能力调用**，走 S2S token exchange，不走 C2/C3              | 本文档主体                                                         |

下面按消费方分四类,说清楚各自怎么接第二层。

## 1. Platform（本仓，运营方）——不是"消费方",是操作台

admin-bff / console-bff 现在直连 Atlas 的模型注册/授权/配额管理 API（provider/model/grant/
price_rule/policy CRUD + 租户配额看板），这不是"业务调用模型能力"，是**运营操作**——平台运营者
管理 Atlas 的目录和授权，跟"karda 调 Atlas 做 embedding"是完全不同的调用面。

- **关系**：platform 是 Atlas 的**运营方**，不是 Atlas 的客户，也不是需要 S2S token exchange
  的对等服务。
- **对接方式（任务5）**：`bff/admin-bff`、`bff/console-bff` 的 `atlas.router.ts`（2026-07-29 前
  叫 `model-platform.router.ts`）从"进程内 fetch localhost"改成调 Atlas 真实网络地址，鉴权升级为运营态凭证（沿用平台内部
  管理面认证，不是 S2S token exchange——运营台调后台管理 API 和"产品互调模型能力"不是一回事，
  不应该用同一套凭证语义）。
- **不做的事**：platform 不通过 S2S provider 面调 Atlas 的 embedding/parse/rerank/generation——
  运营台只管目录和授权,不代表任何产品发起推理调用。
- **2026-07-28 增**：本节"鉴权升级为运营态凭证"的契约化落点 =
  [`product_250_management-plane-contract.md`](../product_250_management-plane-contract.md)(M-1 操作者身份传递 / M-4 能力控制台);
  admin-bff 直连代理为过渡形态,目标态与实施批次见该契约 §2/§4。

## 2. Varda（L0 内嵌，本仓内）——最短路径，纯 generation

Varda 是唯一"活在 vxture-platform monorepo 里"的智能助手（`agent-server/varda`），不是独立
产品仓，复用宿主会话。它对 Atlas 的调用最简单：

- **调用面**：只用 A4（生成），`ChatRequest` 契约（`modelCode`/`messages`/`tenantId`/
  `applicationId`+`applicationType` 等），不涉及 embedding/parse/rerank——Varda 没有知识库/
  检索管线,不是资产面产品。
- **调用路径**：`agent-server/varda` → `@vxture/model-runtime-client`（留在本仓,决策5,未发布,
  只服务 monorepo 内的 agent-server）→ Atlas 真实网络地址（原来是同网段的这个环境变量
  指向 monorepo 内服务，现在指向独立仓部署的 Atlas，变量本身 2026-07-29 也从
  `MODEL_PLATFORM_URL` 改名为 `ATLAS_API_URL`）。
- **鉴权**：service 模式 S2S token exchange（`aud=atlas`，`act.sub`=varda 服务身份）——虽然
  Varda 是内嵌产品,但它对 Atlas 而言就是一个调用方,和外部产品仓走同一套 S2S 契约,不因为"住在
  同一个 monorepo"就搞特殊、走内部裸调用。
- **计量归属**：`workspaceId`=触发会话的 workspace（Varda 场景是用户直接触发对话,不是资产归属
  方后台加工,对应 karda 需求信里"检索/交互场景计量归触发方"一类,不是"加工场景计量归资产归属方"）。

## 3. Karda（及同构的 Arda/Terra，L2 独立仓）——S2S 供给面全量消费方

Karda 是目前唯一已经把需求提到桌面上的 L2 消费方（`vxture-karda` 提交的 A1/A2/A3 需求清单），
但这套关系对 Arda/Terra 同样适用（`product_240` §3：C3 consume 对 L2 全部 ✔）。

- **调用面**：四类全用——A1（embedding，加工管线向量化）、A2（解析类小模型，deep-path 解析）、
  A3（rerank，检索统一精排）、A4（生成，`karda.ask` 单轮问答）。这是 Atlas 面向 L2 的完整供给面。
- **调用路径**：karda 加工/检索 worker → Atlas 独立仓暴露的 S2S 端点（`vxture-atlas` 仓
  `docs/30-design/200-s2s-provider-surface.md` 定义的 `/v1/embed`、`/v1/parse`、`/v1/rerank`
  - 已有的 generation 端点）——**纯网络调用,不经过 vxture-platform**。platform 在这条链路里
    没有任何角色（不代理、不转发），这是 Atlas 独立成仓后最直接体现"L1↔L2 平级对接"的一条线。
- **鉴权**：service 模式 S2S token exchange，`aud=atlas`，`act.sub`=karda 服务身份；
  批处理场景（A1/A2）workspace 归属=**库/资产归属方**（不是触发用户）；在线场景（A3）workspace
  归属=**触发请求的 workspace**——这个区分已经在 karda 的需求信和 Atlas 的设计稿里对齐过。
- **计量**：Atlas 是唯一计量入口，karda 不重复上报模型 token 消耗，只做归集视图。
- **本仓的角色**：**只做 Atlas 作为产品的 C2/C3 平台侧登记**（product 目录/OIDC client/webhook——
  任务6），不涉及 karda↔atlas 这条 S2S 调用链路本身——那是两个独立仓之间的事,platform 只是
  身份/计量的权威源头,不是调用路径上的一环。

## 4. L3 agent（raven/anlan/forge/xuanzhen）——经 agent-server 三段式,以 generation 为主

L3 是"行业业务领域智能体"（文档编写/客户管理/轨迹分析/战场模拟），`product_240` §3 明确 L3 的
"agent-server 槽 + 技能装载器 + Atlas LLM 客户端"是**核心必备件**（不是选装），`S2S caller`
对 L3 也是核心。

- **架构参照**：Varda 的三段式（前端→BFF→agent-server；`ToolRegistry` 白名单、`CallerContext`
  单一身份源、先审计后执行）是 L3 运行时的参照架构（`product_240` §4.2 第1项，仍待正式裁决,
  但已是既定参照方向）——即每个 L3 agent 仓都有自己独立的 `agent-server/`，结构上模仿 Varda,
  但**是独立仓,不在 vxture-platform monorepo 内**（这是 L3 和 Varda 的关键区别：Varda 是
  L0 内嵌复用宿主会话,L3 是独立产品仓,各自有自己的 agent-server 进程）。
- **调用面**：以 A4（生成）为主——L3 agent 的核心能力是"调用大模型完成业务任务"，不是资产面
  产品，不天然需要 embedding/parse/rerank（如果某个 L3 agent 的业务确实需要检索能力，那应该
  经由 L2（如 karda）作为知识库入口，而不是 L3 直接调 Atlas 的 A1/A3——`product_240` §3：
  visible-set/召回层过滤对 L3 是 ✘，"经 L2 入口被求值"，即 L3 不直接做资产面检索）。
- **调用路径**：L3 agent-server 内的 caller 模块（`product_210` token exchange 规范，尚无
  参照实现——T3 首个消费场景 arda→? 尚未落地，caller 模块要么先按规范抄样例，要么等 T3）→
  Atlas 的 generation 端点。
- **技能装载**：走 **Runa**（分发面），不是 Atlas——`product_240` §3 把"技能装载器"和"Atlas LLM
  客户端"并列为 L3 agent-server 槽的两个不同组件：技能从 Runa 拉取（版本 pinning+装载前验签），
  模型调用走 Atlas，两条线不要混在一起设计。
- **本仓的角色**：同 karda——只做 Atlas/Runa 作为产品的平台侧登记，不介入 L3 agent 仓↔Atlas
  的调用链路本身。

## 5. 统一契约层（四类消费方不因来源不同而分裂）

不管是 varda（内嵌）、karda（L2 独立仓）还是 L3 agent（独立仓），调 Atlas 时遵守同一套契约,
不为每类消费方定制协议：

- S2S token exchange 是唯一鉴权路径（`product_210`），没有消费方专属的凭证形式。
- 429 语义统一（限流 `RATE_LIMITED` vs 配额耗尽 `QUOTA_EXHAUSTED`，见 atlas 仓设计稿 §1.1）。
- 计量唯一入口在 Atlas，任何消费方都不重复上报模型 token。
- workspace 归属原则统一：**批处理/后台加工 = 资产归属方；在线交互 = 触发请求方**——这条原则
  对 karda 的 A1/A2 vs A3、对 varda 的对话场景、对 L3 agent 的任务执行场景都适用，不是 karda
  专属规则。

## 6. 与本仓任务5/6/7 的对应关系

| 本节                       | 对应本仓任务                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- |
| §1 Platform 运营台切换     | 任务5（BFF 部分）                                                            |
| §2 Varda 切换              | 任务5（model-runtime-client 部分）                                           |
| §3/§4 Atlas 作为产品的登记 | 任务6（平台侧登记，不涉及调用链路本身）                                      |
| 全篇                       | 任务7 文档同步时,`40-model-platform.md`/`product_100_matrix.md` 应引用本文档 |

本仓（vxture-platform）在 Atlas 独立后的角色收窄为：① Atlas 作为产品的 C2/C3 登记权威源，
② platform 运营台（admin/console BFF）的直接调用方，③ varda 的宿主。karda↔atlas、
L3 agent↔atlas 的 S2S 调用链路完全在两个独立仓之间发生，本仓不参与、不代理、不需要知晓实现
细节——这是"彻底切分"的应有含义：不是本仓不管 Atlas 了，而是本仓只管自己该管的那三件事。

## 7. 跨产品契约治理（2026-07-27，补记）

**触发背景**：karda 130 函把 Atlas A4 端点问题误寄到本仓；Atlas 自己的关键结论（token-exchange
是否已实现）只写在一封"暂存本仓、尚未走正式渠道发出"的草稿信里，导致 karda 后续又基于过期
前提发了一轮请求（140 函）。且 Atlas 已实际部署 worker-02:3100 多日，本仓
`13-infra-allocation-registry.md` 却一直登记"待分配"未回填。三个问题的共性：**跨仓事实靠书信
口口相传，没有一处唯一权威、可查的落点**，本节把治理规则固化，避免复发。

### 7.1 编制权分工（"谁来编制"不是笼统交给一方）

| 内容                                                                              | 编制方                                                                                                          | 落点                                                        | 理由                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 端点契约本体（schema/参数/错误码/版本策略,如 A1-A4 各自的 request/response 形状） | **Atlas 自己**                                                                                                  | `vxture-atlas` `docs/30-design/200-s2s-provider-surface.md` | 只有 provider 知道自己模型/算力的真实能力边界（生产者拥有 schema，类比 Confluent Schema Registry：producer 注册、consumer 校验兼容性）                                                                           |
| 鉴权信封（S2S token exchange 协议本身）                                           | **platform**                                                                                                    | `product_210` §3                                            | 跨越所有 L1/L2/L3 的统一机制，不因 provider 不同而分裂，已实施（T1/T2）                                                                                                                                          |
| 跨消费方统一不变量（鉴权路径/错误语义/计量唯一入口/workspace 归属原则,§5 四条）   | **platform**                                                                                                    | `product_210` §11（本次新增，见下）                         | 不能由单个 provider 自行决定这四条要不要遵守；platform 是唯一有资格对"所有 L1 provider 一视同仁"下判断的一方                                                                                                     |
| 能力发现（消费方怎么知道有哪些 modelCode/调用类型可用）                           | **Atlas 自己**，但**复用既有机制,不新造**                                                                       | `product_210` §4.2 `.well-known/vxture-tools`               | 平台本就不建中心工具注册表（product_210 §4.2 已定），Atlas 把 A1-A4 各自登记为工具描述符（`atlas.embed`/`atlas.parse`/`atlas.rerank`/`atlas.chat`）即可解决"消费方只能靠书信问 modelCode"的问题,不需要另建注册表 |
| 新增调用类型的需求征询（如 A1-A3 设计）                                           | **Atlas 主导,但设计前必须广播征询全部已知消费方**（karda + arda + terra + L3 占位），不能只按最先来信的一家设计 | 各自书信/PR 评论留痕即可,不强制新机制                       | 避免"N=1 客户驱动 API 设计"反模式——karda 提的 A2"部署亲和性"、A3"候选池 100/P95<400ms"都是 karda 场景特有约束,若不征询其他消费方,arda/terra/L3 接入时大概率发现契约形状不适配                                    |

### 7.2 跨仓事实同步纪律

- **稳态事实（是否已部署/是否已实现/地址是什么）唯一权威落点 = 登记表**（`13-infra-allocation-registry.md`
  等），**不是书信**。谁做了变更（部署上线/契约实现完成/端点开通），谁在同一批次回填对应登记表——
  书信只用于传递"一次性请求/决策"，不做事实的长期宿主。
- **草稿信不得卡关键阻塞事实**：若某仓书信里的结论会阻塞另一仓的决策（如"某端点是否已实现"这类
  是/否阻断性事实），不允许只停留在未发出的草稿里——要么立即正式发出，要么至少先把这个具体的
  是/否结论回填进登记表/README，书信可以慢慢补充完整背景说明，但不能让"决定性事实"唯一来源是一封
  没发出的信。

### 7.3 本次落地

- `13-infra-allocation-registry.md` §3 atlas 行已回填 `worker-02:3100 在产`（本次同批修正）。
- `product_210` §11 新增"供给面契约变更检查单"，作为 Atlas（及未来 ontos/runa）新增/变更 S2S
  供给面契约前的强制检查项，见该文档。
