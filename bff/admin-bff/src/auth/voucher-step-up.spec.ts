/**
 * voucher-step-up.spec.ts - Request tampering and session binding regressions.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { describe, expect, it } from "vitest";
import { voucherStepUpIntent } from "./voucher-step-up";
import { AuthMiddleware } from "../middleware/auth.middleware";

// ===========================================================================
// Every financially relevant field, target and operation identity participates.
// ===========================================================================
const path =
  "/api/commercial/voucher-batches/11111111-1111-4111-8111-111111111111/issue";
const command = {
  idempotencyKey: "one",
  reason: "approved",
  count: 2,
  fundingPaymentId: "payment-one",
};
function intent(body: object = command, url = path) {
  return voucherStepUpIntent({
    method: "POST",
    path: url,
    body,
    operatorSessionHash: "a".repeat(64),
  } as never);
}
describe("voucher request intent", () => {
  it("ignores JSON property ordering", () => {
    expect(
      intent({
        fundingPaymentId: "payment-one",
        count: 2,
        reason: "approved",
        idempotencyKey: "one",
      }).requestHash,
    ).toBe(intent().requestHash);
  });
  it.each([
    { count: 3 },
    { fundingPaymentId: "other" },
    { reason: "other" },
    { idempotencyKey: "two" },
    { unexpected: true },
  ])(
    "rejects parameter substitutions by changing the binding: %j",
    (change) => {
      expect(intent({ ...command, ...change }).requestHash).not.toBe(
        intent().requestHash,
      );
    },
  );
  it("binds the route target and action", () => {
    expect(
      intent(command, path.replace("11111111-", "22222222-")).requestHash,
    ).not.toBe(intent().requestHash);
    expect(
      intent({ ...command, action: "review" }, path.replace("issue", "actions"))
        .requestHash,
    ).not.toBe(intent().requestHash);
  });
  it("rejects missing trusted session state", () => {
    expect(() =>
      voucherStepUpIntent({ method: "POST", path, body: command } as never),
    ).toThrow("step_up_session_required");
  });
  it.each([
    {},
    { ...command, idempotencyKey: "" },
    { ...command, count: NaN },
    { ...command, count: undefined },
  ])("rejects ambiguous or unbound input %j", (body) => {
    expect(() => intent(body)).toThrow("invalid_action_request");
  });
  it("does not offer action authorization for other endpoints", () => {
    expect(() => intent(command, "/api/orders/one/void")).toThrow(
      "invalid_action_request",
    );
  });
});

// ===========================================================================
// The binding comes from verified RP state, not a browser field or access token.
// ===========================================================================
it("keeps an RP session stable through refresh and separates a second login", async () => {
  let rpsid = "session-one",
    token = "access-one";
  const auth = {
    getCurrentUser: async () => ({ id: "operator" }),
    getCapabilities: async () => ["admin.plane"],
  };
  const rp = {
    resolve: async () => ({
      status: "ok",
      rpsid,
      accessToken: token,
      claims: { sub: "opr_operator", userType: "operator" },
    }),
  };
  const middleware = new AuthMiddleware(
    auth as never,
    rp as never,
    { cookieSecure: true, config: { clientId: "admin" } } as never,
  );
  const run = async () => {
    const req = {
      cookies: new Proxy({}, { get: () => "opaque" }),
      path: "/api/commercial/voucher-batches",
      originalUrl: "/api/commercial/voucher-batches",
    };
    await middleware.use(req as never, {} as never, () => {});
    return req as typeof req & { operatorSessionHash: string };
  };
  const first = await run();
  token = "refreshed-access";
  expect((await run()).operatorSessionHash).toBe(first.operatorSessionHash);
  rpsid = "session-two";
  expect((await run()).operatorSessionHash).not.toBe(first.operatorSessionHash);
  expect(first.operatorSessionHash).toMatch(/^[a-f0-9]{64}$/);
  expect(first.operatorSessionHash).not.toContain("session-one");
});
