/**
 * operator-webauthn.router.ts — operator WebAuthn/Passkey registration endpoints.
 * @package @vxture/bff-auth
 *
 * Authenticated registration ceremony (P3.1): the operator must already hold an
 * operator central session (vx_sid_op, read from the cookie). Served on the
 * operator login surface (accounts) so the ceremony origin matches the WebAuthn
 * RP. See identity-platform-operator.md §2.1.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Header,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { OperatorWebauthnCredentialDetail } from "@vxture/service-iam";
import { AccountReauthenticationService } from "../authn/account-reauthentication.service";
import { OperatorWebauthnService } from "../oidc/operator-webauthn.service";
import { OperatorSelfGuard } from "../authn/operator-self.guard";
import { SID_COOKIE_NAME as SID_COOKIE } from "../authn/cookie";

// ============================================================================
// Workforce account self-service
// ============================================================================

@Controller()
@UseGuards(OperatorSelfGuard)
export class OperatorWebauthnRouter {
  constructor(
    @Inject(OperatorWebauthnService)
    private readonly webauthn: OperatorWebauthnService,
    @Inject(AccountReauthenticationService)
    private readonly reauthentication: AccountReauthenticationService,
  ) {}

  /** Begin passkey registration → options JSON (challenge parked server-side). */
  @Post("oidc/operator/webauthn/register/options")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async options(
    @Req() req: Request,
    @Body() body: { proofToken?: unknown },
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    await this.reauthentication.require(
      "workforce",
      operatorSid(req),
      body?.proofToken,
      "passkey-add",
      "",
    );
    return this.webauthn.createRegistrationOptions(operatorSid(req));
  }

  /** Finish passkey registration → verify attestation + persist the credential. */
  @Post("oidc/operator/webauthn/register/verify")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: { response?: RegistrationResponseJSON; proofToken?: unknown },
    @Req() req: Request,
  ): Promise<{ credentialId: string }> {
    if (!body?.response) {
      throw new BadRequestException("invalid_request");
    }
    await this.reauthentication.require(
      "workforce",
      operatorSid(req),
      body.proofToken,
      "passkey-add",
      "",
      true,
    );
    return this.webauthn.verifyRegistration(operatorSid(req), body.response);
  }

  /** List the authenticated operator's passkeys (management UI). */
  @Get("oidc/operator/webauthn/credentials")
  @Header("Cache-Control", "no-store")
  async list(
    @Req() req: Request,
  ): Promise<{ credentials: OperatorWebauthnCredentialDetail[] }> {
    return {
      credentials: await this.webauthn.listCredentials(operatorSid(req)),
    };
  }

  /** Rename a passkey. */
  @Patch("oidc/operator/webauthn/credentials/:id")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async rename(
    @Param("id") id: string,
    @Body() body: { label?: string },
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    if (!body?.label) {
      throw new BadRequestException("invalid_request");
    }
    await this.webauthn.renameCredential(operatorSid(req), id, body.label);
    return { ok: true };
  }

  /** Revoke a passkey (anti-lockout enforced for webauthn-required operators). */
  @Delete("oidc/operator/webauthn/credentials/:id")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: { proofToken?: unknown },
  ): Promise<{ ok: true }> {
    await this.reauthentication.require(
      "workforce",
      operatorSid(req),
      body?.proofToken,
      "passkey-remove",
      id,
      true,
    );
    await this.webauthn.revokeCredential(operatorSid(req), id);
    return { ok: true };
  }
}

// ============================================================================
// Cookie selection
// ============================================================================

/** Read the operator central-session cookie from the request. */
function operatorSid(req: Request): string | undefined {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  return cookies[SID_COOKIE.operator];
}
