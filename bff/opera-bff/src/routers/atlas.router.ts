/**
 * atlas.router.ts — Atlas 技术管理面代理（provider / model / 用量事实）。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * opera 是 Atlas 的技术运维归属：Provider 接入与 Model Registry 的生命周期管理
 * （创建/编辑/启停/删除）此前挂在 admin 的 /atlas 页，本次全量迁走（`product_250`
 * §4 批E "admin 迁出退役"），admin-bff 只留只读代理（给它自己 commercial 页面
 * ——price-rules/policies/quotas——挂 model 下拉用）。
 *
 * 归属依据 = `product_250` v0.2（owner 2026-08-11 决定：管理 UI 归 opera 统一
 * 创建，provider 仓只负责管理 API 契约；批D 由"atlas 仓"改为 platform 仓）。
 * 注：该决定与另一条同日口径"opera 完全从 admin 迁出，聚焦技术运维平台"，
 * 2026-08-12 之前都**只写在本仓代码注释里、docs/ 0 处**；前者已补记进
 * `docs/30-design/product_250_management-plane-contract.md` v0.2，后者对应
 * 批E 本就在文档中有据。改动归属判断前读文档，不要只读注释。
 * 这不是复制一份：本文件与 admin-bff 的 atlas.router.ts 各自独立维护，类型/服务
 * 零交叉引用（不 import 对方任何东西），只是恰好代理同一个上游、恰好长得像—— 两个
 * *-bff 之间不建依赖是明确纪律。
 *
 * 数据源单一权威 = Atlas 的 `/capability/*` HTTP 面（ATLAS_API_URL，外部主机；
 * vxture-atlas/docs/20-specs/10-http-surface.md 是权威契约，仓内不存副本）。
 * 认证 = operator-OBO（product_250 M-1）：把当前 operator 的会话 access token
 * 换成 aud=atlas 的短时管理令牌再转发，opera-bff 不用自己的身份替 operator 说话。
 * OperatorExchangeService 是 opera-bff 自己的一份（在 OidcRpModule 里，和
 * admin-bff 那份代码同构但物理独立）。换票失败时降级为匿名转发而不是挡页面——
 * atlas 尚未强制校验这枚令牌的过渡期内，先让页面能看。
 *
 * 能力码：providers 用 `model:provider.manage`、models/usage-summaries 用
 * `model:model.manage`——这是活库 admin.operator_permission 里**真实存在**的当前
 * 三段式码（2026-08-11 核对：admin/super_admin/tech_ops 三个角色都直接持有这两
 * 个，opera 与 admin 从同一套 admin.operator_role_permission 表解析能力码，
 * "能力码是平台级的，不因为换了个门户就换一套"——operator-authz.service.ts 文件
 * 头）。**不用** `platform.model.manage`：那是旧扁平码，早已从 seed 目录退役，
 * 现在只活在 admin-bff 自己的 `LEGACY_CAPABILITY_BRIDGE`（auth.service.ts）里，
 * 靠那层桥接把 model:*.manage 现算成 platform.model.manage 回填进
 * capabilities——桥接是 admin 侧为了不动旧路由签名而加的过渡垫片，opera-bff 没
 * 有这段历史包袱，没有理由背同一个死码：第一次实测直接验证过（一个持
 * model:provider.manage 的账号在 opera 侧读 providers 时被判 403，查明是这里）。
 *
 * 范围覆盖 opera 技术面用得到的：providers（全 CRUD，含 health 字段与
 * providers/performance 近实时聚合，2026-08-12 补，liaison #245）、models（全
 * CRUD）、
 * provider-keys（vault，2026-08-12 补——atlas#131 官方 tracking marker明确写着
 * "model management incl. provider-keys vault page... will move to opera"）、
 * usage-summaries（只读，metering 页用）、endpoints（2026-08-12 补，liaison
 * #246——稳定能力入口 code → primary/fallback modelCode 的间接层，无独立 Router
 * 资源）、api-keys（2026-08-12 补，liaison #247——网关入方向调用者凭证，和
 * provider-keys 是反方向，不要混；这批 key 目前还没接入任何认证路径，纯管理面）。
 * grants / price-rules / policies / quotas 是商业封装层，留在 admin-bff——两段
 * 裁决（opera 技术供给 → admin 商业封装，product_100_matrix.md）没有变。
 *
 * endpoints 复用 model:model.manage（路由配置本质是模型间接层，同一批人管）；
 * api-keys 复用 model:provider.manage（和 provider-keys 一样是"vault"类操作,
 * 同样挂 StepUp）——admin.operator_permission 目前没有更细的能力码，不在这里
 * 新造一个只有零个 operator 持有的死码。
 *
 * 二次验证（2026-08-13，`product_250` v0.4）：判据归 platform 目录、**执行归
 * console**。密钥类 9 个写路由在**本文件**用 `@RequireStepUp()` 标注，由 opera-bff
 * 的 `OperatorStepUpGuard` 在代理前把关；门户 `StepUpProvider` 负责跑仪式
 *（IdP 现签 300s 操作级凭证）。
 *
 * **Atlas 侧已撤除自己的 `StepUpRequiredGuard`**（vxture-atlas#167，随 #165 达成
 * 一致后执行），同时删掉了 `amr` 与 `operator_role` 的解析（#169）——判据是"有没有
 * 拒绝分支"：那两个 claim 解析进 context 后无人读，`amr` 唯一的消费者就是被删的那个
 * 守卫。Atlas 保留 7 条真实有拒绝分支的校验：验签/iss/exp/aud、`scope=mgmt:atlas`、
 * `realm=workforce`、`userType=operator`、`sub`（审计记名）、`act.sub`（来源模块）。
 *
 * 所以现在**只有一道闸门**，在 opera 这边，且是操作级而非会话级。不再需要透传
 * Atlas 的 step-up 错误——它不会再产生那个错误了。
 *
 * ── 2026-08-13 按 Atlas 管理面设计稿逐条验收（vxture-atlas
 * `docs/30-design/110-management-plane.md` + `docs/20-specs/10-http-surface.md`，
 * 对照 `service/src/runtime/model-admin.controller.ts` 实源核对）────────────────
 *
 * 补上四个此前 0 处代理的资源，并把三处**已经过时的响应形状**改对。过时的那几个
 * 比缺失的更危险：页面照旧渲染，只是渲染的是一个 Atlas 已经不再那样回的世界。
 *
 * 新增：
 * - `protocols`——协议词表 + 每个协议的 `config.wire` 默认值。设计稿写明它就是
 *   「管理 UI 的下拉数据源」，而 models 页此前硬编码三个值，与真实适配器分发表
 *   无关，选错了要到真实调用才炸。
 * - `providers/:id/probe`——provider 粒度主动探测。opera 此前在**页面里**手工编排
 *   （拉模型列表 → 挑一个 → 打模型 probe），那套编排现在有了官方实现，且会回
 *   `probedModel` 说明验的是哪一条，以及 409 MODEL_ADMIN_PROVIDER_NOT_PROBEABLE
 *   （provider 在、但名下没有启用模型）——这两个信息前端编排都给不出来。
 * - `product-grants`——**产品维授权轴**（product × endpoint）。这是工程关系不是
 *   商业关系（设计稿"授权在移向 (product, endpoint)"一节的三行表：tenant↔product
 *   归平台商业面，product↔endpoint 归 Atlas，tenant↔model「不应存在」），所以它
 *   归 opera，而**留在 admin 的是旧的 tenant 轴 `grants`**——两个都叫 grant，不是
 *   同一个东西，不要合并。
 * - `audit-logs`——Atlas 自己那份 append-only 变更流水。与 opera-bff 的
 *   `support.audit_logs` 不重复：后者只记「经过 opera 的写」，前者记 Atlas 收到的
 *   **每一次** `/capability/*` 写（含被守卫在 handler 之前挡掉的、operator_sub
 *   记为 "unknown" 的失败尝试）。只看 opera 那份，等于只审计自己。
 *
 * 形状修正（旧字段全部还在，是加字段不是换字段）：
 * - providers 行多了 `modelCount`、models 行多了 `grantCount`/`endpointRefCount`
 *   ——设计稿第 2 条规则：**行上的计数就是挡住删除的那个数**，与删除前置条件同源。
 * - endpoints 行多了 `resolution` 与 `models[]`。`state` 是运营的意图，
 *   `resolution` 是它当前实际在干什么，两者**只在上游坏掉时才不一致**——而那正是
 *   唯一值得看的时刻。设计稿这条是从「三个 state:active 的 endpoint 指着已下线
 *   模型、页面全绿」学来的。
 * - usage-summaries 行多了 `dimension` 与 `workspaceId` 等轴字段：这个端点从
 *   tenant 单轴扩成了五轴（`groupBy`），且**计费主体是 (tenant, workspace) 这一对**
 *   ——只按 tenant 分组会盖掉是哪个工作区烧的。
 *
 * 三条边界没有变：price-rules / policies / quotas / 旧 tenant 轴 `grants` 仍归
 * admin（商业封装层，product_100_matrix.md 两段裁决）；opera 不在这里代理它们。
 *
 * ── 2026-08-23 上游路径改名（product_251 X-4，vxture-atlas#206）────────────────
 *
 * Atlas 把三个含糊的资源名改成了说清「授的是什么、路由的是什么」的名字：
 *
 *   endpoints       → model-routes
 *   product-grants  → product-endpoint-grants
 *   grants          → tenant-model-grants        （admin 的，不在本文件）
 *
 * 旧名**仍在服务**，但带 `Deprecation: true` + `Sunset: 2026-09-16` 响应头，并计入
 * `capability_legacy_path_requests_total{path,operator}`——那个计数器就是删除旧名的
 * 闸门（`capability-route-names.ts`：日期是地板，归零才是触发条件）。继续打旧名有两个
 * 后果：到期日那天变成 404，且在此之前**让计数器永远归不了零**，等于我们自己把上游
 * 的清理挡住。所以本次把出站路径全部改到新名。
 *
 * **本层对外的路径一行不动**（`/api/atlas/endpoints`、`/api/atlas/product-grants`）：
 * 页面那侧的语义没变，把上游改名吸收在适配层正是它存在的理由——同 runos 那边
 * `grants/:id` → `POST :id/revoke` 的先例。
 *
 * 审计不受影响：Atlas 的 `audit.middleware.ts` 用 `canonicalCapabilitySegment()`
 * 把旧名折回新名再落库，所以改之前落的行本来就记的是 `model-routes` /
 * `product-endpoint-grants`——变更审计页上的资源类型筛选值不会因为这次改动分叉。
 *
 * ── 查询参数：Atlas 现在**拒收**它不认识的过滤器 ──────────────────────────────
 *
 * 每个 list 端点都过一遍 `rejectUnknownFilters(all, ALLOWED, "*_UNKNOWN_FILTER")`
 * （atlas `http-query.ts`）：多送一个键不是被忽略，是 400，且 message 会把该端点接受
 * 的全集列出来。理由写在那个文件里——一个没被应用的过滤器会回一页**没筛过的**结果，
 * HTTP 200、形状正常、答案完全不对，而这在审计检索上是最坏的一种失败。
 *
 * 对本文件的意义是：**往任何一个 params 里加键之前，先去上游确认它在 allowlist 里**。
 * 加错了会立刻整页报错（响亮），比悄悄多回一堆行好；但那也意味着「顺手加个过滤器」
 * 不再是一个本地决定。当前逐端点的 allowlist：
 *   providers            includeInactive
 *   provider-keys        providerCode
 *   model-routes         includeInactive, modelCode
 *   models               includeInactive, providerId
 *   product-endpoint-grants  productCode, endpointCode, includeInactive
 *   usage-summaries      tenantId, applicationId, applicationType, cycleMonth,
 *                        providerCode, modelCode, productCode, groupBy
 *   logs                 tenantId, modelCode, providerCode, endpointCode, status,
 *                        requestId, taskId, from, to, cursor, limit
 *   logs/summary         window, modelCode, providerCode, endpointCode
 *   audit-logs           objectType, objectId, actorId, action, outcome, from, to,
 *                        cursor, limit
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { Request } from "express";
import type { Pool } from "pg";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { OperatorAuditEntry } from "../audit/audit-log";
import { recordProxyWrite } from "../audit/proxy-audit";
import { assertAtlasContract, type AtlasResource } from "./atlas-contract";
import {
  notEntitled,
  unauthenticated,
  upstreamUnavailable,
} from "../errors/api-error";
import { RequireStepUp } from "../auth/step-up.decorator";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";

/** 换票时的目标 audience（对齐 product_100 的产品码）。 */
const ATLAS_AUDIENCE = "atlas";
/** 活库当前的三段式能力码（见文件头——不是 admin-bff 那个已退役的扁平码）。 */
const PROVIDER_MANAGE_CAPABILITY = "model:provider.manage";
const MODEL_MANAGE_CAPABILITY = "model:model.manage";

