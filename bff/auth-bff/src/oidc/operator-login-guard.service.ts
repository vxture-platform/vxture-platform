/**
 * operator-login-guard.service.ts - operator-realm login hardening (IdP).
 * @package @vxture/bff-auth
 *
 * Brute-force + bot protection for the operator (admin.operator_account) interactive login,
 * ported from the retired admin-bff local login (Batch 8, D-X). Two layers:
 *   - IP + account fixed-window failure rate-limiting (in-memory, per-instance);
 *   - admin-surface Cloudflare Turnstile verification (env-gated via
 *     CF_TURNSTILE_ENABLED — no-op until enabled, so the accounts login UI can
 *     wire the widget independently).
 *
 * Operator-only by design: the tenant realm is unaffected (D-X scope).
 */

import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import {
  TurnstileVerificationError,
  TurnstileVerifier,
} from "@vxture/core-auth";

const WINDOW_MS = 15 * 60 * 1000; // 15-minute fixed window
const IP_LIMIT = 10; // max failures per IP per window
const ACCOUNT_LIMIT = 5; // max failures per identifier per window
// Must match the accounts operator-login widget's action (OidcLoginForm).
const OPERATOR_TURNSTILE_ACTION = "operator_auth";

interface Bucket {
  attempts: number;
  windowStart: number;
}

@Injectable()
export class OperatorLoginGuard {
  private readonly logger = new Logger(OperatorLoginGuard.name);
  private readonly turnstile = TurnstileVerifier.fromEnv("admin");
  private readonly ipBuckets = new Map<string, Bucket>();
  private readonly accountBuckets = new Map<string, Bucket>();

  /** Throw 429 when the IP or identifier exceeded its failure window. */
  assertWithinRateLimit(ip: string, identifier: string): void {
    const now = Date.now();
    const retryAfter = Math.max(
      this.retryAfter(this.ipBuckets, ip, IP_LIMIT, now),
      this.retryAfter(
        this.accountBuckets,
        identifier.toLowerCase(),
        ACCOUNT_LIMIT,
        now,
      ),
    );
    if (retryAfter > 0) {
      throw new HttpException(
        `too_many_attempts; retry after ${retryAfter}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Verify the admin-surface Turnstile token. No-op when Turnstile is disabled
   * (CF_TURNSTILE_ENABLED unset) so this can ship ahead of the login-UI widget.
   */
  async verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
    try {
      await this.turnstile.verify({
        token: token ?? null,
        remoteIp: ip,
        expectedAction: OPERATOR_TURNSTILE_ACTION,
      });
    } catch (error) {
      // The 401 body stays a bare `human_verification_failed` on purpose - the
      // reason (hostname-mismatch / action-mismatch / Cloudflare error-codes /
      // no token at all) is operator-config or bot-signal information, not
      // something to hand back to the caller. But it MUST land somewhere: until
      // 2026-08-29 it was swallowed here, so a wrong `*_ALLOWED_HOSTNAMES`, a
      // crossed secret and a client that timed out and degraded were all one
      // indistinguishable 401 - and a production incident was diagnosed by
      // guesswork for hours. One warn line per failure, greppable by the stable
      // `captcha_verification_failed` prefix, never the token.
      this.logger.warn(captchaFailureLine("admin", ip, error));
      throw new UnauthorizedException("human_verification_failed");
    }
  }

  /** Record a failed credential attempt (IP + identifier counters +1). */
  recordFailure(ip: string, identifier: string): void {
    const now = Date.now();
    this.increment(this.ipBuckets, ip, now);
    this.increment(this.accountBuckets, identifier.toLowerCase(), now);
  }

  /** Clear the IP + identifier counters after a successful login. */
  recordSuccess(ip: string, identifier: string): void {
    this.ipBuckets.delete(ip);
    this.accountBuckets.delete(identifier.toLowerCase());
  }

  /** Seconds until the key's window frees up, or 0 if currently allowed. */
  private retryAfter(
    buckets: Map<string, Bucket>,
    key: string,
    limit: number,
    now: number,
  ): number {
    const bucket = buckets.get(key);
    if (!bucket) return 0;
    if (now - bucket.windowStart > WINDOW_MS) {
      buckets.delete(key);
      return 0;
    }
    if (bucket.attempts >= limit) {
      return Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
    }
    return 0;
  }

  private increment(
    buckets: Map<string, Bucket>,
    key: string,
    now: number,
  ): void {
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > WINDOW_MS) {
      buckets.set(key, { attempts: 1, windowStart: now });
    } else {
      bucket.attempts += 1;
    }
  }
}

/**
 * One structured line per captcha failure. `reason` is the verifier's own
 * classification; `detail` carries Cloudflare's `error-codes` when there are
 * any. `reason=missing-token` is the client-side degrade path (widget errored
 * or hit the 12 s grace window and submitted without a token) - the one that
 * looks like a bot rejection but is a reachability problem.
 */
export function captchaFailureLine(
  surface: "admin" | "tenant",
  ip: string,
  error: unknown,
): string {
  const reason =
    error instanceof TurnstileVerificationError ? error.reason : "unexpected";
  const detail =
    error instanceof Error ? error.message.replace(/\s+/g, " ") : String(error);
  return `captcha_verification_failed surface=${surface} reason=${reason} ip=${ip} detail="${detail}"`;
}
