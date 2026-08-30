/**
 * upstream-grants.ts — atlas / runos 两个上游的调用底座，以及「某产品在上游还有
 * 哪些生效中的授权」这一次读。
 * @package @vxture/bff-opera
 * @layer BFF
 * @category Lib
 * @author AI-Generated
 * @date 2026-08-31
 *
 * ── 为什么从两个 router 里抽出来 ─────────────────────────────────────────────
 *
 * `atlas.router.ts` 的 `atlasRequest()` 与 `runos.router.ts` 的 `runosRequest()`
 * 此前是两份逐行相同的代码（fetch → 连接层失败 502 → 非 2xx 按上游状态码透传 →
 * 空体回 undefined），只差三个字面量：换票 audience、不可达时的错误码、默认基址。
 * 两个 router 各自的 `request()` 也一样——都是「拿 operator 会话换一枚 aud=<上游>
 * 的短时令牌，带上去」（product_250 M-1：外壳永远不以自己的身份打上游管理面）。
 *
 * 2026-08-31 产品退役闸门（owner 优先级 #1）需要**第三个**调用点——产品目录
 * router 在写 `deprecated` 之前要问两个上游「这个产品还有没有生效中的授权」。
 * 再抄一份 OBO 代码等于把同一段逻辑养在三处；于是把底座收到这里，三个 router
 * 用同一份。行为一行不变：错误码、状态码透传、`onStatus` 回传口全部保留。
 *
 * ── 这里不做什么 ────────────────────────────────────────────────────────────
 *
 * 不做出口契约校验（`assertAtlasContract` / `assertRunosContract`）——那是各 router
 * 按资源声明的，留在调用点。不做审计留痕（`recordProxyWrite`）——本文件只有读。
 *
 * 门户不得直接引用本文件（依赖方向：portals → bff 只走 HTTP）。
 */

import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import { upstreamUnavailable } from "../errors/api-error";
import type { RequestContext } from "../types/request-context";

export type JsonObject = Record<string, unknown>;
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** 两个上游。键就是换票时的 audience（对齐 product_100 的产品码）。 */
export type UpstreamName = "atlas" | "runos";

interface UpstreamProfile {
  /** 人看的名字，进错误文案。 */
  label: string;
  /** 连接层失败（进程没应答）时的错误码——与「上游回了个错」不是一回事。 */
  unavailableCode: string;
  /** 上游回了非 2xx 但响应体不带 code 时的兜底码。 */
  failedCode: string;
  /** 只在没传 baseUrl 时用；生产由 `VxConfigService.platform.*_API_URL` 给。 */
  defaultBaseUrl: string;
}

export const UPSTREAMS: Readonly<Record<UpstreamName, UpstreamProfile>> = {
  atlas: {
    label: "Atlas",
    unavailableCode: "ATLAS_UNAVAILABLE",
    failedCode: "ATLAS_REQUEST_FAILED",
    defaultBaseUrl: "http://localhost:3100",
  },
  runos: {
    label: "Runos",
    unavailableCode: "RUNOS_UNAVAILABLE",
    failedCode: "RUNOS_REQUEST_FAILED",
    defaultBaseUrl: "http://localhost:3120",
  },
};

interface UpstreamErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

export interface UpstreamRequestOptions {
  method?: HttpMethod;
  body?: JsonObject;
  bearer?: string;
}

/**
 * 一次裸的上游调用。与此前两份 `atlasRequest` / `runosRequest` 逐行等价：
 *   - fetch 抛错（连不上）→ 502 `<UPSTREAM>_UNAVAILABLE`，`retryable: true`
 *   - 非 2xx → 按上游状态码原样透传，响应体里的 code 不覆盖
 *   - 空体 → undefined
 *
 * @param onStatus 上游成功状态码的回传口。只有真正区分 200/201 的路由才传它
 *   （哪些算、为什么不是全部，见 `RunosRouter.request()` 的注释）。
 */
