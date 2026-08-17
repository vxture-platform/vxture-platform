/**
 * product-health.router.ts — 接入产品的 prod/beta 存活 + 就绪探测。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 自 admin 的「服务监控」迁入（2026-08-11）。**不是同一个功能，只是同一个入口位**：
 * admin 那份探的是本地 dev-panel（:8090），从未连过生产——
 * docs/20-specs/000-platform/admin/20-admin-platform-refinement-plan.md 把它登记在
 * P4「service-monitor 生产遥测源（Q6 维持 dev-only）」，之前两次迁移都刻意跳过它
 * （49d60f2 的原话："moving it would relocate emptiness"）。这次换了数据源和语义：
 * 探的不是平台自己的门户/BFF，是**接入平台的产品线**——每个产品的 prod 与 beta 是否
 * 存活（owner 口径 2026-08-11，已建档：
 * `docs/20-specs/000-platform/opera/20-service-monitor.md` §2）。
 *
 * 数据源单一权威 = appoidc.oidc_clients LEFT JOIN product.products，不是另起一份
 * 硬编码清单：origin 就是各产品登记的 OIDC 回调地址去掉路径，与 seed 侧同一份数据
 * （deploy/database/seed/seed-catalog.mjs 的 `appUris()`）。LEFT JOIN 而不是 JOIN——
 * ontos/raven/anlan/forge/xuanzhen 五个产品已注册 OIDC 客户端，但 product.products
 * 还没有它们的目录行（产品定义待建，见 product_100_matrix.md），INNER JOIN 会把这
 * 五个直接丢掉；这里退而求其次，用客户端自己的 name/display_name 顶上，分组键改用
 * "product_id 或裸 client_id 去 -beta 后缀"。
 *
 * 两种 prod/beta 建模并存（seed 历史遗留，两种都要认）：
 *   多数产品（runos/atlas/ontos/raven/anlan/forge/xuanzhen/ruyin）——同一个 client_id，
 *   redirect_uris = [prod 回调, beta 回调?]（`appUris()` 固定序，prod 在前，beta 未
 *   配置时数组长度为 1）。
 *   arda/karda —— 两个独立 client_id（如 `arda` / `arda-beta`），后者
 *   release_channel='beta'。
 *
 * 每个 origin 探两类端点——**划分与路径约定归 025 标准 §2**，不在这里另立规矩；
 * owner 口径说的"health、status"指的就是这两类（对应 UI 的存活/就绪两列，不是要求
 * 产品必须用 /status 这个路径名）。详见 20-service-monitor.md §3：
 *   health＝liveness——只证明进程在听，不代表能否对外服务。
 *   status＝readiness——依赖项是否就绪，能否真正服务；返回 `checks` 明细。
 * 025 标准把 readiness 列为可选，目前全仓零产品真正接上，所以 status 列大概率显示
 * "未实现"——这是诚实的现状，不是探测逻辑的缺陷。
 * 每类端点两种运行时路径约定都试（Next 前端 `/api/health`+`/api/ready`、Nest 后端
 * `/healthz`+`/readyz`），两条并发探，先拿到的非 404 响应视为命中；两条都 404 记
 * "未实现"（readiness）或"异常"（liveness——它不是可选项）；两条都连不上记"不可达"。
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

export type LivenessStatus =
  | "healthy"
  | "unhealthy"
  | "unreachable"
  | "not_configured";
export type ReadinessStatus =
  | "ready"
  | "degraded"
  | "fail"
  | "not_implemented"
  | "unreachable"
  | "not_configured";

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
  origin: string | null;
  health: LivenessProbe;
  status: ReadinessProbe;
}

export interface ProductHealthItem {
  productId: string;
  productCode: string;
  productName: string;
  layer: ProductLayer;
  prod: ProductChannelHealth;
  beta: ProductChannelHealth;
}

interface OidcClientRow {
  client_id: string;
  product_id: string | null;
  release_channel: string;
  redirect_uris: string[];
  status: string;
  name: string | null;
  display_name: string | null;
  product_code: string | null;
  product_name: string | null;
  product_type: string | null;
}

interface ProductGroup {
  groupKey: string;
  productId: string | null;
  productCode: string;
  productName: string;
  productType: string | null;
  prodOrigin: string | null;
  betaOrigin: string | null;
}

// product_id 非空＝已在 product.products 建目录行的产品；ontos/raven/anlan/forge/
// xuanzhen 五个已注册 OIDC 客户端但目录行还没建（产品定义待建，见
// product_100_matrix.md），product_id 恒为 NULL、天然会被 "product_id is not null"
// 挡在外面——这个允许名单就是那五个的显式豁免，跟下面 LAYER_FALLBACK_BY_CODE
// 共用同一份 key，不是两套并行口径。哪天某个 code 有了真目录行，从这里删掉它，
// `product_id is not null` 会自动接住，行为不变。
const PENDING_CATALOG_CLIENT_IDS = [
  "ontos",
  "raven",
  "anlan",
  "forge",
  "xuanzhen",
] as const;

const PRODUCT_CLIENTS_SELECT = `
select c.client_id, c.product_id, c.release_channel, c.redirect_uris, c.status,
       c.name, c.display_name,
       p.product_code, p.product_name, p.product_type
from appoidc.oidc_clients c
left join product.products p on p.id = c.product_id
where c.status = 'active'
  and (p.deleted_at is null or p.id is null)
  and (c.product_id is not null or c.client_id = any($1::varchar[]))
`;

// product_100_matrix.md §2 的层级判定，权威来源 = product.products.product_type。
function layerFromProductType(productType: string | null): ProductLayer | null {
  switch (productType) {
    case "model_platform":
    case "capability_platform":
      return "L1";
    case "data_platform":
    case "knowledge_platform":
      return "L2";
    case "client":
      return "client";
    case "external":
      return "external";
    default:
      return null;
  }
}

// 上面 PENDING_CATALOG_CLIENT_IDS 那五个的层级，同一份 matrix 文档判定，只是数据
// 还没落库——这里是文档到字段的临时占位，不是新开一套分类口径。
const LAYER_FALLBACK_BY_CODE: Readonly<Record<string, ProductLayer>> = {
  ontos: "L2",
  raven: "L3",
  anlan: "L3",
  forge: "L3",
  xuanzhen: "L3",
};

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

    const { rows } = await this.pool.query<OidcClientRow>(
      PRODUCT_CLIENTS_SELECT,
      [PENDING_CATALOG_CLIENT_IDS as unknown as string[]],
    );
    const groups = groupByProduct(rows).sort((a, b) =>
      a.productCode.localeCompare(b.productCode),
    );

    return Promise.all(
      groups.map(async (group) => {
        const [prod, beta] = await Promise.all([
          probeChannel(group.prodOrigin),
          probeChannel(group.betaOrigin),
        ]);
        const layer =
          layerFromProductType(group.productType) ??
          LAYER_FALLBACK_BY_CODE[group.productCode] ??
          "unclassified";
        return {
          productId: group.productId ?? group.groupKey,
          productCode: group.productCode,
          productName: group.productName,
          layer,
          prod,
          beta,
        };
      }),
    );
  }
}

/** `arda-beta` → `arda`；已经是裸码的原样返回。 */
function baseClientId(clientId: string): string {
  return clientId.endsWith("-beta")
    ? clientId.slice(0, -"-beta".length)
    : clientId.endsWith("-canary")
      ? clientId.slice(0, -"-canary".length)
      : clientId;
}

