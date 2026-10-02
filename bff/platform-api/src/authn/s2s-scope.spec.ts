import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { scopeToS2sCaller } from "./s2s-scope";
import type { S2sCallerCtx } from "./s2s-caller";

const caller = (overrides: Partial<S2sCallerCtx> = {}): S2sCallerCtx => ({
  productCode: "arda",
  mode: "service",
  orgId: null,
  workspaceId: "11111111-1111-1111-1111-111111111111",
  ...overrides,
});

describe("scopeToS2sCaller", () => {
  /*
   * 旧凭据那条路（`s2sCaller` 缺席）两档，2026-10-02 起由调用点**显式声明**。
   *
   * 下面第一条钉的是一个**已登记的缺口**，不是一个期望的行为：`trust-declared` 原样回显
   * 请求体自报的 workspace，而那个值下一跳就进 SQL 的归属谓词。四个在产调用点还得这样，
   * 因为收紧要先让五个对接方换凭据（E2/E3）。它在
   * `scripts/guardrails/s2s-legacy-scope.snapshot.json` 里登记着。
   */
  it("legacy + trust-declared：原样回显自报的 workspace（已登记的缺口）", () => {
    const result = scopeToS2sCaller(
      undefined,
      {
        workspaceId: "22222222-2222-2222-2222-222222222222",
        productCodes: ["arda"],
      },
      "trust-declared",
    );
    expect(result.workspaceId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("legacy + deny：当场 403，不回显任何 workspace", () => {
    expect(() =>
      scopeToS2sCaller(
        undefined,
        {
          workspaceId: "22222222-2222-2222-2222-222222222222",
          productCodes: ["arda"],
        },
        "deny",
      ),
    ).toThrow(ForbiddenException);
  });

  it("deny 只对旧凭据生效——带 token 时照常按 token 的 workspace 走", () => {
    /* 不然「deny」会从「关掉旧凭据」变成「把这条路整个关掉」，连 Bearer 调用方一起打掉。 */
    const result = scopeToS2sCaller(
      caller(),
      {
        workspaceId: "22222222-2222-2222-2222-222222222222",
        productCodes: ["arda"],
      },
      "deny",
    );
    expect(result.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("overrides the request-declared workspace with the token's own workspace", () => {
    const result = scopeToS2sCaller(
      caller(),
      {
        workspaceId: "22222222-2222-2222-2222-222222222222",
        productCodes: ["arda"],
      },
      "trust-declared",
    );
    expect(result.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("allows a request for the caller's own product code", () => {
    const result = scopeToS2sCaller(
      caller({ productCode: "runos" }),
      {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        productCodes: ["runos"],
      },
      "trust-declared",
    );
    expect(result.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects a request for a different product code", () => {
    expect(() =>
      scopeToS2sCaller(
        caller({ productCode: "arda" }),
        {
          workspaceId: "11111111-1111-1111-1111-111111111111",
          productCodes: ["runos"],
        },
        "trust-declared",
      ),
    ).toThrow(ForbiddenException);
  });

  it("rejects a batch request containing any product code that isn't the caller's own", () => {
    expect(() =>
      scopeToS2sCaller(
        caller({ productCode: "arda" }),
        {
          workspaceId: "11111111-1111-1111-1111-111111111111",
          productCodes: ["arda", "runos"],
        },
        "trust-declared",
      ),
    ).toThrow(ForbiddenException);
  });

  it("fails closed when the token has no workspace_id, rather than trusting the request's", () => {
    expect(() =>
      scopeToS2sCaller(
        caller({ workspaceId: null }),
        {
          workspaceId: "22222222-2222-2222-2222-222222222222",
          productCodes: ["arda"],
        },
        "trust-declared",
      ),
    ).toThrow(ForbiddenException);
  });
});
