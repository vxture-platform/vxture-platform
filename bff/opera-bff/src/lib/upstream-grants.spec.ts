/**
 * upstream-grants.spec.ts —— 退役闸门那一次上游读的形状（2026-08-31）。
 *
 * 钉四件 tsc 看不见的事：
 *   1. 两条上游查询的**确切形状**（路径、过滤参数、按 audience 换票后的 bearer）。
 *      闸门的正确性全押在这两条 URL 上——参数名写错一个字母，上游回 400，闸门就
 *      永远 502；参数语义漂了（比如 includeInactive 默认值反转），闸门就永远放行。
 *   2. 只数 `state="active"`：上游多回一条 inactive 不能把产品拦住。
 *   3. fail closed：任何一边连不上、回错、回的不是数组，都是 502
 *      `UPSTREAM_UNAVAILABLE` 并点名是哪一边——**不是**把上游的 403 原样透传。
 *   4. `upstreamRequest` 与被它替掉的两份 `atlasRequest` / `runosRequest` 行为一致：
 *      非 2xx 按上游状态码透传且不覆盖上游的 code；空体回 undefined；`onStatus`
 *      只在成功时回传。
 */
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";
import {
  fetchActiveUpstreamGrants,
  upstreamCheckUnavailable,
  upstreamRequest,
} from "./upstream-grants";

const OPERATOR_TOKEN = "operator-access-token";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["platform:product.manage"],
    operatorAccessToken: OPERATOR_TOKEN,
  } as unknown as Request & RequestContext;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 按 audience 发不同的令牌，这样能验证「打 atlas 用的是 atlas 的票」。 */
function makeDeps() {
  const getToken = vi.fn(async (_subject: string, audience: string) =>
    audience === "atlas" ? "obo-atlas" : "obo-runos",
  );
  return {
    deps: {
      operatorExchange: { getToken } as unknown as OperatorExchangeService,
      atlasApiUrl: "http://atlas.test",
      runosApiUrl: "http://runos.test",
    },
    getToken,
  };
}

const ATLAS_ACTIVE = {
  id: "0f5b2d1a-1111-4aaa-8bbb-000000000001",
  productCode: "karda",
  endpointCode: "chat/default",
  state: "active",
  expiresAt: null,
};
const ATLAS_INACTIVE = { ...ATLAS_ACTIVE, id: "…-2", state: "inactive" };
const RUNOS_DIRECT = {
  grantId: "g-1",
  subjectType: "product",
  subjectRef: "karda",
  capabilityId: "arda.invoice-query",
  grantType: "direct",
  state: "active",
};
const RUNOS_DERIVED = {
  ...RUNOS_DIRECT,
  grantId: "g-2",
  capabilityId: "arda.invoice-read",
  grantType: "derived",
};

