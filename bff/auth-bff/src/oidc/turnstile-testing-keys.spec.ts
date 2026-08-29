import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TurnstileVerificationError,
  TurnstileVerifier,
} from "@vxture/core-auth";

/**
 * Cloudflare's documented dummy secrets answer siteverify with
 * `hostname: "example.com"`, NO `action`, and `metadata.result_with_testing_key`.
 * Measured 2026-08-29 against the live endpoint - not read off a doc example.
 *
 * Without special handling every dummy-key result dies on the hostname check,
 * which means the failure and replay branches (2x… / 3x… secrets) can never be
 * exercised locally, and a production box that was handed a dummy secret fails
 * with a misleading `hostname-mismatch`. The verifier now names that case
 * (`testing-key`) and lets ONE explicit env flag turn it into a pass.
 *
 * These specs mock `fetch` with the exact bodies the live endpoint returned.
 */
const TESTING_PASS = {
  success: true,
  challenge_ts: "2026-08-29T11:13:24.076Z",
  "error-codes": [],
  hostname: "example.com",
  metadata: { result_with_testing_key: true },
};
const TESTING_FAIL = {
  success: false,
  "error-codes": ["invalid-input-response"],
  metadata: { result_with_testing_key: true },
};
const TESTING_SPENT = {
  success: false,
  "error-codes": ["timeout-or-duplicate"],
  metadata: { result_with_testing_key: true },
};
const REAL_PASS = {
  success: true,
  hostname: "accounts.vxture.com",
  action: "tenant_auth",
};

function verifierWith(
  body: unknown,
  opts: { allowTestingKeys?: boolean } = {},
): TurnstileVerifier {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
  return new TurnstileVerifier({
    enabled: true,
    secretKey: "1x0000000000000000000000000000000AA",
    allowedHostnames: ["localhost"],
    ...opts,
  });
}

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "none";
  } catch (error) {
    return error instanceof TurnstileVerificationError
      ? error.reason
      : `not-a-verifier-error:${String(error)}`;
  }
}

describe("TurnstileVerifier with Cloudflare testing keys", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a testing-key result by name when the flag is off", async () => {
    const v = verifierWith(TESTING_PASS);
    expect(
      await reasonOf(v.verify({ token: "t", expectedAction: "tenant_auth" })),
    ).toBe("testing-key");
  });

  it("passes a testing-key result when the flag is on, skipping hostname and action", async () => {
    const v = verifierWith(TESTING_PASS, { allowTestingKeys: true });
    await expect(
      v.verify({ token: "t", expectedAction: "tenant_auth" }),
    ).resolves.toMatchObject({ success: true });
  });

  /* The failure branches are the reason the dummy keys are worth wiring up:
     a real widget cannot be made to fail on demand. Their error-codes must
     reach the reason line unchanged. */
  it("surfaces the 2x… secret's failure as siteverify-failed with its error-code", async () => {
    const v = verifierWith(TESTING_FAIL, { allowTestingKeys: true });
    await expect(v.verify({ token: "t" })).rejects.toMatchObject({
      reason: "siteverify-failed",
      message: expect.stringContaining("invalid-input-response"),
    });
  });

  it("surfaces the 3x… secret's replay as siteverify-failed with timeout-or-duplicate", async () => {
    const v = verifierWith(TESTING_SPENT, { allowTestingKeys: true });
    await expect(v.verify({ token: "t" })).rejects.toMatchObject({
      reason: "siteverify-failed",
      message: expect.stringContaining("timeout-or-duplicate"),
    });
  });

  /* The flag must not loosen anything for a REAL response: the metadata is
     what unlocks the skip, not the flag alone. */
  it("still enforces hostname and action on a real result even with the flag on", async () => {
    const v = verifierWith(REAL_PASS, { allowTestingKeys: true });
    expect(await reasonOf(v.verify({ token: "t" }))).toBe("hostname-mismatch");

    const ok = new TurnstileVerifier({
      enabled: true,
      secretKey: "real",
      allowedHostnames: ["accounts.vxture.com"],
      allowTestingKeys: true,
    });
    expect(
      await reasonOf(
        ok.verify({ token: "t", expectedAction: "operator_auth" }),
      ),
    ).toBe("action-mismatch");
  });

  it("reads the flag from CF_TURNSTILE_ALLOW_TESTING_KEYS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => TESTING_PASS })),
    );
    const env = {
      CF_TURNSTILE_ENABLED: "true",
      CF_TURNSTILE_TENANT_SECRET_KEY: "1x0000000000000000000000000000000AA",
      CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES: "localhost",
      CF_TURNSTILE_ALLOW_TESTING_KEYS: "true",
    };
    await expect(
      TurnstileVerifier.fromEnv("tenant", env).verify({ token: "t" }),
    ).resolves.toMatchObject({ success: true });

    const off = TurnstileVerifier.fromEnv("tenant", {
      ...env,
      CF_TURNSTILE_ALLOW_TESTING_KEYS: "false",
    });
    expect(await reasonOf(off.verify({ token: "t" }))).toBe("testing-key");
  });
});
