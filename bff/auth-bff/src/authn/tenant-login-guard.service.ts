/**
 * Customer human-verification proof consumption.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import { Inject, Injectable } from "@nestjs/common";
import { HumanCaptchaService } from "./human-captcha.service";

@Injectable()
export class TenantLoginGuard {
  constructor(
    @Inject(HumanCaptchaService) private readonly captcha: HumanCaptchaService,
  ) {}

  /** Consume a one-time proof for the customer domain. */
  async verifyHuman(token: string | undefined, _ip: string): Promise<void> {
    await this.captcha.consume("customer", token);
  }
}
