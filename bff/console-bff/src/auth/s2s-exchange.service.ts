/**
 * s2s-exchange.service.ts — platform-caller T1 token acquisition (2026-07-28,
 * console→atlas wiring line)
 * @package @vxture/bff-console
 * @layer BFF
 * @description
 *   Exchanges console-bff's own confidential-client credentials for a
 *   short-lived management-plane token (aud = target product_code, e.g.
 *   "atlas") via the platform token endpoint's new platform-caller mode
 *   (`token-exchange.service.ts`'s `PLATFORM_LEVEL_S2S_CALLERS` allowlist).
 *   Unlike admin-bff's `OperatorExchangeService`, this is NOT OBO — there is
 *   no subject_token; console-bff declares the tenant `workspace_id` it has
 *   already resolved from the customer's own session (TenantMiddleware, run
 *   before any router in this BFF), and the IdP mints a service-mode token
 *   with `act.sub = "console"` (not a product code — providers must not
 *   conflate "the platform's console surface asked on a tenant's behalf"
 *   with "product X called for its own execution").
 *
 *   Atlas's `S2sAuthGuard` has no shared-secret fallback (unlike platform's
 *   own `PlatformAuthGuard`), so a failed exchange here must not silently
 *   degrade to an unauthenticated upstream call — callers should treat a
 *   null result as a hard failure (`BadGatewayException`), not a fallback.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";

const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
/** Cache slightly under the mint TTL (300s) so we never forward a stale token. */
const CACHE_TTL_MS = 240_000;
/** Hard cap; entries are pruned on insert. One workspace ↔ few audiences in practice. */
const CACHE_MAX_ENTRIES = 256;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

@Injectable()
export class S2sExchangeService {
  private readonly logger = new Logger(S2sExchangeService.name);
  private readonly cache = new Map<string, CachedToken>();

  constructor(@Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime) {}

  /**
   * Returns a management-plane token for `audience` scoped to `workspaceId`,
   * or null when the exchange fails. Callers must treat null as a hard
   * failure — atlas (and any other T1-guarded provider) will reject an
   * unauthenticated request outright, so degrading to a bare upstream call
   * only trades a clear 502 here for a confusing 401 from the provider.
   */
  async getToken(
    workspaceId: string,
    audience: string,
    orgId?: string,
  ): Promise<string | null> {
    const key = `${audience}\n${workspaceId}\n${orgId ?? ""}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAtMs > Date.now()) {
      return hit.accessToken;
    }

    const cfg = this.rpRuntime.config;
    const base = (cfg.backchannelIssuer ?? cfg.issuer).replace(/\/+$/, "");
    const params = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      workspace_id: workspaceId,
      audience,
    });
    if (orgId) {
      params.set("org_id", orgId);
    }
    let response: Response;
    try {
      response = await fetch(`${base}/oidc/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
    } catch (e) {
      this.logger.warn(
        `platform-caller S2S exchange unreachable (aud=${audience}): ${(e as Error).message}`,
      );
      return null;
    }
    if (!response.ok) {
      this.logger.warn(
        `platform-caller S2S exchange rejected (aud=${audience}, status=${response.status})`,
      );
      return null;
    }
    let accessToken: string | undefined;
    try {
      const body = (await response.json()) as { access_token?: string };
      accessToken = body.access_token;
    } catch {
      return null;
    }
    if (!accessToken) {
      return null;
    }

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Drop expired entries first; if none expired, drop the oldest inserted.
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (v.expiresAtMs <= now) this.cache.delete(k);
      }
      if (this.cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    this.cache.set(key, {
      accessToken,
      expiresAtMs: Date.now() + CACHE_TTL_MS,
    });
    return accessToken;
  }
}
