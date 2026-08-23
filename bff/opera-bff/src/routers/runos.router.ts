/**
 * runos.router.ts — Runos 技术管理面代理（capability / endpoint 注册）。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * opera 是 Runos 的技术运维归属（同 atlas.router.ts 的先例，product_100 §3
 * L1 不变量：管理面统一按 product_250 交付）。模块 UI 归 opera 统一创建、而不是
 * 各产品各自建 admin-module，依据是 owner 2026-08-11 决定「联邦挂载为核心路线，
 * 挂载内容归 opera 统一创建」——该决定已补记进 `docs/30-design/
 * product_250_management-plane-contract.md` v0.2（头部修订记 + M-4 + §4 批次表
 * D/F 行）与 `10-shell-mount-contract.md` §2。2026-08-12 之前这条口径**只写在
 * 本文件注释里、docs/ 全目录 0 处**，等于自己引用自己授权自己；补记就是为了
 * 消除这个循环——改动这里的归属判断前先读那两份文档，不要只读本注释。
 *
 * 数据源单一权威 = Runos 的 `/capability/*` HTTP 面（RUNOS_API_URL，外部主机；
 * vxture-runos service/src/registry/registry.controller.ts 是权威契约，仓内
 * 不存副本）。认证 = operator-OBO（product_250 M-1），机制与 atlas.router.ts
 * 完全同构：把 operator 会话 access token 换成 aud=runos 的短时管理令牌
 * （scope=mgmt:runos）再转发。
 *
 * 能力码：`capability:runos.read` / `capability:runos.manage`（2026-08-11
 * 随本次接入一并注册进 admin.operator_permission，super_admin/tech_ops 持
 * manage，operation/auditor 持 read——deploy/database/seed/seed-catalog.mjs）。
 *
 * 范围只覆盖 Runos M1 已经真实实现的部分（2026-08-11 读 vxture-runos 源码
 * 核对，不是design 文档推测）：
 *   - capabilities：register / list / get / promote-to-stable
 *   - endpoints：register / set-status（没有独立的 list-all 接口——端点始终
 *     挂在某个 capability 下，读取走 capability 详情的 `endpoints` 字段）
 * policies / quality-profiles / plugins 在 Runos 侧仍没有对应 controller
 * （M2+ 范围），继续留在 opera 的"规划中"占位页，不在这里假装代理。
 * （credentials / audit / grants 曾在这一行里，2026-08-12～13 陆续补齐，见下。）
 *
 * 2026-08-12 补 M2 两项（liaison #248，ADR-009，已合并到 runos main）：
 *   - capabilities 的 primitiveType 现在接受 "skill"（asset 仍拒绝）；
 *     skill 的 operations 系统强制恰好一条 fetch，前端不让用户编辑这段
 *   - certification：POST .../certification，四项固定清单（不是可配置的），
 *     outcome 服务端计算，opera 不接受调用方直传 outcome
 *
 * 2026-08-12 补凭证代理（liaison #250，250-credential-proxy.md 已合并）：
 * `POST /governance/credentials` 只支持 mode="account-scoped"，
 * per-caller 会被 runos 直接拒绝（依赖平台侧 RFC 8693 token exchange，
 * vxture-platform#226 未落地，opera 不需要处理这个分支）。secretMaterial
 * 落库前加密，响应体永不回显——这里原样透传 runos 的响应，不额外读取或缓存
 * 明文。~~只有写入口，没有 list/read 接口~~ **2026-08-13 已补齐**（见下）。
 *
 * 2026-08-12 补 Grant 写入口（liaison #249，230/280，已合并）：owner 决定
 * opera 技术供给 + admin 商业打包在 M2 合并成一次写入——原设计文档描述的
 * "opera 独立技术供给目录"端点不存在，`POST /commerce/capability-grants` 一次把
 * riskScope（opera 该填的）和 quotaLimit（admin 该填的）都收了，没有阶段
 * 隔离。这里不假装有阶段隔离，UI 侧也做成单页合并表单（owner 2026-08-12 拍
 * 板）。subjectType 目前只开放 tenant / workspace——tier 级授权依赖
 * callerProductCode 这个 Runos 自己文档标注的"临时简化"兜底值，opera 侧先不
 * 接，等 Runos 真正的订阅/tier 解析落地再加。
 *
 * 2026-08-13 补齐一批「写得进、看不见、改不动」的缺口（runos `incr/04`，起于
 * `vxture-runos#65`——opera 页面上那几条"没有清单/不能撤销/看不到用量"的横幅
 * 就是这个 issue 的证据）：
 *   - credentials：list（元数据）/ rotate / revoke / applies-to
 *   - grants：revoke（迁 `revoked` 终态，不删行）/ quota 消费量读 / quota 重置 /
 *     by-capability 反向索引
 *   - capabilities：updateMetadata（title/ownerRef）/ version lifecycle
 *     （deprecated·withdrawn）/ official 准入档 / reembed
 *   - audit：mgmt_event / capability_call / task_outcome 三条读流
 * 共同点是这些**列早就存在、只是没有路由**，补的是可达性不是新语义。
 *
 * 2026-08-23 按 runos 生产源码逐条复核（`registry` / `commerce` / `governance` /
 * `audit` 四个 controller + prisma schema），补一条、修两处：
 *   - 补 `PATCH grants/:grantId`（改条款）。上游早已交付 `updateTerms`，opera 侧
 *     一直用"撤销 + 重发"顶着——那是两次写、中间有一个没有授权的窗口，且每改一次
 *     配额计数就归零。上游同时把"重发换条款"改成 409，旧路径连跑通都不成立了。
 *   - `CapabilityCallRecord.latencyMs` → `latencyTotalMs`：上游从来没有前者，
 *     调用流水的延迟列一直是空的（不报错，所以没人发现）。
 *   - 同一条记录的行标识由 `callId` 改为 `eventId`：`call_id` 是非唯一索引。
 * 仍**未**代理、且是有意的：`POST endpoint-instances/:id/activate|deactivate`
 * （端点三态，二元开关表达不了，见下）；`GET capabilities/:id` 的 `versions[]` 带
 * `embedding` 向量（上游 include 全量，是它那侧的载荷问题，不在这层裁剪——裁了就等于
 * 我们决定哪些字段不重要）。
 *
 * step-up：密钥类写路由（credentials 的 create/rotate/revoke）挂
 * `@RequireStepUp()`；grants / capabilities 的写**不挂**——判据在
 * `admin.operator_permission.requires_step_up`，而 `capability:runos.manage`
 * 是粗粒度码、刻意未标（`product_250` §M-2 补注「过渡态」：整码标 true 会把
 * "改个标题"也卡上二次验证）。等 runos 按 M-2 注册操作级词表后再补标，届时
 * 这里跟着加装饰器，不要提前在代码里自造一套判据。 */

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
  Res,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { Request, Response as ExpressResponse } from "express";
