/**
 * operator-mfa.service.ts — operator second-factor resolution + verification.
 * @package @vxture/bff-auth
 *
 * The MFA brain of the two-step operator login (identity-platform-operator.md
 * §2/§3). Two responsibilities:
 *   1. resolveLoginMfa — read the operator's policy inputs + enrollment and
 *      derive the login obligation via the iam policy resolver (decideMfa): does
 *      this login need a second factor, and if so which methods are available
 *      (or must the operator enroll first).
 *   2. verifySecondFactor — the verification seam dispatched by method. P2.2
 *      establishes the dispatch; the concrete verifiers land later: TOTP (P2.3),
 *      recovery codes (P2.4), WebAuthn (P3). Until implemented a method is
 *      reported unsupported.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import {
  buildOtpauthUri,
  decideMfa,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  PgOperatorRepository,
  verifyTotp,
  type MfaDecision,
  type OperatorMfaContext,
} from "@vxture/service-iam";
import {
  decryptSecret,
  deriveSecretKey,
  encryptSecret,
} from "./operator-secret-cipher";
import { RedisService } from "../redis/redis.service";

/** Authenticator-app issuer label shown next to the operator account. */
const TOTP_ISSUER = "Vxture";

/** The login-flow MFA outcome for an operator who passed the first factor. */
export interface OperatorLoginMfa {
  decision: MfaDecision;
  /** Registered second factors usable now; empty when enrollment is required. */
  methods: string[];
}

/** A presented second factor to verify against a pending MFA challenge. */
export interface SecondFactorInput {
  operatorId: string;
  method: string;
  code: string;
}

/** TOTP enrollment material handed to the UI (rendered as a QR + manual key). */
export interface TotpEnrollment {
  /** base32 plaintext secret — shown once for manual entry. */
  secret: string;
  /** otpauth:// provisioning URI — rendered as the QR code. */
  otpauthUri: string;
}

// ============================================================================
// Policy, verification and enrollment
// ============================================================================

@Injectable()
export class OperatorMfaService {
  private totpKey: Buffer | null = null;