function envelope(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

describe("fetchActiveUpstreamGrants —— 两条上游查询的形状", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function routeByHost(handlers: {
    atlas: () => Response | Promise<Response>;
    runos: () => Response | Promise<Response>;
  }) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://atlas.test")) return handlers.atlas();
      if (url.startsWith("http://runos.test")) return handlers.runos();
      throw new Error(`unexpected url ${url}`);
    });
  }

  function calledUrls(): string[] {
    return fetchMock.mock.calls.map(([input]) => String(input));
  }

  function bearerOf(url: string): string | undefined {
    const call = fetchMock.mock.calls.find(([input]) => String(input) === url);
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    return headers["authorization"];
  }

  it("Atlas 按 productCode 只取生效行；Runos 按 subjectType=product&subjectRef 取单主体；各用各的票", async () => {
    const { deps, getToken } = makeDeps();
    routeByHost({
      atlas: () => jsonResponse([ATLAS_ACTIVE]),
      runos: () => jsonResponse([RUNOS_DIRECT, RUNOS_DERIVED]),
    });

    const result = await fetchActiveUpstreamGrants(deps, makeReq(), "karda");

    const atlasUrl =
      "http://atlas.test/capability/product-endpoint-grants?productCode=karda&includeInactive=false";
    const runosUrl =
      "http://runos.test/commerce/capability-grants?subjectType=product&subjectRef=karda";
    expect(calledUrls().sort()).toEqual([atlasUrl, runosUrl].sort());
    expect(bearerOf(atlasUrl)).toBe("Bearer obo-atlas");
    expect(bearerOf(runosUrl)).toBe("Bearer obo-runos");
    expect(getToken.mock.calls.map(([, aud]) => aud).sort()).toEqual([
      "atlas",
      "runos",
    ]);

    expect(result.productCode).toBe("karda");
    expect(result.atlas.count).toBe(1);
    expect(result.atlas.sample).toEqual([
      {
        id: ATLAS_ACTIVE.id,
        endpointCode: "chat/default",
        expiresAt: null,
      },
    ]);
    expect(result.runos.count).toBe(2);
    expect(result.runos.sample.map((s) => s.grantType)).toEqual([
      "direct",
      "derived",
    ]);
  });

  it("产品码进 URL 前要编码——带斜杠或空格的码不能把路径拆散", async () => {
    const { deps } = makeDeps();
    routeByHost({
      atlas: () => jsonResponse([]),
      runos: () => jsonResponse([]),
    });
    await fetchActiveUpstreamGrants(deps, makeReq(), "demo product/x");
    expect(calledUrls().some((u) => u.includes("demo%20product%2Fx"))).toBe(
      true,
    );
  });

  it("只数 state=active：上游多回一条 inactive 不算生效", async () => {
    const { deps } = makeDeps();
    routeByHost({
      atlas: () => jsonResponse([ATLAS_INACTIVE]),
      runos: () => jsonResponse([{ ...RUNOS_DIRECT, state: "revoked" }]),
    });
    const result = await fetchActiveUpstreamGrants(deps, makeReq(), "karda");
    expect(result.atlas.count).toBe(0);
    expect(result.runos.count).toBe(0);
  });

  it("Atlas 连不上 → 502 UPSTREAM_UNAVAILABLE，点名 atlas，cause 带 ATLAS_UNAVAILABLE", async () => {
    const { deps } = makeDeps();
    routeByHost({
      atlas: () => Promise.reject(new TypeError("fetch failed")),
      runos: () => jsonResponse([]),
    });
    const body = await fetchActiveUpstreamGrants(deps, makeReq(), "karda").then(
      () => null,
      (e: unknown) => envelope(e),
    );
    expect(body?.["statusCode"]).toBe(502);
    expect(body?.["code"]).toBe("UPSTREAM_UNAVAILABLE");
    expect(body?.["upstream"]).toBe("atlas");
    expect(body?.["cause"]).toEqual({
      code: "ATLAS_UNAVAILABLE",
      statusCode: 502,
    });
    expect(body?.["retryable"]).toBe(true);
  });

  it("Runos 回 403 → 仍是 502（不把上游的 403 透传成「你没权限退役」），cause 保留上游的码", async () => {
    const { deps } = makeDeps();
    routeByHost({
      atlas: () => jsonResponse([]),
      runos: () =>
        jsonResponse(
          { code: "OPERATOR_TOKEN_MISSING", message: "no operator" },
          403,
        ),
    });
    const body = await fetchActiveUpstreamGrants(deps, makeReq(), "karda").then(
      () => null,
      (e: unknown) => envelope(e),
    );
    expect(body?.["statusCode"]).toBe(502);
    expect(body?.["upstream"]).toBe("runos");
    expect(body?.["cause"]).toEqual({
      code: "OPERATOR_TOKEN_MISSING",
      statusCode: 403,
    });
  });

  it("上游回的不是数组 → 502（形状不对等于没查到，不当成「没有授权」）", async () => {
    const { deps } = makeDeps();
    routeByHost({
      atlas: () => jsonResponse({ items: [] }),
      runos: () => jsonResponse([]),
    });
    const body = await fetchActiveUpstreamGrants(deps, makeReq(), "karda").then(
      () => null,
      (e: unknown) => envelope(e),
    );
    expect(body?.["code"]).toBe("UPSTREAM_UNAVAILABLE");
    expect(body?.["upstream"]).toBe("atlas");
  });
});

describe("upstreamRequest —— 与被替掉的 atlasRequest / runosRequest 行为一致", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("非 2xx 按上游状态码透传，上游的 code 不被覆盖", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: "MODEL_ADMIN_HAS_DEPENDENTS", message: "x" }, 409),
    );
    const error = await upstreamRequest("atlas", "/capability/models/1").then(
      () => null,
      (e: unknown) => e as HttpException,
    );
    expect(error?.getStatus()).toBe(409);
    expect((error?.getResponse() as { code: string }).code).toBe(
      "MODEL_ADMIN_HAS_DEPENDENTS",
    );
  });

  it("非 2xx 且响应体不带 code → 各上游自己的兜底码", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const error = await upstreamRequest("runos", "/x").then(
      () => null,
      (e: unknown) => e as HttpException,
    );
    expect((error?.getResponse() as { code: string }).code).toBe(
      "RUNOS_REQUEST_FAILED",
    );
  });

  it("空体回 undefined；onStatus 只在成功时回传上游状态码", async () => {
    const onStatus = vi.fn();
    fetchMock.mockResolvedValue(new Response("", { status: 201 }));
    const result = await upstreamRequest(
      "runos",
      "/commerce/capability-grants",
      { method: "POST", body: { a: 1 } },
      "http://runos.test",
      onStatus,
    );
    expect(result).toBeUndefined();
    expect(onStatus).toHaveBeenCalledWith(201);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("失败时 onStatus 不回传", async () => {
    const onStatus = vi.fn();
    fetchMock.mockResolvedValue(new Response("", { status: 400 }));
    await upstreamRequest(
      "runos",
      "/x",
      {},
      "http://runos.test",
      onStatus,
    ).catch(() => undefined);
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe("upstreamCheckUnavailable", () => {
  it("非 HttpException 的原因归为 UPSTREAM_REQUEST_FAILED、无状态码", () => {
    const body = envelope(upstreamCheckUnavailable("runos", new Error("boom")));
    expect(body["cause"]).toEqual({
      code: "UPSTREAM_REQUEST_FAILED",
      statusCode: null,
    });
    expect(String(body["message"])).toContain("Runos");
  });
});
