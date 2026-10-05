import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { scopeToS2sCaller } from "./s2s-scope";
import type { S2sCallerCtx } from "./s2s-caller";

const caller = (overrides: Partial<S2sCallerCtx> = {}): S2sCallerCtx => ({
  productCode: "arda",
  mode: "service",
  orgId: null,
  workspaceId: "11111111-1111-1111-1111-111111111111",
  delegated: false,
  ...overrides,
});

/**
 * 代上报票（决策 3 PR C）：auth-bff 为 L1 上报者铸的 `aud=vxture` 票——`act.sub` 是上报者
 * （atlas）、`delegated: true`、**没有** workspace。它的全部意义就是「产品码不等于 act.sub
 * 也要放行」，所以下面的矩阵要钉住的是：放行只发生在 delegated 票 + attribute-declared 这一格，
 * 别的格子一个都不松。
 */
const delegatedAtlas = (): S2sCallerCtx => ({
  productCode: "atlas",
  mode: "service",
  orgId: null,
  workspaceId: null,
  delegated: true,
});

const WS_DECLARED = "22222222-2222-2222-2222-222222222222";

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
        workspaceId: WS_DECLARED,
        productCodes: ["arda"],
      },
      "trust-declared",
      "deny",
    );
    expect(result).toEqual({ workspaceId: WS_DECLARED, reporter: null });
  });

  it("legacy + deny：当场 403，不回显任何 workspace", () => {
    expect(() =>
      scopeToS2sCaller(
        undefined,
        {
          workspaceId: WS_DECLARED,
          productCodes: ["arda"],
        },
        "deny",
        "deny",
      ),
    ).toThrow(ForbiddenException);
  });

  it("deny 只对旧凭据生效——带 token 时照常按 token 的 workspace 走", () => {
    /* 不然「deny」会从「关掉旧凭据」变成「把这条路整个关掉」，连 Bearer 调用方一起打掉。 */
    const result = scopeToS2sCaller(
      caller(),
      {
        workspaceId: WS_DECLARED,
        productCodes: ["arda"],
      },
      "deny",
      "deny",
    );
    expect(result.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("overrides the request-declared workspace with the token's own workspace", () => {
    const result = scopeToS2sCaller(
      caller(),
      {
        workspaceId: WS_DECLARED,
        productCodes: ["arda"],
      },
      "trust-declared",
      "deny",
    );
    expect(result).toEqual({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      reporter: null,
    });
  });

  it("allows a request for the caller's own product code", () => {
    const result = scopeToS2sCaller(
      caller({ productCode: "runos" }),
      {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        productCodes: ["runos"],
      },
      "trust-declared",
      "deny",
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
        "deny",
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
        "deny",
      ),
    ).toThrow(ForbiddenException);
  });

  it("fails closed when the token has no workspace_id, rather than trusting the request's", () => {
    expect(() =>
      scopeToS2sCaller(
        caller({ workspaceId: null }),
        {
          workspaceId: WS_DECLARED,
          productCodes: ["arda"],
        },
        "trust-declared",
        "deny",
      ),
    ).toThrow(ForbiddenException);
  });
});

describe("scopeToS2sCaller —— 代上报票（决策 3 PR C，2026-10-04）", () => {
  it("delegated + attribute-declared：自报产品就是归属产品，工作区取自报值，reporter = act.sub", () => {
    const result = scopeToS2sCaller(
      delegatedAtlas(),
      { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
      "trust-declared",
      "attribute-declared",
    );
    expect(result).toEqual({ workspaceId: WS_DECLARED, reporter: "atlas" });
  });

  it("delegated + attribute-declared：一次问几个归属产品都放行（C2 批量读）", () => {
    const result = scopeToS2sCaller(
      delegatedAtlas(),
      { workspaceId: WS_DECLARED, productCodes: ["karda", "tenderforge"] },
      "trust-declared",
      "attribute-declared",
    );
    expect(result.workspaceId).toBe(WS_DECLARED);
    expect(result.reporter).toBe("atlas");
  });

  it("delegated 票没有 workspace 是设计，不是缺陷——不走 s2s_scope_missing_workspace", () => {
    /* 产品票缺 workspace 要 fail-closed（上面那条）；代上报票的绑定在请求体，两者不是同一格。 */
    expect(() =>
      scopeToS2sCaller(
        delegatedAtlas(),
        { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
        "trust-declared",
        "attribute-declared",
      ),
    ).not.toThrow();
  });

  it("delegated + deny：403 s2s_delegated_path_not_allowed，归属与工作区都不回", () => {
    expect(() =>
      scopeToS2sCaller(
        delegatedAtlas(),
        { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
        "trust-declared",
        "deny",
      ),
    ).toThrow(
      expect.objectContaining({ message: "s2s_delegated_path_not_allowed" }),
    );
  });

  it("delegated 档位不松动产品票：product 票 + attribute-declared 仍按 act.sub 比对（403）", () => {
    /* 「attribute-declared」说的是代上报票；一张普通产品票带着别人的产品码照样 s2s_product_mismatch。 */
    expect(() =>
      scopeToS2sCaller(
        caller({ productCode: "arda" }),
        { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
        "trust-declared",
        "attribute-declared",
      ),
    ).toThrow(expect.objectContaining({ message: "s2s_product_mismatch" }));
  });

  it("delegated 档位不碰旧凭据那条路：legacy 仍只看 legacy 档位", () => {
    const echoed = scopeToS2sCaller(
      undefined,
      { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
      "trust-declared",
      "attribute-declared",
    );
    expect(echoed).toEqual({ workspaceId: WS_DECLARED, reporter: null });
    expect(() =>
      scopeToS2sCaller(
        undefined,
        { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
        "deny",
        "attribute-declared",
      ),
    ).toThrow(
      expect.objectContaining({ message: "s2s_legacy_path_not_allowed" }),
    );
  });

  it("delegated 票若带了 workspace 也不用它——绑定在请求体，票里的值不是判据", () => {
    /* auth-bff 不铸这种票；钉住是为了让「票里有 workspace 就信票」这条捷径永远不出现。 */
    const result = scopeToS2sCaller(
      {
        ...delegatedAtlas(),
        workspaceId: "99999999-9999-9999-9999-999999999999",
      },
      { workspaceId: WS_DECLARED, productCodes: ["tenderforge"] },
      "trust-declared",
      "attribute-declared",
    );
    expect(result.workspaceId).toBe(WS_DECLARED);
  });
});