export async function upstreamRequest<TResponse>(
  upstream: UpstreamName,
  path: string,
  options: UpstreamRequestOptions = {},
  baseUrl: string = UPSTREAMS[upstream].defaultBaseUrl,
  onStatus?: (status: number) => void,
): Promise<TResponse> {
  const profile = UPSTREAMS[upstream];
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
    throw upstreamUnavailable(
      profile.unavailableCode,
      `${profile.label} is unavailable`,
    );
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new HttpException(
      parseUpstreamError(profile, responseText, response.status),
      response.status,
    );
  }

  onStatus?.(response.status);

  if (!responseText.trim()) {
    return undefined as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function parseUpstreamError(
  profile: UpstreamProfile,
  responseText: string,
  status: number,
): UpstreamErrorBody {
  if (!responseText.trim()) {
    return {
      code: profile.failedCode,
      message: `${profile.label} request failed with status ${status}`,
      statusCode: status,
    };
  }
  try {
    const parsed = JSON.parse(responseText) as UpstreamErrorBody;
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return { ...parsed, statusCode: parsed.statusCode ?? status };
    }
    return {
      code: profile.failedCode,
      message: `${profile.label} request failed with status ${status}`,
      statusCode: status,
      details: parsed,
    };
  } catch {
    return {
      code: profile.failedCode,
      message: responseText,
      statusCode: status,
    };
  }
}

/**
 * operator-OBO：拿当前 RP 会话的 access token 换一枚 aud=<上游> 的短时令牌。
 * 没有会话令牌时回 null（上游那头会以自己的 401 表达）；换票失败同样回 null，
 * 由 `OperatorExchangeService` 记 warn——这两条降级都是它此前在两个 router 里
 * 的原有行为，这里只是搬。
 */
export async function operatorBearer(
  operatorExchange: OperatorExchangeService,
  req: Request & RequestContext,
  upstream: UpstreamName,
): Promise<string | null> {
  return req.operatorAccessToken
    ? operatorExchange.getToken(req.operatorAccessToken, upstream)
    : null;
}

/** 一个 router 打某个上游需要的两样东西。 */
export interface UpstreamDeps {
  operatorExchange: OperatorExchangeService;
  /** 已去掉尾部斜杠的基址。 */
  baseUrl: string;
}

/**
 * 代操作者打一次上游 = 换票 + `upstreamRequest`。三个 router 的 `request()`
 * 都落到这里。
 */
export async function operatorRequest<TResponse>(
  deps: UpstreamDeps,
  upstream: UpstreamName,
  req: Request & RequestContext,
  path: string,
  options: UpstreamRequestOptions = {},
  onStatus?: (status: number) => void,
): Promise<TResponse> {
  const bearer = await operatorBearer(deps.operatorExchange, req, upstream);
  return upstreamRequest<TResponse>(
    upstream,
    path,
    { ...options, ...(bearer ? { bearer } : {}) },
    deps.baseUrl,
    onStatus,
  );
}

// ── 某产品在上游的生效授权（产品退役闸门用）──────────────────────────────────

/** 409 明细里每边最多带几条样本。数字进 `count`，样本只是让人一眼知道是哪几条。 */
export const GRANT_SAMPLE_LIMIT = 5;

/** Atlas `product_endpoint_grants` 一行里闸门关心的字段。 */
export interface AtlasGrantSample {
  id: string;
  endpointCode: string;
  expiresAt: string | null;
}

/** Runos `capability_grant` 一行里闸门关心的字段。 */
export interface RunosGrantSample {
  grantId: string;
  capabilityId: string;
  /** direct / derived。派生行撤不掉，得撤它的锚点——文案要区分。 */
  grantType: string;
}

export interface ActiveUpstreamGrants {
  productCode: string;
  atlas: { count: number; sample: AtlasGrantSample[] };
  runos: { count: number; sample: RunosGrantSample[] };
}

export interface UpstreamGrantsDeps {
  operatorExchange: OperatorExchangeService;
  atlasApiUrl: string;
  runosApiUrl: string;
}

/**
 * 「这个产品在两个上游还有没有生效中的授权」——一次读，两边并发。
 *
 * 用的两条查询（也是 `upstream-grants.spec.ts` 钉住的形状）：
 *   Atlas  GET /capability/product-endpoint-grants?productCode=<code>&includeInactive=false
 *   Runos  GET /commerce/capability-grants?subjectType=product&subjectRef=<code>
 *
 * 两边都只回 `state="active"` 的行（Atlas 由 `includeInactive=false` 过滤；Runos 的
 * 单主体读本来就是 `listActiveForSubject`，direct ∪ derived 全集）。这里仍按
 * `state === "active"` 再筛一遍——不是兜底，是把「什么叫生效」这个判据写在离决定
 * 最近的地方：上游哪天把过滤参数改了语义，闸门的口径不跟着漂。
 *
 * **到期不算例外**：Atlas 一条 `state=active` 但 `expiresAt` 已过的授权仍算生效
 * 行——它不再放行，但它仍是一条挂在这个产品码上的活跃记录，退役前该被停用而不是
 * 被遗忘。闸门宁可多拦一次（停用一条过期授权是一次点击），不替人决定「过期的
 * 不用管」。
 *
 * **任何一边读不到就抛 502 `UPSTREAM_UNAVAILABLE`**（fail closed）：连不上、上游
 * 回错（含 401/403——操作者的 OBO 令牌打不开那个上游）、响应形状不对，都算「没
 * 查到」。退役要求这个检查，查不到不等于没有。哪一边坏了写在 `upstream` 字段，
 * 上游自己的码带在 `cause` 里，让人知道该去看谁。
 */
