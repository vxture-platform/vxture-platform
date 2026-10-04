/**
 * legacy-auth-usage.service.ts - E6：谁还在走旧凭据（按月 / 路由 / 产品计数）。
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category service
 * @description
 *   内部面口令拆分（2026-10-04，E1）之后，产品面继续收共享口令 `AUTH_INTERNAL_TOKEN`
 *   （`x-vxture-internal-auth`），直到每个产品都换成 S2S 票（E3a）。E3a 那天 owner 要的是
 *   一张「谁还在走旧凭据」的表；此前唯一的信号是 C2 的「最近一次」键（只存最后一笔、带
 *   `via`），usage / sharing / provisioning 三个 router 什么都不记。
 *
 *   计数：Redis hash `<REDIS_KEY_PREFIX>integration:legacy-auth:<YYYY-MM>`（UTC 月），
 *   field `<route>|<product>`，HINCRBY，键 TTL 90 天。`route` ∈ `LEGACY_AUTH_ROUTES`；
 *   `product` = 请求里自报的产品码——旧头没有身份，归因只能跟 C2 信号同一条规则；
 *   entitlements 一次请求问几个产品码就记几笔（问的是「哪个产品还在走」，不是请求数）。
 *   opera-bff 读回来（`product-integration-signals.router.ts` 的 `legacyAuth`），接入检查 /
 *   运行健康的 C2 那格旁显示「本月仍有 n 次调用走旧共享凭据」。
 *
 *   不洪水：进程内 Map 聚合，每 60s 一次批量 HINCRBY；日志每 (route, product) 每小时至多
 *   一行（`n` 是自上一行以来累计的次数）。契约与 `EntitlementSeenRecorder` 相同：**永不改
 *   响应、永不抛**；Redis 坏了一个 streak 记一条 warn 然后静默，直到有一次写成功。
 *
 *   发射点在四个 router 的 `scopeToS2sCaller` 之后、`s2sCaller` 为 undefined 的分支——
 *   不放进 guard：guard 那一层还没解析出产品码。
 *
 *   看不见什么（写下来，免得把「0」读成「没人走」）：
 *   - 进程退出前不满 60s 的那一批：`onModuleDestroy` 做一次尽力 flush，但 `disconnect()`
 *     不等它，重启那一刻最多丢一分钟；
 *   - 写失败的那一批不重试（重试会在 Redis 长时间不可用时无限堆积）；
 *   - 被 `scopeToS2sCaller` 以 `deny` 拒掉的旧凭据调用（`intent=reserve`）——那条路 403，
 *     在发射点之前就抛了；
 *   - 产品码在发射点上还没经目录校验（`resolveProductId` 在它之后），拿着口令的调用方
 *     可以用随机码撑大 hash——所以每月至多 `LEGACY_AUTH_MAX_FIELDS` 个 field，超过的
 *     归到 `<route>|__other__`，Map 与 hash 两头都有界。
 *
 * @author AI-Generated
 * @date 2026-10-04
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

/** 产品面的五条路由；field 的前半段。opera-bff 原样回显，不做词表映射。 */
export const LEGACY_AUTH_ROUTES = [
  "entitlements",
  "usage.consume",
  "usage.gauge",
  "sharing.visible-set",
  "provisioning.ack",
] as const;
export type LegacyAuthRoute = (typeof LEGACY_AUTH_ROUTES)[number];

export interface LegacyAuthUsageInput {
  route: LegacyAuthRoute;
  /** 请求里自报的产品码（旧头没有身份；归因规则同 C2 信号）。 */
  productCode: string;
}

