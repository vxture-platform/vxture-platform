/**
 * Customer sensitive actions with proof consumption and durable logout.
 * @package @vxture/bff-auth
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import { validNewPassword } from "../authn/password-policy";

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
// ⚠️ 跨层引用: Account writes and login-method safety belong to the account domain.
import {
  AccountService,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  assertValidAccount,
  type CustomerSecurityOperation,
} from "@vxture/service-account";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import type { CustomerSessionContext } from "./realm-session.service";
import { OidcService } from "./oidc.service";

@Injectable()
export class CustomerSecurityService {
  private readonly logger = new Logger(CustomerSecurityService.name);
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(CustomerSecurityChallengeService)
    private readonly challenges: CustomerSecurityChallengeService,
    @Inject(OidcService) private readonly oidc: OidcService,
  ) {}

  /** Normalize targets once, before creating the immutable verification ceremony. */
  async start(context: CustomerSessionContext, body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("invalid_security_request");
    const input = body as Record<string, unknown>;
    const operations = [
      "phone-change",
      "email-change",
      "phone-verify",
      "email-verify",
      "password",
      "identity-unlink",
      "username",
      "account-login",
      "email-login",
      "identity-link",
    ];
    if (
      typeof input.operation !== "string" ||
      !operations.includes(input.operation) ||
      typeof input.method !== "string" ||
      !["phone", "email"].includes(input.method)
    )
      throw new BadRequestException("invalid_security_request");
    const operation = input.operation as CustomerSecurityOperation;
    let target = typeof input.target === "string" ? input.target.trim() : "";
    if (operation === "phone-change") {
      target = target.replace(/^\+86/, "").replace(/\s/g, "");
      if (!/^1[3-9]\d{9}$/.test(target))
        throw new BadRequestException("invalid_phone");
    } else if (operation === "email-change") {
      target = target.toLowerCase();
      if (target.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target))
        throw new BadRequestException("invalid_email");
    } else if (operation === "username") assertValidAccount(target);
    else if (
      ["account-login", "email-login"].includes(operation) &&
      !["true", "false"].includes(target)
    )
      throw new BadRequestException("invalid_login_setting");
    else if (
      ["identity-unlink", "identity-link"].includes(operation) &&
      !/^[a-z][a-z0-9-]{0,31}$/.test(target)
    )
      throw new BadRequestException("invalid_provider");
    if (operation === "phone-verify") target = context.user.phone;
    if (operation === "email-verify") target = context.user.email ?? "";
    if (operation === "password") target = "";
    if (
      (operation === "phone-change" &&
        target === context.user.phone.replace(/^\+86/, "")) ||
      (operation === "email-change" && target === context.user.email) ||
      (operation === "username" &&
        target.toLowerCase() === context.user.account.toLowerCase())
    )
      throw new BadRequestException("security_target_unchanged");
    // Avoid sending a verification code for a change the account row lock will reject.
    if (
      operation === "username" &&
      context.user.accountChangedAt &&
      Date.now() - Date.parse(context.user.accountChangedAt) <
        USERNAME_CHANGE_COOLDOWN_DAYS * 86400000
    )
      throw new BadRequestException("username_change_cooldown");
    if (operation === "identity-unlink") {
      const identities = (
        await this.accounts.listIdentitiesByUser(context.userId)
      ).filter((identity) => identity.provider === target);
      if (!identities.length)
        throw new BadRequestException("identity_not_bound");
      return this.challenges.start(
        context,
        operation,
        target,
        input.method as "phone" | "email",
        identities.map((identity) => identity.providerSubject).sort(),
      );
    }
    return this.challenges.start(
      context,
      operation,
      target,
      input.method as "phone" | "email",
    );
  }

  // ============================================================================
  // Proof consumption and security writes
  // ============================================================================

  /** Execute exactly the proven operation; request input cannot replace its target or account. */
  async execute(context: CustomerSessionContext, id: string, body: unknown) {
    const proof = await this.challenges.consume(context, id);
    if (
      [
        "account-deletion",
        "account-recovery",
        "mfa-enable",
        "identity-link",
      ].includes(proof.operation)
    )
      throw new BadRequestException("lifecycle_endpoint_required");
    const passwords =
      body && typeof body === "object"
        ? (body as { password?: unknown; currentPassword?: unknown })
        : {};
    if (
      proof.operation === "password" &&
      !validNewPassword(passwords.password, "customer")
    )
      throw new BadRequestException("weak_password");
    const sessions = await this.accounts.listSessions(context.userId);
    await this.accounts.applySelfSecurity(context.userId, proof, passwords);
    try {
      await this.oidc.cleanupCustomerSessions(
        context.userId,
        sessions.map((s) => s.sid),
      );
    } catch {
      // The account write and durable revocation already committed. Do not report
      // a failed mutation or invite a retry that cannot reuse its consumed proof.
      this.logger.warn(
        `customer security logout propagation incomplete: ${context.userId}`,
      );
      return {
        ok: true as const,
        reauthenticate: true as const,
        logoutPropagationPending: true,
      };
    }
    return {
      ok: true as const,
      reauthenticate: true as const,
      logoutPropagationPending: false,
    };
  }
}
