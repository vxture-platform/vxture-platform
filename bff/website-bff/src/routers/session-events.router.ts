/**
 * Host routing for the shared RP session stream.
 * @package @vxture/bff-website
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-24
 */
import { Controller, Get, Inject, Optional, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
// ⚠️ 跨层引用: Shared transport never grants business access.
import {
  SessionEventsEndpoint,
  type RpAuthService,
  type RpSessionStore,
  type SessionRecoveryAuthority,
  type SessionEventsHub,
  type IdentityChangesAuthority,
} from "@vxture/core-oidc-rp";
import {
  RP_SESSION_EVENTS,
  RP_RECOVERY,
  RP_SESSION_STORE,
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  RP_CHANGES,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
@Controller("auth")
export class SessionEventsRouter extends SessionEventsEndpoint {
  constructor(
    @Inject(RP_SESSION_EVENTS) hub: SessionEventsHub | null,
    @Inject(RP_RECOVERY) authority: SessionRecoveryAuthority | null,
    @Inject(RP_SESSION_STORE) store: RpSessionStore,
    @Inject(RP_AUTH_SERVICE) auth: RpAuthService,
    @Inject(RP_RUNTIME) runtime: RpRuntime,
    @Optional() @Inject(RP_CHANGES) changes?: IdentityChangesAuthority | null,
  ) {
    super(hub, authority, store, auth, runtime, changes);
  }
  @Get("events")
  override events(@Req() req: Request, @Res() res: Response): Promise<void> {
    return super.events(req, res);
  }
}
