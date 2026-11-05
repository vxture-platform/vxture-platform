/**
 * Session verification and distributed refresh without treating outages as logout.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category auth
 * @author AI-Generated
 * @date 2026-11-05
 */
import {
  mapAccessClaims,
  randomToken,
  type RpUser,
} from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: use the canonical verified identity projection.
import type { Request } from "express";
import type { WorkbenchConfig } from "../config";
import { failure } from "../errors";
import {
  validateBinding,
  validateContext,
  type WorkbenchOidcClient,
} from "./oidc-client";
import type { SessionStore } from "./session-store";

export interface Authenticated {
  id: string;
  user: RpUser;
}

/** Independent RP lifecycle: expiry bounds remain stable during token rotation. */
export class SessionService {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(
    private readonly store: SessionStore,
    private readonly client: WorkbenchOidcClient,
    private readonly config: WorkbenchConfig,
  ) {}

  cookie(req: Request): string | undefined {
    const cookies: unknown = req.cookies;
    if (!cookies || typeof cookies !== "object") return undefined;
    const value: unknown = Reflect.get(cookies, this.config.cookieName);
    return typeof value === "string" ? value : undefined;
  }

  // ========================================================================
  // Authentication: Redis coordinates refresh and central checks across pods.
  // ========================================================================
  async authenticate(req: Request): Promise<Authenticated> {
    const id = this.cookie(req);
    if (!id)
      throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Sign in to continue");
    const record = await this.store.read(id);
    if (!record)
      throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Sign in to continue");
    const now = Math.floor(Date.now() / 1000);
    if (
      record.session.nextCheckAt <= now ||
      record.session.accessExpiresAt <= now + 60
    ) {
      let operation = this.pending.get(id);
      if (!operation) {
        operation = this.renew(id);
        this.pending.set(id, operation);
      }
      try {
        await operation;
      } finally {
        if (this.pending.get(id) === operation) this.pending.delete(id);
      }
    }
    // Re-read after the lock so concurrent logout never re-enters through old data.
    const current = await this.store.read(id);
    if (!current)
      throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Sign in to continue");
    const claims = await this.client.verifyAccessToken(
      current.session.accessToken,
    );
    validateContext(claims);
    if (
      claims.sub !== current.session.sub ||
      (claims.sid !== undefined && claims.sid !== current.session.sid) ||
      claims.active_org !== current.session.org ||
      claims.active_workspace !== current.session.workspace
    )
      throw failure(
        401,
        "WORKBENCH_CONTEXT_CHANGED",
        "Session context does not match",
      );
    return { id, user: mapAccessClaims(claims) };
  }

  private async renew(id: string): Promise<void> {
    const owner = randomToken();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const record = await this.store.read(id);
      if (!record)
        throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Sign in to continue");
      const now = Math.floor(Date.now() / 1000);
      if (
        record.session.nextCheckAt > now &&
        record.session.accessExpiresAt > now + 60
      )
        return;
      if (!(await this.store.lock(id, owner))) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        continue;
      }
      try {
        const record = await this.store.read(id);
        if (!record)
          throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Sign in to continue");
        const next = { ...record.session };
        if (next.nextCheckAt <= now) {
          const central = await this.client.centralStatus(next.sid);
          if (!central.valid) {
            await this.store.revokeSid(next.sid);
            throw failure(
              401,
              "WORKBENCH_LOGIN_REQUIRED",
              "Central session ended",
            );
          }
          next.nextCheckAt = central.nextCheckAt;
        }
        if (next.accessExpiresAt <= now + 60) {
          // A rejected refresh is not proof of central logout (#538).
          // Preserve the binding, fail this request, and allow explicit re-login.
          let tokens;
          try {
            tokens = await this.client.refresh(next.refreshToken);
          } catch {
            throw failure(
              503,
              "WORKBENCH_REFRESH_UNAVAILABLE",
              "Session renewal temporarily unavailable",
            );
          }
          const claims = await this.client.verifyAccessToken(
            tokens.accessToken,
          );
          const identity = await this.client.verifyIdToken(tokens.idToken);
          validateBinding(identity, claims);
          if (
            identity.sid !== next.sid ||
            identity.sub !== next.sub ||
            claims.active_org !== next.org ||
            claims.active_workspace !== next.workspace
          )
            throw failure(
              401,
              "WORKBENCH_CONTEXT_CHANGED",
              "Sign in again to confirm the active context",
            );
          Object.assign(next, tokens);
        }
        if (!(await this.store.update(id, record.raw, next)))
          throw failure(
            503,
            "WORKBENCH_SESSION_CHANGED",
            "Session changed; retry",
          );
        return;
      } finally {
        await this.store.unlock(id, owner);
      }
    }
    throw failure(
      503,
      "WORKBENCH_SESSION_BUSY",
      "Session refresh in progress; retry",
    );
  }
}