import type { Pool } from "pg";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { OperatorAuditEntry } from "../audit/audit-log";
import { recordProxyWrite } from "../audit/proxy-audit";
import {
  notEntitled,
  unauthenticated,
  upstreamUnavailable,
} from "../errors/api-error";
import { RequireStepUp } from "../auth/step-up.decorator";
import { assertRunosContract, type RunosResource } from "./runos-contract";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";

/** 换票时的目标 audience（对齐 product_100 的产品码）。 */
const RUNOS_AUDIENCE = "runos";
/** 活库当前的三段式能力码（见文件头）。 */
const CAPABILITY_READ = "capability:runos.read";
const CAPABILITY_MANAGE = "capability:runos.manage";

type JsonObject = Record<string, unknown>;
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RunosErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

export interface CapabilityVersionRecord {
  capabilityId: string;
  version: string;
  state: string;
  contract: Record<string, unknown>;
  contentDigest: string;
  createdAt: string;
}

/**
 * 能力分类法（runos `incr/07` / `120` §3.1，v0.5.0 起**强制**）。
 *
 * 15 选 1，注册必填——缺了 runos 直接 `missing_category`，非法值 `invalid_category`
 * 并附完整词表。**`other` 是真实选项，不是缺省回落**：填不出来时选它是一个明确的
 * 判断，而由前端悄悄替人补一个默认值，等于替运营做了分类决定还不告诉他。
 */
