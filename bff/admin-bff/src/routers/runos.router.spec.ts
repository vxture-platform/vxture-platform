/**
 * runos.router.spec.ts — admin 侧 Runos 只读代理的行为钉子。
 *
 * 这条代理端到端没法在本地跑：operator 会话要人登录，Runos 的 `/capability/*` 又
 * 只认 operator bearer（直连 `localhost:3120` 回 `OPERATOR_TOKEN_MISSING`）。所以把
 * `fetch` 换成桩，钉住四件 tsc 看不见的事：
 *
 *   1. 能力门在**打上游之前**判——无会话 401、无码 403，`fetch` 一次都不该被调。
 *   2. 查询参数原样透传：`tag` 可重复且必须 append 不能 set（AND 语义）。
 *   3. OBO：换票 aud=runos，拿到的令牌原样作 bearer；换票失败降级为不带 bearer。
 *   4. 上游契约漂移在入口 502 并点名字段；上游错误按原状态码透传；不可达 502。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/console.types";
import { RunosRouter } from "./runos.router";

/* 路由文件把 `VxConfigService` 当 DI 令牌（`@Inject(VxConfigService)`），所以它是
   运行时引用；`@vxture/core-config` 的入口指向 dist，这里给一个空类顶替令牌位，
   免得单测依赖一次 workspace 构建。构造时传的是手写的 `platform` 对象。 */
vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

const OPERATOR_TOKEN = "operator-access-token";

