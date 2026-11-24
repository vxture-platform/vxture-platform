/**
 * One PostgreSQL notification connection fans logout hints to local SSE streams.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category auth
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  HttpException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  IdentityNotificationClient,
  IdentityNotification,
} from "./identity-persistence";

// ============================================================================
// Only scoped invalidation hints cross the notification connection.
// ============================================================================
interface Subscriber {
  subject?: string;
  changed?(): void;
  revoked(): void;
  disconnected(): void;
  heartbeat(): void;
}
export class SessionEventsHub {
  private readonly logger = new Logger(SessionEventsHub.name);
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private client: IdentityNotificationClient | undefined;
  private connected = false;
  private stopped = false;
  private generation = 0;
  private count = 0;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private pulse: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly createClient: () => IdentityNotificationClient,
    private readonly scope: {
      realm?: "customer" | "workforce";
      issuer: string;
      clientId: string;
      environment: string;
    },
    private readonly transportReady: () => boolean,
    private readonly options = {
      heartbeatMs: 25000,
      retryMs: 1000,
      maxConnections: 5000,
      maxPerSid: 32,
    },
    private readonly resetRecovery: () => void = () => undefined,
    private readonly changesEnabled = false,
  ) {}

  /** @returns Whether both persistence notifications and Redis are connected. */
  get ready(): boolean {
    return this.connected && !this.stopped && this.transportReady();
  }

  /** Connect once; failures retry only the disconnected transport, never session state. */
  async onModuleInit(): Promise<void> {
    this.pulse = setInterval(() => {
      for (const group of this.subscribers.values())
        for (const subscriber of group) subscriber.heartbeat();
    }, this.options.heartbeatMs);
    this.pulse.unref();
    await this.connect();
  }

  /** Release sockets and timers during application shutdown. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.pulse) clearInterval(this.pulse);
    this.invalidate();
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  /** Drop streams after a transport generation changes; reconnect must reauthenticate. */
  invalidate(): void {
    this.generation += 1;
    this.resetRecovery();
    const subscriptions = [...this.subscribers.values()].flatMap((group) => [
      ...group,
    ]);
    this.subscribers.clear();
    this.count = 0;
    for (const subscriber of subscriptions) subscriber.disconnected();
  }

  /**
   * Subscribe before final session verification so a concurrent logout cannot be lost.
   * @param sid Identity loaded from the RP store, never from request parameters.
   * @param subscriber Bounded connection callbacks; callers recheck durable state on hints.
   * @returns Cleanup and a connection-generation predicate.
   */
  subscribe(sid: string, subscriber: Subscriber) {
    if (!this.ready)
      throw new ServiceUnavailableException("Session events unavailable");
    const group = this.subscribers.get(sid) ?? new Set<Subscriber>();
    if (
      this.count >= this.options.maxConnections ||
      group.size >= this.options.maxPerSid
    )
      throw new HttpException("Session event connection limit reached", 429);
    this.subscribers.set(sid, group);
    group.add(subscriber);
    this.count += 1;
    const generation = this.generation;
    return {
      current: () => this.ready && this.generation === generation,
      unsubscribe: () => {
        if (this.subscribers.get(sid) !== group || !group.delete(subscriber))
          return;
        this.count -= 1;
        if (!group.size) this.subscribers.delete(sid);
      },
    };
  }

  // ========================================================================
  // LISTEN is broadcast to every BFF instance. Missed hints force a fresh snapshot.
  // ========================================================================
  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = this.createClient();
    this.client = client;
    client.onNotification((notification) => this.notify(notification));
    client.onDisconnect(() => this.lost(client));
    try {
      await client.connect();
      await client.query("LISTEN rp_session_revoked");
      if (this.changesEnabled) {
        await client.query("LISTEN rp_identity_changed");
        const installed = await client.query(`select 1 from pg_trigger where
          tgrelid='session.rp_identity_versions'::regclass and tgname='trg_rp_identity_notify'
          and tgenabled in ('O','A') and not tgisinternal`);
        if (!installed.rowCount)
          throw new Error("Identity notification migration required");
      }
      const result = await client.query(`select 1 from pg_trigger where
        tgrelid='session.rp_revocation_receipts'::regclass
        and tgname='trg_rp_revocation_notify' and tgenabled in ('O','A') and not tgisinternal`);
      if (!result.rowCount)
        throw new Error("Session notification migration required");
      if (this.stopped || this.client !== client) return;
      this.connected = true;
      this.attempts = 0;
    } catch {
      this.lost(client);
    }
  }

  private lost(client: IdentityNotificationClient): void {
    if (this.client !== client) return;
    this.client = undefined;
    this.connected = false;
    this.invalidate();
    void client.end().catch(() => undefined);
    if (this.stopped) return;
    this.logger.warn(
      "Session event listener disconnected; streams require recovery",
    );
    const delay = Math.min(
      30000,
      this.options.retryMs * 2 ** Math.min(this.attempts++, 5),
    );
    this.retry = setTimeout(
      () => {
        void this.connect();
      },
      Math.min(30000, delay + Math.floor((Math.random() * delay) / 2)),
    );
    this.retry.unref();
  }

  private notify(notification: IdentityNotification): void {
    if (
      !this.ready ||
      ![
        "rp_session_revoked",
        ...(this.changesEnabled ? ["rp_identity_changed"] : []),
      ].includes(notification.channel) ||
      !notification.payload
    )
      return;
    try {
      const data = JSON.parse(notification.payload) as Record<
        string,
        unknown
      > | null;
      if (
        !data ||
        data.issuer !== this.scope.issuer ||
        data.client_id !== this.scope.clientId ||
        data.realm !== (this.scope.realm ?? "customer") ||
        data.environment !== this.scope.environment
      )
        return;
      if (notification.channel === "rp_identity_changed") {
        if (
          typeof data.subject_key !== "string" ||
          typeof data.sub !== "string"
        )
          return;
        if (data.kind === "context") {
          for (const subscriber of this.subscribers.get(data.subject_key) ?? [])
            if (subscriber.subject === data.sub) subscriber.changed?.();
        } else if (data.kind === "access" && data.subject_key === data.sub) {
          for (const group of this.subscribers.values())
            for (const subscriber of group)
              if (subscriber.subject === data.sub) subscriber.changed?.();
        }
      } else if (
        typeof data.sid === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(data.sid)
      ) {
        for (const subscriber of this.subscribers.get(data.sid) ?? [])
          subscriber.revoked();
      }
    } catch {
      // Malformed hints cannot become logout facts or expose a payload in logs.
    }
  }
}
