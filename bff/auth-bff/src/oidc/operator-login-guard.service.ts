/**
 * operator-login-guard.service.ts - operator-realm login hardening (IdP).
 * @package @vxture/bff-auth
 *
 * Brute-force + bot protection for the operator (admin.operator_account) interactive login,
 * ported from the retired admin-bff local login (Batch 8, D-X). Two layers:
 *   - IP + account fixed-window failure rate-limiting (in-memory, per-instance);
 *   - realm-scoped Aliyun human-verification proof consumption.
 *
 * Operator-only by design: the tenant realm is unaffected (D-X scope).
 */

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { HumanCaptchaService } from "../authn/human-captcha.service";

const WINDOW_MS = 15 * 60 * 1000; // 15-minute fixed window
const IP_LIMIT = 10; // max failures per IP per window
const ACCOUNT_LIMIT = 5; // max failures per identifier per window

interface Bucket {
  attempts: number;
  windowStart: number;
}

@Injectable()
export class OperatorLoginGuard {
  constructor(
    @Inject(HumanCaptchaService) private readonly captcha: HumanCaptchaService,
  ) {}
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

  /** Consume a one-time proof for the workforce domain. */
  async verifyHuman(token: string | undefined, _ip: string): Promise<void> {
    await this.captcha.consume("workforce", token);
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
