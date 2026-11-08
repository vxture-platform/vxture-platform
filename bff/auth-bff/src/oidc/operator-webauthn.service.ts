/**
 * operator-webauthn.service.ts — operator WebAuthn/Passkey ceremonies.
 * @package @vxture/bff-auth
 *
 * Registration + assertion for operator passkeys (identity-platform-operator.md
 * §2.1):
 *   - registration (P3.1): authenticated (vx_sid_op) via *ForOperator wrappers,
 *     or by operator id for enroll-on-login (P3.3 high-privilege bootstrap).
 *   - assertion (P3.2): second factor at login, with a sign_count clone guard.
 * Env-driven RP config (rpID / rpName / origin — never hardcoded); fail-closed
 * when unconfigured. One-time challenges parked in Redis (60s) and consumed on
 * verify so a response cannot be replayed. Attestation 'none'; authenticator
 * attachment unrestricted (platform + roaming). Credential management UI = P3.4.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import {
  isWebauthnCounterRegression,
  PgOperatorRepository,
  type OperatorWebauthnCredentialDetail,
} from "@vxture/service-iam";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { RedisService } from "../redis/redis.service";
import { RealmSessionService } from "./realm-session.service";

const WEBAUTHN_CHALLENGE_TTL_SECONDS = 60;

interface WebauthnRp {
  rpID: string;
  rpName: string;
  origin: string;
}

@Injectable()
export class OperatorWebauthnService {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealmSessionService)
    private readonly realmSession: RealmSessionService,
  ) {}

  /** Env-driven RP config; fail-closed when unconfigured. */
  private rp(): WebauthnRp {
    const rpID = this.config.auth.OPERATOR_WEBAUTHN_RP_ID;
    const origin = this.config.auth.OPERATOR_WEBAUTHN_ORIGIN;
    const rpName = this.config.auth.OPERATOR_WEBAUTHN_RP_NAME;
    if (!rpID || !origin) {
      throw new ServiceUnavailableException("operator_webauthn_unavailable");
    }
    return { rpID, rpName, origin };
  }

  /** Resolve the operator id from the operator central session; 401 otherwise. */
  private async resolveOperatorId(sid: string | undefined): Promise<string> {
    return this.realmSession.requireOperator(sid);
  }

  /**
   * Build registration options for the authenticated operator (vx_sid_op) and
   * park the challenge (60s) for anti-replay. Excludes already-registered
   * credentials.
   */
  async createRegistrationOptions(
    sid: string | undefined,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.createRegistrationOptionsForOperator(
      await this.resolveOperatorId(sid),
    );
  }

  /**
   * Build registration options for a known operator id — the enroll-on-login
   * path (P3.3) where the operator is identified by mfa_pending, not a session.
   */
  async createRegistrationOptionsForOperator(
    operatorId: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { rpID, rpName } = this.rp();
    const operator = await this.operators.findById(operatorId);
    if (!operator) throw new UnauthorizedException("operator_session_required");

    const existing = await this.operators.listWebauthnCredentials(operatorId);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(operatorId),
      userName: operator.username,
      userDisplayName: operator.username,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    await this.redis.storeOperatorWebauthnChallenge(
      operatorId,
      options.challenge,
      WEBAUTHN_CHALLENGE_TTL_SECONDS,
    );
    return options;
  }

  /**
   * Verify the registration response against the parked challenge and persist the
   * credential. Missing/expired challenge or a failed attestation → explicit
   * error (never silently accepted).
   */
  async verifyRegistration(
    sid: string | undefined,
    response: RegistrationResponseJSON,
  ): Promise<{ credentialId: string }> {
    return this.verifyRegistrationForOperator(
      await this.resolveOperatorId(sid),
      response,
    );
  }

  /** Verify + persist a registration for a known operator id (enroll-on-login). */
  async verifyRegistrationForOperator(
    operatorId: string,
    response: RegistrationResponseJSON,
  ): Promise<{ credentialId: string }> {
    const { rpID, origin } = this.rp();

    const expectedChallenge =
      await this.redis.consumeOperatorWebauthnChallenge(operatorId);
    if (!expectedChallenge) {
      throw new BadRequestException("webauthn_challenge_expired");
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException("webauthn_verification_failed");
    }

    const { credential, aaguid } = verification.registrationInfo;
    await this.operators.insertWebauthnCredential({
      operatorId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      signCount: credential.counter,
      transports: credential.transports ?? [],
      aaguid: aaguid ?? null,
    });
    return { credentialId: credential.id };
  }

  // ─── assertion (second factor at login, P3.2) ─────────────────────────────

  /**
   * Build authentication (assertion) options for an operator's registered
   * passkeys and park the challenge (60s) for anti-replay. Throws when the
   * operator has no credentials (the caller should not have offered webauthn).
   */
  async createAuthenticationOptions(
    operatorId: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const { rpID } = this.rp();
    const creds =
      await this.operators.getWebauthnCredentialsForAuth(operatorId);
    if (creds.length === 0) {
      throw new BadRequestException("no_webauthn_credentials");
    }
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: "preferred",
    });
    await this.redis.storeOperatorWebauthnAuthChallenge(
      operatorId,
      options.challenge,
      WEBAUTHN_CHALLENGE_TTL_SECONDS,
    );
    return options;
  }

  /**
   * Verify an assertion against the parked challenge. Returns true on success
   * (after advancing the stored signature counter), false on an unknown
   * credential / failed signature, and rejects a clone/rollback (counter did not
   * advance). Missing/expired challenge → explicit error.
   */
  async verifyAuthentication(
    operatorId: string,
    response: AuthenticationResponseJSON,
  ): Promise<boolean> {
    const { rpID, origin } = this.rp();
    const expectedChallenge =
      await this.redis.consumeOperatorWebauthnAuthChallenge(operatorId);
    if (!expectedChallenge) {
      throw new BadRequestException("webauthn_challenge_expired");
    }

    const creds =
      await this.operators.getWebauthnCredentialsForAuth(operatorId);
    const match = creds.find((c) => c.credentialId === response.id);
    if (!match) return false;

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: match.credentialId,
          publicKey: new Uint8Array(match.publicKey),
          counter: match.signCount,
          transports: match.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      // Bad signature / format / library-side counter regression → reject.
      return false;
    }
    if (!verification.verified) return false;

    const newCounter = verification.authenticationInfo.newCounter;
    // Explicit clone/rollback guard (belt-and-suspenders over the library check):
    // a non-advancing counter must not authenticate, and must not persist.
    if (isWebauthnCounterRegression(match.signCount, newCounter)) {
      return false;
    }
    await this.operators.updateWebauthnSignCount(
      operatorId,
      match.credentialId,
      newCounter,
    );
    return true;
  }

  // ─── credential management (authenticated, P3.4) ──────────────────────────

  /** List the authenticated operator's passkeys (no secret material). */
  async listCredentials(
    sid: string | undefined,
  ): Promise<OperatorWebauthnCredentialDetail[]> {
    const operatorId = await this.resolveOperatorId(sid);
    return this.operators.listWebauthnCredentialsDetailed(operatorId);
  }

  /** Rename one of the operator's passkeys (by row id). */
  async renameCredential(
    sid: string | undefined,
    id: string,
    label: string,
  ): Promise<void> {
    const operatorId = await this.resolveOperatorId(sid);
    const trimmed = label.trim();
    if (!trimmed) throw new BadRequestException("invalid_label");
    const ok = await this.operators.renameWebauthnCredential(
      operatorId,
      id,
      trimmed,
    );
    if (!ok) throw new NotFoundException("credential_not_found");
  }

  /**
   * Revoke one of the operator's passkeys (by row id). Anti-lockout: a
   * webauthn-required operator cannot remove their last passkey (§2.1).
   */
  async revokeCredential(sid: string | undefined, id: string): Promise<void> {
    const operatorId = await this.resolveOperatorId(sid);
    const ctx = await this.operators.getMfaContext(operatorId);
    if (ctx?.webauthnRequired && ctx.webauthnCredentialCount <= 1) {
      throw new BadRequestException("last_webauthn_credential");
    }
    const ok = await this.operators.deleteWebauthnCredential(operatorId, id);
    if (!ok) throw new NotFoundException("credential_not_found");
  }
}