type JsonObject = Record<string, unknown>;
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * 两值资源的最小词表（atlas `object-state.ts`）。Provider / Endpoint /
 * Product Grant / Provider Key 都是它。
 */
export type ObjectState = "active" | "inactive";

/**
 * 模型的三值状态。第三档 `deprecated` 正是 product_251 M-B3 立论那句话的实例：
 * **仍可解析、不再推荐**，既不是 true 也不是 false，布尔装不下。
 */
export type ModelState = ObjectState | "deprecated";

interface AtlasErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

/** 从真实 chat/stream 流量派生，不是主动探活；无流量时 status="unknown"（不是 "down"）。 */
export interface ProviderHealth {
  status: "healthy" | "degraded" | "down" | "unknown";
  successRate: number | null;
  avgLatencyMs: number | null;
  attempts: number;
  lastObservedAt: string | null;
}

export interface ModelProviderRecord {
  /** 该 provider 名下**未删除**的模型数（不论启停）——就是挡住
   *  `DELETE /capability/providers/:id` 的那个数，与删除前置条件同源。列上显示 0
   *  而删除回 409，比不显示这一列更糟：它教会操作者不信这个页面。 */
  modelCount: number;
  id: string;
  providerCode: string;
  providerType: string;
  providerName: string;
  description: string | null;
  homepageUrl: string | null;
  consoleUrl: string | null;
  billingUrl: string | null;
  /** product_251 B-3 的两值词表：`active` / `inactive`。 */
  state: ObjectState;
  config: Record<string, unknown> | null;
  health: ProviderHealth;
  createdAt: string;
  updatedAt: string;
}

/** attempts/successes/errors 是进程启动以来的累计计数器（Prometheus 语义）——
 *  要算速率，轮询两次做差值，不是瞬时 QPS。只覆盖 chat/stream，只到 provider 粒度。 */
export interface ProviderPerformanceSnapshot {
  generatedAt: string;
  processStartedAt: string;
  inFlightRequests: number;
  providers: {
    provider: string;
    attempts: number;
    successes: number;
    errors: number;
    errorRate: number | null;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    lastObservedAt: string | null;
  }[];
}

/**
 * **模型的 `state` 是三值**，与 provider / grant / endpoint 的两值不同：
 * `active` / `inactive` / `deprecated`。
 *
 * `deprecated` = **仍可解析、不再推荐**，它的 `is_active` 仍是 true——所以「已弃用」
 * 不是「已停用」，把两者压成一个布尔正是 B-3 立论的那句话。优先级由 atlas 定：
 * `deleted_at` > `is_active` > `deprecated_at`，即运营明确停用的模型报 `inactive`
 * 而不是 `deprecated`（他停用它是认真的）。
 */
/**
 * atlas 的 `ResolvedWire`，逐字段照抄（`vxture-atlas/service/src/providers/wire.ts`）。
 *
 * 七个键就是 atlas 的 `KNOWN_KEYS` 全集——写入侧对未知键是**拒绝**而不是忽略，
 * 所以这里不留 index signature：多出来的键意味着上游改了词表，那该由契约守卫报出来，
 * 不该被一个 `[k: string]: unknown` 悄悄吞掉。
 */
export interface ResolvedWire {
  schemaVersion: number;
  /** 端点后缀；`null` 表示用适配器默认。 */
  chatPath: string | null;
  authStyle: string;
  /** 附加的静态请求头（如 Anthropic 的 `anthropic-version`）。 */
  headers: Record<string, string>;
  streamUsage: string;
  supports: Record<string, boolean>;
  /** 规范参数名 → 上游线上字段名，仅记录与默认不同的。 */
  paramMap: Record<string, string>;
}

