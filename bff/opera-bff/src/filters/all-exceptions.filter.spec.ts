/**
 * all-exceptions.filter.spec.ts —— 出口的三条通路 + 拒绝留痕的口径。
 *
 * 为什么测过滤器而不是它内部的纯函数：**它的价值恰恰在于"什么都拦得住"**。
 * 只测 `envelopeFromHttp` 会漏掉「非 HttpException 走没走对分支」「留痕有没有在
 * 响应之后」这类真正会出事的地方。
 */
import { BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidRequest, notEntitled } from "../errors/api-error";
import { AllExceptionsFilter } from "./all-exceptions.filter";

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

function makeHost(
  captured: Captured,
  req: Partial<{
    method: string;
    originalUrl: string;
    operator: { id: string };
    headers: Record<string, string>;
  }> = {},
): ArgumentsHost {
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };
  const request = {
    method: "GET",
    originalUrl: "/api/products",
    headers: {},
    ...req,
  };
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

/** 只记调用、不连库。 */
function fakePool() {
  const calls: unknown[][] = [];
  const pool = {
    query: vi.fn((_sql: string, params: unknown[]) => {
      calls.push(params);
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe("通路 ① ApiError —— 原样出", () => {
  it("封套不被改写", () => {
    const c: Captured = {};
    new AllExceptionsFilter().catch(
      invalidRequest("VALIDATION_REQUIRED", "x is required", "x"),
      makeHost(c),
    );
    expect(c.status).toBe(400);
    expect(c.body).toMatchObject({
      code: "VALIDATION_REQUIRED",
      retryable: false,
      field: "x",
    });
  });
});

describe("通路 ② 上游透传 —— 不覆盖上游的码", () => {
  /* atlas 的 `MODEL_ADMIN_HAS_DEPENDENTS` 带着 blockedBy 明细，控制台正是靠它
     把「你不能删」变成「先去清掉这三个」。重写成本地码等于把这份好意扔了。 */
  it("保留上游 code 与明细，只补 retryable", () => {
    const c: Captured = {};
    new AllExceptionsFilter().catch(
      new HttpException(
        {
          code: "MODEL_ADMIN_HAS_DEPENDENTS",
          message: "still referenced",
          blockedBy: [{ type: "endpoint", id: "e1", label: "chat/default" }],
        },
        HttpStatus.CONFLICT,
      ),
      makeHost(c),
    );
    expect(c.body?.code).toBe("MODEL_ADMIN_HAS_DEPENDENTS");
    expect(c.body?.blockedBy).toHaveLength(1);
    expect(c.body?.retryable).toBe(false);
  });

  it("上游自己给了 retryable 就不动它", () => {
    const c: Captured = {};
    new AllExceptionsFilter().catch(
      new HttpException(
        { code: "UPSTREAM_BUSY", message: "busy", retryable: true },
        HttpStatus.CONFLICT,
      ),
      makeHost(c),
    );
    expect(c.body?.retryable).toBe(true);
  });
});

describe("通路 ③ 兜底 —— 框架自造的错误也得有封套", () => {
  /* 这条是过滤器存在的全部理由：路由不存在的 404、请求体不是合法 JSON 的 400，
     那些点业务代码一行都碰不到。 */
  it("裸 Nest 异常拿到 UNCLASSIFIED_ 码", () => {
    const c: Captured = {};
    new AllExceptionsFilter().catch(
      new BadRequestException("bad"),
      makeHost(c),
    );
    expect(c.body?.code).toBe("UNCLASSIFIED_BAD_REQUEST");
    expect(c.body?.retryable).toBe(false);
  });

  it("非 HttpException → 500 INTERNAL_ERROR，且不泄露内部信息", () => {
    const c: Captured = {};
    new AllExceptionsFilter().catch(
      new Error("db password is hunter2"),
      makeHost(c),
    );
    expect(c.status).toBe(500);
    expect(c.body).toMatchObject({ code: "INTERNAL_ERROR", retryable: false });
    expect(JSON.stringify(c.body)).not.toContain("hunter2");
  });
});

describe("被拒留痕的口径（X-3 §4.1）", () => {
  const OPERATOR = { id: "00000000-0000-4000-a000-000000000011" };
  let fake: ReturnType<typeof fakePool>;

  beforeEach(() => {
    fake = fakePool();
  });

  const fire = (method: string, url: string, exception: unknown) =>
    new AllExceptionsFilter(fake.pool).catch(
      exception,
      makeHost({}, { method, originalUrl: url, operator: OPERATOR }),
    );

  it("403 写操作 —— 记", async () => {
    fire("POST", "/api/atlas/provider-keys/abc/rotate", notEntitled("x:y"));
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
  });

  it("409 写操作 —— 记", async () => {
    fire(
      "PATCH",
      "/api/products/0c4fa6cc-a86d-4e96-98cd-deacc0b38b46/state",
      new HttpException({ code: "CATALOG_INVALID_STATE_TRANSITION" }, 409),
    );
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    /* error_code 那一格往往比 action 更有用——`NOT_ENTITLED` 与
       `MAINTENANCE_WINDOW_READ_ONLY` 是两回事。 */
    expect(fake.calls[0]).toContain("CATALOG_INVALID_STATE_TRANSITION");
  });

  it("400 纯格式 —— 不记（每个手滑都留一行会把审计表淹掉）", async () => {
    fire("PATCH", "/api/products/x/state", invalidRequest("V_X", "m", "state"));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.calls).toHaveLength(0);
  });

  it("404 —— 不记（「对象不存在」不是拒绝）", async () => {
    fire(
      "PATCH",
      "/api/products/x/state",
      new HttpException({ code: "NF" }, 404),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.calls).toHaveLength(0);
  });

  it("读操作被拒 —— 不记（只记写方法）", async () => {
    fire("GET", "/api/maintenance-windows", notEntitled("x:y"));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.calls).toHaveLength(0);
  });

  it("没有池子时只出封套、不炸", () => {
    const c: Captured = {};
    expect(() =>
      new AllExceptionsFilter().catch(
        notEntitled("x:y"),
        makeHost(c, { method: "POST", operator: OPERATOR }),
      ),
    ).not.toThrow();
    expect(c.body?.code).toBe("NOT_ENTITLED");
  });

  /* 留痕失败不能把一个已经发出去的 4xx 变成 5xx——那是拿观测性换可用性。 */
  it("留痕失败不影响已发出的响应", async () => {
    const boom = {
      query: vi.fn(() => Promise.reject(new Error("pool down"))),
    } as unknown as Pool;
    const c: Captured = {};
    expect(() =>
      new AllExceptionsFilter(boom).catch(
        notEntitled("x:y"),
        makeHost(c, { method: "POST", operator: OPERATOR }),
      ),
    ).not.toThrow();
    expect(c.status).toBe(403);
    await new Promise((r) => setTimeout(r, 20));
  });
});