export const CAPABILITY_CATEGORIES = [
  "communication",
  "crm",
  "support",
  "devops",
  "security",
  "finance",
  "hr",
  "commerce",
  "marketing",
  "data",
  "documents",
  "productivity",
  "development",
  "legal",
  "other",
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

export interface CapabilityRecord {
  capabilityId: string;
  primitiveType: string;
  providerId: string;
  ownerRef: string;
  title: string;
  /**
   * 面向最终用户的名字，**按 locale 分键**（`{"zh-CN": "…", "en": "…"}`，
   * runos `120-capability-model.md` §3.2）。库里默认 `{}`，不是 null。
   *
   * **是呈现不是身份**：解析、授权、计量、审计一律不认它，`title` 仍是运营名。
   * 某个 locale 缺失时回落到 `title`——**不跨 locale 回落**，那会让人读到一个
   * 语言不明的名字还以为是自己那门语言的。
   */
  displayName?: Record<string, string>;
  admissionTier: string;
  /** 15 选 1，v0.5.0 起必填。 */
  category?: string;
  /** 0..8 个，`^[a-z0-9][a-z0-9-]{1,31}$`。 */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityDetailRecord extends CapabilityRecord {
  versions: CapabilityVersionRecord[];
  aliases: {
    capabilityId: string;
    alias: string;
    version: string;
    updatedAt: string;
  }[];
  endpoints: EndpointInstanceRecord[];
}

/** `GET /governance/credentials` —— **元数据，永不含密钥材料**（runos 侧
 *  `listMetadata()` 连 secret_ciphertext 都不 select）。 */
export interface CredentialBindingRecord {
  bindingId: string;
  credentialClass: string;
  providerId: string;
  mode: string;
  appliesTo: string[];
  subjectScope: string | null;
  state: string;
  createdAt: string;
  rotatedAt: string | null;
}

/** `audit.mgmt_event` 行——「谁、通过哪个控制台、改了什么」。 */
export interface MgmtEventRecord {
  eventId: string;
  /** runos v0.8.0 起由 `event_type` 改名（X-3：字段名三方对齐）。 */
  action: string;
  /** v0.8.0 新增：`success` / `rejected`——「谁试图做但被拒了」由此答得出。 */
  outcome: string;
  occurredAt: string;
  actorId: string;
  actorConsole: string;
  objectType: string;
  objectId: string;
  objectVersionBefore: string | null;
  objectVersionAfter: string;
  changeDigest: string;
}

/**
 * 审计三条流的分页形状（runos v0.8.0，product_251 A-3）。
 *
 * **keyset 游标不是 offset**：这几张表在被读的同时还在追加，offset 会漏行或重复行。
 * 游标不透明——自己拼一个会拿到 `AUDIT_INVALID_CURSOR`，而不是半份结果。
 *
 * **本层原样透传，不代为翻页。** 在 BFF 里循环取到 `nextCursor` 为空，等于把「还有
 * 更多」这个事实从页面手里拿走，而那正是运营者需要知道的（同 `usage-summaries` 的
 * top-N 截断纪律）。`usage-summaries` 刻意没有游标：它是有界窗口上的聚合，行数是轴的
 * 基数不是流的长度。
 */
export interface AuditPage<T> {
  /** `items`，不是 `rows`——product_251 A-4，两个上游同形。 */
  items: T[];
  nextCursor: string | null;
}

/**
 * `audit.capability_call` 行——「这个 agent 实际调用了什么」。
 *
 * **`eventId` 是主键，`callId` 不是。** 上游 schema 上 `call_id` 只有一个**非唯一**
 * 索引，与之配套的还有 `sequence_no` / `parent_call_id` / `retry_of`：一次调用可以
 * 落多条事件行。拿 `callId` 当行标识（React key、去重、"复制调用 ID"）在重试或多段
 * 调用出现的那一刻就会撞——而那恰好是最需要看清这张表的时候。
 */
export interface CapabilityCallRecord {
  /** 主键。行标识用它。 */
  eventId: string;
  /** 业务意义上的一次调用；同一个值可能横跨多行（见上）。 */
  callId: string;
  occurredAt: string;
  taskId: string | null;
  capabilityId: string | null;
  workspaceId: string | null;
  tenantId: string | null;
  agentId: string | null;
  /** runos v0.8.0 起由 `status` 改名——`state` 是对象算不算数，`outcome` 是这次尝试怎么结束的。 */
  outcome: string | null;
  decision: string | null;
  errorClass: string | null;
  errorCode: string | null;
  /**
   * 端到端延迟。**上游没有 `latencyMs` 这个字段**——它拆成了三个
   * （`latencyTotalMs` / `latencyGatewayMs` / `latencyCapabilityMs`），网关自身开销
   * 与能力执行时间分开记，因为"慢在哪一段"是排障要先答的问题。此前本接口写的是
   * `latencyMs`，上游从不返回，页面那一列恒为「—」而不报错。
   */
  latencyTotalMs: number | null;
  /** 网关自身开销。与 total 的差值就是能力那一段。 */
  latencyGatewayMs: number | null;
  latencyCapabilityMs: number | null;
}

/** `audit.task_outcome` 行——纯断言层（ADR-006），只喂贡献度评分。 */
export interface TaskOutcomeRecord {
  taskId: string;
  occurredAt: string;
  workspaceId: string | null;
  agentId: string | null;
  outcome: string;
  note: string | null;
}

/** runos `USAGE_AXES` 的七根轴，取值与上游一字不差——写错上游回 400 并列出合法值。 */
export type UsageAxis =
  | "tenant"
  | "workspace"
  | "product"
  | "agent"
  | "provider"
  | "capability"
  | "endpoint";

/**
 * 一行用量汇总。**不属于当前轴的身份字段是 `null`**，不是缺数据——一行 provider
 * 汇总本来就是跨所有租户求和的。两个例外由上游契约保证：`workspace` 行带 `tenantId`
 * （工作区蕴含租户），`endpoint` 行带 `capabilityId`（端点嵌在能力里）。
 *
 * `costAmount` 是**字符串**（decimal，不走 JS number 免得丢精度），而且它是**运营视图
 * 不是账单事实**——runos 自己在契约里写明它「不预判 product_110 §6.8#1 的计费归属裁定」。
 */
export interface UsageSummaryRow {
  dimension: UsageAxis;
  tenantId: string | null;
  workspaceId: string | null;
  productId: string | null;
  agentId: string | null;
  provider: string | null;
  capabilityId: string | null;
  endpointInstanceId: string | null;
  calls: number;
  allowedCalls: number;
  successCalls: number;
  costAmount: string;
}

/**
 * 上游回的是**信封**不是裸数组，而且理由被 product_251 A-4 写死了：`groupBy` 默认
 * `workspace`、窗口默认当月 UTC，两者都是**服务端解析出来的**，回显只能放信封上——
 * 放在行上的话，空结果时它会整个消失，调用方拿到空集合后无从得知自己查的是哪根轴。
 */
export interface UsageSummaryPage {
  dimension: UsageAxis;
  from: string;
  to: string;
  items: UsageSummaryRow[];
}

export interface EndpointInstanceRecord {
  id: string;
  capabilityId: string;
  version: string;
  environment: string;
  baseUrl: string;
  /** runos v0.8.0 起由 `status` 改名（B-3）。 */
  state: string;
  createdAt: string;
}

/**
 * 上游 `CommerceController.MAX_SUBJECT_REFS`。超限不是截断而是**整批 400**，所以这里
 * 分片而不是只取前 N —— 悄悄丢掉一部分产品，界面上和「这些产品没有授权」一模一样。
 */
const RUNOS_MAX_SUBJECT_REFS = 100;

@Controller("api/runos")
export class RunosRouter {
  private readonly runosApiUrl: string;

  constructor(
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(OperatorExchangeService)
    private readonly operatorExchange: OperatorExchangeService,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {
    this.runosApiUrl = configService.platform.RUNOS_API_URL.trim().replace(
      /\/+$/,
      "",
    );
  }

  /** 同 atlas.router.ts 的 writeThrough：上游成功后事后留痕（`product_250`
   *  M-5 第二条）。审计失败不改变接口结果——远端已生效，报错会诱导重试。 */
  private async writeThrough<T>(
    req: Request & RequestContext,
    path: string,
    options: { method?: HttpMethod; body?: JsonObject; res?: ExpressResponse },
    audit: (result: T) => OperatorAuditEntry,
  ): Promise<T> {
    const result = await this.request<T>(req, path, options);
    await recordProxyWrite(this.rwPool, req, audit(result));
    return result;
  }

  /**
   * @param options.res 传了就把**上游的成功状态码**照搬到本层响应上。
   *
   * ── 为什么不是每条 POST 都传 ────────────────────────────────────────────
   *
   * Nest 对 `@Post()` 默认回 201，而上游只有**两条**路由真的用状态码承载信息
   * （product_251 B-2「调用方不必 diff 行就能分辨新建与已存在」）：
   *
   *   POST /commerce/capability-grants   201 新建 · 200 已存在同条款
   *   POST /capability/endpoint-instances 201 新建 · 200 已发布过
   *
   * 其余 20 多条上游只有一个成功状态，把一个恒定值"透传"一遍是仪式不是契约。
   * 所以规则写在这里：**上游哪条路由 `res.status(created ? 201 : 200)`，本层对应
   * 那条就传 `res`**；上游加第三条时，这里跟着加第三条。
   *
   * 机制上能成立是因为 Nest 在**跑 handler 之前**就 setStatus，而
   * `RouterExecutionContext.createHandleResponseFn` 拿到的 `httpStatusCode` 是
   * undefined（调用点只传三个参数），于是 `reply()` 里的 `if (statusCode)` 不成立、
   * 不会覆盖 handler 里后设的值。`@Res({ passthrough: true })` 因此是有效的。
   */
  private async request<T>(
    req: Request & RequestContext,
    path: string,
    options?: {
      method?: HttpMethod;
      body?: JsonObject;
      res?: ExpressResponse;
      /** 只在**读**上给：带上它就在出口校验必有字段。见 `runos-contract.ts`。 */
      contract?: RunosResource;
    },
  ): Promise<T> {
    const bearer = req.operatorAccessToken
      ? await this.operatorExchange.getToken(
          req.operatorAccessToken,
          RUNOS_AUDIENCE,
        )
      : null;
    const res = options?.res;
    const payload = await runosRequest<T>(
      path,
      { ...options, ...(bearer ? { bearer } : {}) },
      this.runosApiUrl,
      res ? (status) => res.status(status) : undefined,
    );
    return options?.contract
      ? assertRunosContract(payload, options.contract)
      : payload;
  }

  // ── Capabilities ─────────────────────────────────────────────────────────

  /**
   * 目录列表。`?category=` 精确匹配；`?tag=` **可重复，且是全部命中（AND）**——
   * 不是任一命中，透传时必须保留重复参数，用 append 而不是 set。
   */
  @Get("capabilities")
  listCapabilities(
    @Req() req: Request & RequestContext,
    @Query("category") category?: string,
    @Query("tag") tag?: string | string[],
  ): Promise<CapabilityRecord[]> {
    assertCanRead(req);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    for (const t of Array.isArray(tag) ? tag : tag ? [tag] : []) {
      if (t) params.append("tag", t);
    }
    return this.request<CapabilityRecord[]>(
      req,
      `/capability/capabilities${params.size ? `?${params.toString()}` : ""}`,
      { contract: "capabilities" },
    );
  }

  @Get("capabilities/:capabilityId")
  getCapability(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
  ): Promise<CapabilityDetailRecord> {
    assertCanRead(req);
    return this.request<CapabilityDetailRecord>(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}`,
      { contract: "capability-detail" },
    );
  }

  @Post("capabilities")
  registerCapability(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<{
    capabilityId: string;
    version: string;
    state: string;
    admissionTier: string;
    contentDigest: string;
  }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      "/capability/capabilities",
      { method: "POST", body },
      (r) => ({
        action: "runos.capability.register",
        resourceType: "runos_capability",
        resourceId: r.capabilityId,
        after: { version: r.version, state: r.state, tier: r.admissionTier },
      }),
    );
  }

  @Post("capabilities/:capabilityId/versions/:version/promote")
  promoteCapability(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
    @Param("version") version: string,
  ): Promise<{
    capabilityId: string;
    version: string;
    state: string;
    previousStable: string | null;
  }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}/versions/${encodeURIComponent(version)}/promote`,
      { method: "POST" },
      (r) => ({
        action: "runos.capability.promote",
        resourceType: "runos_capability",
        resourceId: capabilityId,
        after: { version, state: r.state, previousStable: r.previousStable },
      }),
    );
  }

  @Post("capabilities/:capabilityId/certification")
  submitCertification(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
    @Body() body: JsonObject,
  ): Promise<{
    capabilityId: string;
    outcome: "certified" | "rejected";
    items: { item: string; pass: boolean; note?: string }[];
  }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}/certification`,
      { method: "POST", body },
      (r) => ({
        action: "runos.capability.certification",
        resourceType: "runos_capability",
        resourceId: capabilityId,
        /* outcome 是服务端算的，落它才有意义——记提交了什么不如记判成了什么。 */
        after: { outcome: r.outcome, items: r.items },
      }),
    );
  }

  // ── Capabilities 补充写（2026-08-13 runos `incr/04` 补齐；起于 #65）────────
  //    共同点：这四样在 runos 里**都有列可写、都没有路由**，所以能力注册进去
  //    之后就再也改不动——改个标题、退役一个版本、换个负责团队、重算一次
  //    embedding，全都无路可走。不是新功能，是把已经存在的列接上。

  /** 可编辑元数据只有 title / ownerRef。`providerId` **刻意不在这里**——runos
   *  `98_column_locks.sql` 把它列为身份列，转让 provider 是另一件事、另一条路由
   *  （M1 尚不存在）。这里也不给它字段，免得有人以为漏传了。 */
  @Patch("capabilities/:capabilityId")
  updateCapabilityMetadata(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
    @Body() body: JsonObject,
  ): Promise<{ capabilityId: string; title: string; ownerRef: string }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}`,
      { method: "PATCH", body },
      (r) => ({
        action: "runos.capability.update_metadata",
        resourceType: "runos_capability",
        resourceId: capabilityId,
        after: { title: r.title, ownerRef: r.ownerRef },
      }),
    );
  }

  /**
   * 退役半边：`deprecated`（仍可解析，只是打信号）/ `withdrawn`（从快照里掉出去）。
   * **到不了 `stable`**——晋升有自己的路由，runos 侧对本路由直接 400。
   *
   * withdrawn 会把**指向该版本的每一个别名**一并删掉，响应里 `droppedAliases` 点名
   * 是哪些。此前这里写的是 `droppedAlias`（单数、string）——上游从来没有这个键，
   * 于是门户那句「这个能力现在没有 stable 可解析」的警告**一次都没有触发过**：
   * 撤掉一个正是 stable 的版本，界面上是一个平静的绿色 toast。
   * （2026-08-23 联调实测：撤一个版本回的是 `{"droppedAliases":["latest"]}`。）
   *
   * 是**数组**也重要：掉的不只有 `stable`，`latest` 与任何自定义别名都会跟着掉。
   */
  @Patch("capabilities/:capabilityId/versions/:version/lifecycle")
  setVersionLifecycle(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
    @Param("version") version: string,
    @Body() body: JsonObject,
  ): Promise<{
    capabilityId: string;
    version: string;
    state: string;
    droppedAliases?: string[];
  }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}/versions/${encodeURIComponent(version)}/state`,
      { method: "PATCH", body },
      (r) => ({
        action: "runos.capability.set_lifecycle",
        resourceType: "runos_capability_version",
        resourceId: `${capabilityId}@${version}`,
        after: {
          state: r.state,
          ...(r.droppedAliases?.length
            ? { droppedAliases: r.droppedAliases }
            : {}),
        },
      }),
    );
  }

  /** `official` 准入档——**仅第一方**（runos `FIRST_PARTY_PROVIDERS`，非第一方
   *  provider 直接 409 `not_first_party`）。`experimental → certified` 不走这里，
   *  走认证清单。 */
  @Post("capabilities/:capabilityId/official")
  setOfficialTier(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
  ): Promise<{ capabilityId: string; admissionTier: string }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}/official`,
      { method: "POST" },
      (r) => ({
        action: "runos.capability.set_official",
        resourceType: "runos_capability",
        resourceId: capabilityId,
        after: { admissionTier: r.admissionTier },
      }),
    );
  }

  /** 重算某个版本的发现向量。换了 embedding 模型、或注册时那次 embed 失败了，
   *  此前没有任何回头路。embedding provider 返回空时 runos 报 409，向量不变。 */
  @Post("capabilities/:capabilityId/versions/:version/reembed")
  reembedVersion(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
    @Param("version") version: string,
  ): Promise<{ capabilityId: string; version: string; dimensions: number }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}/versions/${encodeURIComponent(version)}/reembed`,
      { method: "POST" },
      (r) => ({
        action: "runos.capability.reembed",
        resourceType: "runos_capability_version",
        resourceId: `${capabilityId}@${version}`,
        after: { dimensions: r.dimensions },
      }),
    );
  }

  // ── Grants（opera 技术字段 + admin 商业字段合并为一次写入——见文件头）────────

  /**
   * 发一条授权。**上游对"已存在"的回答变了**（product_251 B-2）：
   *
   *   同一对主体+能力已有 active 的 direct 行，条款**相同** → 200，`created:false`
   *   （不写库，但会重编闭包：能力可能新增了依赖，重发就是运营在要求把它接上）
   *   条款**不同**                                   → **409 `GRANT_EXISTS`**
   *   已有 derived 行                                → 就地升级为 direct
   *   全新                                           → 201
   *
   * 那个 409 是本次接入要注意的一处：以前"重发一遍换个配额"是静默无效，现在是明确
   * 报错并指向 `PATCH grants/:grantId`。**改条款走 PATCH，不要撤销重发。**
   */
  @Post("grants")
  createGrant(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
    @Res({ passthrough: true }) res: ExpressResponse,
  ): Promise<Record<string, unknown>> {
    assertCanManage(req);
    return this.writeThrough<Record<string, unknown>>(
      req,
      "/commerce/capability-grants",
      { method: "POST", body, res },
      (r) => ({
        action: "runos.grant.write",
        resourceType: "runos_grant",
        resourceId: String(r.grantId ?? ""),
        /* grantType 值钱：同一次「新增」可能是对 derived 行的原地升级
           （upgradeToDirect），审计里能区分出来才查得清。 */
        after: r,
      }),
    );
  }

  /**
   * 改条款 —— **上游 2026-08 补的原子入口**（`CommerceController.updateGrant` →
   * `GrantProvisioningService.updateTerms`）。
   *
   * 在它存在之前，改一条授权的 riskScope / quotaLimit 只能「撤销 + 重发」：两次写、
   * 两个失败点，中间那一刻这个产品是**没有这条授权**的。门户当时那样做是对的
   * （`grantDirect` 对已存在的 direct 行确实什么都不套用），现在不再是——上游已经
   * 把「同一对主体+能力、不同条款」的重复 POST 改成 **409 `GRANT_EXISTS`** 并在
   * message 里指向本路由，所以旧路径现在连"能跑通"都不成立了。
   *
   * 三条上游语义原样透传，不在这里代为兜底：
   *   - **偏序更新**：没送的字段保持原值（三个都没送 → 400 `GRANT_PATCH_EMPTY`）。
   *   - 非 `active` 的授权改不动 → 409 `GRANT_NOT_ACTIVE`（撤销过的要重新发一条，
   *     而不是"改回来"——那会让一段被撤销的时间从历史里消失）。
   *   - 收窄 riskScope 会连带重编派生闭包，上游在同一个调用里做完。
   *
   * grantId 保持不变，所以配额消耗计数**跟着这条授权继续**——这正是撤销重发做不到
   * 的：那条路径下每改一次条款，用量就从零开始，月度配额形同虚设。
   */
  @Patch("grants/:grantId")
  updateGrantTerms(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
    @Body() body: JsonObject,
  ): Promise<Record<string, unknown>> {
    assertCanManage(req);
    return this.writeThrough<Record<string, unknown>>(
      req,
      `/commerce/capability-grants/${encodeURIComponent(grantId)}`,
      { method: "PATCH", body },
      (r) => ({
        action: "runos.grant.update_terms",
        resourceType: "runos_grant",
        resourceId: grantId,
        /* 条款不是密钥，可以落——「改成了什么」正是这条留痕要回答的问题。 */
        after: r,
      }),
    );
  }

  // ── Audit（只读三条流；runos 侧 limit 服务端 clamp 到 1000，不信调用方）──────

  @Get("audit/calls")
  listAuditCalls(
    @Req() req: Request & RequestContext,
    @Query("taskId") taskId?: string,
    @Query("capabilityId") capabilityId?: string,
    @Query("workspaceId") workspaceId?: string,
    @Query("tenantId") tenantId?: string,
    @Query("agentId") agentId?: string,
    @Query("outcome") outcome?: string,
    @Query("decision") decision?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<AuditPage<CapabilityCallRecord>> {
    assertCanRead(req);
    const p = new URLSearchParams();
    if (taskId) p.set("taskId", taskId);
    if (capabilityId) p.set("capabilityId", capabilityId);
    if (workspaceId) p.set("workspaceId", workspaceId);
    if (tenantId) p.set("tenantId", tenantId);
    if (agentId) p.set("agentId", agentId);
    if (outcome) p.set("outcome", outcome);
    if (decision) p.set("decision", decision);
    if (limit) p.set("limit", limit);
    if (cursor) p.set("cursor", cursor);
    return this.request<AuditPage<CapabilityCallRecord>>(
      req,
      `/audit/calls${p.size ? `?${p.toString()}` : ""}`,
      { contract: "audit-calls" },
    );
  }

  @Get("audit/mgmt-events")
  listAuditMgmtEvents(
    @Req() req: Request & RequestContext,
    @Query("actorId") actorId?: string,
    @Query("actorConsole") actorConsole?: string,
    @Query("objectType") objectType?: string,
    @Query("objectId") objectId?: string,
    @Query("action") action?: string,
    @Query("outcome") outcome?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<AuditPage<MgmtEventRecord>> {
    assertCanRead(req);
    const p = new URLSearchParams();
    if (actorId) p.set("actorId", actorId);
    if (actorConsole) p.set("actorConsole", actorConsole);
    if (objectType) p.set("objectType", objectType);
    if (objectId) p.set("objectId", objectId);
    if (action) p.set("action", action);
    if (outcome) p.set("outcome", outcome);
    if (limit) p.set("limit", limit);
    if (cursor) p.set("cursor", cursor);
    return this.request<AuditPage<MgmtEventRecord>>(
      req,
      `/audit/mgmt-events${p.size ? `?${p.toString()}` : ""}`,
      { contract: "audit-mgmt-events" },
    );
  }

  @Get("audit/outcomes")
  listAuditOutcomes(
    @Req() req: Request & RequestContext,
    @Query("taskId") taskId?: string,
    @Query("workspaceId") workspaceId?: string,
    @Query("agentId") agentId?: string,
    @Query("outcome") outcome?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<AuditPage<TaskOutcomeRecord>> {
    assertCanRead(req);
    const p = new URLSearchParams();
    if (taskId) p.set("taskId", taskId);
    if (workspaceId) p.set("workspaceId", workspaceId);
    if (agentId) p.set("agentId", agentId);
    if (outcome) p.set("outcome", outcome);
    if (limit) p.set("limit", limit);
    if (cursor) p.set("cursor", cursor);
    return this.request<AuditPage<TaskOutcomeRecord>>(
      req,
      `/audit/outcomes${p.size ? `?${p.toString()}` : ""}`,
      { contract: "audit-outcomes" },
    );
  }

  /**
   * 七轴用量汇总（`vxture-runos#81`，v0.5.0 起在产）。
   *
   * 三条上游契约必须原样透传、不在这里代为"修好"：
   *
   * 1. **`groupBy` 写错 runos 回 400 并列出合法轴**——不在这里悄悄改写成默认轴。
   *    把一个写错的轴渲染成 workspace 数据，比报错更容易被当成真答案。
   * 2. **`from`/`to` 解析失败 runos 也回 400**，不回退到默认窗口——一个打错的 `from`
   *    若被兜成默认月份，返回的是一个"自信地错着"的月份。这条纪律与本仓一致，透传。
   * 3. **恰好返回 `limit` 行 = top-N 截断**，此时总计是**少算**的。BFF 不加工，
   *    由页面据 `rows.length === limit` 说明——在这里悄悄多取一页会让"截断"这个
   *    事实消失，而它正是运营者需要知道的。
   *
   * 七个身份过滤器与任意轴可组合（`?groupBy=capability&workspaceId=...`）。
   */
  @Get("audit/usage-summaries")
  listUsageSummaries(
    @Req() req: Request & RequestContext,
    @Query("groupBy") groupBy?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("tenantId") tenantId?: string,
    @Query("workspaceId") workspaceId?: string,
    @Query("productId") productId?: string,
    @Query("agentId") agentId?: string,
    @Query("provider") provider?: string,
    @Query("capabilityId") capabilityId?: string,
    @Query("endpointInstanceId") endpointInstanceId?: string,
    @Query("limit") limit?: string,
  ): Promise<UsageSummaryPage> {
    assertCanRead(req);
    const p = new URLSearchParams();
    if (groupBy) p.set("groupBy", groupBy);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (tenantId) p.set("tenantId", tenantId);
    if (workspaceId) p.set("workspaceId", workspaceId);
    if (productId) p.set("productId", productId);
    if (agentId) p.set("agentId", agentId);
    if (provider) p.set("provider", provider);
    if (capabilityId) p.set("capabilityId", capabilityId);
    if (endpointInstanceId) p.set("endpointInstanceId", endpointInstanceId);
    if (limit) p.set("limit", limit);
    return this.request<UsageSummaryPage>(
      req,
      `/audit/usage-summaries${p.size ? `?${p.toString()}` : ""}`,
      { contract: "usage-summaries" },
    );
  }

  // ── Credentials（2026-08-13：runos 补齐了读/轮换/吊销/重定范围，
  //    此前只有写入口——见 vxture-runos#65 与其 280 §5b.1/§5b.2）─────────────

  @Get("credentials")
  listCredentials(
    @Req() req: Request & RequestContext,
  ): Promise<CredentialBindingRecord[]> {
    assertCanRead(req);
    return this.request<CredentialBindingRecord[]>(
      req,
      "/governance/credentials",
      { contract: "credentials" },
    );
  }

  @RequireStepUp()
  @Post("credentials")
  createCredentialBinding(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<{
    credentialClass: string;
    providerId: string;
    mode: "account-scoped";
    appliesTo: string[];
    createdAt: string;
  }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      "/governance/credentials",
      { method: "POST", body },
      (r) => ({
        action: "runos.credential.provision",
        resourceType: "runos_credential_binding",
        resourceId: `${r.providerId}:${r.credentialClass}`,
        /* 只记绑定元数据。runos 侧响应本就不回显 secretMaterial，但这里显式
           挑字段而不是整包落，理由同 atlas 的密钥路由：形状会变，安全默认是
           白名单不是黑名单。 */
        after: {
          credentialClass: r.credentialClass,
          providerId: r.providerId,
          mode: r.mode,
          appliesTo: r.appliesTo,
        },
      }),
    );
  }

  /* 以下三个凭证写路由**一律不落 `after`**：同 atlas 密钥路由的理由——审计要
     回答"谁在什么时候动了哪条绑定"，不是"绑定里有什么"。轮换请求体带明文
     secretMaterial，更不能进审计。全部挂 step-up（product_250 v0.4）。 */

  @RequireStepUp()
  @Post("credentials/:bindingId/rotate")
  rotateCredential(
    @Req() req: Request & RequestContext,
    @Param("bindingId") bindingId: string,
    @Body() body: JsonObject,
  ): Promise<{ bindingId: string; state: string; rotatedAt: string }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/governance/credentials/${encodeURIComponent(bindingId)}/rotate`,
      { method: "POST", body },
      () => ({
        action: "runos.credential.rotate",
        resourceType: "runos_credential_binding",
        resourceId: bindingId,
      }),
    );
  }

  /** 吊销**会清空密文**（不是打标记），不可逆——runos 侧 `revoke()` 幂等。 */
  @RequireStepUp()
  @Delete("credentials/:bindingId")
  revokeCredential(
    @Req() req: Request & RequestContext,
    @Param("bindingId") bindingId: string,
  ): Promise<{ bindingId: string; state: string }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/governance/credentials/${encodeURIComponent(bindingId)}`,
      { method: "DELETE" },
      () => ({
        action: "runos.credential.revoke",
        resourceType: "runos_credential_binding",
        resourceId: bindingId,
      }),
    );
  }

  /** 重定范围：不重新提供密钥就改 appliesTo。空数组会被 runos 拒——退役用 DELETE。 */
  @RequireStepUp()
  @Patch("credentials/:bindingId/applies-to")
  setCredentialAppliesTo(
    @Req() req: Request & RequestContext,
    @Param("bindingId") bindingId: string,
    @Body() body: JsonObject,
  ): Promise<{ bindingId: string; appliesTo: string[] }> {
    assertCanManage(req);
    return this.writeThrough(
      req,
      `/governance/credentials/${encodeURIComponent(bindingId)}/applies-to`,
      { method: "PATCH", body },
      (r) => ({
        action: "runos.credential.set_applies_to",
        resourceType: "runos_credential_binding",
        resourceId: bindingId,
        after: { appliesTo: r.appliesTo },
      }),
    );
  }

  // ── Grants 补充读写（2026-08-13 runos 补齐撤销/配额/反向索引）──────────────

  /**
   * 跨产品的授权汇总 —— **形状固定的接缝**。
   *
   * 权益配置的清单页要回答「每个产品持有多少条能力授权、分布在哪些分类」。
   *
   * **2026-08-16：`vxture-runos#98` 已落地，扇出收掉了。** 从「一个产品一次、服务端
   * 并发」换成一次 `GET /commerce/capability-grants?subjectRefs=&subjectType=product`。当初把这个
   * 接缝放在 BFF 而不是页面里，图的就是这一刻——**端点形状与调用方一行都没动**，只换
   * 了内脏。
   *
   * 两侧语义等价，不是近似：单主体的 `listActiveForSubject` 与批量的
   * `listActiveForSubjects` 都是 `state:"active"` 全集（direct ∪ derived，ADR-005
   * 「所见即所售」），差别只在 `where` 是等值还是 `in`。
   *
   * **上游限每次 100 个主体**（`MAX_SUBJECT_REFS`，超出回 400），所以按 100 分片。今天
   * 只有 21 个产品，但把分片写进来是因为超限的表现是**整批 400**——等产品数长过 100
   * 那天再发现，汇总页会是整页空的。
   *
   * 失败语义保持不变：某一片失败**不拖垮整批**，那一片的产品记成空数组并在 `failed`
   * 里点名。汇总页少几个产品的数，比整页读不出来好；但**不能静默**——否则「这个产品
   * 没有授权」与「这个产品没查到」在界面上长得一模一样。
   */
  @Get("grants/summary")
  async grantsSummary(
    @Req() req: Request & RequestContext,
    @Query("productCodes") productCodes?: string,
  ): Promise<{
    byProduct: Record<string, Record<string, unknown>[]>;
    failed: string[];
  }> {
    assertCanRead(req);
    const codes = [
      ...new Set(
        (productCodes ?? "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ];

    /* 每个请求过的产品都要有一格。**空数组与「没查到」必须能区分**——先把所有码填成
       空数组，查回来的再覆盖；失败的留空并进 `failed`。 */
    const byProduct: Record<string, Record<string, unknown>[]> = {};
    for (const code of codes) byProduct[code] = [];
    const failed: string[] = [];

    const chunks: string[][] = [];
    for (let i = 0; i < codes.length; i += RUNOS_MAX_SUBJECT_REFS) {
      chunks.push(codes.slice(i, i + RUNOS_MAX_SUBJECT_REFS));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const rows = await this.request<Record<string, unknown>[]>(
            req,
            `/commerce/capability-grants?subjectType=product&subjectRefs=${encodeURIComponent(chunk.join(","))}`,
          );
          for (const row of rows) {
            const ref =
              typeof row["subjectRef"] === "string" ? row["subjectRef"] : null;
            /* 只认请求过的码：上游按 `in` 查，理论上不会多回，但把不认识的 ref 塞进
               `byProduct` 会凭空造出一个调用方没问过的产品。 */
            if (ref !== null && ref in byProduct) byProduct[ref]!.push(row);
          }
        } catch {
          failed.push(...chunk);
        }
      }),
    );
    return { byProduct, failed };
  }

  /** 反向索引：「谁持有这个能力的授权」——撤销或审计一个能力时问的问题。 */
  @Get("grants/by-capability/:capabilityId")
  listGrantsByCapability(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
  ): Promise<Record<string, unknown>[]> {
    assertCanRead(req);
    /* 上游 v0.8.0 把三种取法收敛到一个集合读、用查询参数选（A-2）：
       `?capabilityId=` 就是原来的 `by-capability/:id`。本层对外的路径**不动**，
       页面不受影响——适配层存在的意义正是把这类改动吸收在这里。 */
    return this.request<Record<string, unknown>[]>(
      req,
      `/commerce/capability-grants?capabilityId=${encodeURIComponent(capabilityId)}`,
      { contract: "grants" },
    );
  }

  /** 配额消耗。runos 侧读取前会 flush 本地分片，数字最多滞后一个 flush 周期。 */
  @Get("grants/:grantId/quota")
  getGrantQuota(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
  ): Promise<Record<string, unknown>> {
    assertCanRead(req);
    return this.request<Record<string, unknown>>(
      req,
      `/commerce/capability-grants/${encodeURIComponent(grantId)}/quota`,
      { contract: "grant-quota" },
    );
  }

  @Post("grants/:grantId/quota/reset")
  resetGrantQuota(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
  ): Promise<Record<string, unknown>> {
    assertCanManage(req);
    return this.writeThrough<Record<string, unknown>>(
      req,
      `/commerce/capability-grants/${encodeURIComponent(grantId)}/quota/reset`,
      { method: "POST" },
      () => ({
        action: "runos.grant.quota_reset",
        resourceType: "runos_grant",
        resourceId: grantId,
      }),
    );
  }

  /**
   * **刻意声明在 grants 段最后。** Nest 在同一个 controller 内按声明顺序匹配，
   * 这个两段式 pattern 会吞掉 `grants/` 下所有其它两段路由——
   * `by-capability/:id` 与 `:grantId/quota` 都会先落到这里
   * （subjectType="by-capability" / subjectRef="quota"）。runos 侧
   * `commerce.controller.ts` 踩过同一个坑并留了同样的注释，本文件此前把它放在
   * 段首、被上面两条撞上：只因为**转发出去的 URL 字符串恰好一模一样**、
   * 且两条都是 `assertCanRead`，才没有表现出故障——是巧合不是设计。
   * 新增任何 `grants/<a>/<b>` 路由都必须放在本方法**之上**。
   */
  @Get("grants/:subjectType/:subjectRef")
  listGrants(
    @Req() req: Request & RequestContext,
    @Param("subjectType") subjectType: string,
    @Param("subjectRef") subjectRef: string,
  ): Promise<Record<string, unknown>[]> {
    assertCanRead(req);
    return this.request<Record<string, unknown>[]>(
      req,
      `/commerce/capability-grants?subjectType=${encodeURIComponent(subjectType)}` +
        `&subjectRef=${encodeURIComponent(subjectRef)}`,
      { contract: "grants" },
    );
  }

  /**
   * 撤销 = 迁到 `revoked` 终态，**不是删行**——审计要留。
   *
   * 上游 v0.8.0 起改成具名动作 `POST :id/revoke`（product_251 B-4：`DELETE` 只表示
   * 移除，而这里行还在、历史也在）。**本层对外仍是 `DELETE`**：页面那侧的语义没变，
   * 而把改动吸收在适配层正是它存在的理由。等三方改名定案时再一并考虑本层的表达。
   */
  @Delete("grants/:grantId")
  revokeGrant(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
  ): Promise<Record<string, unknown>> {
    assertCanManage(req);
    return this.writeThrough<Record<string, unknown>>(
      req,
      `/commerce/capability-grants/${encodeURIComponent(grantId)}/revoke`,
      { method: "POST" },
      () => ({
        action: "runos.grant.revoke",
        resourceType: "runos_grant",
        resourceId: grantId,
      }),
    );
  }

  // ── Endpoints（永远挂在某个 capability 下，没有独立 list-all 接口）───────────

  /** 201 新建 · 200 该版本这个环境已经发布过——状态码照搬上游，见 `request()`。 */
  @Post("endpoints")
  registerEndpoint(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
    @Res({ passthrough: true }) res: ExpressResponse,
  ): Promise<EndpointInstanceRecord> {
    assertCanManage(req);
    return this.writeThrough<EndpointInstanceRecord>(
      req,
      "/capability/endpoint-instances",
      { method: "POST", body, res },
      (r) => ({
        action: "runos.endpoint.register",
        resourceType: "runos_endpoint",
        resourceId: r.id,
        after: r,
      }),
    );
  }

  /**
   * 上游 v0.8.0：`PATCH endpoints/:id/status` → `PATCH endpoint-instances/:id/state`
   * （B-3 仓内统一）。上游同时补了 `activate`/`deactivate` 一对动作路由——端点是
   * 三态（active/draining/disabled）不是二元开关，所以这里保留通用的 state 写法；
   * 二元开关才该走动作端点，这是 B-3 的判据本身。
   */
  @Patch("endpoints/:endpointId/status")
  setEndpointStatus(
    @Req() req: Request & RequestContext,
    @Param("endpointId") endpointId: string,
    @Body() body: { state: string },
  ): Promise<EndpointInstanceRecord> {
    assertCanManage(req);
    return this.writeThrough<EndpointInstanceRecord>(
      req,
      `/capability/endpoint-instances/${encodeURIComponent(endpointId)}/state`,
      { method: "PATCH", body },
      (r) => ({
        action: "runos.endpoint.set_state",
        resourceType: "runos_endpoint",
        resourceId: endpointId,
        after: { state: r.state },
      }),
    );
  }
}

