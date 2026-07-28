# Model Provider Registry Plan — naming, domestic-first rollout, egress, selection UX

> 定位：本文回答"Atlas 之后要接哪些真实模型供给商（Claude/OpenAI/Gemini/Doubao/DeepSeek/MiniMax…），
> 这些供给商的编址、路由、开关、跨境网络与合规、以及消费方怎么选模型"——是本仓
> （vxture-platform）侧对模型注册表(`model.*` schema，平台库现行权威)的规划文档，不是 Atlas
> 自己的运行时/adapter 实现细节（那部分正本在 `vxture-atlas` 仓）。
> 上游：`platform/40-model-platform.md`(Model Platform 架构)、`platform/41-atlas-integration-topology.md`
> §7(跨产品契约治理)、`product_210_tool-protocol.md` §11(供给面契约变更检查单)、
> `docs/50-deployment/13-infra-allocation-registry.md`(atlas 主机)。
> 落地：`deploy/database/seed/seed-catalog.mjs` 第 10 段（`model.model_providers`/`model.models`/
> `model.model_price_rules`）、`deploy/database/seed/seed-lib.mjs`（固定 UUID 常量）。

## 0. 三个问题，三个不同的"路径"

上一轮讨论把"路径"混在一起问过——拆开看其实是三件独立的事：

1. **URL 路径命名**（`/model-platform/chat` vs `/v1/chat`）——Atlas 自己仓库的事，见
   `41-atlas-integration-topology.md` §7 已有的治理框架，本文不重述。
2. **modelCode 编址方案**——多供给商场景下，调用方怎么用一个字符串定位到具体模型。本文 §1。
3. **网络出境路径 + 合规姿态**——境外供给商(Claude/OpenAI/Gemini)从境内主机能不能连、该不该连。
   本文 §2-§3，是本文档真正的主体。

## 1. modelCode 编址方案：`{provider_code}/{vendor_model_name}`

采纳这个命名法（已在 §10 落地，见 `deploy/database/seed/seed-catalog.mjs`）：

- 前缀 = `model.model_providers.provider_code`，天然是 provider adapter 分发键；
- 全局唯一，避免不同厂商撞名（如未来两家都发布叫 "flash"/"mini" 的型号）；
- 支持同一逻辑能力走不同供给路径而不混淆（如未来同一模型有直连/代理两条路，注册成两个不同
  modelCode，用 `config.fallbackModelCodes` 做主备，`40-model-platform.md` §8 已有此机制）。

**遗留例外（不是漏改）**：`doubao-pro-32k`/`claude-sonnet-4`/`gpt-4o` 三个已经在产的 model_code
**保持不带前缀**——这三行的固定 UUID（`ID.modelDoubaoPro`/`ID.modelClaudeSonnet`/`ID.modelGpt4o`）
在已经跑过这份 seed 的环境里已经存在，若把 `model_code` 改成带前缀的新字符串、UUID 不变重新
insert，会在 `model.models` 的主键 `id` 上撞车（`on conflict (model_code) do nothing` 这个冲突目标
盯的是 `model_code` 唯一约束，不覆盖 `id` 主键冲突，插入会直接报错，不是静默跳过）。**这三行的
真正改名需要一次显式的 `UPDATE ... SET model_code = ...` 迁移，不能靠改 seed 文字重新 insert**——
本轮不做，留作待办（登记见 §5 任务表）。新增的三行（deepseek/minimax/google）没有这个历史包袱，
直接用带前缀的规范命名。

### 1.1 `model_code` 是编址/分发键,不是上游 API 的字面值(2026-07-28 澄清,回应 `vxture-atlas` liaison platform#152)

atlas 真实调用 Doubao/Zhipu 时发现:自己的 provider adapter 把 `model_code` **原样**塞进上游请求体的
`model` 字段——Doubao/Zhipu 的真实 API 只认各自厂商裸型号 ID(如 `doubao-seed-2-0-lite-260428`/
`glm-5.2`),不认带 `{provider_code}/` 前缀的字符串,直接 404。

这不是命名约定本身错了,是**两个不同概念被一个字段同时承担**:`model_code` 天然该是**内部编址/
分发键**(本文开头就是这么定的——"provider adapter 分发键",用来在多厂商场景下避免撞名、决定
路由到哪个 adapter),从来没有被定义为"逐字节发给上游 API 的值"。两者在无前缀的三个遗留例外
（`doubao-pro-32k` 等）里恰好相等,掩盖了这个区分从一开始就该存在。