function groupByProduct(rows: OidcClientRow[]): ProductGroup[] {
  const byGroup = new Map<string, OidcClientRow[]>();
  for (const row of rows) {
    const key = row.product_id ?? `client:${baseClientId(row.client_id)}`;
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }

  const groups: ProductGroup[] = [];
  for (const [groupKey, clientRows] of byGroup) {
    const betaRow = clientRows.find(
      (r) => r.release_channel === "beta" || r.client_id.endsWith("-beta"),
    );
    const stableRow = clientRows.find((r) => r !== betaRow) ?? clientRows[0];
    if (!stableRow) continue;

    const prodOrigin = originOf(stableRow.redirect_uris?.[0]);
    const betaOrigin = betaRow
      ? originOf(betaRow.redirect_uris?.[0])
      : originOf(stableRow.redirect_uris?.[1]);

    const code = stableRow.product_code ?? baseClientId(stableRow.client_id);
    const name =
      stableRow.product_name ??
      stableRow.display_name ??
      stableRow.name ??
      code;

    groups.push({
      groupKey,
      productId: stableRow.product_id,
      productCode: code,
      productName: name,
      productType: stableRow.product_type,
      prodOrigin,
      betaOrigin,
    });
  }
  return groups;
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

function readChecks(
  body: Record<string, unknown> | null,
): Record<string, string> | null {
  const raw = body?.checks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
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
    const bodyStatus = readStringField(hit.body, "status");
    const status: ReadinessStatus =
      bodyStatus === "ready" ||
      bodyStatus === "degraded" ||
      bodyStatus === "fail"
        ? bodyStatus
        : hit.status >= 200 && hit.status < 300
          ? "ready"
          : "fail";
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
  // 压根没实现它，不是"故障"。全仓目前零产品真正接上，所以这条大概率总是命中。
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

async function probeChannel(
  origin: string | null,
): Promise<ProductChannelHealth> {
  const [health, status] = await Promise.all([
    probeLiveness(origin),
    probeReadiness(origin),
  ]);
  return { origin, health, status };
}
