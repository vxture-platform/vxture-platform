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

@Injectable()
export class OperatorMfaService {
  private totpKey: Buffer | null = null;

  constructor(
    @Inject(PgOperatorRepository)
    private readonly operators: PgOperatorRepository,
    @Inject(VxConfigService) private readonly config: VxConfigService,
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

  /**
   * Resolve the MFA obligation for an operator login. An unknown operator id
   * (anomalous after a successful first factor) resolves to "no MFA" so the
   * caller fails downstream on findById rather than this path leaking account
   * existence.
   *
   * OPERATOR_MFA_DEV_BYPASS: explicit opt-in, local convenience only. Read via
   * VxConfigService (not raw process.env) so it can't leak across test workers
   * that load `.env.local` for unrelated config domains, and fails closed in
   * production regardless of the value — never gate it on anything an operator
   * deploy could set.
   */
  async resolveLoginMfa(operatorId: string): Promise<OperatorLoginMfa> {
    if (!this.config.isProduction && this.config.auth.OPERATOR_MFA_DEV_BYPASS) {
      return {
        decision: {
          effectivePolicy: "disabled",
          mfaRequired: false,
          enrollRequired: false,
          webauthnRequired: false,
          enrollFactor: null,
        },
        methods: [],
      };
    }
    const ctx = await this.operators.getMfaContext(operatorId);
    if (!ctx) {
      return {
        decision: {
          effectivePolicy: "disabled",
          mfaRequired: false,
          enrollRequired: false,
          webauthnRequired: false,
          enrollFactor: null,
        },
        methods: [],
      };
    }
    const decision = decideMfa(
      {
        platformDefault: ctx.platformDefault,
        roleFloor: ctx.roleFloor,
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
   * Begin TOTP enrollment: generate a fresh secret, stage it (encrypted,
   * unconfirmed) on the operator_mfa row, and return the base32 secret +
   * otpauth URI for the QR. Confirmed by the first valid code (confirmTotp).
   */
  async beginTotpEnrollment(operatorId: string): Promise<TotpEnrollment> {
    const operator = await this.operators.findById(operatorId);
    if (!operator) throw new BadRequestException("invalid_grant");
    const secret = generateTotpSecret();
    await this.operators.upsertPendingTotpSecret(
      operatorId,
      encryptSecret(secret, this.secretKey()),
    );
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
   * Confirm TOTP enrollment with the first code. On success the staged secret is
   * enabled, a fresh batch of recovery codes is issued (returned once for
   * display), and TOTP becomes a usable factor. `{ ok: false }` on a wrong code
   * (the caller decides whether to burn an attempt).
   */
  async confirmTotpEnrollment(
    operatorId: string,
    code: string,
  ): Promise<{ ok: false } | { ok: true; recoveryCodes: string[] }> {
    const enrollment = await this.operators.getTotpEnrollment(operatorId);
    if (!enrollment?.secret) return { ok: false };
    const secret = decryptSecret(enrollment.secret, this.secretKey());
    if (!verifyTotp(secret, code, { window: 1 })) return { ok: false };
    await this.operators.enableTotp(operatorId);
    const recoveryCodes = await this.issueRecoveryCodes(operatorId);
    return { ok: true, recoveryCodes };
  }
}