**结论**:`model.models.config`(已有 jsonb 列,无需 DDL 变更)新增一个可选键
`upstreamModel: string`——provider adapter 构造上游请求体时,优先读
`config.upstreamModel`,缺省(遗留例外三行)才退回 `model_code` 本身。带前缀的新注册行
（deepseek/minimax/google 占位型号替换为真实型号时）应同时写好 `config.upstreamModel` 为厂商
裸型号 ID。**这是 atlas 自己 adapter 代码的实现范围**(读哪个字段、怎么退回),本仓只负责在
seed 数据里把 `config.upstreamModel` 填对。

**已知偏离,待回收**:atlas 为了让 Doubao/Zhipu 真实调用跑通,临时把这两家的 `model_code` 直接
改回裸型号(如 `doubao-seed-2-0-lite-260428` 本身,不带 `doubao/` 前缀)注册——这是在 adapter 还
没实现 `config.upstreamModel` 读取之前的可用性优先选择,**偏离了本节的编址规范,不是新的例外
条款**。`config.upstreamModel` 落地后应把这两行改回带前缀命名 + 补 `config.upstreamModel`,登记
见 §6 任务表 #9。

## 2. 域内优先，境外"注册但关闭"

owner 决策(2026-07-27)：**跨境网络与合规问题暂缓，先聚焦国内模型；境外三家先在模型平台注册好
（目录形状就绪），但状态设为关闭，不可用，等跨境网络+合规通过后再开**。已落地：

| provider_code    | is_active                    | config.egressRoute | 说明                                                                                      |
| ---------------- | ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `doubao`         | **true**                     | `direct`           | 域内，已在产                                                                              |
| `deepseek`(新增) | **true**                     | `direct`           | 域内，占位型号 `deepseek/deepseek-chat`，上线前需产品/成本确认真实型号                    |
| `minimax`(新增)  | **true**                     | `direct`           | 域内，占位型号 `minimax/minimax-text-01`，同上需确认                                      |
| `anthropic`      | **false**（本轮关闭）        | `overseas-proxy`   | 已在产但本轮改为不可用，`config.status = registered-closed-pending-egress-and-compliance` |
| `openai`         | **false**（本轮关闭）        | `overseas-proxy`   | 同上                                                                                      |
| `google`(新增)   | **false**（新注册,直接关闭） | `overseas-proxy`   | 占位型号 `google/gemini-2.5-flash`                                                        |

实现上做了两件事保证幂等收敛（不只是"新库能建对"，"已经跑过旧 seed 的环境重跑也能收敛到新状态"）：
insert 语句本身（`on conflict do nothing`，覆盖全新环境）+ 紧跟着的显式 `UPDATE`（覆盖
anthropic/openai/google 已经存在的场景，因为 `on conflict do nothing` 不会更新已存在的行）。

## 3. 模型 vs OAuth：管理面性质不同,这直接决定了"开关"怎么生效

**关键澄清（owner 指出，2026-07-27）**：模型供给商是**页面可配置**的（DB 驱动，Admin 控制台
`ModelPlatformPage.tsx` 经 `bff/admin-bff/src/routers/model-platform.router.ts` 做 provider/model
CRUD，`40-model-platform.md` §4/§8 已有此能力）——这和 OAuth client secret 那种**写死在主机 env
文件里、改了要 recreate 容器**的机制完全不同。

推论：**未来境外三家跨境网络+合规通过后，"打开"这几个 provider 不需要代码改动或重新部署**——
是 operator 在 Admin 控制台里把 `is_active` 勾选为 true（连带补上真实 `model_code`/定价/
`config.egressRoute` 指向届时建好的代理路由）。本仓这次 seed 改动只负责"把目录形状先摆出来"，
不是"以后开启也要靠改这份 seed 再发布"——那样反而绕开了页面管理的本意。

## 4. 出境网络路径 + 数据合规（暂缓，但决策路径先记录）

跨境问题本身按 owner 指示暂缓，但把技术路线记录下来，避免将来重新讨论一遍：

- **网络路径**：参照 `project_google_oauth_egress` 已定的技术方案——专用海外 VPS 跑 HTTPS
  CONNECT 正向代理、加入 tailnet、ACL 限定只有指定主机能用；**不建议复用 Google OAuth 未来要建的
  那台代理机**，模型推理流量（持续、可能流式、携带真实客户 prompt 内容）和 OAuth 的两个端点
  （偶发、极小）吞吐画像完全不同，共用一台机器会互相拖累故障域。
- **数据出境合规**：客户 prompt/对话内容一旦经代理发到 Claude/OpenAI/Gemini，构成个人信息/数据
  出境，可能触发《数据出境安全评估办法》或标准合同备案——这是 **owner 决策项，不是技术决策**，
  网络路径打通之前必须先有姿态（是否需要标准合同备案、是否只对特定行业/租户开放境外模型、
  是否需要租户级显式授权勾选）。技术落点复用现有 `model.model_grant`（租户级技术授权白名单）
  ——不需要新表，只需要在"给某租户发境外 modelCode 的 grant"这个动作前加一道合规确认前提。
