/**
 * One-use customer security ceremonies with exact operation and target binding.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
// ⚠️ 跨层引用: Notification delivery and account contracts remain in their domain packages.
import { MailService } from "@vxture/service-mail";
import type {
  CustomerSecurityOperation,
  CustomerSecuritySnapshot,
} from "@vxture/service-account";
import { CustomerPhoneCodeService } from "./customer-phone-code.service";
import { RedisService } from "../redis/redis.service";
import type { CustomerSessionContext } from "../oidc/realm-session.service";

// ============================================================================
// Server-owned ceremony facts
// ============================================================================

export interface CustomerSecurityChallenge {
  userId: string;
  sid: string;
  operation: CustomerSecurityOperation;
  target: string;
  method: "phone" | "email";
  anchor: string;
  snapshot: CustomerSecuritySnapshot;
  phase:
    | "sending"
    | "anchor"
    | "anchor-busy"
    | "target-pending"
    | "target-sending"
    | "target"
    | "target-busy"
    | "authorized";
  attempts: number;
  digest: string;
}

@Injectable()
export class CustomerSecurityChallengeService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CustomerPhoneCodeService)
    private readonly sms: CustomerPhoneCodeService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /** Start an operation-bound challenge after reserving the account send budget. */
  async start(
    context: CustomerSessionContext,
    operation: CustomerSecurityOperation,
    target: string,
    method: "phone" | "email",
    identitySubjects?: string[],
  ) {
    const user = context.user;
    const verifyingPhone = operation === "phone-verify";
    const verifyingEmail = operation === "email-verify";
    if (
      (verifyingPhone && method !== "phone") ||
      (verifyingEmail && method !== "email")
    )
      throw new BadRequestException("invalid_verification_method");
    if (
      method === "phone"
        ? !user.phone || (!verifyingPhone && !user.phoneVerified)
        : !user.email || (!verifyingEmail && !user.emailVerified)
    )
      throw new BadRequestException("verified_anchor_required");
    if (
      !(await this.redis.reserveCustomerSecurityBudget(
        `send:${context.userId}`,
      ))
    )
      throw new HttpException("too_many_attempts", 429);
    const id = randomUUID();
    const record: CustomerSecurityChallenge = {
      userId: context.userId,
      sid: context.sid,
      operation,
      target,
      method,
      anchor: method === "phone" ? user.phone : user.email!,
      snapshot: {
        ...(identitySubjects ? { identitySubjects } : {}),
        phone: user.phone,
        email: user.email,
        phoneVerified: user.phoneVerified ?? false,
        emailVerified: user.emailVerified ?? false,
        account: user.account,
        accountLoginDisabled: user.accountLoginDisabled ?? false,
        emailLoginDisabled: user.emailLoginDisabled ?? false,
        hasPassword: user.hasPassword ?? false,
      },
      phase: "sending",
      attempts: 0,
      digest: "",
    };
    const code = this.prepareCode(id, record);
    const sending = JSON.stringify(record);
    if (!(await this.redis.createCustomerSecurity(id, sending)))
      throw new ServiceUnavailableException("security_challenge_unavailable");
    try {
      await this.deliver(id, record, code, false);
      record.phase = "anchor";
      if (
        !(await this.redis.swapCustomerSecurity(
          id,
          sending,
          JSON.stringify(record),
        ))
      )
        throw new ServiceUnavailableException("security_delivery_expired");
    } catch (error) {
      await this.redis.swapCustomerSecurity(id, sending, null);
      throw error;
    }
    return { challengeId: id, expiresIn: 600, stage: "anchor" as const };
  }

  /** Verify the anchor or new target, excluding concurrent checks and allowing five attempts. */
  async verify(
    context: CustomerSessionContext,
    id: string,
    code: unknown,
    target = false,
  ) {
    const { record, raw } = await this.load(context, id);
    const phase = target ? "target" : "anchor";
    if (record.phase !== phase)
      throw new BadRequestException("security_challenge_stage");
    if (typeof code !== "string" || !/^\d{6}$/.test(code))
      throw new BadRequestException("invalid_code");
    record.phase = target ? "target-busy" : "anchor-busy";
    record.attempts++;
    const busy = JSON.stringify(record);
    if (!(await this.redis.swapCustomerSecurity(id, raw, busy)))
      throw new BadRequestException("security_challenge_busy");
    let accepted = false;
    try {
      const method = target
        ? record.operation === "phone-change"
          ? "phone"
          : "email"
        : record.method;
      const address = target ? record.target : record.anchor;
      accepted =
        method === "phone"
          ? await this.sms.verifyCode(this.phone(address), code, {
              scope: target ? "customer-phone-change" : "customer-security",
              context: id,
            })
          : timingSafeEqual(
              Buffer.from(record.digest, "hex"),
              Buffer.from(this.digest(id, code), "hex"),
            );
    } catch (error) {
      record.phase = phase;
      await this.redis.swapCustomerSecurity(
        id,
        busy,
        record.attempts >= 5 ? null : JSON.stringify(record),
      );
      throw error;
    }
    record.phase = accepted
      ? !target && ["phone-change", "email-change"].includes(record.operation)
        ? "target-pending"
        : "authorized"
      : phase;
    const stored = await this.redis.swapCustomerSecurity(
      id,
      busy,
      !accepted && record.attempts >= 5 ? null : JSON.stringify(record),
    );
    if (!accepted || !stored) throw new BadRequestException("invalid_code");
    return { ok: true as const, stage: record.phase };
  }

  /** Deliver the new contact's code only after control of the current anchor was proven. */
  async sendTarget(context: CustomerSessionContext, id: string) {
    const { record, raw } = await this.load(context, id);
    if (record.phase !== "target-pending")
      throw new BadRequestException("security_challenge_stage");
    if (
      !(await this.redis.reserveCustomerSecurityBudget(
        `target:${record.operation}:${record.target}`,
      ))
    )
      throw new HttpException("too_many_attempts", 429);
    record.phase = "target-sending";
    record.attempts = 0;
    const code = this.prepareCode(id, record);
    const sending = JSON.stringify(record);
    if (!(await this.redis.swapCustomerSecurity(id, raw, sending)))
      throw new BadRequestException("security_challenge_busy");
    try {
      await this.deliver(id, record, code, true);
      record.phase = "target";
      if (
        !(await this.redis.swapCustomerSecurity(
          id,
          sending,
          JSON.stringify(record),
        ))
      )
        throw new ServiceUnavailableException("security_delivery_expired");
    } catch (error) {
      await this.redis.swapCustomerSecurity(id, sending, null);
      throw error;
    }
    return { ok: true as const, stage: "target" as const };
  }

  /** Consume an authorized proof before applying any account mutation; retries need fresh proof. */
  async consume(
    context: CustomerSessionContext,
    id: string,
    operation?: CustomerSecurityOperation,
  ): Promise<CustomerSecurityChallenge> {
    const { record, raw } = await this.load(context, id);
    if (
      (operation !== undefined && record.operation !== operation) ||
      record.phase !== "authorized" ||
      !(await this.redis.swapCustomerSecurity(id, raw, null))
    )
      throw new BadRequestException("security_proof_required");
    return record;
  }

  // ============================================================================
  // Delivery and exact-owner resolution
  // ============================================================================

  private async load(context: CustomerSessionContext, id: string) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
      throw new BadRequestException("invalid_security_challenge");
    const raw = await this.redis.readCustomerSecurity(id);
    if (!raw) throw new BadRequestException("security_challenge_expired");
    const record = JSON.parse(raw) as CustomerSecurityChallenge;
    if (record.userId !== context.userId || record.sid !== context.sid)
      throw new BadRequestException("security_challenge_owner");
    return { raw, record };
  }
  private prepareCode(id: string, record: CustomerSecurityChallenge) {
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    record.digest = this.digest(id, code);
    return code;
  }
  private digest(id: string, code: string) {
    return createHash("sha256").update(`${id}:${code}`).digest("hex");
  }
  private phone(value: string) {
    return value.replace(/^\+86/, "").replace(/\s/g, "");
  }
  private async deliver(
    id: string,
    record: CustomerSecurityChallenge,
    code: string,
    target: boolean,
  ) {
    const method = target
      ? record.operation === "phone-change"
        ? "phone"
        : "email"
      : record.method;
    const address = target ? record.target : record.anchor;
    if (method === "phone")
      await this.sms.sendCode(this.phone(address), {
        scope: target ? "customer-phone-change" : "customer-security",
        context: id,
      });
    else await this.mail.sendVerifyCode(address, code);
  }
}
