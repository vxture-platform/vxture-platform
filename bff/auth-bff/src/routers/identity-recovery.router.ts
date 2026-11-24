/**
 * Authenticated logout recovery endpoints; no browser credential fallback.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  Body,
  Controller,
  Headers,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { VxConfigService } from "@vxture/core-config";
// ⚠️ 跨层引用: Delegate confidential-client authentication to the public IAM repository.
import { PgOidcClientRepository } from "@vxture/service-iam";
import {
  IdentityRecoveryRepository,
  recoveryError,
  type RecoveryProfile,
} from "../authn/identity-recovery.repository";
import { parseSessionStatusCredentials } from "../oidc/session-status";

// ============================================================================
// Authentication and strict bounded request shapes
// ============================================================================
@Controller("oidc/identity")
export class IdentityRecoveryRouter {
  constructor(
    @Inject(IdentityRecoveryRepository)
    private readonly recovery: IdentityRecoveryRepository,
    @Inject(PgOidcClientRepository)
    private readonly clients: PgOidcClientRepository,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  private async run<T>(
    authorization: string | undefined,
    req: Request,
    res: Response,
    action: (client: string, body: Record<string, unknown>) => Promise<T>,
    body: unknown,
  ): Promise<T> {
    res.setHeader("Cache-Control", "no-store");
    try {
      const credentials = parseSessionStatusCredentials(authorization);
      const client = await this.clients.authenticateClient(
        credentials.clientId,
        credentials.clientSecret!,
      );
      if (!client || client.tokenEndpointAuthMethod !== "client_secret_basic")
        throw recoveryError("INVALID_CLIENT", 401);
      if (
        client.realm !== "customer" &&
        !(
          client.realm === "workforce" &&
          process.env.WORKFORCE_IDENTITY_SYNC_ENABLED === "true"
        )
      )
        throw recoveryError("CAPABILITY_NOT_ENABLED", 403);
      if (
        !req.is("application/json") ||
        Object.keys(req.query).length ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      )
        throw recoveryError("INVALID_REQUEST");
      return await action(client.clientId, body as Record<string, unknown>);
    } catch (error) {
      if (error instanceof HttpException) {
        if (error.getStatus() === 401) {
          res.setHeader("WWW-Authenticate", 'Basic realm="accounts"');
          throw recoveryError("INVALID_CLIENT", 401);
        }
        throw error;
      }
      throw recoveryError("IDENTITY_UNAVAILABLE", 503);
    }
  }

  /** @returns A single consistent snapshot; no token, cookie or permission grant. */
  @Post("snapshot")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  snapshot(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.snapshotFor("logout-v1", authorization, body, req, res);
  }

  /** @returns Context/access versions for explicitly enabled platform BFFs. */
  @Post("changes/snapshot")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  changesSnapshot(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.snapshotFor("changes-v1", authorization, body, req, res);
  }

  private snapshotFor(
    profile: RecoveryProfile,
    authorization: string | undefined,
    body: unknown,
    req: Request,
    res: Response,
  ) {
    return this.run(
      authorization,
      req,
      res,
      async (client, fields) => {
        const sids = fields.sids;
        if (
          Object.keys(fields).length !== 1 ||
          !Array.isArray(sids) ||
          sids.length > 100 ||
          sids.some(
            (sid: unknown) =>
              typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sid),
          ) ||
          new Set(sids).size !== sids.length
        )
          throw recoveryError("INVALID_REQUEST");
        return this.recovery.snapshot(
          client,
          this.config.auth.OIDC_ISSUER,
          sids as string[],
          profile,
        );
      },
      body,
    );
  }

  /** @returns A bounded page after a signed cursor from snapshot or prior recovery. */
  @Post("events")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  events(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.eventsFor("logout-v1", authorization, body, req, res);
  }

  /** @returns Committed context/access invalidations; these never grant permissions. */
  @Post("changes/events")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  changesEvents(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.eventsFor("changes-v1", authorization, body, req, res);
  }

  private eventsFor(
    profile: RecoveryProfile,
    authorization: string | undefined,
    body: unknown,
    req: Request,
    res: Response,
  ) {
    return this.run(
      authorization,
      req,
      res,
      async (client, fields) => {
        const limit = fields.limit ?? 100;
        if (
          Object.keys(fields).some(
            (key) => !["cursor", "limit"].includes(key),
          ) ||
          typeof fields.cursor !== "string" ||
          fields.cursor.length > 512 ||
          typeof limit !== "number" ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          throw recoveryError("INVALID_REQUEST");
        return this.recovery.events(
          client,
          this.config.auth.OIDC_ISSUER,
          fields.cursor,
          limit,
          profile,
        );
      },
      body,
    );
  }
}
