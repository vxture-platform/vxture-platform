/**
 * product-health.router.ts — 目录产品各渠道的存活 + 就绪探测。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 自 admin 的「服务监控」迁入（2026-08-11）。**不是同一个功能，只是同一个入口位**：
 * admin 那份探的是本地 dev-panel（:8090），从未连过生产——
 * docs/20-specs/000-platform/admin/20-admin-platform-refinement-plan.md 把它登记在
 * P4「service-monitor 生产遥测源（Q6 维持 dev-only）」，之前两次迁移都刻意跳过它
 * （49d60f2 的原话："moving it would relocate emptiness"）。这次换了数据源和语义：
 * 探的不是平台自己的门户/BFF，是**接入平台的产品线**——每个产品的各渠道是否
 * 存活（owner 口径 2026-08-11，已建档：
 * `docs/20-specs/000-platform/opera/20-service-monitor.md` §2）。
 *
 * ── 2026-08-30：清单以 product.products 为主表（40-product-registry.md §4）────────
 *
 * 此前主表是 `appoidc.oidc_clients`，LEFT JOIN 产品表，外加一份硬编码豁免名单
 * （ontos/raven/anlan/forge/xuanzhen）和一张按产品码猜层级的表——于是本页显示的
 * 「产品」与「产品目录」是两份清单：目录里 21 个、这里 12 个，其中 5 个目录里根本
 * 没有。根因不是 JOIN 方向，是把「谁是产品」这个问题交给了客户端表回答。
 *
 * 现在：**`product.products` 是唯一权威**，本页 = 目录里每一个未删除的产品，
 * LEFT JOIN 它名下 `client_kind='product'` 且 `status='active'` 的 OIDC 客户端，按
 * `release_channel` 分到 stable / beta / canary 三个渠道。没有任何客户端的产品照样
 * 出现，标为 **未接入**（`onboarded=false`）——目录里有、监控里没有，正是运营者要
 * 看见的事实，不是该被过滤掉的噪声。层级只由 `product_type` 判定（矩阵文档 §2），
 * 没有按产品码的回退表：目录行没填对类型，就如实显示「未分类」。
 *
 * 渠道的唯一口径是 `release_channel`。此前"stable 客户端的第二个 redirect_uri = beta"
 * 那条派生路径已退役：一个回调白名单里多一个地址，不等于登记了一个渠道。同一渠道若
 * 登记了多个活跃客户端，取最早登记的那个探（一渠道一地址，表里一行放不下两个）。
 *
 * 每个 origin 探两类端点——**划分与路径约定归 025 标准 §2**，不在这里另立规矩；
 * owner 口径说的"health、status"指的就是这两类（对应 UI 的存活/就绪两列，不是要求
 * 产品必须用 /status 这个路径名）。详见 20-service-monitor.md §3：
 *   health＝liveness——只证明进程在听，不代表能否对外服务。
 *   status＝readiness——依赖项是否就绪，能否真正服务；返回 `checks` 明细。
 * 025 标准把 readiness 列为可选。**atlas 与 runos 已经接上了**（两边都有 `/readyz`
 * 与 `/healthz`，2026-08-23 读源码核对），所以这两行不该再显示"未实现"；其余产品多数
 * 仍未实现，那一列显示"未实现"是诚实的现状，不是探测逻辑的缺陷。
 * 自报状态的翻译见 `readinessFromBody()`——那里有一个"atlas 坏了却显示就绪"的坑。
 * 每类端点两种运行时路径约定都试（Next 前端 `/api/health`+`/api/ready`、Nest 后端
 * `/healthz`+`/readyz`），两条并发探，先拿到的非 404 响应视为命中；两条都 404 记
 * "未实现"（readiness）或"异常"（liveness——它不是可选项）；两条都连不上记"不可达"。
 *
 * ── 2026-08-31：client 型产品不探测，标「不适用」──────────────────────────────
 *
 * 桌面 / 原生客户端产品（`product_type='client'`，如 ruyin）的 OIDC 客户端是 RFC 8252
 * 的公共客户端，回调地址是 loopback（`http://127.0.0.1/...`）。它没有服务面可探——
 * 按 redirect_uri 的 origin 去探，探到的是 opera-bff 自己容器的 127.0.0.1，永远
 * 「不可达」，还会被算进「需要关注」。这不是产品故障，是探测对象不存在。所以：
 * 层级判为 client 的产品，已登记的渠道**不发探测**，存活 / 就绪两列都记
 * `not_applicable`（渠道本身照样列出：客户端登记是事实，只是没有东西可探）；
 * 没登记的渠道仍是 `not_configured`（登记与否是另一个事实）。见
 * `channelProbeMode()`。
 *
 * 只读、零持久化：每次请求现探，不落库、不缓存趋势，前端定时轮询。未设专属能力码：
 * admin 原页面从未挂过权限码，迁移不新增门槛，只要求已登录 operator。
 */

