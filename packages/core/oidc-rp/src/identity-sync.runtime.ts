/**
 * Host-supplied persistence and transport composition for optional RP synchronization.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category runtime
 * @author AI-Generated
 * @date 2026-11-24
 */
import { SessionRecoveryAuthority } from "./session-recovery.authority";
import { IdentityChangesAuthority } from "./identity-changes.authority";
import {
  HttpIdentityRecoveryClient,
  type IdentityEnvironment,
} from "./identity-recovery.client";
import {
  HttpIdentityChangesClient,
  IdentityEventVerifier,
} from "./identity-changes.client";
import { SessionEventsHub } from "./session-events.hub";
import type {
  IdentitySqlPool,
  IdentityNotificationClient,
} from "./identity-persistence";
import type { OidcRpConfig } from "./types";

// ============================================================================
// Independent flags remain host-owned; no registration is created implicitly.
// ============================================================================
export class IdentitySyncRuntime {
  readonly recovery: SessionRecoveryAuthority | null = null;
  readonly changes: IdentityChangesAuthority | null = null;
  readonly verifier: IdentityEventVerifier | null = null;
  readonly hub: SessionEventsHub | null = null;
  readonly retirement: boolean;
  constructor(
    config: OidcRpConfig,
    flags: {
      recovery: boolean;
      changes: boolean;
      events: boolean;
      retirement: boolean;
      environment?: string | undefined;
    },
    createPool: () => IdentitySqlPool,
    createListener: () => IdentityNotificationClient,
    transportReady: () => boolean,
  ) {
    this.retirement = flags.retirement;
    if (
      (flags.changes && (!flags.recovery || !flags.events)) ||
      (flags.events && !flags.recovery) ||
      (flags.retirement && !flags.changes)
    )
      throw new Error("Incomplete identity synchronization configuration");
    if (!flags.recovery) return;
    if (
      !config.clientSecret ||
      !["dev", "beta", "prod"].includes(flags.environment ?? "")
    )
      throw new Error("Recovery requires explicit confidential client scope");
    const environment = flags.environment as IdentityEnvironment;
    const scope = {
      issuer: config.issuer,
      clientId: config.clientId,
      environment,
    };
    this.recovery = new SessionRecoveryAuthority(
      createPool(),
      new HttpIdentityRecoveryClient(config, environment),
      scope,
    );
    if (flags.changes) {
      this.changes = new IdentityChangesAuthority(
        createPool(),
        new HttpIdentityChangesClient(config, environment),
        scope,
        this.recovery,
      );
      this.verifier = new IdentityEventVerifier(config, environment);
    }
    if (flags.events)
      this.hub = new SessionEventsHub(
        createListener,
        scope,
        transportReady,
        undefined,
        () => this.reset(),
        flags.changes,
      );
  }
  /** Discard positive confirmations after transport reconnection; retain receipts. */
  reset(): void {
    this.recovery?.reset();
    this.changes?.reset();
  }
  /** Close streams and reset authority when the host's session cache reconnects. */
  invalidate(): void {
    this.reset();
    this.hub?.invalidate();
  }
  async onModuleInit(): Promise<void> {
    await this.hub?.onModuleInit();
  }
  async onModuleDestroy(): Promise<void> {
    await this.hub?.onModuleDestroy();
    await Promise.all([
      this.recovery?.onModuleDestroy(),
      this.changes?.onModuleDestroy(),
    ]);
  }
}