function assertCanRead(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities?.includes(CAPABILITY_READ) &&
    !req.capabilities?.includes(CAPABILITY_MANAGE)
  ) {
    throw notEntitled(CAPABILITY_READ);
  }
}

function assertCanManage(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities?.includes(CAPABILITY_MANAGE)) {
    throw notEntitled(CAPABILITY_MANAGE);
  }
}

async function runosRequest<TResponse>(
  path: string,
  options: {
    method?: HttpMethod;
    body?: JsonObject;
    bearer?: string;
  } = {},
  baseUrl: string = "http://localhost:3120",
  /**
   * 上游成功状态码的回传口。**只有真正区分 200/201 的路由才传它**，哪些算、
   * 为什么不是全部，见 `RunosRouter.request()` 的注释。
   */
  onStatus?: (status: number) => void,
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
    throw upstreamUnavailable("RUNOS_UNAVAILABLE", "Runos is unavailable");
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new HttpException(
      parseRunosError(responseText, response.status),
      response.status,
    );
  }

  onStatus?.(response.status);

  if (!responseText.trim()) {
    return undefined as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function parseRunosError(responseText: string, status: number): RunosErrorBody {
  if (!responseText.trim()) {
    return {
      code: "RUNOS_REQUEST_FAILED",
      message: `Runos request failed with status ${status}`,
      statusCode: status,
    };
  }
  try {
    const parsed = JSON.parse(responseText) as RunosErrorBody;
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return { ...parsed, statusCode: parsed.statusCode ?? status };
    }
    return {
      code: "RUNOS_REQUEST_FAILED",
      message: `Runos request failed with status ${status}`,
      statusCode: status,
      details: parsed,
    };
  } catch {
    return {
      code: "RUNOS_REQUEST_FAILED",
      message: responseText,
      statusCode: status,
    };
  }
}