import { Controller, Get, Inject, Req } from "@nestjs/common";
import { unauthenticated } from "../errors/api-error";
import type { Request } from "express";
import type { Pool } from "pg";
import { OPERA_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";

const PROBE_TIMEOUT_MS = 4_000;
/** 优先级顺序：先试前端约定（redirect_uri 指向的多半是用户面前端），再试后端约定。 */
const LIVENESS_PATHS = ["/api/health", "/healthz"] as const;
const READINESS_PATHS = ["/api/ready", "/readyz"] as const;

export type ProductLayer =
  | "L1"
  | "L2"
  | "L3"
  | "client"
  | "external"
  | "unclassified";

/** 与 product.products.status 的 CHECK 词表一致（40_product.sql）。 */
export type ProductState = "draft" | "active" | "inactive" | "deprecated";

/** 与 appoidc.oidc_clients.release_channel 的 CHECK 词表一致（22_appoidc.sql）。 */
export type ReleaseChannel = "stable" | "beta" | "canary";
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = [
  "stable",
  "beta",
  "canary",
];

export type LivenessStatus =
  | "healthy"
  | "unhealthy"
  | "unreachable"
  | "not_configured"
  | "not_applicable";
export type ReadinessStatus =
  | "ready"
  | "degraded"
  | "fail"
  | "not_implemented"
  | "unreachable"
  | "not_configured"
  | "not_applicable";

export interface LivenessProbe {
  status: LivenessStatus;
  origin: string | null;
  path: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  service: string | null;
  version: string | null;
  gitSha: string | null;
  stage: string | null;
  buildTime: string | null;
  error: string | null;
  checkedAt: string;
}

export interface ReadinessProbe {
  status: ReadinessStatus;
  origin: string | null;
  path: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  checks: Record<string, string> | null;
  error: string | null;
  checkedAt: string;
}

export interface ProductChannelHealth {
  /** 该渠道登记的 OIDC 客户端；null = 这个渠道没有客户端，也就没有探测发生过。 */
  clientId: string | null;
  origin: string | null;
  health: LivenessProbe;
  status: ReadinessProbe;
}

export interface ProductHealthItem {
  productId: string;
  productCode: string;
  productName: string;
  layer: ProductLayer;
  state: ProductState;
  /** 至少一个渠道登记了活跃客户端。false = 目录里有、但还没做基础接入。 */
  onboarded: boolean;
  prod: ProductChannelHealth;
  beta: ProductChannelHealth;
  canary: ProductChannelHealth;
}

/** `PRODUCT_CHANNELS_SELECT` 的一行：一个产品 × 它的一个活跃客户端（或没有客户端时 client_* 全 null）。 */
export interface ProductChannelRow {
  product_id: string;
  product_code: string;
  product_name: string;
  product_type: string | null;
  product_status: string;
  client_id: string | null;
  release_channel: string | null;
  redirect_uris: string[] | null;
}

export interface ChannelClient {
  clientId: string;
  origin: string | null;
}

export interface ProductChannelGroup {
  productId: string;
  productCode: string;
  productName: string;
  productType: string | null;
  state: ProductState;
  channels: Record<ReleaseChannel, ChannelClient | null>;
}

/**
 * 主表是产品目录，不是客户端表。`c.status='active'` 放在 JOIN 条件而不是 WHERE 里：
 * 放 WHERE 会把"只有停用客户端"的产品整个筛掉，那它就从「未接入」变成了「不存在」。
 * 排序把同一产品的客户端按登记时间排好，分组时同渠道取第一个即"最早登记的"。
 */
const PRODUCT_CHANNELS_SELECT = `
select p.id as product_id, p.product_code, p.product_name, p.product_type,
       p.status as product_status,
       c.client_id, c.release_channel, c.redirect_uris
  from product.products p
  left join appoidc.oidc_clients c
    on c.product_id = p.id
   and c.client_kind = 'product'
   and c.status = 'active'
 where p.deleted_at is null
 order by p.product_code asc, c.created_at asc nulls last, c.client_id asc
`;

/** product_100_matrix.md §2 的层级判定，唯一来源 = product.products.product_type。 */
export function layerFromProductType(productType: string | null): ProductLayer {
  switch (productType) {
    case "model_platform":
    case "capability_platform":
      return "L1";
    case "data_platform":
    case "knowledge_platform":
      return "L2";
    // L3 = 行业智能体应用（矩阵 §1）；vxtpl 与 demo 智能体都是这个类型。
    case "agent":
      return "L3";
    case "client":
      return "client";
    case "external":
      return "external";
    default:
      return "unclassified";
  }
}

function isReleaseChannel(value: string | null): value is ReleaseChannel {
  return (RELEASE_CHANNELS as readonly string[]).includes(value ?? "");
}

function toProductState(status: string): ProductState {
  return status === "draft" ||
    status === "active" ||
    status === "inactive" ||
    status === "deprecated"
    ? status
    : "draft";
}

/** 把「产品 × 客户端」行集折成「产品 → 三个渠道」。纯函数，单测在 product-health.spec.ts。 */
export function groupProductChannels(
  rows: ProductChannelRow[],
): ProductChannelGroup[] {
  const byProduct = new Map<string, ProductChannelGroup>();
  for (const row of rows) {
    let group = byProduct.get(row.product_id);
    if (!group) {
      group = {
        productId: row.product_id,
        productCode: row.product_code,
        productName: row.product_name,
        productType: row.product_type,
        state: toProductState(row.product_status),
        channels: { stable: null, beta: null, canary: null },
      };
      byProduct.set(row.product_id, group);
    }
    if (!row.client_id || !isReleaseChannel(row.release_channel)) continue;
    // 同渠道多客户端：rows 已按登记时间升序，先到的留下，后来的不探。
    if (group.channels[row.release_channel]) continue;
    group.channels[row.release_channel] = {
      clientId: row.client_id,
      origin: originOf(row.redirect_uris?.[0]),
    };
  }
  return [...byProduct.values()];
}

@Controller("api/product-health")
export class ProductHealthRouter {
  constructor(@Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get()
  async listProductHealth(
    @Req() req: Request & RequestContext,
  ): Promise<ProductHealthItem[]> {
    // 无独立能力码可挂（见文件头），只要求会话存在——中间件已经在 /api/* 上挡过
    // 一轮，这里是纵深防御而非唯一防线。
    if (!req.operator) {
      throw unauthenticated("AUTH_NO_SESSION", "No active session");
    }

    const { rows } = await this.pool.query<ProductChannelRow>(
      PRODUCT_CHANNELS_SELECT,
    );
    const groups = groupProductChannels(rows);

    return Promise.all(
      groups.map(async (group) => {
        const layer = layerFromProductType(group.productType);
        const [prod, beta, canary] = await Promise.all([
          resolveChannel(layer, group.channels.stable),
          resolveChannel(layer, group.channels.beta),
          resolveChannel(layer, group.channels.canary),
        ]);
        return {
          productId: group.productId,
          productCode: group.productCode,
          productName: group.productName,
          layer,
          state: group.state,
          onboarded: RELEASE_CHANNELS.some(
            (channel) => group.channels[channel] !== null,
          ),
          prod,
          beta,
          canary,
        };
      }),
    );
  }
}

function originOf(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}

function readStringField(
  body: Record<string, unknown> | null,
  field: string,
): string | null {
  const value = body?.[field];
  return typeof value === "string" ? value : null;
}

/**
 * 逐依赖的就绪明细，拍平成「名字 → 一句话」。
 *
 * **025 标准里 `checks` 的值是对象**（`{status, latencyMs?, message?}`），不是字符串
 * ——atlas 回的是 `{"database":{"status":"pass","latencyMs":2}, …}`。此前这里只收
 * `typeof value === "string"`，于是每一项都被丢掉、`out` 空、返回 null：
 * **服务状态页的「checks」一栏对每个真正实现了 readiness 的产品都是空的**
 * （2026-08-23 联调实测：atlas 六项检查、runos 一项，一项都没显示出来）。
 * 不报错，看起来就像"这个产品没给明细"。
 *
 * 两种形状都收：字符串原样，对象取 `status`，有延迟就带上。收窄成一行字是因为
 * 调用方（服务状态页）把它渲染成 `名字 值 · 名字 值`，不做嵌套展开。
 */
export function readChecks(
  body: Record<string, unknown> | null,
): Record<string, string> | null {
  const raw = body?.checks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      if (typeof v["status"] !== "string") continue;
      const latency =
        typeof v["latencyMs"] === "number" ? ` ${v["latencyMs"]}ms` : "";
      out[key] = `${v["status"]}${latency}`;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

type PathOutcome =
  | {
      kind: "response";
      status: number;
      durationMs: number;
      body: Record<string, unknown> | null;
    }
  | { kind: "network-error"; durationMs: number; message: string };

interface PathAttempt {
  path: string;
  outcome: PathOutcome;
}

/**
 * Node 的 fetch() 失败时，顶层 `error.message` 几乎永远是没有信息量的
 * "fetch failed"（undici 的已知行为，跟失败原因无关，DNS/连接被拒/超时都是这句）
 * ——真正原因在 `error.cause` 里，不挖出来就是把这句英文字面量原样糊给用户看
 * （2026-08-12 opera 服务监控页实测抓到：不可达一律显示 "fetch failed"）。
 * `AbortSignal.timeout` 触发时是 `DOMException(name="TimeoutError")`，不带
 * cause，走单独分支。
 */
function describeNetworkError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "探测超时";
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code?: unknown }).code)
        : undefined;
    if (code === "ECONNREFUSED") return "连接被拒绝";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "域名解析失败";
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT")
      return "连接超时";
    if (code === "ECONNRESET") return "连接被重置";
    if (cause instanceof Error && cause.message) return cause.message;
    if (error.message && error.message !== "fetch failed") {
      return error.message;
    }
  }
  return "连接失败";
}