/** The two Redis commands the recorder needs; ioredis satisfies them. */
export interface LegacyAuthRedisClient {
  hincrby(key: string, field: string, increment: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

interface UsageLogger {
  warn(message: string): void;
  log(message: string): void;
}

export interface LegacyAuthUsageRecorderOptions {
  client: LegacyAuthRedisClient;
  /** Redis key prefix (REDIS_KEY_PREFIX); shared with every other key on this Redis. */
  keyPrefix: string;
  log: UsageLogger;
  /** Injectable clock for tests（fake timers 也会替换 Date.now，默认即可）。 */
  now?: () => number;
  flushMs?: number;
  ttlSec?: number;
  logIntervalMs?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Key = `${REDIS_KEY_PREFIX}${LEGACY_AUTH_KEY_INFIX}${YYYY-MM}`; opera-bff builds the same. */
export const LEGACY_AUTH_KEY_INFIX = "integration:legacy-auth:";

/** 90 days: three months of history is enough to say "still" on E3a day. */
export const LEGACY_AUTH_TTL_SEC = 90 * 24 * 60 * 60;

/** One batched HINCRBY round per minute. */
export const LEGACY_AUTH_FLUSH_MS = 60_000;

/** One log line per (route, product) per hour. */
export const LEGACY_AUTH_LOG_INTERVAL_MS = 60 * 60 * 1000;

/** Per-month cap on distinct fields; beyond it the product part becomes `__other__`. */
export const LEGACY_AUTH_MAX_FIELDS = 512;
export const LEGACY_AUTH_OVERFLOW_PRODUCT = "__other__";

/** 日志限速表的上限：超过就整表清空（与 auth-bff 的 invalid_internal_auth warn 同一手法）。 */
const LOG_TABLE_MAX_ENTRIES = 4096;

/**
 * UTC month of a timestamp, as the key suffix.
 *
 * @param nowMs - epoch milliseconds
 * @returns `YYYY-MM`
 */
export function legacyAuthMonth(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/**
 * Build the Redis key for a month's legacy-auth counters.
 *
 * @param keyPrefix - REDIS_KEY_PREFIX of this deployment
 * @param month - `YYYY-MM` (UTC)
 * @returns the fully prefixed key
 */
export function legacyAuthKey(keyPrefix: string, month: string): string {
  return `${keyPrefix}${LEGACY_AUTH_KEY_INFIX}${month}`;
}

/**
 * Hash field for one (route, product) pair.
 *
 * @param route - one of LEGACY_AUTH_ROUTES
 * @param productCode - self-reported product code
 * @returns `<route>|<product>`
 */
export function legacyAuthField(
  route: LegacyAuthRoute,
  productCode: string,
): string {
  return `${route}|${productCode}`;
}

function splitField(field: string): { route: string; product: string } {
  const at = field.indexOf("|");
  return at < 0
    ? { route: field, product: "" }
    : { route: field.slice(0, at), product: field.slice(at + 1) };
}

// ============================================================================
// Recorder (pure, testable)
// ============================================================================

/**
 * Batched, fire-and-forget counter. Framework-free so the batching, the
 * hourly log throttle and the no-throw contract can be unit-tested with a
 * fake client and fake timers.
 */
export class LegacyAuthUsageRecorder {
  private readonly client: LegacyAuthRedisClient;
  private readonly keyPrefix: string;
  private readonly log: UsageLogger;
  private readonly now: () => number;
  private readonly flushMs: number;
  private readonly ttlSec: number;
  private readonly logIntervalMs: number;
  /** month → field → count，等下一次 flush。 */
  private readonly pending = new Map<string, Map<string, number>>();
  /** field → 上一次打日志的时刻（ms）。 */
  private readonly lastLoggedAt = new Map<string, number>();
  /** field → 自上一行日志以来累计的次数。 */
  private readonly sinceLastLog = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** True while inside a failure streak: the first failure logs, the rest stay quiet. */
  private failing = false;

  constructor(options: LegacyAuthUsageRecorderOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix;
    this.log = options.log;
    this.now = options.now ?? Date.now;
    this.flushMs = options.flushMs ?? LEGACY_AUTH_FLUSH_MS;
    this.ttlSec = options.ttlSec ?? LEGACY_AUTH_TTL_SEC;
    this.logIntervalMs = options.logIntervalMs ?? LEGACY_AUTH_LOG_INTERVAL_MS;
  }

  /**
   * Count one request that came in on the legacy header. Synchronous, never
   * throws, touches nothing but an in-memory Map.
   *
   * @param input - which route, which self-reported product
   */
  record(input: LegacyAuthUsageInput): void {
    const month = legacyAuthMonth(this.now());
    let byField = this.pending.get(month);
    if (!byField) {
      byField = new Map();
      this.pending.set(month, byField);
    }
    let field = legacyAuthField(input.route, input.productCode);
    if (!byField.has(field) && byField.size >= LEGACY_AUTH_MAX_FIELDS) {
      field = legacyAuthField(input.route, LEGACY_AUTH_OVERFLOW_PRODUCT);
    }
    byField.set(field, (byField.get(field) ?? 0) + 1);
  }

  /** Start the periodic flush. The timer is unref'd: it never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Push the pending counts to Redis in one HINCRBY per field plus one EXPIRE
   * per key. Returns synchronously; never throws and never rejects anything
   * the caller could observe. A failed batch is dropped, not retried.
   */
  flush(): void {
    if (this.pending.size === 0) return;
    const batches = [...this.pending.entries()];
    this.pending.clear();
    const now = this.now();
    const writes: Promise<unknown>[] = [];
    // A client that throws synchronously is folded into the same rejection path.
    const call = (fn: () => Promise<unknown>): Promise<unknown> => {
      try {
        return fn();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };
    for (const [month, byField] of batches) {
      const key = legacyAuthKey(this.keyPrefix, month);
      for (const [field, n] of byField) {
        writes.push(call(() => this.client.hincrby(key, field, n)));
        this.noteForLog(field, n, now);
      }
      writes.push(call(() => this.client.expire(key, this.ttlSec)));
    }
    Promise.all(writes).then(
      () => this.onSuccess(),
      (error: unknown) => this.onFailure(error),
    );
  }

  /** One line per (route, product) per hour; `n` accumulates between lines. */
  private noteForLog(field: string, n: number, now: number): void {
    if (this.lastLoggedAt.size >= LOG_TABLE_MAX_ENTRIES) {
      this.lastLoggedAt.clear();
      this.sinceLastLog.clear();
    }
    const total = (this.sinceLastLog.get(field) ?? 0) + n;
    const last = this.lastLoggedAt.get(field);
    if (last !== undefined && now - last < this.logIntervalMs) {
      this.sinceLastLog.set(field, total);
      return;
    }
    this.lastLoggedAt.set(field, now);
    this.sinceLastLog.set(field, 0);
    const { route, product } = splitField(field);
    this.log.log(
      `legacy internal-auth: route=${route} product=${product} n=${total}`,
    );
  }

  private onSuccess(): void {
    if (this.failing) {
      this.failing = false;
      this.log.log("legacy internal-auth counter writes recovered");
    }
  }

  private onFailure(error: unknown): void {
    if (this.failing) return;
    this.failing = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.log.warn(
      `legacy internal-auth counter write failed; the product-face requests were already served, further failures stay quiet until one write succeeds: ${reason}`,
    );
  }
}

// ============================================================================
// Nest service (owns the Redis connection)
// ============================================================================

@Injectable()
export class LegacyAuthUsageService implements OnModuleDestroy {
  private readonly logger = new Logger(LegacyAuthUsageService.name);
  private readonly redis: Redis;
  private readonly recorder: LegacyAuthUsageRecorder;
  private connectionErrorLogged = false;

  constructor(@Inject(VxConfigService) config: VxConfigService) {
    const r = config.redis;
    // Same construction as IntegrationSignalService (and the RP session stores):
    // offline queue on so a write issued while the socket is still connecting is
    // flushed rather than dropped; maxRetriesPerRequest bounds how long a queued
    // write can linger when Redis is actually down.
    this.redis = r.REDIS_URL
      ? new Redis(r.REDIS_URL, { maxRetriesPerRequest: 3 })
      : new Redis({
          host: r.REDIS_HOST,
          port: r.REDIS_PORT,
          password: r.REDIS_PASSWORD,
          db: r.REDIS_DB,
          maxRetriesPerRequest: 3,
        });
    this.redis.on("error", (error: Error) => {
      if (this.connectionErrorLogged) return;
      this.connectionErrorLogged = true;
      this.logger.warn(
        `Redis unavailable for legacy internal-auth counters (product-face requests unaffected): ${error.message}`,
      );
    });
    this.redis.on("ready", () => {
      if (!this.connectionErrorLogged) return;
      this.connectionErrorLogged = false;
      this.logger.log("Redis reconnected for legacy internal-auth counters");
    });
    this.recorder = new LegacyAuthUsageRecorder({
      client: this.redis,
      keyPrefix: r.REDIS_KEY_PREFIX,
      log: this.logger,
    });
    this.recorder.start();
  }

  /**
   * Fire-and-forget: count one request that authenticated with the legacy
   * shared header. Call it only when `s2sCaller` is undefined.
   *
   * @param input - which route, which self-reported product
   */
  record(input: LegacyAuthUsageInput): void {
    this.recorder.record(input);
  }

  onModuleDestroy(): void {
    this.recorder.stop();
    // Best effort: whatever is pending goes out now; disconnect() does not wait
    // for it (quit() would hang when Redis is down), so a restart can lose at
    // most the last minute of counts.
    this.recorder.flush();
    this.redis.disconnect();
  }
}
