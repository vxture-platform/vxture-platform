/**
 * operator-exchange.service.ts — operator-OBO token acquisition (product_250 M-1, batch B)
 * @package @vxture/bff-admin
 * @layer BFF
 * @description
 *   Exchanges the current operator's RP-session access token for a short-lived
 *   management-plane token (aud = provider product_code, e.g. "atlas") via the
 *   platform token endpoint's operator-OBO mode (RFC 8693). The minted token is
 *   what the model-platform proxy forwards to the provider — the BFF never
 *   calls a provider's management API with its own identity (M-1 铁律).
 *
 *   Tokens are cached per (subject token, audience) slightly under their 300s
 *   TTL so a burst of admin-page requests costs one exchange, while a session
 *   refresh (new subject token) naturally rotates the cache key.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";

const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
/** Cache slightly under the mint TTL (300s) so we never forward a stale token. */
const CACHE_TTL_MS = 240_000;
/** Hard cap; entries are pruned on insert. One operator ↔ few audiences in practice. */
const CACHE_MAX_ENTRIES = 256;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

@Injectable()
export class OperatorExchangeService {
  private readonly logger = new Logger(OperatorExchangeService.name);
  private readonly cache = new Map<string, CachedToken>();

  constructor(@Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime) {}

  /**
   * Returns a management-plane token for `audience`, or null when the exchange
   * fails (callers degrade to an unauthenticated upstream call — during the
   * transition the provider ignores the header; once the provider enforces
   * M-1 verification, a null here surfaces as the provider's own 401).
   */
  async getToken(
    subjectToken: string,
    audience: string,
  ): Promise<string | null> {
    const key = `${audience}\n${subjectToken}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAtMs > Date.now()) {
      return hit.accessToken;
    }

    const cfg = this.rpRuntime.config;
    const base = (cfg.backchannelIssuer ?? cfg.issuer).replace(/\/+$/, "");
    let response: Response;
    try {
      response = await fetch(`${base}/oidc/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          subject_token: subjectToken,
          subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
          audience,
        }).toString(),
      });
    } catch (e) {
      this.logger.warn(
        `operator-OBO exchange unreachable (aud=${audience}): ${(e as Error).message}`,
      );
      return null;
    }
    if (!response.ok) {
      this.logger.warn(
        `operator-OBO exchange rejected (aud=${audience}, status=${response.status})`,
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