async function attemptPath(origin: string, path: string): Promise<PathAttempt> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${origin}${path}`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const durationMs = Date.now() - startedAt;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return {
      path,
      outcome: { kind: "response", status: response.status, durationMs, body },
    };
  } catch (error) {
    return {
      path,
      outcome: {
        kind: "network-error",
        durationMs: Date.now() - startedAt,
        message: describeNetworkError(error),
      },
    };
  }
}

/** 两条路径并发试；命中＝拿到非 404 响应。都 404＝约定路径不存在；都连不上＝不可达。 */
async function raceCandidatePaths(
  origin: string,
  paths: readonly string[],
): Promise<PathAttempt[]> {
  return Promise.all(paths.map((path) => attemptPath(origin, path)));
}

function maxDuration(attempts: PathAttempt[]): number | null {
  const durations = attempts.map((a) => a.outcome.durationMs);
  return durations.length > 0 ? Math.max(...durations) : null;
}

function firstErrorMessage(attempts: PathAttempt[]): string | null {
  const failed = attempts.find((a) => a.outcome.kind === "network-error");
  return failed && failed.outcome.kind === "network-error"
    ? failed.outcome.message
    : null;
}

function pickHit(attempts: PathAttempt[]): {
  path: string;
  status: number;
  durationMs: number;
  body: Record<string, unknown> | null;
} | null {
  // 按路径声明序取第一个非 404 响应，而不是"谁先到"——确定性优先于速度：同一
  // 组探测结果每次跑都该一样，不该因为网络抖动改变命中哪条路径。
  for (const attempt of attempts) {
    if (attempt.outcome.kind === "response" && attempt.outcome.status !== 404) {
      return { path: attempt.path, ...attempt.outcome };
    }
  }
  return null;
}

function allNotFound(attempts: PathAttempt[]): boolean {
  return (
    attempts.length > 0 &&
    attempts.every(
      (a) => a.outcome.kind === "response" && a.outcome.status === 404,
    )
  );
}

const NOW = () => new Date().toISOString();

async function probeLiveness(origin: string | null): Promise<LivenessProbe> {
  const checkedAt = NOW();
  if (!origin) {
    return {
      status: "not_configured",
      origin: null,
      path: null,
      httpStatus: null,
      durationMs: null,
      service: null,
      version: null,
      gitSha: null,
      stage: null,
      buildTime: null,
      error: null,
      checkedAt,
    };
  }

  const attempts = await raceCandidatePaths(origin, LIVENESS_PATHS);
  const hit = pickHit(attempts);
  if (hit) {
    return {
      status: hit.status >= 200 && hit.status < 300 ? "healthy" : "unhealthy",
      origin,
      path: hit.path,
      httpStatus: hit.status,
      durationMs: hit.durationMs,
      service: readStringField(hit.body, "service"),
      version: readStringField(hit.body, "version"),
      gitSha: readStringField(hit.body, "gitSha"),
      stage: readStringField(hit.body, "stage"),
      buildTime: readStringField(hit.body, "buildTime"),
      error: null,
      checkedAt,
    };
  }

  // liveness 不是可选项（025 标准）——两条约定路径都 404 本身就是个缺陷，不是
  // "没实现"，按异常上报。
  if (allNotFound(attempts)) {
    return {
      status: "unhealthy",
      origin,
      path: null,
      httpStatus: 404,
      durationMs: maxDuration(attempts),
      service: null,
      version: null,
      gitSha: null,
      stage: null,
      buildTime: null,
      error: `liveness 未命中已知路径（${LIVENESS_PATHS.join(" / ")} 均 404）`,
      checkedAt,
    };
  }

  return {
    status: "unreachable",
    origin,
    path: null,
    httpStatus: null,
    durationMs: maxDuration(attempts),
    service: null,
    version: null,
    gitSha: null,
    stage: null,
    buildTime: null,
    error: firstErrorMessage(attempts) ?? "探测失败",
    checkedAt,
  };
}

/**
 * 把产品自报的 readiness 词翻成本页的三档。
 *
 * **025 标准的词表是 `ready` / `degraded` / `blocked`**，不是 `fail`——atlas 与 runos
 * 都按标准回 `blocked`（各自 `health.service.ts` 的 `ReadinessStatus`）。此前这里只认
 * `ready|degraded|fail`，`blocked` 落到 HTTP 状态码的兜底分支上，于是：
 *
 *   runos  blocked 时把响应置成 503 → 兜底判成 `fail`，凑巧对了
 *   atlas  `/readyz` **恒回 200**（handler 不改状态码）→ 兜底判成 **`ready`**
 *
 * 也就是说 atlas 数据库不可用时，服务状态页会把它显示成「就绪」。这是这一版最不能留
 * 的一种错：页面全绿而系统是坏的，比读不出来更糟。
 *
 * `fail` 继续认，因为它是本页对外的档位名，也可能有产品照着这个页面回；HTTP 状态码
 * 兜底保留给不按标准回话的产品——但**只在没有可辨认的自报状态时**才用它。
 */
export function readinessFromBody(
  bodyStatus: string | null,
  httpStatus: number,
): ReadinessStatus {
  if (bodyStatus === "ready" || bodyStatus === "degraded") return bodyStatus;
  if (bodyStatus === "blocked" || bodyStatus === "fail") return "fail";
  return httpStatus >= 200 && httpStatus < 300 ? "ready" : "fail";
}

async function probeReadiness(origin: string | null): Promise<ReadinessProbe> {
  const checkedAt = NOW();
  if (!origin) {
    return {
      status: "not_configured",
      origin: null,
      path: null,
      httpStatus: null,
      durationMs: null,
      checks: null,
      error: null,
      checkedAt,
    };
  }

  const attempts = await raceCandidatePaths(origin, READINESS_PATHS);
  const hit = pickHit(attempts);
  if (hit) {
    const status = readinessFromBody(
      readStringField(hit.body, "status"),
      hit.status,
    );
    return {
      status,
      origin,
      path: hit.path,
      httpStatus: hit.status,
      durationMs: hit.durationMs,
      checks: readChecks(hit.body),
      error: null,
      checkedAt,
    };
  }

  // readiness 是可选端点（025 标准 §2）——两条约定路径都 404，最可能是这个产品
  // 压根没实现它，不是"故障"。
  if (allNotFound(attempts)) {
    return {
      status: "not_implemented",
      origin,
      path: null,
      httpStatus: 404,
      durationMs: maxDuration(attempts),
      checks: null,
      error: null,
      checkedAt,
    };
  }

  return {
    status: "unreachable",
    origin,
    path: null,
    httpStatus: null,
    durationMs: maxDuration(attempts),
    checks: null,
    error: firstErrorMessage(attempts) ?? "探测失败",
    checkedAt,
  };
}

/** 一个渠道 = 一个客户端的 origin；没有客户端就没有探测这回事（两列都是 not_configured）。 */
export type ChannelProbeMode = "probe" | "not_applicable";

/**
 * Whether a registered channel gets probed. Pure: unit-tested in
 * product-health.spec.ts. Only `client` products with a registered channel are
 * exempt — an unregistered channel stays `not_configured` regardless of layer,
 * because "not registered" is a different fact from "nothing to probe".
 */
export function channelProbeMode(
  layer: ProductLayer,
  channel: ChannelClient | null,
): ChannelProbeMode {
  return channel && layer === "client" ? "not_applicable" : "probe";
}

/** A registered channel on a client product: nothing to probe, no network call. */
export function notApplicableChannel(
  channel: ChannelClient,
): ProductChannelHealth {
  const checkedAt = NOW();
  const origin = channel.origin;
  return {
    clientId: channel.clientId,
    origin,
    health: {
      status: "not_applicable",
      origin,
      path: null,
      httpStatus: null,
      durationMs: null,
      service: null,
      version: null,
      gitSha: null,
      stage: null,
      buildTime: null,
      error: null,
      checkedAt,
    },
    status: {
      status: "not_applicable",
      origin,
      path: null,
      httpStatus: null,
      durationMs: null,
      checks: null,
      error: null,
      checkedAt,
    },
  };
}

async function resolveChannel(
  layer: ProductLayer,
  channel: ChannelClient | null,
): Promise<ProductChannelHealth> {
  if (channel && channelProbeMode(layer, channel) === "not_applicable") {
    return notApplicableChannel(channel);
  }
  return probeChannel(channel);
}

async function probeChannel(
  channel: ChannelClient | null,
): Promise<ProductChannelHealth> {
  const origin = channel?.origin ?? null;
  const [health, status] = await Promise.all([
    probeLiveness(origin),
    probeReadiness(origin),
  ]);
  return { clientId: channel?.clientId ?? null, origin, health, status };
}