export interface AiModelRecord {
  /** 引用该模型的未删除授权数。挡删除。 */
  grantCount: number;
  /** 把该模型挂作 primary **或 fallback** 的未删除 endpoint 数。挡删除——
   *  悄悄剪断一条 failover 链和弄坏一个 primary 是同一类问题，只是更安静。 */
  endpointRefCount: number;
  id: string;
  providerId: string | null;
  modelCode: string;
  modelName: string;
  provider: string;
  endpointUrl: string;
  protocol: string;
  /**
   * 这一行由**哪一层契约**来服务：`chat` / `embedding` / `rerank` / `parse`。
   *
   * 它决定的是 atlas 上哪个 surface 认这个模型（`/v1/chat` / `/v1/embed` /
   * `/v1/rerank` / `/v1/parse`），**且创建后不可改**——atlas 的列锁不给 UPDATE，
   * 送过去是 400。所以注册时选错等于要重新注册一个。
   *
   * 2026-08-23 补：此前 opera 的注册载荷根本不送这个字段，服务端默认 `chat`——
   * 也就是**经 opera 注册的模型只能是 chat**，而在产库里 embedding / rerank / parse
   * 三类都真实存在（它们是别的途径建的）。这是一处实打实的联通缺口，不是打磨。
   */
  modelType: string;
  description: string | null;
  /** 上下文窗口（token）。在产库 131 个模型里 128 个有值。 */
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: string[];
  supportsStreaming: boolean;
  /** 列表排序权重，越小越前；atlas 创建时默认 999。 */
  sort: number;
  /**
   * 上游 + wire 的不透明指纹（atlas `model-behavior-version.ts`）。
   *
   * 它存在的唯一理由是让「有人把这个模型指到了别的上游」**变得可观测**——`modelCode`
   * 锁死不可改，但 `endpointUrl` / `providerId` / `config` 都允许改，改完调用方拿到的
   * 还是同一个 modelCode，行为却换了。这个值一变就是那件事发生了。
   */
  behaviorVersion: string;
  keyReference: {
    source: "env";
    name: string;
    configured: boolean;
  } | null;
  /**
   * **模型是三值**，与 provider / grant / endpoint 的两值不同。
   *
   * `deprecated` = **仍可解析、不再推荐**，它的 `is_active` 仍是 true——所以「已弃用」
   * 不是「已停用」。优先级由 atlas 定：`deleted_at` > `is_active` > `deprecated_at`，
   * 即运营明确停用的模型报 `inactive` 而不是 `deprecated`（他停用它是认真的）。
   */
  state: ModelState;
  /**
   * **这个模型自己声明的** wire 覆盖（以及其它自由配置）。不是生效值。
   *
   * 与 `resolvedWire` 并列不是冗余：这一份回答「哪一层设了这个键」，那一份回答
   * 「实际跑的是什么」。上游把两份都发过来，正是为了让控制台不必自己合并。
   */
  config: Record<string, unknown> | null;
  /**
   * 实际生效的线协议描述符：协议默认 ← Provider 的 `config.wire` ← 本模型的。
   *
   * atlas 2026-08-24 起直发（`resolveWireFor`，纯配置合并、不发上游请求）。此前
   * 想看生效值只能跑一次自检，而自检是**真实调用、要烧 token**——于是
   * `behaviorVersion` 这个便宜信号指向了一个昂贵的答案，实际没人去问。
   *
   * **不要在门户里自己合并这三层。** 上游的 `applyOverlay` 是逐键合并
   * （`headers` 走 string-map 合并、`authStyle` 走枚举读取且遇到非法值静默回退），
   * 重实现一遍就是同一个事实的第二个来源，而且它的失败方式是安静的：
   * 渲染出一个从来没有任何请求用过的描述符。
   */
  resolvedWire: ResolvedWire;
  /** 何时弃用的——控制台要的是**何时**，不只是**是否**（atlas#236）。 */
  deprecatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 元数据视图——不带密文，更不带明文；镜像 atlas 的 ProviderKeyAdminRecord。 */
export interface ProviderKeyRecord {
  id: string;
  providerCode: string;
  keyAlias: string;
  keyScope: string;
  /** product_251 B-3 的两值词表：`active` / `inactive`。 */
  state: ObjectState;
  lastRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Endpoint 当前实际在干什么——从它指向的模型状态**读时推导**，不写在行上。
 *
 * - `disabled`     运营把它关了。只有运营能置这个态，模型/provider 的任何动作都
 *                  不会覆盖它。
 * - `unresolvable` primary 和 fallback 都服务不了，调用会失败。
 * - `degraded`     primary 不行、fallback 顶着，**调用仍然成功**。这个态以前根本
 *                  没有表示，也是最值得报警的一个。
 * - `serving`      primary 可服务。
 */
export type EndpointResolutionState =
  | "disabled"
  | "unresolvable"
  | "degraded"
  | "serving";

/** `provider_inactive` 单独成一档有意义：停用 provider 以前对流量毫无影响，
 *  运营可以把一家供应商「关掉」、看着页面变灰、然后继续付钱给它。 */
export type ModelAvailability =
  | "available"
  | "model_inactive"
  | "provider_inactive"
  | "missing";

export interface EndpointModelRef {
  modelCode: string;
  availability: ModelAvailability;
}

export interface ModelEndpointRecord {
  id: string;
  code: string;
  category: string;
  primaryModelCode: string;
  fallbackModelCode: string | null;
  /** 运营的**意图**。父级动作永不写子级：停用一个模型不会停用指着它的 endpoint。 */
  /** product_251 B-3 的两值词表：`active` / `inactive`。 */
  state: ObjectState;
  /** 意图的**后果**，读时推导。与 `state` 不一致时，就是上游出事了。 */
  resolution: EndpointResolutionState;
  /** primary 在前、fallback 在后，各自带「为什么能／不能服务」。 */
  models: EndpointModelRef[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 产品对某个能力入口的持有（product × endpoint × 应用范围）。
 *
 * `productCode`/`endpointCode` 创建后不可变：改指向 = 一次撤销加一次新建，两个
 * 决定都留在变更流水里，而原地改只会留下终点、丢掉起点。
 *
 * 唯一性由 Atlas 侧唯一索引保证（`NULLS NOT DISTINCT`——产品级授权的
 * `applicationId` 是 NULL，默认 NULL 语义会允许存在两条）。运行时按**任意一条**
 * 命中的有效授权放行，所以少了这个约束，停用你正看着的那一条不会真的收回权限
 * ——一个看起来生效了的操作。
 */
export interface ProductGrantRecord {
  id: string;
  productCode: string;
  endpointCode: string;
  applicationId: string | null;
  applicationType: string | null;
  /** product_251 B-3 的两值词表：`active` / `inactive`。 */
  state: ObjectState;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 协议词表——管理 UI 协议下拉的唯一数据源，静态、不含任何租户数据。 */
export interface ProtocolCatalogEntry {
  protocol: string;
  description: string;
  knownUpstreams: string[];
  aliases: string[];
  wireDefaults: Record<string, unknown>;
}

export interface ProtocolCatalogResponse {
  wireSchemaVersion: number;
  protocols: ProtocolCatalogEntry[];
}

/** 模型自检：**会发起真实上游调用**（Atlas 侧上限 16 token，chat + stream 两路）。 */
export interface ModelProbeResult {
  requestId: string;
  modelId: string;
  modelCode: string;
  provider: string;
  protocol: string;
  /** null = 走了 provider_code 回退层，没有匹配到具名协议。 */
  resolvedProtocol: string | null;
  adapter: string;
  endpointUrl: string;
  keyResolved: boolean;
  wire: Record<string, unknown>;
  checks: {
    mode: "chat" | "stream";
    ok: boolean;
    latencyMs: number;
    /** 上游有没有回 usage——决定这个模型的调用会不会**静默漏计量**。 */
    usageReported: boolean;
    totalTokens: number | null;
    error?: { code: string; message: string };
  }[];
  ok: boolean;
}

/** Provider 粒度自检。provider 自己没有 wire，所以「这家通不通」永远是**借它名下
 *  某个模型**回答的——`probedModel` 说明借的是哪一个，好让失败可归因：是模型特有
 *  的问题（上游不认这个 modelCode），还是 provider 级的（密钥错、主机不可达）。 */
export interface ProviderProbeResult {
  providerId: string;
  providerCode: string;
  probedModel: { id: string; modelCode: string };
  probe: ModelProbeResult;
  ok: boolean;
}

export interface GatewayApiKeyRecord {
  id: string;
  name: string;
  /**
   * **`internal` 已退役**（owner 2026-08-14；Atlas 侧 incr/08），签发路径上只剩
   * `external`。兄弟产品（karda / arda / varda / runos）每一个都持有 OIDC 客户端，
   * 用 300 秒 S2S 令牌调 `/v1/*`，令牌上的 `act.sub` 就是产品授权表认的那个身份
   * ——再发一把长期有效、两边各存一份的共享密钥不会多出任何能力，只会把更强的
   * 机制换成更弱的。留着这个档位等于邀请后来人去实现那个降级。
   *
   * 联合类型里保留 `internal` 只为**如实读出历史行**：那批老 key 被置为 revoked
   * 而不是删除（吊销是失效凭证的终态，删掉会连轮换历史与审计留痕一起抹掉它被
   * 签发过这件事）。不要据此以为还能签一把。
   */
  kind: "internal" | "external";
  owner: string | null;
  keyPrefix: string;
  /**
   * 运营**设成**什么。2026-08-23 起对齐 Atlas 现行形状：字段由 `status` 改名
   * `state`，中间那档由 `disabled` 改叫 `inactive`（product_251 M-B3 最小词表）。
   * 库里那一列仍是 `disabled`，Atlas 在记录边界上换算、不迁数据。
   */
  state: "active" | "inactive" | "revoked";
  /**
   * 现在**实际**是什么：把到期折进去之后的态，比 `state` 多一档 `expired`。
   *
   * **读时推导，从不入库**——定时任务翻旧行等于为了让排程成立而改写历史，而且在到期
   * 发生到任务跑到之间，存着的那个值是假的（价格规则与策略的到期同一套判断）。优先级
   * 终态优先：revoked 无论到期与否都是 revoked；inactive 读作 inactive 而不是 expired，
   * 因为那是运营选的、可以撤回的态。
   *
   * 门户读这个，不要自己拿 `expiresAt` 和当前时间再算一遍。
   */
  effectiveState: "active" | "expired" | "inactive" | "revoked";
  /** null = 不限期，跑到被撤销为止。create 与 rotate 都可以带这个入参。 */
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** create/rotate 响应——secret 只在这一次出现，之后永不可再取回。 */
export interface GatewayApiKeyWithSecret extends GatewayApiKeyRecord {
  secret: string;
}

/** 2026-08-12 liaison #251：这个端点以前是永远返回 [] 的死桩，字段形状是没有
 * 真实响应可核对的猜测。Atlas v0.3.1（vxture-atlas#151）改成从自己的请求日志
 * 按 (tenantId, cycleMonth, applicationId, applicationType) 聚合，真形状如下
 * ——没有 id/featureId/agentId/statType/totalCostAmount/currency，不是加字段
 * 是整个换了一遍，旧类型不能兼容升级。 */
/** `/capability/logs` 的行形状（Atlas 唯一带分页的 /capability/* 端点）。 */
export interface AtlasRequestLogRecord {
  id: string;
  requestId: string;
  /**
   * **跨产品关联键**（product_251 X-2）。同一个 taskId 在 runos 的
   * `audit.capability_call` 里也在——一次 agent 任务在模型面烧了什么、在能力面调了
   * 什么，只有这一个字段能把两条流对起来。X-2 特意把它加到**读形状**上而不只是过滤
   * 器：一个能筛却读不回来的维度，等于拿到行之后无法分组。
   */
  taskId: string | null;
  status: string;
  tenantId: string | null;
  workspaceId: string | null;
  applicationId: string | null;
  applicationType: string | null;
  agentId: string | null;
  modelCode: string | null;
  providerCode: string | null;
  /** S2S 令牌上的 `act.sub`，不是调用方自称的——与 usage-summaries 的 product 轴同源。 */
  productCode: string | null;
  endpointCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  usageType: string | null;
  costUnit: string | null;
  createdAt: string;
  error: Record<string, unknown> | null;
}

export interface AtlasRequestLogPage {
  items: AtlasRequestLogRecord[];
  /** 不透明游标；null 表示没有下一页。 */
  nextCursor: string | null;
}

/** `/capability/logs/summary` —— 窗口聚合，`items` 按 model/provider/endpoint 分组。 */
export interface AtlasLogSummaryBucket {
  requests: number;
  errors: number;
  errorRate: number | null;
  totalTokens: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

/**
 * product_251 A-4 之后，窗口回显叫 `from`/`to`、集合叫 `items`——与 runos 的
 * `/audit/usage-summaries` 同一套词。它们此前是 `windowStart`/`windowEnd`/`byGroup`：
 * 同一个概念在两个上游有两套词，运营者读到的两份聚合含义相同、长相毫无关系。
 */
export interface AtlasLogSummary {
  from: string;
  to: string;
  /** 注意：`overall.totalTokens` 恒为 0——它来自另一份不带 token 求和的聚合，
   *  靠把各组加起来倒推等于给同一个数造第二个权威来源。别在页面上把它当真值渲染。 */
  overall: AtlasLogSummaryBucket;
  /** `endpointCode: null` 是**真实的一组**，不是缺口：调用方直接点名
   *  modelCode/taskProfile（一种正当的路由方式）、以及 incr/03 之前的老行，都落在
   *  这一组。Atlas 如实上报而不是丢弃，好让各组仍能加总回 `overall`——页面把它藏
   *  起来就等于少报。 */
  items: (AtlasLogSummaryBucket & {
    modelCode: string | null;
    providerCode: string | null;
    endpointCode: string | null;
  })[];
}

/** 用量汇总聚合轴。 */
export type UsageRollupDimension =
  | "tenant"
  | "provider"
  | "model"
  | "endpoint"
  | "product";

/**
 * 用量汇总一行。`dimension` 说明这一行是按哪根轴聚出来的，**不属于该轴的身份字段
 * 一律为 null**——provider 行没有租户，因为它是跨所有租户求和的。
 *
 * 计费主体是 **(tenantId, workspaceId) 这一对**：tenant:workspace 是 1:N，只按
 * tenant 分组会盖掉是哪个工作区烧的，只按 workspace 分组会丢掉该找谁收钱。
 */
export interface TenantUsageSummaryRecord {
  dimension: UsageRollupDimension;
  cycleMonth: string;
  tenantId: string | null;
  workspaceId: string | null;
  applicationId: string | null;
  applicationType: string | null;
  providerCode: string | null;
  modelCode: string | null;
  endpointCode: string | null;
  productCode: string | null;
  requests: string;
  inputTokens: string;
  outputTokens: string;
  totalTokens: string;
  errors: string;
}

/**
 * Atlas 自己那份变更流水的一行（`audit.change_records`）。
 *
 * 三条性质各自承重：**数据库层面 append-only**（`atlas_svc` 只有 INSERT/SELECT，
 * 连 DELETE 都没有）；**从路由推导**而不是每个 handler 各自调一次（漏标一条会
 * 静默失败，而按路由推导的话，新写路由从存在的那一刻起就被审计到）；
 * **只记字段名、不记值**（这里的请求体带 provider 密钥和网关密钥明文，审计表变成
 * 密钥库的第二份未加密副本，比它要堵的缺口更糟）。
 *
 * 被拒绝的尝试也记，`outcome: "failure"`——包括守卫在任何 handler 跑之前就挡掉的
 * （那种 `actorId` 是 `"unknown"`）：一次没有可归属操作者的写尝试，正是审计
 * 要找的东西。读操作从不记录。
 *
 * 字段名走 product_251 X-3 词表（atlas#215 已部署）：`id`→`eventId`、
 * `resourceType`→`objectType`、`resourceId`→`objectId`、`operatorSub`→`actorId`、
 * `actorClientId`→`actorConsole`。**旧名一个都不再出现**——`atlas-compat.ts` 的
 * `normalizeAtlasAuditRow` 已随之删除，所以这里读旧名会读到 undefined，而不是被
 * 兼容层接住。变更审计页（`AtlasChangeTable.tsx`）读的一直是新名，本接口此前是**只有
 * 类型没跟上**：`request<T>()` 只做断言不做校验，所以没有任何东西会报出这种漂移。
 */
export interface AtlasChangeRecord {
  eventId: string;
  objectType: string;
  objectId: string | null;
  action: string;
  /** M-1 的 operator `sub`；守卫先挡掉的尝试记为 "unknown"。 */
  actorId: string;
  /** 来源模块（`act.sub`，即 workforce RP）。 */
  actorConsole: string | null;
  /** 一次写**碰过哪些字段的名字**——不带值。 */
  changedFields: string[];
  requestId: string | null;
  outcome: string;
  occurredAt: string;
}

export interface AtlasChangeRecordPage {
  items: AtlasChangeRecord[];
  nextCursor: string | null;
}

@Controller("api/atlas")
export class AtlasRouter {
  private readonly atlasApiUrl: string;

  constructor(
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(OperatorExchangeService)
    private readonly operatorExchange: OperatorExchangeService,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {
    this.atlasApiUrl = configService.platform.ATLAS_API_URL.trim().replace(
      /\/+$/,
      "",
    );
  }

  /**
   * 代理一次写操作并留痕（`product_250` M-5 第二条）。上游成功后才写审计——
   * 失败的尝试不留 success 记录；审计本身失败不影响接口结果（远端已生效，
   * 报错会诱导重试 = 把一次变更做成两次），但会落 error 日志。
   */
  private async writeThrough<T>(
    req: Request & RequestContext,
    path: string,
    options: { method?: HttpMethod; body?: JsonObject },
    /**
     * 由调用点构造完整审计条目——**刻意不默认把整个响应塞进 `after`**：
     * provider-keys / api-keys 的 create 与 rotate 响应里带**明文 secret**，
     * 自动落 `after` 等于把密钥写进审计表。安全默认是"不记"，要记什么由
     * 知道响应形状的人显式指定。
     */
    audit: (result: T) => OperatorAuditEntry,
  ): Promise<T> {
    const result = await this.request<T>(req, path, options);
    await recordProxyWrite(this.rwPool, req, audit(result));
    return result;
  }

  /**
   * @param contract 只在**列表读**上给：带上它就在出口校验必有字段，缺了直接抛
   *   `ATLAS_CONTRACT_FIELD_MISSING` 并点名。理由与"为什么不挂写响应"见
   *   `atlas-contract.ts`。
   */
  private async request<T>(
    req: Request & RequestContext,
    path: string,
    options?: {
      method?: HttpMethod;
      body?: JsonObject;
      contract?: AtlasResource;
    },
  ): Promise<T> {
    const bearer = req.operatorAccessToken
      ? await this.operatorExchange.getToken(
          req.operatorAccessToken,
          ATLAS_AUDIENCE,
        )
      : null;
    const payload = await atlasRequest<T>(
      path,
      { ...options, ...(bearer ? { bearer } : {}) },
      this.atlasApiUrl,
    );
    /* `atlas-compat.ts` 的 `isActive` 归一层已于 2026-08-23 删除：门户全量迁到
       `state`，垫片自带的删除条件（"页面完成语义迁移后才能删"）已满足。取代它的是
       下面这道**入口断言**——上一版是"上游少给就自己补一个"，这一版是"上游少给就
       点名报错"。两者的差别就是一个坏掉的契约会不会被人看见。 */
    return options?.contract
      ? assertAtlasContract(payload, options.contract)
      : payload;
  }

  // ── Protocols（静态词表，管理 UI 协议下拉的唯一数据源）──────────────────────

  /** 协议 → 适配器分发键 + 该协议的 `config.wire` 默认值。手写一份候选列表意味着
   *  操作者能选到 Atlas 根本不认的值，而这件事要到第一次真实调用才暴露。 */
  @Get("protocols")
  listProtocols(
    @Req() req: Request & RequestContext,
  ): Promise<ProtocolCatalogResponse> {
    assertCanManageModels(req);
    return this.request<ProtocolCatalogResponse>(req, "/capability/protocols", {
      contract: "protocols",
    });
  }

  // ── Providers ────────────────────────────────────────────────────────────

  @Get("providers")
  listProviders(
    @Req() req: Request & RequestContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ModelProviderRecord[]> {
    assertCanManageProviders(req);
    return this.request<ModelProviderRecord[]>(
      req,
      `/capability/providers?includeInactive=${includeInactive === "false" ? "false" : "true"}`,
      { contract: "providers" },
    );
  }

  @Post("providers")
  createProvider(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelProviderRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ModelProviderRecord>(
      req,
      "/capability/providers",
      { method: "POST", body },
      (r) => ({
        action: "atlas.provider.create",
        resourceType: "atlas_provider",
        resourceId: r.id,
        after: r,
      }),
    );
  }

  @Patch("providers/:providerId")
  updateProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
    @Body() body: JsonObject,
  ): Promise<ModelProviderRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ModelProviderRecord>(
      req,
      `/capability/providers/${encodeURIComponent(providerId)}`,
      { method: "PATCH", body },
      (r) => ({
        action: "atlas.provider.update",
        resourceType: "atlas_provider",
        resourceId: providerId,
        after: r,
      }),
    );
  }

  @Post("providers/:providerId/activate")
  activateProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ModelProviderRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ModelProviderRecord>(
      req,
      `/capability/providers/${encodeURIComponent(providerId)}/activate`,
      { method: "POST" },
      () => ({
        action: "atlas.provider.activate",
        resourceType: "atlas_provider",
        resourceId: providerId,
      }),
    );
  }

  @Post("providers/:providerId/deactivate")
  deactivateProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ModelProviderRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ModelProviderRecord>(
      req,
      `/capability/providers/${encodeURIComponent(providerId)}/deactivate`,
      { method: "POST" },
      () => ({
        action: "atlas.provider.deactivate",
        resourceType: "atlas_provider",
        resourceId: providerId,
      }),
    );
  }

  @Delete("providers/:providerId")
  deleteProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ModelProviderRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ModelProviderRecord>(
      req,
      `/capability/providers/${encodeURIComponent(providerId)}`,
      { method: "DELETE" },
      () => ({
        action: "atlas.provider.delete",
        resourceType: "atlas_provider",
        resourceId: providerId,
      }),
    );
  }

  /**
   * Provider 连通性自检。**会发起真实上游调用并消耗 token**。
   *
   * Atlas 借该 provider 下 `modelCode` 最小的那个启用模型跑一次模型自检，并在
   * `probedModel` 里说明借的是哪一个。它存在的理由是列表上那个 `health` 是**流量
   * 派生**的：没跑过流量的 provider 会永远显示 unknown，于是新接入的一家在真正
   * 给它压流量之前无法验证。
   *
   * 只按需触发，没有周期性主动探测——那会把流量派生设计要避开的上游成本又请回来。
   * 409 MODEL_ADMIN_PROVIDER_NOT_PROBEABLE = provider 在，但名下没有启用模型
   * （所以不是 404；而拿一个已停用的模型去探、再报告这家健康，比不给结论更糟）。
   * 与模型自检共用同一个 10s 冷却，所以这条路径绕不开冷却。
   */
  @Post("providers/:providerId/probe")
  probeProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ProviderProbeResult> {
    assertCanManageProviders(req);
    /* 自检花真钱，所以照样留痕——"谁在什么时候烧了这笔 token"是运营要能回答的
       问题，不能因为它不改配置就不记。 */
    return this.writeThrough<ProviderProbeResult>(
      req,
      `/capability/providers/${encodeURIComponent(providerId)}/probe`,
      { method: "POST" },
      (r) => ({
        action: "atlas.provider.probe",
        resourceType: "atlas_provider",
        resourceId: providerId,
        after: { ok: r.ok, probedModel: r.probedModel },
      }),
    );
  }

  @Get("providers/performance")
  getProvidersPerformance(
    @Req() req: Request & RequestContext,
  ): Promise<ProviderPerformanceSnapshot> {
    assertCanManageProviders(req);
    return this.request<ProviderPerformanceSnapshot>(
      req,
      "/capability/providers/performance",
      { contract: "providers-performance" },
    );
  }

  // ── Provider keys（vault；四个写路由挂 opera 侧 @RequireStepUp()——
  //    Atlas 已撤除自己那道守卫，见文件头）─────────────────────────────────

  @Get("provider-keys")
  listProviderKeys(
    @Req() req: Request & RequestContext,
    @Query("providerCode") providerCode?: string,
  ): Promise<ProviderKeyRecord[]> {
    assertCanManageProviders(req);
    return this.request<ProviderKeyRecord[]>(
      req,
      `/capability/provider-keys${providerCode ? `?providerCode=${encodeURIComponent(providerCode)}` : ""}`,
      { contract: "provider-keys" },
    );
  }

  /* 以下四个密钥写路由**一律不落 `after`**：provider-key 的响应虽然当前不含
     密钥材料，但这类资源的响应形状随时可能加字段，默认不记比逐字段审查更稳。
     审计要回答的是"谁在什么时候动了哪把钥匙"，不是"钥匙长什么样"。 */

  @RequireStepUp()
  @Post("provider-keys")
  createProviderKey(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ProviderKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ProviderKeyRecord>(
      req,
      "/capability/provider-keys",
      { method: "POST", body },
      (r) => ({
        action: "atlas.provider_key.create",
        resourceType: "atlas_provider_key",
        resourceId: r.id,
      }),
    );
  }

  @RequireStepUp()
  @Post("provider-keys/:providerKeyId/rotate")
  rotateProviderKey(
    @Req() req: Request & RequestContext,
    @Param("providerKeyId") providerKeyId: string,
    @Body() body: JsonObject,
  ): Promise<ProviderKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ProviderKeyRecord>(
      req,
      `/capability/provider-keys/${encodeURIComponent(providerKeyId)}/rotate`,
      { method: "POST", body },
      () => ({
        action: "atlas.provider_key.rotate",
        resourceType: "atlas_provider_key",
        resourceId: providerKeyId,
      }),
    );
  }

  @RequireStepUp()
  @Post("provider-keys/:providerKeyId/activate")
  activateProviderKey(
    @Req() req: Request & RequestContext,
    @Param("providerKeyId") providerKeyId: string,
  ): Promise<ProviderKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ProviderKeyRecord>(
      req,
      `/capability/provider-keys/${encodeURIComponent(providerKeyId)}/activate`,
      { method: "POST" },
      () => ({
        action: "atlas.provider_key.activate",
        resourceType: "atlas_provider_key",
        resourceId: providerKeyId,
      }),
    );
  }

