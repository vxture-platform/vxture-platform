/**
 * Account-center boundary regression coverage.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, expect, it, vi } from "vitest";
import { OperatorSelfGuard } from "./operator-self.guard";

describe("workforce self-service guard", () => {
  function build(
    cookies: Record<string, unknown> = {
      vx_sid: "customer",
      vx_sid_op: "operator",
    },
  ) {
    const origin = { assertRequest: vi.fn() };
    const realms = { requireOperator: vi.fn(async () => "operator-id") };
    const req = { cookies };
    const context = { switchToHttp: () => ({ getRequest: () => req }) };
    const guard = new OperatorSelfGuard(origin as never, realms as never);
    return { origin, realms, context, guard };
  }
  it("selects only the workforce cookie", async () => {
    const f = build();
    expect(await f.guard.canActivate(f.context as never)).toBe(true);
    expect(f.realms.requireOperator).toHaveBeenCalledWith("operator");
  });
  it.each([{ vx_sid: "customer" }, { vx_sid_op: 123 }])(
    "never falls back for %j",
    async (cookies) => {
      const f = build(cookies);
      await f.guard.canActivate(f.context as never);
      expect(f.realms.requireOperator).toHaveBeenCalledWith(undefined);
    },
  );
  it("checks origin before querying the workforce store", async () => {
    const f = build();
    f.origin.assertRequest.mockImplementationOnce(() => {
      throw new Error("forbidden");
    });
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      "forbidden",
    );
    expect(f.realms.requireOperator).not.toHaveBeenCalled();
  });
  it("propagates revoked or disabled workforce identity failures", async () => {
    const f = build();
    f.realms.requireOperator.mockRejectedValueOnce(
      new Error("operator_session_required"),
    );
    await expect(f.guard.canActivate(f.context as never)).rejects.toThrow(
      "operator_session_required",
    );
  });
});