- 两项都留作 owner-gated 待办，不在本轮范围内推进（见 §5 任务表标注）。

## 5. 消费路径：业务自动适配 vs 用户主动选择（karda 追加需求，2026-07-27）

karda 后续接入模型能力时，两种消费模式需要不同的契约形状，不能都靠"传一个 modelCode"了事：

### 5.1 业务自动适配

karda 的业务代码不应该硬编码具体 modelCode——一旦硬编码，就绕开了 Atlas 存在的意义（换供应商/
降级都得改 karda 代码）。目标形态：karda 传一个**任务画像**（如 `taskProfile`，抽象标签，不是
具体厂商模型名），由 `model.model_policy`（现有字段"routing preference"，目前未真正实现按任务
画像选择的逻辑）解析成具体 modelCode + fallback 链。换供应商、调价格、灰度都在 Atlas 一侧完成，
karda 不用感知。**这是 Atlas 侧待设计项**，本仓只负责登记 Atlas 作为产品的 C2/C3（既有边界不变）。

### 5.2 用户主动选择

karda 前端如果要给终端用户一个模型选择器，需要 Atlas 暴露"这个租户/workspace 实际可选哪些
模型"。现有 `GET /model-platform/models`（`ModelRuntimeController.listModels()`）**是全局未过滤
的**——直接拿来做终端用户选择器会把租户没被授权、甚至没走合规确认的境外模型也列出来。
**这是 Atlas 侧的一个真实缺口**，建议 Atlas 加一个按调用方 S2S token 的 `workspace_id` 求值过的
"可选模型"变体（S2S token 本就带 workspace_id，天然可以用来过滤 `model_grant`），而不是复用
运营台那个全局清单接口。两条路径共用同一个 `model.model_grant` 授权底座，只是"谁来选"不同。

## 6. 推进任务表

| #   | 任务                                                                   | 归属           | 状态                 | 备注                                                                                                     |
| --- | ---------------------------------------------------------------------- | -------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | modelCode 命名规范定稿                                                 | platform       | ✅ 本轮完成          | 本文 §1                                                                                                  |
| 2   | 域内三家(doubao/deepseek/minimax)注册为 active                         | platform       | ✅ 本轮完成          | `seed-catalog.mjs` 第 10 段；deepseek/minimax 为占位型号,上线前需确认真实型号+成本                       |
| 3   | 境外三家(anthropic/openai/google)注册为 registered-closed              | platform       | ✅ 本轮完成          | 含幂等 UPDATE，覆盖已存在环境                                                                            |
| 4   | 已在产 3 个 model_code 补前缀(doubao-pro-32k→doubao/doubao-pro-32k 等) | platform       | 待办(不阻塞)         | 需要显式 UPDATE 迁移，不能靠 reseed；不影响任何当前功能，优先级低                                        |
| 5   | 出境网络路径(专用海外代理机)                                           | platform 基建  | **owner-gated,暂缓** | 参照 Google OAuth 出海方案但不共用同一台机器                                                             |
| 6   | 数据出境合规姿态拍板                                                   | **owner 决策** | **owner-gated,暂缓** | 先于任务 5 落地，网络通了不代表合规                                                                      |
| 7   | 任务画像路由(`model_policy` 按 taskProfile 选模型)                     | Atlas 编制     | 待 Atlas 设计        | 本仓不代做，随 A1-A3 一起规划                                                                            |
| 8   | 租户过滤的"可选模型"清单接口                                           | Atlas 编制     | 待 Atlas 设计        | karda 做用户选择器前的前置依赖                                                                           |
| 9   | `config.upstreamModel` 落地 + doubao/zhipu 裸型号回收为带前缀命名      | Atlas 实现     | 待 Atlas 排期        | 本文 §1.1；不阻塞现有功能（当前裸型号可用），platform 侧仅需保证 seed 数据里 `config.upstreamModel` 填对 |

## 7. 边界之外

不在本文档拍板：deepseek/minimax 的真实型号与成本费率（产品/成本决策，需替换占位值后再启用
计费）；境外三家的实际代理机型号/带宽/合规文本（owner 决策，暂缓）；Atlas 侧 `model_policy`/
"可选模型"接口的具体实现（Atlas 自己的仓库与设计文档）。

## 8. 租户自有/自注册模型扩展路径（2026-07-28 owner 拍板：预留全量设计，本期只做 Phase 1）

### 8.1 三种供给形态（行业收敛分类）

