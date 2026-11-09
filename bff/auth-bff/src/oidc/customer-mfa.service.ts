/**
 * customer-mfa.service.ts - customer authenticator enrollment and login verification.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-08
 */
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
// ⚠️ Cross-layer reference: persistence stays in the customer account domain.
import {
  CustomerMfaRepository,
  type CustomerFactor,
} from "@vxture/service-account";
// ⚠️ Cross-layer reference: reuse tested RFC primitives, without workforce account access.
import {
  buildOtpauthUri,
  generateTotpSecret,
  generateRecoveryCodes,
  generateTotp,
  hashRecoveryCode,
} from "@vxture/service-iam";
// ⚠️ Cross-layer reference: configuration and encryption are infrastructure APIs.
import { VxConfigService } from "@vxture/core-config";
import {
  deriveSecretKey,
  encryptSecret,
  decryptSecret,
} from "@vxture/core-utils";
import { RedisService } from "../redis/redis.service";

// ============================================================================
// Customer-only ceremonies and key separation
// ============================================================================
@Injectable()
export class CustomerMfaService {
  constructor(
    @Inject(CustomerMfaRepository)
    private readonly factors: CustomerMfaRepository,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  private key(): Buffer {
    const key = this.config.auth.OPERATOR_TOTP_ENC_KEY;
    if (!key) throw new ServiceUnavailableException("mfa_unavailable");
    return deriveSecretKey(`${key}:customer-mfa:v1`);
  }
  async enabled(userId: string): Promise<boolean> {
    return Boolean(await this.factors.read(userId));
  }

  /** A code time step is accepted once, even across simultaneous pending logins. */
  private counter(secret: string, code: string): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const now = Math.floor(Date.now() / 30000);
    for (const offset of [0, -1, 1]) {
      const counter = now + offset;
      const expected = generateTotp(secret, { timestamp: counter * 30 });
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(code)))
        return counter;
    }
    return null;
  }

  async beginEnrollment(userId: string, sid: string, account: string) {
    if (await this.enabled(userId))
      throw new BadRequestException("mfa_already_enrolled");
    const token = randomUUID(),
      secret = generateTotpSecret();
    await this.redis.storeAccountsCeremony(token, {
      kind: "customer-enrollment",
      userId,
      sid,
      secret: encryptSecret(secret, this.key()),
    });
    return {
      enrollmentToken: token,
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        accountName: account,
        issuer: "VXTURE Accounts",
      }),
    };
  }

  async confirmEnrollment(
    userId: string,
    sid: string,
    token: string,
    code: string,
  ) {
    const raw = await this.redis.attemptAccountsCeremony(token);
    if (!raw) throw new BadRequestException("mfa_session_expired");
    const pending = JSON.parse(raw) as {
      kind: string;
      userId: string;
      sid: string;
      secret: string;
    };
    if (
      pending.kind !== "customer-enrollment" ||
      pending.userId !== userId ||
      pending.sid !== sid
    )
      throw new BadRequestException("mfa_owner_mismatch");
    const counter = this.counter(
      decryptSecret(pending.secret, this.key()),
      code,
    );
    if (counter === null) throw new BadRequestException("invalid_code");
    if (!(await this.redis.consumeAccountsCeremony(token, raw)))
      throw new BadRequestException("mfa_session_expired");
    const recoveryCodes = generateRecoveryCodes();
    if (
      !(await this.factors.activate(
        userId,
        pending.secret,
        recoveryCodes.map(hashRecoveryCode),
        counter,
        sid,
      ))
    )
      throw new BadRequestException("mfa_state_changed");
    return { recoveryCodes };
  }

  /** Share the account attempt budget and bind a consumed proof to its factor version. */
  private async verifiedFactor(
    userId: string,
    method: string,
    code: string,
  ): Promise<CustomerFactor | null> {
    if (
      !(await this.redis.reserveCustomerSecurityBudget(
        `mfa:${userId}`,
        [10, 50, 100],
      ))
    )
      throw new HttpException("too_many_attempts", 429);
    const factor = await this.factors.read(userId);
    if (!factor) return null;
    if (method === "recovery") {
      const accepted = await this.factors.consumeRecovery(
        userId,
        factor.version,
        hashRecoveryCode(code),
      );
      return accepted ? factor : null;
    }
    if (method !== "totp") return null;
    const counter = this.counter(
      decryptSecret(factor.secret, this.key()),
      code,
    );
    const accepted =
      counter !== null &&
      (await this.factors.consumeCounter(userId, factor.version, counter));
    return accepted ? factor : null;
  }

  /** Bound guesses across every pending login, then consume the factor proof atomically. */
  async verify(userId: string, method: string, code: string): Promise<boolean> {
    return Boolean(await this.verifiedFactor(userId, method, code));
  }

  /**
   * Disable only the factor version proven by this authenticated customer.
   * @param userId - Guard-owned customer identifier.
   * @param sid - Current customer session, rechecked by the write transaction.
   * @param method - TOTP or a one-use recovery code.
   * @param code - Fresh proof that is never stored in plaintext.
   * @returns Confirmation after durable revocation of all customer sessions.
   * @throws {BadRequestException} For an invalid proof or a concurrent factor change.
   */
  async disable(userId: string, sid: string, method: string, code: string) {
    const factor = await this.verifiedFactor(userId, method, code);
    if (!factor) throw new BadRequestException("invalid_code");
    if (!(await this.factors.remove(userId, factor.version, sid)))
      throw new BadRequestException("mfa_state_changed");
    return { ok: true as const, reauthenticate: true as const };
  }
}