  constructor(
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Derived AES key for TOTP secrets; fail-closed when unconfigured. */
  private secretKey(): Buffer {
    if (!this.totpKey) {
      const raw = this.config.auth.OPERATOR_TOTP_ENC_KEY;
      if (!raw) {
        throw new ServiceUnavailableException("operator_totp_unavailable");
      }
      this.totpKey = deriveSecretKey(raw);
    }
    return this.totpKey;
  }

  /** Workforce authentication always requires an enrolled second factor. */
  async resolveLoginMfa(operatorId: string): Promise<OperatorLoginMfa> {
    const ctx = await this.operators.getMfaContext(operatorId);
    if (!ctx) throw new BadRequestException("invalid_grant");
    const decision = decideMfa(
      {
        platformDefault: ctx.platformDefault,
        roleFloor: "required",
        personal: ctx.personalPolicy,
      },
      {
        totpEnabled: ctx.totpEnabled,
        webauthnCredentialCount: ctx.webauthnCredentialCount,
        webauthnRequired: ctx.webauthnRequired,
      },
    );
    let methods: string[];
    if (decision.enrollRequired) {
      methods = [];
    } else if (decision.webauthnRequired) {
      // High-privilege: only the passkey is offered (TOTP/recovery rejected).
      methods = ["webauthn"];
    } else {
      methods = this.enrolledMethods(ctx);
    }
    return { decision, methods };
  }

  /** Registered second factors for an operator, in presentation order. */
  private enrolledMethods(ctx: OperatorMfaContext): string[] {
    const methods: string[] = [];
    if (ctx.totpEnabled) methods.push("totp");
    if (ctx.webauthnCredentialCount > 0) methods.push("webauthn");
    return methods;
  }

  /**
   * Verify a presented second factor. Returns true on success, false on a wrong
   * but well-formed code (caller burns an attempt), or throws BadRequest for an
   * unsupported / not-yet-implemented method. Concrete verifiers are wired in
   * later tasks (see file header).
   */
  async verifySecondFactor(input: SecondFactorInput): Promise<boolean> {
    switch (input.method) {
      case "totp":
        return this.verifyTotpCode(input.operatorId, input.code);
      case "recovery":
        return this.operators.consumeRecoveryCode(
          input.operatorId,
          hashRecoveryCode(input.code),
        );
      // case "webauthn": → P3
      default:
        throw new BadRequestException("unsupported_mfa_method");
    }
  }

  /**
   * Generate a fresh batch of single-use recovery codes, persist their hashes
   * (replacing any prior set), and return the plaintext codes for one-time
   * display. Called at enrollment (identity-platform-operator.md §2.1).
   */
  async issueRecoveryCodes(operatorId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.operators.replaceRecoveryCodes(
      operatorId,
      codes.map(hashRecoveryCode),
    );
    return codes;
  }

  /** Verify a TOTP code against the operator's enabled secret (±1 step). */
  private async verifyTotpCode(
    operatorId: string,
    code: string,
  ): Promise<boolean> {
    const enrollment = await this.operators.getTotpEnrollment(operatorId);
    if (!enrollment?.enabled || !enrollment.secret) return false;
    const secret = decryptSecret(enrollment.secret, this.secretKey());
    return verifyTotp(secret, code, { window: 1 });
  }

  /**
   * Stage an encrypted secret without changing the active factor or recovery codes.
   * @param operatorId - Workforce account owning this ceremony.
   * @param context - Login challenge or authenticated session plus ceremony token.
   * @param initialOnly - Reject enrollment-on-login once any factor exists.
   * @param expected - Factor state observed before self-service reauthentication.
   * @returns QR material for this ceremony only.
   * @throws {BadRequestException} When the account or enrollment policy rejects it.
   */
  async beginTotpEnrollment(
    operatorId: string,
    context: string,
    initialOnly = false,
    expected?: { secret: string | null; enabled: boolean },
  ): Promise<TotpEnrollment> {
    const operator = await this.operators.findById(operatorId);
    if (!operator) throw new BadRequestException("invalid_grant");
    const ctx = await this.operators.getMfaContext(operatorId);
    if (!ctx || ctx.webauthnRequired)
      throw new BadRequestException("webauthn_required");
    if (initialOnly && (ctx.totpEnabled || ctx.webauthnCredentialCount > 0)) {
      throw new BadRequestException("mfa_already_enrolled");
    }
    const previous = await this.operators.getTotpEnrollment(operatorId);
    if (
      expected &&
      ((previous?.secret ?? null) !== expected.secret ||
        (previous?.enabled ?? false) !== expected.enabled)
    ) {
      throw new BadRequestException("mfa_state_changed");
    }
    const secret = generateTotpSecret();
    const stored = await this.redis.storeOperatorTotpPending(
      operatorId,
      context,
      {
        secret: encryptSecret(secret, this.secretKey()),
        previousSecret: previous?.secret ?? null,
        previousEnabled: previous?.enabled ?? false,
        initialOnly,
      },
    );
    if (!stored) throw new BadRequestException("mfa_enrollment_in_progress");
    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        accountName: operator.username,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  /**
   * Consume one ceremony and atomically activate its factor and recovery codes.
   * @param operatorId - Workforce account owning this ceremony.
   * @param code - First code generated by the new authenticator.
   * @param context - Exact context used to stage the secret.
   * @returns Recovery codes once, or failure for expired, stale or invalid proof.
   * @throws {Error} When the stores are unavailable; active material remains intact.
   */
  async confirmTotpEnrollment(
    operatorId: string,
    code: string,
    context: string,
  ): Promise<{ ok: false } | { ok: true; recoveryCodes: string[] }> {
    const attempt = await this.redis.attemptOperatorTotpPending(
      operatorId,
      context,
    );
    if (!attempt) return { ok: false };
    const secret = decryptSecret(attempt.pending.secret, this.secretKey());
    if (!verifyTotp(secret, code, { window: 1 })) return { ok: false };
    if (
      !(await this.redis.consumeOperatorTotpPending(
        operatorId,
        context,
        attempt.version,
      ))
    ) {
      return { ok: false };
    }
    const recoveryCodes = generateRecoveryCodes();
    const activated = await this.operators.activateTotpEnrollment(operatorId, {
      ...attempt.pending,
      recoveryHashes: recoveryCodes.map(hashRecoveryCode),
    });
    if (!activated) return { ok: false };
    return { ok: true, recoveryCodes };
  }
}
