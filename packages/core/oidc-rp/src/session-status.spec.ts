/**
 * Passive central checks distinguish revocation from unavailable verification.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-16
 */
import { afterEach, expect, it, vi } from "vitest";
import { checkOidcSession } from "./session-status";
import type { OidcRpConfig } from "./types";

const config: OidcRpConfig = {
  issuer: "https://accounts.example",
  backchannelIssuer: "http://auth.internal",
  clientId: "console",
  clientSecret: "fixture",
  redirectUri: "https://console.example/auth/callback",
  scopes: ["openid"],
  sessionTtlSec: 3600,
};
afterEach(() => vi.unstubAllGlobals());

it.each([true, false])(
  "reads uncached validity %s without claiming activity",
  async (valid) => {
    const request = vi.fn(async () =>
      Response.json({
        valid,
        next_check_at: Math.floor(Date.now() / 1000) + 300,
      }),
    );
    vi.stubGlobal("fetch", request);
    expect(await checkOidcSession(config, "central")).toBe(valid);
    expect(request).toHaveBeenCalledWith(
      "http://auth.internal/oidc/session/status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sid: "central", active: false }),
      }),
    );
  },
);

it.each([{}, { valid: "false" }, { valid: true, next_check_at: 1 }])(
  "rejects malformed status %j",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    await expect(checkOidcSession(config, "central")).rejects.toThrow();
  },
);

it("does not interpret an outage as revocation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await expect(checkOidcSession(config, "central")).rejects.toThrow(
    "unavailable",
  );
});
