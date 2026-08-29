/**
 * tenant-login-guard.service.ts - tenant-realm login-surface bot protection (IdP).
 * @package @vxture/bff-auth
 *
 * Cloudflare Turnstile verification for the tenant accounts login surface,
 * env-gated via CF_TURNSTILE_ENABLED (no-op until enabled). Currently guards SMS
 * code issuance (/auth/send-phone-code) — the SMS-bombing gate; per-phone send
 * rate-limiting itself lives in PhoneCodeService. Mirrors OperatorLoginGuard's
 * Turnstile layer with the tenant surface (CF_TURNSTILE_TENANT_*) and the
 * tenant_auth action.
 *
 * The phone-login completion (/oidc/authorize/login/phone) is intentionally NOT
 * Turnstile-gated: the single-use token is consumed here at send time, and the
 * completion is already gated by possession of the SMS code.
 */

import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { TurnstileVerifier } from "@vxture/core-auth";

import { captchaFailureLine } from "../oidc/operator-login-guard.service";

// Must match the accounts tenant login widget's action (OidcLoginForm).
const TENANT_TURNSTILE_ACTION = "tenant_auth";

@Injectable()
export class TenantLoginGuard {
  private readonly logger = new Logger(TenantLoginGuard.name);
  private readonly turnstile = TurnstileVerifier.fromEnv("tenant");

  /**
   * Verify the tenant-surface Turnstile token. No-op when Turnstile is disabled
   * (CF_TURNSTILE_ENABLED unset) so it can ship ahead of the login-UI widget.
   */
  async verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
    try {
      await this.turnstile.verify({
        token: token ?? null,
        remoteIp: ip,
        expectedAction: TENANT_TURNSTILE_ACTION,
      });
    } catch (error) {
      // Same discipline as the operator guard: bare 401 to the caller, the
      // reason to the log. See `captchaFailureLine` for why.
      this.logger.warn(captchaFailureLine("tenant", ip, error));
      throw new UnauthorizedException("human_verification_failed");
    }
  }
}
