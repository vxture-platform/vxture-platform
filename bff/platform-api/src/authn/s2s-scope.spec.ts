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
  it("echoes the request-declared workspace when s2sCaller is absent (legacy path)", () => {
    const result = scopeToS2sCaller(undefined, {
      workspaceId: "22222222-2222-2222-2222-222222222222",
      productCodes: ["arda"],
    });
    expect(result.workspaceId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("overrides the request-declared workspace with the token's own workspace", () => {
    const result = scopeToS2sCaller(caller(), {
      workspaceId: "22222222-2222-2222-2222-222222222222",
      productCodes: ["arda"],
    });
    expect(result.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("allows a request for the caller's own product code", () => {
    const result = scopeToS2sCaller(caller({ productCode: "runos" }), {
      workspaceId: "11111111-1111-1111-1111-111111111111",
      productCodes: ["runos"],
    });
    expect(result.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects a request for a different product code", () => {
    expect(() =>
      scopeToS2sCaller(caller({ productCode: "arda" }), {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        productCodes: ["runos"],
      }),
    ).toThrow(ForbiddenException);
  });

  it("rejects a batch request containing any product code that isn't the caller's own", () => {
    expect(() =>
      scopeToS2sCaller(caller({ productCode: "arda" }), {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        productCodes: ["arda", "runos"],
      }),
    ).toThrow(ForbiddenException);
  });

  it("fails closed when the token has no workspace_id, rather than trusting the request's", () => {
    expect(() =>
      scopeToS2sCaller(caller({ workspaceId: null }), {
        workspaceId: "22222222-2222-2222-2222-222222222222",
        productCodes: ["arda"],
      }),
    ).toThrow(ForbiddenException);
  });
});
