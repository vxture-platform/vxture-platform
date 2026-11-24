/**
 * Reliable standard OIDC logout delivery for durable customer sessions.
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
  SessionLogoutRepository,
  type LogoutDelivery,
} from "../authn/session-logout.repository";
import { OidcKeyService } from "../oidc/oidc-key.service";

// ============================================================================
// Durable queue scheduling: LISTEN wakes fast, the bounded scan repairs misses.
// ============================================================================

@Injectable()
export class SessionLogoutJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SessionLogoutJob.name);
  private listener: PoolClient | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private wakePending = false;
  private stopped = false;

  constructor(
    @Inject(SessionLogoutRepository)
    private readonly queue: SessionLogoutRepository,
    @Inject(OidcKeyService) private readonly keys: OidcKeyService,
  ) {}

  onApplicationBootstrap(): void {
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
        this.logger.error("Customer logout delivery recovery failed");
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
      await listener.query("LISTEN customer_session_logout");
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
    await this.queue.expire();
    for (let batch = 0; batch < 10 && !this.stopped; batch += 1) {
      const jobs = await this.queue.claim();
      if (!jobs.length) return;
      const results = await Promise.allSettled(
        jobs.map((job) => this.deliver(job)),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Customer logout delivery persistence failed");
    }
    // Yield to request handling while continuing a nonempty durable backlog.
    this.wakePending = true;
  }

  // ========================================================================
  // Transport policy: standard logout JWT, fresh envelope, no redirects.
  // ========================================================================

  /**
   * Apply one leased delivery; persisting failure is part of completing a pass.
   * @param job Leased durable recipient.
   * @returns Nothing; failures remain recoverable in the queue.
   */
  async deliver(job: LogoutDelivery): Promise<void> {
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
        endpoint = new URL(job.logout_uri);
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
      const token = this.keys.sign(
        {
          sid: job.sid,
          events: { "http://schemas.openid.net/event/backchannel-logout": {} },
        },
        {
          audience: job.client_id,
          subject: `${job.realm === "workforce" ? "opr_" : "usr_"}${job.user_id}`,
          expiresInSec: 120,
        },
      );
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ logout_token: token }).toString(),
      });
      await response.body?.cancel();
      if (response.status === 200 || response.status === 204) {
        await this.queue.finish(job, "delivered", null);
        return;
      }
      if (response.status !== 429 && response.status < 500) {
        await this.quarantine(job, `http_${response.status}`);
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

  private async quarantine(job: LogoutDelivery, reason: string): Promise<void> {
    if (await this.queue.finish(job, "quarantined", reason))
      this.logger.warn(
        `Customer logout delivery requires recovery: ${job.id} (${reason})`,
      );
  }
}
