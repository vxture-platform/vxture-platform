/**
 * social-auth.service.ts — inbound-broker social login orchestration.
 * @package @vxture/bff-auth
 *
 * Drives the brokered OAuth round-trip: build the upstream authorize URL (state
 * stashed in Redis carrying the parked login_challenge), then on callback resolve
 * the identity:
 *   - known (provider, subject)        → log that user in;
 *   - new + upstream returned a phone   → resolve/create by the verified phone
 *                                         (login==register), link the identity, log in;
 *   - new + no phone (e.g. Google)      → stash a pending bind + send to bind-phone.
 * Phone is always the anchor; a provider email is NEVER auto-merged.
 * See docs/design/identity-platform-account.md §5/§6.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  AccountService,
  AVATAR_MAX_BYTES,
  sniffImageType,
} from "@vxture/service-account";
import { CustomerPhoneCodeService } from "../authn/customer-phone-code.service";
import { OidcService, type OidcLoginResult } from "../oidc/oidc.service";
import { RedisService } from "../redis/redis.service";
import {
  RealmSessionService,
  type CustomerSessionContext,
} from "../oidc/realm-session.service";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { OAuthProviderRegistry } from "./provider-registry";

// The social round-trip includes a (first-time) provider login + app-consent
// (QR scan / enterprise approval), which is much slower than an on-page form. Give
// both the CSRF state and the re-anchored login challenge a generous window so the
// parked challenge doesn't expire before the callback (invalid_login_challenge).
const SOCIAL_FLOW_TTL_SECONDS = 1800;
const BIND_TTL_SECONDS = 600;

export type SocialCallbackResult =
  | { kind: "login"; completion: OidcLoginResult }
  | { kind: "bind"; bindToken: string }
  | { kind: "linked" };

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    @Inject(OAuthProviderRegistry)
    private readonly registry: OAuthProviderRegistry,
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(CustomerPhoneCodeService)
    private readonly phoneCode: CustomerPhoneCodeService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(RealmSessionService) private readonly sessions: RealmSessionService,
    @Inject(CustomerSecurityChallengeService)
    private readonly proofs: CustomerSecurityChallengeService,
  ) {}

  /** Enabled providers for the login surface (code + display name; no secrets). */
  async listEnabledProviders(): Promise<{ code: string; name: string }[]> {
    const providers = await this.registry.listEnabled();
    return providers.map((p) => ({ code: p.code, name: p.name }));
  }

  /** Only a phone-proven, session-bound ceremony can add a login identity. */
  async buildLinkStartUrl(
    context: CustomerSessionContext,
    providerCode: string,
    challengeId: string,
  ): Promise<string> {
    if (!["feishu", "dingtalk"].includes(providerCode))
      throw new BadRequestException("provider_unavailable");
    const resolved = await this.registry.resolve(providerCode);
    if (!resolved?.config.redirectUri)
      throw new BadRequestException("provider_unavailable");
    const proof = await this.proofs.consume(
      context,
      challengeId,
      "identity-link",
    );
    if (proof.target !== providerCode)
      throw new BadRequestException("security_proof_required");
    const state = randomUUID();
    await this.redis.storeOauthState(
      state,
      {
        providerCode,
        redirectUri: resolved.config.redirectUri,
        loginChallenge: "",
        link: { userId: context.userId, sid: context.sid },
      },
      300,
    );
    return resolved.provider.buildAuthorizationUrl(
      resolved.config.redirectUri,
      state,
    );
  }

  /** Begin social login: stash state + the parked challenge, return the upstream authorize URL. */
  async buildStartUrl(
    providerCode: string,
    loginChallenge: string,
  ): Promise<string> {
    const context = await this.oidc.loginContext(loginChallenge);
    if (context.realm !== "customer")
      throw new BadRequestException("unsupported_realm");
    const resolved = await this.registry.resolve(providerCode);
    if (!resolved || !resolved.config.redirectUri) {
      throw new BadRequestException("provider_unavailable");
    }
    // Re-anchor the parked login challenge to THIS point (the user committing to a
    // social login), so it survives the slow provider login+consent round-trip and
    // is still present when the callback completes. The challenge was parked at
    // /authorize with a shorter window; a first-time provider login easily outlives
    // it while the state (created just below) survives — the exact mismatch behind
    // `invalid_login_challenge` on first social login. Fail fast with a clear prompt
    // if it already lapsed on the login page (vs a confusing post-callback error).
    const challengeAlive = await this.redis.extendOidcLoginChallenge(
      loginChallenge,
      SOCIAL_FLOW_TTL_SECONDS,
    );
    if (!challengeAlive) {
      throw new BadRequestException("login_session_expired");
    }
    const state = randomUUID();
    await this.redis.storeOauthState(
      state,
      {
        providerCode,
        redirectUri: resolved.config.redirectUri,
        loginChallenge,
      },
      SOCIAL_FLOW_TTL_SECONDS,
    );
    return resolved.provider.buildAuthorizationUrl(
      resolved.config.redirectUri,
      state,
    );
  }

  /** Handle the upstream callback: verify state, resolve the identity, then login or bind. */
  async handleCallback(
    providerCode: string,
    code: string,
    state: string,
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
    customerSid?: string,
  ): Promise<SocialCallbackResult> {
    const statePayload = await this.redis.consumeOauthState(state);
    if (!statePayload || statePayload.providerCode !== providerCode) {
      throw new BadRequestException("invalid_state");
    }
    if (statePayload.link) {
      if (statePayload.link.sid !== customerSid)
        throw new UnauthorizedException("link_session_required");
      const current = await this.sessions.requireCustomer(customerSid);
      if (
        current.userId !== statePayload.link.userId ||
        current.user.status !== "active"
      )
        throw new UnauthorizedException("link_session_required");
    } else {
      const context = await this.oidc.loginContext(statePayload.loginChallenge);
      if (context.realm !== "customer")
        throw new BadRequestException("unsupported_realm");
    }
    const resolved = await this.registry.resolve(providerCode);
    if (!resolved) throw new BadRequestException("provider_unavailable");

    const tokens = await resolved.provider.exchangeCode(
      code,
      statePayload.redirectUri,
    );
    const profile = await resolved.provider.getUserInfo(tokens.accessToken);
    const authMethod = `social:${providerCode}`;

    if (statePayload.link) {
      // Provider calls may outlive the original session or account status.
      const current = await this.sessions.requireCustomer(customerSid);
      if (
        current.userId !== statePayload.link.userId ||
        current.user.status !== "active"
      )
        throw new UnauthorizedException("link_session_required");
      const owner = await this.account.findUserByProviderSubject(
        providerCode,
        profile.providerId,
      );
      if (owner && owner.id !== statePayload.link.userId)
        throw new BadRequestException("identity_already_bound");
      if (!owner)
        await this.bindProfile(statePayload.link.userId, providerCode, profile);
      const bound = await this.account.findUserByProviderSubject(
        providerCode,
        profile.providerId,
      );
      if (!bound || bound.id !== statePayload.link.userId)
        throw new BadRequestException("identity_already_bound");
      return { kind: "linked" };
    }

    // 1) Known identity → log in directly.
    const existing = await this.account.findUserByProviderSubject(
      providerCode,
      profile.providerId,
    );
    if (existing) {
      const completion = await this.oidc.completeLoginWithUser(
        statePayload.loginChallenge,
        existing.id,
        authMethod,
        { ipAddress, userAgent },
      );
      return { kind: "login", completion };
    }

    // 2) New + provider-verified phone → resolve/create by phone, link, log in.
    if (profile.phone) {
      // Phone is the sole anchor; email NEVER resolves/merges accounts (§6).
      // For a new account the provider email/name seed the row; for an existing
      // one we backfill only blank fields (never overwrite). A colliding email
      // is skipped, not merged.
      const byPhone = await this.account.findUserByIdentifier(profile.phone);
      const user =
        byPhone ??
        (await this.account.createUser({
          phone: profile.phone,
          phoneVerified: true,
          name: profile.name,
          ...(profile.email ? { email: profile.email } : {}),
          emailVerified: profile.emailVerified ?? false,
        }));
      // Import the upstream avatar ONCE, at account creation only (D-3); existing
      // accounts keep whatever avatar they have.
      if (!byPhone && profile.avatar) {
        await this.importAvatar(user.id, profile.avatar, providerCode);
      }
      if (byPhone) {
        await this.account.backfillProfile(user.id, {
          name: profile.name,
          ...(profile.email ? { email: profile.email } : {}),
          emailVerified: profile.emailVerified ?? false,
        });
      }
      await this.bindProfile(user.id, providerCode, profile);
      const completion = await this.oidc.completeLoginWithUser(
        statePayload.loginChallenge,
        user.id,
        authMethod,
        { ipAddress, userAgent },
      );
      return { kind: "login", completion };
    }

    // 3) New + no phone (e.g. Google) → stash a pending bind + go to bind-phone.
    const bindToken = randomUUID();
    await this.redis.storeOauthBind(
      bindToken,
      {
        providerCode,
        providerSubject: profile.providerId,
        ...(profile.email ? { email: profile.email } : {}),
        emailVerified: profile.emailVerified ?? false,
        name: profile.name,
        ...(profile.avatar ? { avatar: profile.avatar } : {}),
        loginChallenge: statePayload.loginChallenge,
      },
      BIND_TTL_SECONDS,
    );
    return { kind: "bind", bindToken };
  }

  /** Send only for an existing customer social binding and isolate the token owner. */
  async sendBindPhoneCode(bindToken: string, phone: string): Promise<void> {
    const pending = await this.redis.readOauthBind(bindToken);
    if (!pending) throw new BadRequestException("invalid_binding_token");
    await this.phoneCode.sendCode(phone, {
      scope: "customer-social-bind",
      context: bindToken,
    });
  }

  /**
   * Complete a pending social→phone binding: consume the bind token, verify the
   * SMS code, resolve/create the account by the verified phone (login==register),
   * link the upstream identity, then run the shared login completion. Returns the
   * RP redirect (the caller sets the session cookie). See google-provider §5.
   */
  async completeBind(
    bindToken: string,
    phone: string,
    code: string,
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
  ): Promise<OidcLoginResult> {
    if (!(await this.redis.readOauthBind(bindToken)))
      throw new BadRequestException("invalid_binding_token");
    // Verify the SMS code BEFORE consuming the (single-use) bind token, so a
    // wrong code doesn't burn the token and force a full re-OAuth — the code has
    // its own per-phone attempt/rate limits.
    const verified = await this.phoneCode.verifyCode(phone, code, {
      scope: "customer-social-bind",
      context: bindToken,
    });
    if (!verified) throw new UnauthorizedException("invalid_phone_code");

    const pending = await this.redis.consumeOauthBind(bindToken);
    if (!pending) throw new BadRequestException("invalid_binding_token");

    const byPhone = await this.account.findUserByIdentifier(phone);
    const user =
      byPhone ??
      (await this.account.createUser({
        phone,
        phoneVerified: true,
        name: pending.name,
        ...(pending.email ? { email: pending.email } : {}),
        emailVerified: pending.emailVerified ?? false,
      }));
    if (!byPhone && pending.avatar) {
      await this.importAvatar(user.id, pending.avatar, pending.providerCode);
    }
    if (byPhone) {
      await this.account.backfillProfile(user.id, {
        name: pending.name,
        ...(pending.email ? { email: pending.email } : {}),
        emailVerified: pending.emailVerified ?? false,
      });
    }
    await this.bindProfile(user.id, pending.providerCode, {
      providerId: pending.providerSubject,
      ...(pending.email ? { email: pending.email } : {}),
      emailVerified: pending.emailVerified ?? false,
      name: pending.name,
      ...(pending.avatar ? { avatar: pending.avatar } : {}),
    });
    return this.oidc.completeLoginWithUser(
      pending.loginChallenge,
      user.id,
      `social:${pending.providerCode}`,
      { ipAddress, userAgent },
    );
  }

  /**
   * Download an upstream avatar and store it as the user's platform-owned avatar
   * (identity-platform-account.md §4 D-3). Best-effort: NEVER blocks signup (the user falls
   * back to the frontend default), but every outcome is LOGGED so imports are
   * observable/diagnosable. Hardening for reliable third-party import:
   *  - 5s timeout so an unreachable CDN (e.g. Google from the cluster) can't stall
   *    the signup request;
   *  - the content-type is SNIFFED from the bytes, not trusted from the provider
   *    header (CDNs often return octet-stream / no content-type for images).
   */
  private async importAvatar(
    userId: string,
    url: string,
    source: string,
  ): Promise<void> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        this.logger.warn(
          `avatar import [${source}] user=${userId} skipped: HTTP ${res.status}`,
        );
        return;
      }
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0 || data.length > AVATAR_MAX_BYTES) {
        this.logger.warn(
          `avatar import [${source}] user=${userId} skipped: size ${data.length}B`,
        );
        return;
      }
      const contentType = sniffImageType(data);
      if (!contentType) {
        this.logger.warn(
          `avatar import [${source}] user=${userId} skipped: not a supported image ` +
            `(header content-type=${res.headers.get("content-type") ?? "none"})`,
        );
        return;
      }
      const hash = createHash("sha256").update(data).digest("hex");
      await this.account.setAvatar(userId, { data, contentType, hash, source });
      this.logger.log(
        `avatar import [${source}] user=${userId} ok: ${contentType} ${data.length}B`,
      );
    } catch (err) {
      // best-effort — never block signup on avatar import.
      this.logger.warn(
        `avatar import [${source}] user=${userId} failed: ${String(err)}`,
      );
    }
  }

  /** Link the upstream identity to a user, snapshotting the (non-authoritative) profile. */
  private async bindProfile(
    userId: string,
    providerCode: string,
    profile: {
      providerId: string;
      email?: string;
      emailVerified?: boolean;
      name: string;
      avatar?: string;
    },
  ): Promise<void> {
    await this.account.bindIdentity({
      userId,
      provider: providerCode,
      providerSubject: profile.providerId,
      metadata: {
        email: profile.email ?? null,
        emailVerified: profile.emailVerified ?? false,
        name: profile.name,
        avatar: profile.avatar ?? null,
      },
    });
  }
}