| 维度     | ① 平台供给（现状）       | ② 租户自注册三方（BYOK）                  | ③ 租户自有模型（BYOM/自托管）    |
| -------- | ------------------------ | ----------------------------------------- | -------------------------------- |
| 注册者   | 平台运营者（能力控制台） | 租户管理员（租户 console）                | 租户管理员（租户 console）       |
| 凭证归属 | 平台 vault（shared）     | 租户条目（dedicated），租户与厂商直接结算 | 租户端点凭证或无凭证             |
| 上游成本 | 平台付→计量→向租户收     | 平台不付上游费只计量（服务费=商业决策）   | 无上游费，纯计量                 |
| 可见性   | 按 `model_grant`         | 仅 owner 租户                             | 仅 owner 租户                    |
| 端点门槛 | 平台审核                 | known SaaS（受 §4 出境治理约束）          | 任意 URL，必须 OpenAI-compatible |

### 8.2 既有预埋位（激活即用，非新建）

`model_providers.provider_type CHECK ('online','self_hosted','private')`（三形态类型轴 day-one 已建）；
`private.provider` adapter（代码已存在）；`key.provider_api_keys.key_scope` shared/**dedicated**（租户
专属凭证位已留）；`commerce.tenant_subscription_quota.allow_custom_model`（权益门已在，套餐档位可把
自有模型做成付费能力）。

### 8.3 三个真缺口

1. **注册表 owner 作用域**：`model.models` 无租户归属列且 `model_code` 全局唯一——需加
   `owner_workspace_id nullable`（null=平台条目），唯一约束改 (scope, model_code) 复合；租户条目
   走保留前缀命名空间（衔接 §1 命名法）；owner 隐式授权（建即可用，不走 grant 发放）；跨租户共享
   自有模型**不做**（真有需求走既有 SharingGrant 机制，本期不开门）。
2. **Atlas 第三张 API 脸（租户自助控制面）**：现有运营控制面（M 线）+ S2S 供给面之外，新增
   customer realm 身份、workspace 作用域、经 console-bff 上租户 console 的自助注册面。分工与
   `product_250` 三面架构零冲突：能力控制台管平台全局目录，租户 console 管租户自有条目；
   租户过滤"可选模型"清单端点自然升级为 granted 平台模型 ∪ 租户自有模型的并集。Atlas 仍 L1。
3. **egress/SSRF 防护（安全刚性项）**：租户可注册任意 URL → Atlas runtime 替其发 POST。必须：
   目的地址硬拒 RFC1918/loopback/link-local(169.254.0.0/16)/CGNAT(100.64.0.0/10,即 tailnet 段)、
   DNS 解析后校验（防 rebinding）、独立超时/熔断（租户端点故障域按租户隔离）、平台模型与租户
   模型**不互为 fallback**。

### 8.4 治理红线：BYOK 不得旁路 §2/§4 出境合规决策

境外三家 registered-closed 是 owner 决策；若 BYOK 无目的地治理，任何租户拿自己的境外厂商 key
即可让平台向境外发送 prompt——出境合规义务不因 key 是租户的而消失（平台仍是数据处理/传输方）。
BYOK 端点白名单第一期限定域内厂商；境外 BYOK 与平台自身境外开通走同一个 owner-gated 决策门
（§4），不另开口子。

### 8.5 分期（2026-07-28 拍板）

| Phase | 内容                                                                                                                                                                                            | 状态                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1     | **租户自托管模型（BYOM 域内）**：provider_type='private' 激活 + 租户 console 注册页 + 8.3#1/#2/#3 三缺口 + allow_custom_model 权益门；计费零改动（无上游费只计量）；注册时 test-connection 探测 | **本期实现（已批准）**     |
| 2     | BYOK 域内 SaaS：vault 租户 dedicated 条目 + 计费语义（计不计 period_tokens/服务费=**owner 商业决策**）                                                                                          | 预留，未排期               |
| 3     | 境外 BYOK                                                                                                                                                                                       | 预留，挂 §4 owner-gated 门 |

### 8.6 密钥托管归属（2026-07-28 拍板，对平台供给与租户形态统一适用）

**所有 provider API key（平台 curated 与租户 dedicated）一律存 Atlas 自己库的 `key.provider_api_keys`
（信封加密），能力控制台/运维面零持有**。理由：运行时局部性（每次推理都要用，存平台侧即重建
可用性/延迟耦合）；三平面铁律（控制台是管理面 UI 外壳，无域状态——密钥明文仅在 create/rotate
写入时过一次网，落库即加密，UI 此后只见掩码与轮换日志，`product_250` M-3）；DDL 既定（`40_model.sql`
"密钥归本库 key schema"）。信封加密主密钥（KEK）留 Atlas 主机 env，owner 手动转运，不进运维面。
现行 `apiKeyEnvVar`→env 为过渡态，目标态 runtime 从 vault 解析——Atlas 仓 provider-keys 模块
（含 crypto）已是实现态，剩 runtime 解析接线 + 守卫按 M-1 切换。
