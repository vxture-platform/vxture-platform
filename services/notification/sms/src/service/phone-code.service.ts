/**
 * phone-code.service.ts - purpose-aware Aliyun phone verification.
 * @package @vxture/service-sms
 * @layer Domain
 * @category service
 * @description
 *   Aliyun owns code generation and verification. Customer login, registration,
 *   social binding and workforce phone changes use distinct provider schemes.
 *   Unscoped legacy callers retain a separate compatibility scheme.
 *
 * @author AI-Generated
 * @date 2026-06-29
 */

import { Inject, Injectable } from "@nestjs/common";
import { SmsService } from "./sms.service";

/** Purpose is chosen by trusted server-side callers, never by a request body. */
export interface PhoneCodeOptions {
  scope?:
    | "tenant-auth"
    | "workforce-login"
    | "workforce-phone-change"
    | "customer-login"
    | "customer-register"
    | "customer-social-bind"
    | "customer-security"
    | "customer-phone-change";
}

@Injectable()
export class PhoneCodeService {
  constructor(@Inject(SmsService) private readonly smsService: SmsService) {}

  /**
   * Dispatch through the provider scheme assigned to the purpose.
   * @param phone - Target domestic phone number.
   * @param options - Server-selected verification purpose.
   * @returns When the provider accepts the message.
   * @throws {Error} On invalid configuration or provider failure.
   */
  async sendCode(phone: string, options: PhoneCodeOptions = {}): Promise<void> {
    await this.smsService.sendVerifyCode(normalizePhone(phone), options.scope);
  }

  /**
   * Check the code in the same provider scheme used for dispatch.
   * @param phone - Target phone number.
   * @param code - Submitted code.
   * @param options - Server-selected verification purpose.
   * @returns Whether the provider accepts the code.
   * @throws {Error} On invalid configuration or provider failure.
   */
  async verifyCode(
    phone: string,
    code: string,
    options: PhoneCodeOptions = {},
  ): Promise<boolean> {
    return this.smsService.checkVerifyCode(
      normalizePhone(phone),
      code,
      options.scope,
    );
  }
}

// Helpers

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "");
}
