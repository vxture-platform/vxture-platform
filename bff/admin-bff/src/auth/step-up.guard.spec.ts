/**
 * step-up.guard.spec.ts - Operator identity and strict credential expiry gates.
 * @package @vxture/bff-admin
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { ModuleRef, Reflector } from "@nestjs/core";
import type { OidcRpClient } from "@vxture/core-oidc-rp";
import { OperatorStepUpGuard } from "./step-up.guard";
import { stepUpCookieName, REQUIRE_STEP_UP } from "./step-up.decorator";
import {
  RP_OIDC_CLIENT,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";

const OPERATOR_ID = "11111111-1111-1111-1111-111111111111";
const COOKIE = stepUpCookieName(true); // cookieSecure=true → __Host-vx_op_stepup
const NOW = 1_800_000_000;

// ===========================================================================
// Isolate the guard from transport and cryptographic verification.
// ===========================================================================

/** Build a guard with stubbed reflector + RP client. */
function makeGuard(opts: {
  required: boolean;
  verify?: (token: string) => Promise<Record<string, unknown>>;
}): OperatorStepUpGuard {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === REQUIRE_STEP_UP ? opts.required : undefined,
  } as unknown as Reflector;
  const client = {
    verifyAccessToken:
      opts.verify ?? (() => Promise.reject(new Error("no verifier"))),
  } as unknown as OidcRpClient;
  const runtime = { cookieSecure: true } as unknown as RpRuntime;
  // The guard resolves RP deps lazily via ModuleRef (see step-up.guard.ts).
  const moduleRef = {
    get: (token: unknown) =>
      token === RP_OIDC_CLIENT
        ? client
        : token === RP_RUNTIME
          ? runtime
          : undefined,
  } as unknown as ModuleRef;
  return new OperatorStepUpGuard(reflector, moduleRef);
}

/** Build an ExecutionContext over a fake request. */
function ctx(req: {
  user?: { id: string };
  cookies?: Record<string, unknown>;
}): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const validClaims = {
  sub: `opr_${OPERATOR_ID}`,
  aud: "admin",
  stepup: true,
  exp: NOW + 300,
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Deny every invalid proof before a high-risk handler can run.
// ===========================================================================

describe("OperatorStepUpGuard", () => {
  it("allows non-decorated routes (no step-up required)", async () => {
    const guard = makeGuard({ required: false });
    const ok = await guard.canActivate(
      ctx({ user: { id: OPERATOR_ID }, cookies: {} }),
    );
    expect(ok).toBe(true);
  });

  it("allows a valid credential for the current session operator", async () => {
    const guard = makeGuard({
      required: true,
      verify: async () => validClaims,
    });
    const ok = await guard.canActivate(
      ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "tok" } }),
    );
    expect(ok).toBe(true);
  });

  it("rejects when there is no session operator", async () => {
    const guard = makeGuard({
      required: true,
      verify: async () => validClaims,
    });
    await expect(
      guard.canActivate(ctx({ cookies: { [COOKIE]: "tok" } })),
    ).rejects.toThrow("step_up_required");
  });

  it("rejects when the step-up cookie is absent", async () => {
    const guard = makeGuard({
      required: true,
      verify: async () => validClaims,
    });
    await expect(
      guard.canActivate(ctx({ user: { id: OPERATOR_ID }, cookies: {} })),
    ).rejects.toThrow("step_up_required");
  });

  it("rejects an expired/invalid credential (verify throws)", async () => {
    const guard = makeGuard({
      required: true,
      verify: () => Promise.reject(new Error("OIDC token expired")),
    });
    await expect(
      guard.canActivate(
        ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "tok" } }),
      ),
    ).rejects.toThrow("step_up_required");
  });

  it("rejects a credential bound to a different operator (sub mismatch)", async () => {
    const guard = makeGuard({
      required: true,
      verify: async () => ({ ...validClaims, sub: "opr_someone-else" }),
    });
    await expect(
      guard.canActivate(
        ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "tok" } }),
      ),
    ).rejects.toThrow("step_up_required");
  });

  it("rejects a token without the stepup claim", async () => {
    const guard = makeGuard({
      required: true,
      verify: async () => ({ sub: `opr_${OPERATOR_ID}`, aud: "admin" }),
    });
    await expect(
      guard.canActivate(
        ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "tok" } }),
      ),
    ).rejects.toThrow("step_up_required");
  });

  it.each([
    undefined,
    null,
    "1800000300",
    true,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    NOW + 0.5,
    0,
    -1,
    NOW - 1,
    NOW,
  ])("rejects a missing, malformed or expired exp claim: %j", async (exp) => {
    const guard = makeGuard({
      required: true,
      verify: async () => ({ ...validClaims, exp }),
    });
    await expect(
      guard.canActivate(
        ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "tok" } }),
      ),
    ).rejects.toThrow("step_up_required");
  });

  it("allows a signed expiry one second in the future", async () => {
    const guard = makeGuard({
      required: true,
      verify: async () => ({ ...validClaims, exp: NOW + 1 }),
    });
    expect(
      await guard.canActivate(
        ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "tok" } }),
      ),
    ).toBe(true);
  });

  it("rejects non-string cookies without invoking the verifier", async () => {
    const verify = vi.fn(async () => validClaims);
    const guard = makeGuard({ required: true, verify });
    await expect(
      guard.canActivate(
        ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: ["tok"] } }),
      ),
    ).rejects.toThrow("step_up_required");
    expect(verify).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// A proof for one business action cannot authorize an unrelated legacy route.
// ===========================================================================
it("rejects action credentials presented as a reusable legacy credential", async () => {
  const guard = makeGuard({
    required: true,
    verify: async () => ({
      ...validClaims,
      stepup_action: {
        requestHash: "a".repeat(64),
        sessionHash: "b".repeat(64),
      },
    }),
  });
  await expect(
    guard.canActivate(
      ctx({ user: { id: OPERATOR_ID }, cookies: { [COOKIE]: "bound" } }),
    ),
  ).rejects.toThrow("step_up_required");
});