export async function fetchActiveUpstreamGrants(
  deps: UpstreamGrantsDeps,
  req: Request & RequestContext,
  productCode: string,
): Promise<ActiveUpstreamGrants> {
  const code = encodeURIComponent(productCode);
  const [atlasRows, runosRows] = await Promise.all([
    guarded("atlas", () =>
      operatorRequest<Record<string, unknown>[]>(
        { operatorExchange: deps.operatorExchange, baseUrl: deps.atlasApiUrl },
        "atlas",
        req,
        `/capability/product-endpoint-grants?productCode=${code}&includeInactive=false`,
      ),
    ),
    guarded("runos", () =>
      operatorRequest<Record<string, unknown>[]>(
        { operatorExchange: deps.operatorExchange, baseUrl: deps.runosApiUrl },
        "runos",
        req,
        `/commerce/capability-grants?subjectType=product&subjectRef=${code}`,
      ),
    ),
  ]);

  const atlasActive = atlasRows.filter((r) => r["state"] === "active");
  const runosActive = runosRows.filter((r) => r["state"] === "active");

  return {
    productCode,
    atlas: {
      count: atlasActive.length,
      sample: atlasActive.slice(0, GRANT_SAMPLE_LIMIT).map((r) => ({
        id: str(r["id"]),
        endpointCode: str(r["endpointCode"]),
        expiresAt: typeof r["expiresAt"] === "string" ? r["expiresAt"] : null,
      })),
    },
    runos: {
      count: runosActive.length,
      sample: runosActive.slice(0, GRANT_SAMPLE_LIMIT).map((r) => ({
        grantId: str(r["grantId"]),
        capabilityId: str(r["capabilityId"]),
        grantType: str(r["grantType"]),
      })),
    },
  };
}

/**
 * 把一边的任何失败收成同一个 502。上游自己的错误（比如它回了 403）**不原样透传**：
 * 透传会让调用方看到一个 403，以为是自己没权限退役产品，而真实情况是「检查没做成」。
 * 上游的码留在 `cause` 里，不丢。
 */
async function guarded<T>(
  upstream: UpstreamName,
  call: () => Promise<T>,
): Promise<T> {
  let rows: T;
  try {
    rows = await call();
  } catch (error) {
    throw upstreamCheckUnavailable(upstream, error);
  }
  if (!Array.isArray(rows)) {
    throw upstreamCheckUnavailable(
      upstream,
      new Error(`${UPSTREAMS[upstream].label} 返回的不是数组`),
    );
  }
  return rows;
}

/**
 * 502 `UPSTREAM_UNAVAILABLE`，带 `upstream` 与 `cause`。
 *
 * 不走 `upstreamUnavailable()` 帮手：封套四件套装不下「哪一边、为什么」，而这两样
 * 正是运营者接下来要看的。`AllExceptionsFilter` 对自带 `code` 的响应体会把额外
 * 字段原样带出去（它为 atlas 的 `blockedBy` 留的那条通路），这里用的正是它。
 */
export function upstreamCheckUnavailable(
  upstream: UpstreamName,
  error: unknown,
): HttpException {
  const cause = causeOf(error);
  return new HttpException(
    {
      code: "UPSTREAM_UNAVAILABLE",
      message: `${UPSTREAMS[upstream].label} 的授权没有查到（${cause.code}）——退役要求先确认上游没有生效中的授权，这次没有执行。`,
      retryable: true,
      statusCode: HttpStatus.BAD_GATEWAY,
      upstream,
      cause,
    },
    HttpStatus.BAD_GATEWAY,
  );
}

function causeOf(error: unknown): { code: string; statusCode: number | null } {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const code =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { code?: unknown }).code === "string"
        ? (body as { code: string }).code
        : "UPSTREAM_REQUEST_FAILED";
    return { code, statusCode: error.getStatus() };
  }
  return { code: "UPSTREAM_REQUEST_FAILED", statusCode: null };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}