function makeReq(
  capabilities: string[] | null,
  options: { withToken?: boolean } = {},
): Request & RequestContext {
  return {
    ...(capabilities ? { user: { id: "op-1" }, capabilities } : {}),
    ...(options.withToken === false
      ? {}
      : { operatorAccessToken: OPERATOR_TOKEN }),
  } as unknown as Request & RequestContext;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeRouter(options: { token?: string | null } = {}) {
  const getToken = vi.fn(async () =>
    options.token === undefined ? "obo-token" : options.token,
  );
  const config = {
    platform: {
      /* 故意带尾部斜杠：路由要把它去掉，否则拼出 `//capability`。 */
      RUNOS_API_URL: "http://runos.test/",
      OPERA_BASE_URL: "https://x.vxture.com/",
    },
  } as unknown as VxConfigService;
  const router = new RunosRouter(config, {
    getToken,
  } as unknown as OperatorExchangeService);
  return { router, getToken };
}

/** 一行「什么都不缺」的能力记录，逐字段照 runos prisma schema。 */
const CAPABILITY_ROW = {
  capabilityId: "arda.invoice-query",
  primitiveType: "skill",
  providerId: "arda",
  ownerRef: "team-arda",
  title: "Invoice query",
  displayName: {},
  admissionTier: "certified",
  category: "finance",
  tags: ["invoice"],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const CAPABILITY_DETAIL = {
  ...CAPABILITY_ROW,
  versions: [],
  aliases: [],
  endpoints: [],
};

function firstFetchCall(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit | undefined;
} {
  const call = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return { url: call[0], init: call[1] };
}

/** 去掉一个字段——模拟上游改了形状。不用 rest 解构：本仓的 lint 只放过 `_` 前缀的**参数**。 */
function without(
  row: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const copy = { ...row };
  delete copy[field];
  return copy;
}

/**
 * 收一个 thunk 而不是 Promise：能力门在 handler 里**同步**抛（同 atlas.router.ts，
 * Nest 对同步抛与拒绝的 Promise 一视同仁），直接传 `router.x()` 会在求参数时就炸出去。
 */
async function rejection(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse([CAPABILITY_ROW]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("能力门在打上游之前判", () => {
  it("无会话 → 401，fetch 一次都不调", async () => {
    const { router } = makeRouter();
    const error = await rejection(() => router.listCapabilities(makeReq(null)));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("有会话但没有 runos 码 → 403，fetch 一次都不调", async () => {
    const { router } = makeRouter();
    const error = await rejection(() =>
      router.listCapabilities(makeReq(["platform.model.manage"])),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["capability:runos.read"], ["capability:runos.manage"]])(
    "%s 任一即可放行（与 opera 的 assertCanRead 同判据）",
    async (code) => {
      const { router } = makeRouter();
      await expect(router.listCapabilities(makeReq([code]))).resolves.toEqual([
        CAPABILITY_ROW,
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("management-entry 走同一道门", async () => {
    const { router } = makeRouter();
    expect(() => router.managementEntry(makeReq(null))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      router.managementEntry(makeReq(["platform.tenant.manage"])),
    ).toThrow(ForbiddenException);
  });
});

describe("查询参数原样透传", () => {
  const req = () => makeReq(["capability:runos.read"]);

  it("不带参数就不带 `?`，基址的尾部斜杠被去掉", async () => {
    const { router } = makeRouter();
    await router.listCapabilities(req());
    expect(firstFetchCall(fetchMock).url).toBe(
      "http://runos.test/capability/capabilities",
    );
  });

  it("`tag` 可重复：append 不是 set（AND 语义，丢一个就变成 OR）", async () => {
    const { router } = makeRouter();
    await router.listCapabilities(req(), "finance", ["invoice", "read-only"]);
    expect(firstFetchCall(fetchMock).url).toBe(
      "http://runos.test/capability/capabilities?category=finance&tag=invoice&tag=read-only",
    );
  });

  it("单个 `tag` 字符串同样透传", async () => {
    const { router } = makeRouter();
    await router.listCapabilities(req(), undefined, "invoice");
    expect(firstFetchCall(fetchMock).url).toBe(
      "http://runos.test/capability/capabilities?tag=invoice",
    );
  });

  it("详情：id 进路径", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(CAPABILITY_DETAIL));
    const { router } = makeRouter();
    await router.getCapability(req(), "arda.invoice-query");
    expect(firstFetchCall(fetchMock).url).toBe(
      "http://runos.test/capability/capabilities/arda.invoice-query",
    );
  });
});

describe("operator-OBO（product_250 M-1）", () => {
  it("换票 aud=runos，拿到的令牌原样作 bearer", async () => {
    const { router, getToken } = makeRouter();
    await router.listCapabilities(makeReq(["capability:runos.read"]));
    expect(getToken).toHaveBeenCalledWith(OPERATOR_TOKEN, "runos");
    const headers = firstFetchCall(fetchMock).init?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["authorization"]).toBe("Bearer obo-token");
  });

  it("换票失败降级为不带 bearer 的上游调用（上游校验时以它自己的 401 浮出）", async () => {
    const { router } = makeRouter({ token: null });
    await router.listCapabilities(makeReq(["capability:runos.read"]));
    expect(firstFetchCall(fetchMock).init?.headers).toBeUndefined();
  });

  it("没有会话令牌就不换票", async () => {
    const { router, getToken } = makeRouter();
    await router.listCapabilities(
      makeReq(["capability:runos.read"], { withToken: false }),
    );
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("上游契约与错误", () => {
  const req = () => makeReq(["capability:runos.read"]);

  it("列表少了 admissionTier → 502 并点名字段，不把残行交给页面", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([without(CAPABILITY_ROW, "admissionTier")]),
    );
    const { router } = makeRouter();
    const error = await rejection(() => router.listCapabilities(req()));
    expect(error).toBeInstanceOf(BadGatewayException);
    const body = (error as BadGatewayException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body["code"]).toBe("RUNOS_CONTRACT_FIELD_MISSING");
    expect(body["field"]).toBe("admissionTier");
  });

  it("详情少了 endpoints 同样 502", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(without(CAPABILITY_DETAIL, "endpoints")),
    );
    const { router } = makeRouter();
    const error = await rejection(() => router.getCapability(req(), "x"));
    expect(error).toBeInstanceOf(BadGatewayException);
    const body = (error as BadGatewayException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body["field"]).toBe("endpoints");
  });

  it("上游业务错误按原状态码与错误体透传", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          code: "REGISTRY_CAPABILITY_NOT_FOUND",
          message: "capability not found",
          retryable: false,
        },
        404,
      ),
    );
    const { router } = makeRouter();
    const error = await rejection(() => router.getCapability(req(), "nope"));
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    const body = (error as HttpException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body["code"]).toBe("REGISTRY_CAPABILITY_NOT_FOUND");
    expect(body["statusCode"]).toBe(404);
  });

  it("上游不可达 → 502 Runos is unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { router } = makeRouter();
    const error = await rejection(() => router.listCapabilities(req()));
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).message).toBe("Runos is unavailable");
  });
});

describe("management-entry", () => {
  it("拼 OPERA_BASE_URL + /capability/registry，去掉尾部斜杠", () => {
    const { router } = makeRouter();
    expect(router.managementEntry(makeReq(["capability:runos.read"]))).toEqual({
      url: "https://x.vxture.com/capability/registry",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
