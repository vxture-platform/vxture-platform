/**
 * Customer SMS purpose and single-use ceremony orchestration.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
// ⚠️ Cross-layer import: provider dispatch stays in the notification domain.
import { PhoneCodeService } from "@vxture/service-sms";
import { RedisService } from "../redis/redis.service";

export interface CustomerCodeOptions {
  scope:
    | "customer-login"
    | "customer-register"
    | "customer-social-bind"
    | "customer-security"
    | "customer-phone-change";
  context?: string;
}

// ============================================================================
// Purpose-bound send and verification lifecycle
// ============================================================================
@Injectable()
export class CustomerPhoneCodeService {
  constructor(
    @Inject(PhoneCodeService) private readonly phoneCode: PhoneCodeService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Send a code only after atomically reserving a bounded ceremony.
   * @param phone - Domestic phone number.
   * @param options - Trusted purpose and optional social binding owner.
   * @returns After the matching ceremony is activated.
   * @throws {Error} On invalid input, throttling or unavailable dependencies.
   */
  async sendCode(phone: string, options: CustomerCodeOptions): Promise<void> {
    const target = this.target(phone, options);
    const owner = randomUUID();
    const context = options.context ?? "";
    if (
      !(await this.redis.beginCustomerCode(
        options.scope,
        target,
        context,
        owner,
      ))
    )
      throw new HttpException(
        "too_many_attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    try {
      await this.phoneCode.sendCode(target, { scope: options.scope });
      if (
        !(await this.redis.finishCustomerCodeSend(
          options.scope,
          target,
          context,
          owner,
          true,
        ))
      )
        throw new ServiceUnavailableException("phone_code_delivery_expired");
    } catch (error) {
      await this.redis.finishCustomerCodeSend(
        options.scope,
        target,
        context,
        owner,
        false,
      );
      throw error;
    }
  }

  /**
   * Check provider acceptance and consume the exact ceremony before authorizing use.
   * @param phone - Code delivery target.
   * @param code - Submitted code.
   * @param options - Trusted purpose and binding owner used during dispatch.
   * @returns True for only one successful check within the five-attempt budget.
   * @throws {Error} On invalid input or unavailable dependencies.
   */
  async verifyCode(
    phone: string,
    code: string,
    options: CustomerCodeOptions,
  ): Promise<boolean> {
    const target = this.target(phone, options);
    if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return false;
    const context = options.context ?? "";
    const owner = await this.redis.acquireCustomerCode(
      options.scope,
      target,
      context,
    );
    if (!owner) return false;
    let accepted: boolean;
    try {
      accepted = await this.phoneCode.verifyCode(target, code.trim(), {
        scope: options.scope,
      });
    } catch (error) {
      await this.redis.finishCustomerCodeCheck(
        options.scope,
        target,
        context,
        owner,
        false,
      );
      throw error;
    }
    return this.redis.finishCustomerCodeCheck(
      options.scope,
      target,
      context,
      owner,
      accepted,
    );
  }

  private target(phone: string, options: CustomerCodeOptions): string {
    if (
      !options ||
      ![
        "customer-login",
        "customer-register",
        "customer-social-bind",
        "customer-security",
        "customer-phone-change",
      ].includes(options.scope)
    )
      throw new BadRequestException("invalid_code_purpose");
    if (
      [
        "customer-social-bind",
        "customer-security",
        "customer-phone-change",
      ].includes(options.scope) &&
      !options.context
    )
      throw new BadRequestException("invalid_binding_token");
    const target =
      typeof phone === "string" ? phone.trim().replace(/\s+/g, "") : "";
    if (!/^1[3-9]\d{9}$/.test(target))
      throw new BadRequestException("invalid_phone");
    return target;
  }
}