  @RequireStepUp()
  @Post("provider-keys/:providerKeyId/deactivate")
  deactivateProviderKey(
    @Req() req: Request & RequestContext,
    @Param("providerKeyId") providerKeyId: string,
  ): Promise<ProviderKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<ProviderKeyRecord>(
      req,
      `/capability/provider-keys/${encodeURIComponent(providerKeyId)}/deactivate`,
      { method: "POST" },
      () => ({
        action: "atlas.provider_key.deactivate",
        resourceType: "atlas_provider_key",
        resourceId: providerKeyId,
      }),
    );
  }

  // ── Endpoints（稳定能力入口 → primary/fallback modelCode 间接层；
  //    没有独立 Router 资源——failover 语义就是 fallbackModelCode 有没有值）───────

  @Get("endpoints")
  listEndpoints(
    @Req() req: Request & RequestContext,
    @Query("includeInactive") includeInactive?: string,
    /** 「哪些入口在引用这个模型」——挡住模型删除的 endpointRefCount 要能点开，
     *  一个点不进去的数字是没人能据以行动的数字。primary 与 fallback 都算。 */
    @Query("modelCode") modelCode?: string,
  ): Promise<ModelEndpointRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams({
      includeInactive: includeInactive === "false" ? "false" : "true",
    });
    if (modelCode) params.set("modelCode", modelCode);
    return this.request<ModelEndpointRecord[]>(
      req,
      `/capability/model-routes?${params.toString()}`,
      { contract: "model-routes" },
    );
  }

