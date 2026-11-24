/**
 * Reliable signed identity-change delivery for registered customer platform BFFs.
 * @package @vxture/bff-auth
 * @layer Application
 * @category job
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  IdentityDeliveryRepository,
  type ChangeDelivery,
} from "../authn/identity-delivery.repository";
import { OidcKeyService } from "../oidc/oidc-key.service";

// ============================================================================
// Durable queue scheduling: LISTEN wakes fast, the bounded scan repairs misses.
// ============================================================================

@Injectable()
export class IdentityDeliveryJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(IdentityDeliveryJob.name);
  private listener: PoolClient | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private wakePending = false;
  private stopped = false;

  constructor(
    @Inject(IdentityDeliveryRepository)
    private readonly queue: IdentityDeliveryRepository,
    @Inject(OidcKeyService) private readonly keys: OidcKeyService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.IDENTITY_CHANGE_DELIVERY_ENABLED !== "true") return;
    if (!this.keys.isReady() || this.keys.algorithm !== "RS256")
      throw new Error("Identity delivery requires RS256 signing");
    void this.pass();
    this.timer = setInterval(() => {
      void this.pass();
    }, 30000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
    this.listener?.release(true);
    this.listener = undefined;
  }

  /** @returns Completion of the current bounded recovery/delivery pass. */
  pass(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.wakePending = true;
      return this.running;
    }
    this.running = this.drain()
      .catch(() => {
        this.logger.error("Identity change delivery recovery failed");
      })
      .finally(() => {
        this.running = undefined;
        if (this.wakePending && !this.stopped) {
          this.wakePending = false;
          setImmediate(() => {
            void this.pass();
          });
        }
      });
    return this.running;
  }

  private async listen(): Promise<void> {
    if (this.listener) return;
    const listener = await this.queue.listen();
    this.listener = listener;
    listener.on("notification", () => {
      void this.pass();
    });
    listener.on("error", () => {
      if (this.listener === listener) {
        this.listener = undefined;
        listener.release(true);
      }
    });
    try {
      await listener.query("LISTEN identity_fact_changed");
    } catch (error) {
      if (this.listener === listener) {
        this.listener = undefined;
        listener.release(true);
      }
      throw error;
    }
  }

  private async drain(): Promise<void> {
    await this.listen();
    if ((await this.queue.emitDue()) === 100) this.wakePending = true;
    for (let batch = 0; batch < 10 && !this.stopped; batch += 1) {
      const jobs = await this.queue.claim();
      if (!jobs.length) return;
      const results = await Promise.allSettled(
        jobs.map((job) => this.deliver(job)),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Identity change delivery persistence failed");
    }
    // Yield to request handling while continuing a nonempty durable backlog.
    this.wakePending = true;
  }

  // ========================================================================
  // Transport policy: typed identity JWT, fresh envelope, no redirects.
  // ========================================================================

  /**
   * Apply one leased delivery; persisting failure is part of completing a pass.
   * @param job Leased durable recipient.
   * @returns Nothing; failures remain recoverable in the queue.
   */
  async deliver(job: ChangeDelivery): Promise<void> {
    let failure = "transport_unavailable";
    let retryAfter = 0;
    try {
      if (Date.now() >= job.retry_until.getTime()) {
        await this.quarantine(job, "retry_window_exhausted");
        return;
      }
      if (!(await this.queue.registered(job))) {
        await this.quarantine(job, "registration_changed");
        return;
      }
      let endpoint: URL;
      try {
        endpoint = new URL(job.receiver_uri);
      } catch {
        await this.quarantine(job, "invalid_endpoint");
        return;
      }
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
        endpoint.hostname,
      );
      if (
        (endpoint.protocol !== "https:" &&
          !(endpoint.protocol === "http:" && loopback)) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash
      ) {
        await this.quarantine(job, "invalid_endpoint");
        return;
      }
      if (
        job.issuer !== this.keys.oidcIssuer ||
        this.keys.algorithm !== "RS256"
      ) {
        await this.quarantine(job, "signing_scope_mismatch");
        return;
      }
      const token = this.keys.sign(
        { event: await this.queue.payload(job) },
        {
          audience: job.client_id,
          expiresInSec: 120,
          type: "vxture-identity-event+jwt",
        },
      );
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/jwt" },
        body: token,
      });
      await response.body?.cancel();
      if (response.status === 204) {
        await this.queue.finish(job, "delivered", null);
        return;
      }
      if (response.status !== 429 && response.status < 500) {
        await this.quarantine(job, `http_${response.status}`);
        if (response.status === 401 || response.status === 403)
          await this.queue.suspend(job);
        return;
      }
      failure = `http_${response.status}`;
      const header = response.headers.get("retry-after");
      if (header) {
        const seconds = /^\d+$/.test(header)
          ? Number(header)
          : (Date.parse(header) - Date.now()) / 1000;
        if (Number.isFinite(seconds))
          retryAfter = Math.max(0, Math.min(300, seconds));
      }
    } catch {
      /* Only safe diagnostic codes are persisted below. */
    }
    const cap = Math.min(300, 2 ** Math.min(job.attempts - 1, 9));
    await this.queue.finish(
      job,
      "pending",
      failure,
      Math.max(retryAfter, 0.1, Math.random() * cap),
    );
  }

  private async quarantine(job: ChangeDelivery, reason: string): Promise<void> {
    if (await this.queue.finish(job, "quarantined", reason))
      this.logger.warn(
        `Identity change delivery requires recovery: ${job.id} (${reason})`,
      );
  }
}
