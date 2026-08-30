/**
 * integration-signal.service.ts - C2 "last seen" signal per product.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category service
 * @description
 *   Every successful `GET /platform/entitlements` read leaves a per-product
 *   marker in Redis (`<prefix>integration:c2:<productCode>`, JSON, 30-day
 *   TTL). opera-bff reads it back (`GET /api/products/:id/integration-signals`)
 *   so the launch checklist item `c2_entitlement` is verified from a fact the
 *   platform itself observed, not from a manual tick
 *   (docs/20-specs/000-platform/opera/40-product-registry.md §2 step 2).
 *
 *   What the marker is — and is not:
 *   - A last-seen timestamp, not a ledger. One key per product, overwritten
 *     on every write; there is no history and no count.
 *   - Attribution follows the credential. S2S callers are attributed to
 *     `act.sub` (which `scopeToS2sCaller` already forces to equal the
 *     requested product). Shared-internal-header callers carry no identity,
 *     so they are attributed to the product code(s) they asked about.
 *
 *   Operational contract: this is a side channel of a hot read path, so it
 *   must never change the HTTP response. Writes are throttled in memory
 *   (at most one per product per minute), fired without awaiting, and a
 *   Redis failure is logged once per failure streak and otherwise ignored.
 *   The Redis client is the same shared platform Redis the RP session stores
 *   use (`REDIS_URL` from secrets/platform.env); it is optional to the
 *   process — the host boots and serves without it.
 *
 * @author AI-Generated
 * @date 2026-08-31
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import Redis from "ioredis";

// ============================================================================
// Types
// ============================================================================

/** Which credential the entitlement read authenticated with. */
export type EntitlementSeenVia = "s2s" | "internal-auth";

export interface EntitlementSeenInput {
  productCode: string;
  via: EntitlementSeenVia;
  workspaceId: string | null;
}

/**
 * The stored JSON value. opera-bff parses exactly this shape back
 * (`product-integration-signals.router.ts`) — change both or neither.
 */
export interface EntitlementSeenSignal {
  lastSeenAt: string;
  via: EntitlementSeenVia;
  workspaceId: string | null;
}

/** The one Redis command the recorder needs; ioredis satisfies it. */
export interface SignalRedisClient {
  set(key: string, value: string, mode: "EX", ttlSec: number): Promise<unknown>;
}

interface SignalLogger {
  warn(message: string): void;
  log(message: string): void;
}

export interface EntitlementSeenRecorderOptions {
  client: SignalRedisClient;
  /** Redis key prefix (REDIS_KEY_PREFIX); shared with every other key on this Redis. */
  keyPrefix: string;
  log: SignalLogger;
  /** Injectable clock for tests. */
  now?: () => number;
  throttleMs?: number;
  ttlSec?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Key = `${REDIS_KEY_PREFIX}${C2_SIGNAL_KEY_INFIX}${productCode}`; opera-bff builds the same. */
export const C2_SIGNAL_KEY_INFIX = "integration:c2:";

/** 30 days: long enough to survive a quiet product, short enough to expire a retired one. */
export const C2_SIGNAL_TTL_SEC = 30 * 24 * 60 * 60;

/** At most one Redis write per product per minute. */
export const C2_SIGNAL_THROTTLE_MS = 60_000;

/**
 * Build the Redis key for a product's C2 signal.
 *
 * @param keyPrefix - REDIS_KEY_PREFIX of this deployment
 * @param productCode - product_code (act.sub of the caller)
 * @returns the fully prefixed key
 */
export function c2SignalKey(keyPrefix: string, productCode: string): string {
  return `${keyPrefix}${C2_SIGNAL_KEY_INFIX}${productCode}`;
}

// ============================================================================
// Recorder (pure, testable)
// ============================================================================

/**
 * Throttled, fire-and-forget writer. Framework-free so the throttle and the
 * no-throw contract can be unit-tested with a fake client and a fake clock.
 */
export class EntitlementSeenRecorder {
  private readonly client: SignalRedisClient;
  private readonly keyPrefix: string;
  private readonly log: SignalLogger;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly ttlSec: number;
  /** Last attempt (not last success) per product — a failing Redis must not be hammered either. */
  private readonly lastAttemptAt = new Map<string, number>();
  /** True while inside a failure streak: the first failure logs, the rest stay quiet. */
  private failing = false;

  constructor(options: EntitlementSeenRecorderOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix;
    this.log = options.log;
    this.now = options.now ?? Date.now;
    this.throttleMs = options.throttleMs ?? C2_SIGNAL_THROTTLE_MS;
    this.ttlSec = options.ttlSec ?? C2_SIGNAL_TTL_SEC;
  }

  /**
   * Record one successful entitlement read. Returns synchronously; never
   * throws and never rejects anything the caller could observe.
   *
   * @param input - who asked, via which credential, for which workspace
   */
  record(input: EntitlementSeenInput): void {
    const now = this.now();
    const last = this.lastAttemptAt.get(input.productCode);
    if (last !== undefined && now - last < this.throttleMs) return;
    this.lastAttemptAt.set(input.productCode, now);

    const value: EntitlementSeenSignal = {
      lastSeenAt: new Date(now).toISOString(),
      via: input.via,
      workspaceId: input.workspaceId,
    };
    const key = c2SignalKey(this.keyPrefix, input.productCode);

    let pending: Promise<unknown>;
    try {
      pending = this.client.set(key, JSON.stringify(value), "EX", this.ttlSec);
    } catch (error) {
      this.onFailure(error);
      return;
    }
    pending.then(
      () => this.onSuccess(),
      (error: unknown) => this.onFailure(error),
    );
  }

  private onSuccess(): void {
    if (this.failing) {
      this.failing = false;
      this.log.log("C2 signal writes recovered");
    }
  }

  private onFailure(error: unknown): void {
    if (this.failing) return;
    this.failing = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.log.warn(
      `C2 signal write failed; entitlement reads keep serving, further failures stay quiet until one write succeeds: ${reason}`,
    );
  }
}

// ============================================================================
// Nest service (owns the Redis connection)
// ============================================================================

@Injectable()
export class IntegrationSignalService implements OnModuleDestroy {
  private readonly logger = new Logger(IntegrationSignalService.name);
  private readonly redis: Redis;
  private readonly recorder: EntitlementSeenRecorder;
  private connectionErrorLogged = false;

  constructor(@Inject(VxConfigService) config: VxConfigService) {
    const r = config.redis;
    // Same construction as the RP session stores (opera-bff oidc-rp.module.ts).
    // Offline queue stays on so a write issued while the socket is still
    // connecting is flushed rather than dropped; maxRetriesPerRequest bounds
    // how long a queued write can linger when Redis is actually down.
    this.redis = r.REDIS_URL
      ? new Redis(r.REDIS_URL, { maxRetriesPerRequest: 3 })
      : new Redis({
          host: r.REDIS_HOST,
          port: r.REDIS_PORT,
          password: r.REDIS_PASSWORD,
          db: r.REDIS_DB,
          maxRetriesPerRequest: 3,
        });
    // ioredis emits "error" on every reconnect attempt; without a listener it
    // prints an unhandled-event warning per attempt. One line per outage.
    this.redis.on("error", (error: Error) => {
      if (this.connectionErrorLogged) return;
      this.connectionErrorLogged = true;
      this.logger.warn(
        `Redis unavailable for C2 signals (entitlement reads unaffected): ${error.message}`,
      );
    });
    this.redis.on("ready", () => {
      if (!this.connectionErrorLogged) return;
      this.connectionErrorLogged = false;
      this.logger.log("Redis reconnected for C2 signals");
    });
    this.recorder = new EntitlementSeenRecorder({
      client: this.redis,
      keyPrefix: r.REDIS_KEY_PREFIX,
      log: this.logger,
    });
  }

  /**
   * Fire-and-forget: mark this product as having read its entitlements.
   *
   * @param input - who asked, via which credential, for which workspace
   */
  recordEntitlementRead(input: EntitlementSeenInput): void {
    this.recorder.record(input);
  }

  onModuleDestroy(): void {
    // disconnect(), not quit(): quit() waits for a round-trip that never
    // completes when Redis is down, and shutdown must not hang on a side channel.
    this.redis.disconnect();
  }
}