  @Post("endpoints")
  createEndpoint(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelEndpointRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ModelEndpointRecord>(
      req,
      "/capability/model-routes",
      { method: "POST", body },
      (r) => ({
        action: "atlas.endpoint.create",
        resourceType: "atlas_endpoint",
        resourceId: r.id,
        after: r,
      }),
    );
  }

  @Patch("endpoints/:endpointId")
  updateEndpoint(
    @Req() req: Request & RequestContext,
    @Param("endpointId") endpointId: string,
    @Body() body: JsonObject,
  ): Promise<ModelEndpointRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ModelEndpointRecord>(
      req,
      `/capability/model-routes/${encodeURIComponent(endpointId)}`,
      { method: "PATCH", body },
      (r) => ({
        action: "atlas.endpoint.update",
        resourceType: "atlas_endpoint",
        resourceId: endpointId,
        after: r,
      }),
    );
  }

  @Post("endpoints/:endpointId/activate")
  activateEndpoint(
    @Req() req: Request & RequestContext,
    @Param("endpointId") endpointId: string,
  ): Promise<ModelEndpointRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ModelEndpointRecord>(
      req,
      `/capability/model-routes/${encodeURIComponent(endpointId)}/activate`,
      { method: "POST" },
      () => ({
        action: "atlas.endpoint.activate",
        resourceType: "atlas_endpoint",
        resourceId: endpointId,
      }),
    );
  }

  @Post("endpoints/:endpointId/deactivate")
  deactivateEndpoint(
    @Req() req: Request & RequestContext,
    @Param("endpointId") endpointId: string,
  ): Promise<ModelEndpointRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ModelEndpointRecord>(
      req,
      `/capability/model-routes/${encodeURIComponent(endpointId)}/deactivate`,
      { method: "POST" },
      () => ({
        action: "atlas.endpoint.deactivate",
        resourceType: "atlas_endpoint",
        resourceId: endpointId,
      }),
    );
  }

  @Delete("endpoints/:endpointId")
  deleteEndpoint(
    @Req() req: Request & RequestContext,
    @Param("endpointId") endpointId: string,
  ): Promise<ModelEndpointRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ModelEndpointRecord>(
      req,
      `/capability/model-routes/${encodeURIComponent(endpointId)}`,
      { method: "DELETE" },
      () => ({
        action: "atlas.endpoint.delete",
        resourceType: "atlas_endpoint",
        resourceId: endpointId,
      }),
    );
  }

  // ── Gateway API keys（入方向调用者凭证，和 provider-keys 反方向；五个写路由
  //    挂 opera 侧 @RequireStepUp()——见文件头）───────────────────────────────

  @Get("api-keys")
  listApiKeys(
    @Req() req: Request & RequestContext,
  ): Promise<GatewayApiKeyRecord[]> {
    assertCanManageProviders(req);
    return this.request<GatewayApiKeyRecord[]>(req, "/capability/api-keys", {
      contract: "api-keys",
    });
  }

  /* create 与 rotate 的响应带**明文 secret**（只此一次）——审计**绝不**落
     `after`。只记 id 与脱敏前缀；把 secret 写进 support.audit_logs 等于给
     密钥开了第二个持久化副本，而审计表的读权限比密钥库宽得多。 */

  @RequireStepUp()
  @Post("api-keys")
  createApiKey(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<GatewayApiKeyWithSecret> {
    assertCanManageProviders(req);
    return this.writeThrough<GatewayApiKeyWithSecret>(
      req,
      "/capability/api-keys",
      { method: "POST", body },
      (r) => ({
        action: "atlas.gateway_api_key.create",
        resourceType: "atlas_gateway_api_key",
        resourceId: r.id,
        after: { name: r.name, kind: r.kind, keyPrefix: r.keyPrefix },
      }),
    );
  }

  @RequireStepUp()
  @Post("api-keys/:apiKeyId/rotate")
  rotateApiKey(
    @Req() req: Request & RequestContext,
    @Param("apiKeyId") apiKeyId: string,
  ): Promise<GatewayApiKeyWithSecret> {
    assertCanManageProviders(req);
    return this.writeThrough<GatewayApiKeyWithSecret>(
      req,
      `/capability/api-keys/${encodeURIComponent(apiKeyId)}/rotate`,
      { method: "POST" },
      (r) => ({
        action: "atlas.gateway_api_key.rotate",
        resourceType: "atlas_gateway_api_key",
        resourceId: apiKeyId,
        after: { keyPrefix: r.keyPrefix },
      }),
    );
  }

  @RequireStepUp()
  @Post("api-keys/:apiKeyId/activate")
  activateApiKey(
    @Req() req: Request & RequestContext,
    @Param("apiKeyId") apiKeyId: string,
  ): Promise<GatewayApiKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<GatewayApiKeyRecord>(
      req,
      `/capability/api-keys/${encodeURIComponent(apiKeyId)}/activate`,
      { method: "POST" },
      () => ({
        action: "atlas.gateway_api_key.activate",
        resourceType: "atlas_gateway_api_key",
        resourceId: apiKeyId,
      }),
    );
  }

  @RequireStepUp()
  @Post("api-keys/:apiKeyId/deactivate")
  deactivateApiKey(
    @Req() req: Request & RequestContext,
    @Param("apiKeyId") apiKeyId: string,
  ): Promise<GatewayApiKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<GatewayApiKeyRecord>(
      req,
      `/capability/api-keys/${encodeURIComponent(apiKeyId)}/deactivate`,
      { method: "POST" },
      () => ({
        action: "atlas.gateway_api_key.deactivate",
        resourceType: "atlas_gateway_api_key",
        resourceId: apiKeyId,
      }),
    );
  }

  @RequireStepUp()
  @Post("api-keys/:apiKeyId/revoke")
  revokeApiKey(
    @Req() req: Request & RequestContext,
    @Param("apiKeyId") apiKeyId: string,
  ): Promise<GatewayApiKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<GatewayApiKeyRecord>(
      req,
      `/capability/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
      { method: "POST" },
      () => ({
        action: "atlas.gateway_api_key.revoke",
        resourceType: "atlas_gateway_api_key",
        resourceId: apiKeyId,
      }),
    );
  }

  /**
   * 删除一把网关 key（owner 2026-08-14 决定要有）。
   *
   * **Atlas 已交付**（2026-08-23 核对 `gateway-api-key.controller.ts`），且是**软删除**
   * 并带前置条件：key 必须先停用或撤销——「任何东西都不会从正在服务一步变成没了」，
   * 与本平面其它资源同一条规则。门户侧比这更严，只允许删已撤销的（见 model/keys 页）。
   * 门户那边的 404 兜底文案保留：它是给**还没升到这一版的部署**看的，不是死代码。
   *
   * 与 provider-keys 的删除不是一回事，别照抄：provider key 挂着
   * `key_rotation_logs`（FK ON DELETE CASCADE），删一把连轮换史一起没；网关 key
   * **没有**这张附表，它的历史只在 `audit.change_records` 里，而那张表与 key 行
   * 没有外键关系、也不许 DELETE，所以删行不会动到留痕。
   *
   * 仍然挂 @RequireStepUp()：它比撤销更彻底，没有理由比撤销更容易做到。
   */
  @RequireStepUp()
  @Delete("api-keys/:apiKeyId")
  deleteApiKey(
    @Req() req: Request & RequestContext,
    @Param("apiKeyId") apiKeyId: string,
  ): Promise<GatewayApiKeyRecord> {
    assertCanManageProviders(req);
    return this.writeThrough<GatewayApiKeyRecord>(
      req,
      `/capability/api-keys/${encodeURIComponent(apiKeyId)}`,
      { method: "DELETE" },
      () => ({
        action: "atlas.gateway_api_key.delete",
        resourceType: "atlas_gateway_api_key",
        resourceId: apiKeyId,
      }),
    );
  }

  // ── Models ───────────────────────────────────────────────────────────────

  @Get("models")
  listModels(
    @Req() req: Request & RequestContext,
    @Query("includeInactive") includeInactive?: string,
    /** provider 行上的 `modelCount` 点进来就落在这个过滤上。 */
    @Query("providerId") providerId?: string,
  ): Promise<AiModelRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams({
      includeInactive: includeInactive === "false" ? "false" : "true",
    });
    if (providerId) params.set("providerId", providerId);
    return this.request<AiModelRecord[]>(
      req,
      `/capability/models?${params.toString()}`,
      { contract: "models" },
    );
  }

  @Post("models")
  createModel(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      "/capability/models",
      { method: "POST", body },
      (r) => ({
        action: "atlas.model.create",
        resourceType: "atlas_model",
        resourceId: r.id,
        /* keyReference 只含 {source,name,configured}，无密钥材料，可落。 */
        after: r,
      }),
    );
  }

  @Patch("models/:modelId")
  updateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
    @Body() body: JsonObject,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}`,
      { method: "PATCH", body },
      (r) => ({
        action: "atlas.model.update",
        resourceType: "atlas_model",
        resourceId: modelId,
        after: r,
      }),
    );
  }

  @Post("models/:modelId/activate")
  activateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}/activate`,
      { method: "POST" },
      () => ({
        action: "atlas.model.activate",
        resourceType: "atlas_model",
        resourceId: modelId,
      }),
    );
  }

  @Post("models/:modelId/deactivate")
  deactivateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}/deactivate`,
      { method: "POST" },
      () => ({
        action: "atlas.model.deactivate",
        resourceType: "atlas_model",
        resourceId: modelId,
      }),
    );
  }

  /**
   * 弃用 = 「别再往上建了，它还能用」——`inactive` 说不出这句话。
   *
   * 这对路由 atlas 早有（#219），但**管理面此前读不出结果**：`state` 报两值，运营者
   * POST 完看到的那一行与一个普通 active 模型一模一样（我方 2026-08-17 报出，
   * atlas#236 已修）。在他们修好之前接这个入口没有意义——**能做但看不出做过，
   * 比做不了更糟**。现在数据有了。
   */
  @Post("models/:modelId/deprecate")
  deprecateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}/deprecate`,
      { method: "POST" },
      (r) => ({
        action: "atlas.model.deprecate",
        resourceType: "atlas_model",
        resourceId: modelId,
        after: { state: r.state, deprecatedAt: r.deprecatedAt },
      }),
    );
  }

  /** 可逆：弃用可能是误判，收回这句话应该是便宜的。 */
  @Post("models/:modelId/undeprecate")
  undeprecateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}/undeprecate`,
      { method: "POST" },
      (r) => ({
        action: "atlas.model.undeprecate",
        resourceType: "atlas_model",
        resourceId: modelId,
        after: { state: r.state, deprecatedAt: r.deprecatedAt },
      }),
    );
  }

  @Delete("models/:modelId")
  deleteModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.writeThrough<AiModelRecord>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}`,
      { method: "DELETE" },
      () => ({
        action: "atlas.model.delete",
        resourceType: "atlas_model",
        resourceId: modelId,
      }),
    );
  }

  /** 模型自检：**会发起真实上游调用并消耗 token**（Atlas 侧上限 16），用量归
   *  平台哨兵、不扣任何租户配额；同一模型两次自检间隔 <10s 会被 Atlas 拒
   *  （429 MODEL_ADMIN_PROBE_COOLDOWN）。2026-08-13 补接——设计稿 §4 要求的
   *  「主动检测」在 provider 粒度没有（Atlas 的 health 是流量派生），但在模型
   *  粒度 Atlas 一直提供着这个能力，opera 此前 0 处引用。 */
  @Post("models/:modelId/probe")
  probeModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<ModelProbeResult> {
    assertCanManageModels(req);
    /* 自检也留痕：它花真钱（真实上游调用），"谁在什么时候烧了这笔 token"
       是运营要能回答的问题，不能因为它不改配置就不记。 */
    return this.writeThrough<ModelProbeResult>(
      req,
      `/capability/models/${encodeURIComponent(modelId)}/probe`,
      { method: "POST" },
      (r) => ({
        action: "atlas.model.probe",
        resourceType: "atlas_model",
        resourceId: modelId,
        after: { ok: r.ok, checks: r.checks },
      }),
    );
  }

  // ── Product grants（产品维授权轴：产品持有的是**能力入口**，不是模型）──────
  //
  //    卖出去的是产品服务，不是模型服务：客户买 karda，karda 需要哪些能力是产品
  //    工程问题，不是逐客户的商业问题。所以这张表归 opera（技术面），而按租户逐
  //    模型发放的旧 `grants` 留在 admin——两者都叫 grant，不是同一个东西。
  //
  //    授权命名的是**入口**而不是模型：改 endpoint 指向对调用方应当是无感的，
  //    模型维授权会恰好在最不能破的那一层破坏这个抽象，还会让 endpoint 的
  //    fallback 需要自己再要一次授权才能顶上。直接点名 modelCode 的调用按**推导
  //    集合**鉴权——该产品持有的入口能触达的（primary 与 fallback）模型。
  //
  //    能力码复用 model:model.manage：与 endpoints 同一批人管（授权的是入口），
  //    admin.operator_permission 里也没有更细的码，不在这里新造一个零持有者的死码。

  @Get("product-grants")
  listProductGrants(
    @Req() req: Request & RequestContext,
    @Query("productCode") productCode?: string,
    @Query("endpointCode") endpointCode?: string,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ProductGrantRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams({
      includeInactive: includeInactive === "false" ? "false" : "true",
    });
    if (productCode) params.set("productCode", productCode);
    if (endpointCode) params.set("endpointCode", endpointCode);
    return this.request<ProductGrantRecord[]>(
      req,
      `/capability/product-endpoint-grants?${params.toString()}`,
      { contract: "product-endpoint-grants" },
    );
  }

  @Post("product-grants")
  createProductGrant(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ProductGrantRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ProductGrantRecord>(
      req,
      "/capability/product-endpoint-grants",
      { method: "POST", body },
      (r) => ({
        action: "atlas.product_grant.create",
        resourceType: "atlas_product_grant",
        resourceId: r.id,
        after: r,
      }),
    );
  }

  /** `productCode`/`endpointCode` 不可变——改指向 = 撤销 + 新建，两个决定都要留在
   *  流水里。这里能改的只有应用范围、理由、到期与启停。 */
  @Patch("product-grants/:productGrantId")
  updateProductGrant(
    @Req() req: Request & RequestContext,
    @Param("productGrantId") productGrantId: string,
    @Body() body: JsonObject,
  ): Promise<ProductGrantRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ProductGrantRecord>(
      req,
      `/capability/product-endpoint-grants/${encodeURIComponent(productGrantId)}`,
      { method: "PATCH", body },
      (r) => ({
        action: "atlas.product_grant.update",
        resourceType: "atlas_product_grant",
        resourceId: productGrantId,
        after: r,
      }),
    );
  }

  @Post("product-grants/:productGrantId/activate")
  activateProductGrant(
    @Req() req: Request & RequestContext,
    @Param("productGrantId") productGrantId: string,
  ): Promise<ProductGrantRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ProductGrantRecord>(
      req,
      `/capability/product-endpoint-grants/${encodeURIComponent(productGrantId)}/activate`,
      { method: "POST" },
      () => ({
        action: "atlas.product_grant.activate",
        resourceType: "atlas_product_grant",
        resourceId: productGrantId,
      }),
    );
  }

  @Post("product-grants/:productGrantId/deactivate")
  deactivateProductGrant(
    @Req() req: Request & RequestContext,
    @Param("productGrantId") productGrantId: string,
  ): Promise<ProductGrantRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ProductGrantRecord>(
      req,
      `/capability/product-endpoint-grants/${encodeURIComponent(productGrantId)}/deactivate`,
      { method: "POST" },
      () => ({
        action: "atlas.product_grant.deactivate",
        resourceType: "atlas_product_grant",
        resourceId: productGrantId,
      }),
    );
  }

  @Delete("product-grants/:productGrantId")
  deleteProductGrant(
    @Req() req: Request & RequestContext,
    @Param("productGrantId") productGrantId: string,
  ): Promise<ProductGrantRecord> {
    assertCanManageModels(req);
    return this.writeThrough<ProductGrantRecord>(
      req,
      `/capability/product-endpoint-grants/${encodeURIComponent(productGrantId)}`,
      { method: "DELETE" },
      () => ({
        action: "atlas.product_grant.delete",
        resourceType: "atlas_product_grant",
        resourceId: productGrantId,
      }),
    );
  }

  // ── Observability（只读；设计稿 §11 要的 Metrics + Logs。2026-08-12 补接——
  //    Atlas 早已交付这两个端点，opera 此前 0 处引用，是我们照"新交付了什么"做
  //    增量、从没拿设计稿逐条验收的漏，不是 Atlas 没给）────────────────────────

  @Get("logs")
  listLogs(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("modelCode") modelCode?: string,
    @Query("providerCode") providerCode?: string,
    @Query("endpointCode") endpointCode?: string,
    @Query("requestId") requestId?: string,
    /** 见 `AtlasRequestLogRecord.taskId`——与 runos `/audit/calls?taskId=` 同一个键。 */
    @Query("taskId") taskId?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<AtlasRequestLogPage> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (modelCode) params.set("modelCode", modelCode);
    if (providerCode) params.set("providerCode", providerCode);
    if (endpointCode) params.set("endpointCode", endpointCode);
    if (requestId) params.set("requestId", requestId);
    if (taskId) params.set("taskId", taskId);
    /* status 只接受 success|error|timeout，非法值 Atlas 回 400 —— 原样透传，
       不在这里预先过滤成"看起来正常"的空结果。 */
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", limit);
    return this.request<AtlasRequestLogPage>(
      req,
      `/capability/logs${params.size ? `?${params.toString()}` : ""}`,
      { contract: "logs" },
    );
  }

  @Get("logs/summary")
  getLogSummary(
    @Req() req: Request & RequestContext,
    @Query("window") window?: string,
    @Query("modelCode") modelCode?: string,
    @Query("providerCode") providerCode?: string,
    @Query("endpointCode") endpointCode?: string,
  ): Promise<AtlasLogSummary> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    /* window: 1h|24h(默认)|7d。 */
    if (window) params.set("window", window);
    if (modelCode) params.set("modelCode", modelCode);
    if (providerCode) params.set("providerCode", providerCode);
    if (endpointCode) params.set("endpointCode", endpointCode);
    return this.request<AtlasLogSummary>(
      req,
      `/capability/logs/summary${params.size ? `?${params.toString()}` : ""}`,
      { contract: "logs-summary" },
    );
  }

  // ── Atlas 变更流水（只读；`audit.change_records`）────────────────────────────
  //
  //    与 opera-bff 自己的 `support.audit_logs` **不重复**：那份只记「经过 opera
  //    的写」，这份记 Atlas 收到的每一次 /capability/* 写——包括直连 Atlas 做的、
  //    以及被守卫在 handler 之前挡掉的失败尝试。只看自己那份等于只审计自己。
  //
  //    这里没有写路由，也不可能有：`atlas_svc` 在这张表上只有 INSERT 和 SELECT。
  //
  //    能力码复用 model:model.manage，并如实记下这是个**已知缺口**：提交给平台
  //    能力码词表的那套只覆盖配置类写操作，所以「可以读变更流水」目前没法与
  //    「可以轮换密钥」分开授予。不在这里自造一个平台侧不认的码来假装分开了。

  @Get("audit-logs")
  listAtlasAuditLogs(
    @Req() req: Request & RequestContext,
    @Query("objectType") objectType?: string,
    @Query("objectId") objectId?: string,
    @Query("actorId") actorId?: string,
    @Query("action") action?: string,
    @Query("outcome") outcome?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<AtlasChangeRecordPage> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    /* 参数名走 X-3 词表。Atlas 部署 #215 后**拒收**旧名（`operatorSub` 会被 400 并
       在 message 里点名），所以这里不能留旧名兜底——留着只会把一次筛选变成一次报错。 */
    if (objectType) params.set("objectType", objectType);
    if (objectId) params.set("objectId", objectId);
    if (actorId) params.set("actorId", actorId);
    if (action) params.set("action", action);
    if (outcome) params.set("outcome", outcome);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", limit);
    return this.request<AtlasChangeRecordPage>(
      req,
      `/capability/audit-logs${params.size ? `?${params.toString()}` : ""}`,
      { contract: "audit-logs" },
    );
  }

  // ── Usage summaries（只读，metering 页用；商业口径的账单归 admin 的
  //    usage-summaries 副本，这里只是同一份上游事实的技术视角只读镜像）──────────

  /**
   * `groupBy` 选聚合轴：`tenant`（默认）/ `provider` / `model` / `endpoint` /
   * `product`。默认轴按 **tenant × workspace ×** 月 × application 分组——计费主体
   * 是这一对，不是其中任何一个单独的（这也让默认轴的行数比从前多）。
   *
   * `product` 是聚合轴而非主体：它回答「跑一个产品要花多少」，读的是
   * `product_code`（S2S 令牌上的 `act.sub`，不是调用方自己声称的）。
   *
   * endpoint 轴**排除 NULL 而不是把它们兜成一桶**，因此两个后果要如实讲：它的
   * 总数不会等于 tenant/provider/model 轴的总数（它只覆盖走入口路由的那部分流量，
   * 而这就是诚实的数字），且 endpoint 历史只从 incr/03 上线那天开始——更早的请求
   * 是哪个入口服务的从来没被记过，没有回填，只有猜，而猜比明说有缺口更糟。
   */
  @Get("usage-summaries")
  listUsageSummaries(
    @Req() req: Request & RequestContext,
    @Query("groupBy") groupBy?: string,
    @Query("tenantId") tenantId?: string,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
    @Query("cycleMonth") cycleMonth?: string,
    @Query("providerCode") providerCode?: string,
    @Query("modelCode") modelCode?: string,
    @Query("productCode") productCode?: string,
  ): Promise<TenantUsageSummaryRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    /* 非法轴值 Atlas 回 400 并说明合法取值——原样透传，不在这里悄悄改写成默认轴：
       把一个写错的轴渲染成 tenant 数据，比报错更容易被当成真答案。 */
    if (groupBy) params.set("groupBy", groupBy);
    if (tenantId) params.set("tenantId", tenantId);
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);
    /* cycleMonth 现在校验 YYYY-MM，格式不对 Atlas 会 400 —— 见 liaison #251。 */
    if (cycleMonth) params.set("cycleMonth", cycleMonth);
    if (providerCode) params.set("providerCode", providerCode);
    if (modelCode) params.set("modelCode", modelCode);
    if (productCode) params.set("productCode", productCode);
    return this.request<TenantUsageSummaryRecord[]>(
      req,
      `/capability/usage-summaries${params.size ? `?${params.toString()}` : ""}`,
      { contract: "usage-summaries" },
    );
  }
}

function assertCanManageProviders(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities?.includes(PROVIDER_MANAGE_CAPABILITY)) {
    throw notEntitled(PROVIDER_MANAGE_CAPABILITY);
  }
}

function assertCanManageModels(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities?.includes(MODEL_MANAGE_CAPABILITY)) {
    throw notEntitled(MODEL_MANAGE_CAPABILITY);
  }
}

async function atlasRequest<TResponse>(
  path: string,
  options: {
    method?: HttpMethod;
    body?: JsonObject;
    bearer?: string;
  } = {},
  baseUrl: string = "http://localhost:3100",
): Promise<TResponse> {
  let response: Response;
  const headers: Record<string, string> = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
  };
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw upstreamUnavailable("ATLAS_UNAVAILABLE", "Atlas is unavailable");
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new HttpException(
      parseAtlasError(responseText, response.status),
      response.status,
    );
  }

  if (!responseText.trim()) {
    return undefined as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function parseAtlasError(responseText: string, status: number): AtlasErrorBody {
  if (!responseText.trim()) {
    return {
      code: "ATLAS_REQUEST_FAILED",
      message: `Atlas request failed with status ${status}`,
      statusCode: status,
    };
  }
  try {
    const parsed = JSON.parse(responseText) as AtlasErrorBody;
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return { ...parsed, statusCode: parsed.statusCode ?? status };
    }
    return {
      code: "ATLAS_REQUEST_FAILED",
      message: `Atlas request failed with status ${status}`,
      statusCode: status,
      details: parsed,
    };
  } catch {
    return {
      code: "ATLAS_REQUEST_FAILED",
      message: responseText,
      statusCode: status,
    };
  }
}
