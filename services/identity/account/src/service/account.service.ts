import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PasswordHasher } from "../password/password-hasher";
import { USER_REPOSITORY } from "../tokens";
import type {
  AvatarRecord,
  BackfillProfileInput,
  BindIdentityInput,
  AuthSessionRecord,
  CreateUserInput,
  IdentityRecord,
  LastLoginRecord,
  LoginHistoryEntry,
  SetAvatarInput,
  UpdateProfileInput,
  UserReadRepository,
  UserView,
} from "../types/account.types";

/**
 * User-chosen username (account) format. First char MUST be an ASCII letter so a
 * user-chosen name can never collide with a system default (`_{user_no}`, which
 * starts with `_`) nor be confused with the numeric `user_no`. Charset
 * [A-Za-z0-9_], total length 3–24. See identity-platform-account.md §4.2.
 */
const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;

/** Username (account) may be changed at most once per this many days (§1.1). */
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const USERNAME_CHANGE_COOLDOWN_MS =
  USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/**
 * 自助删除的保留期(050-account §7,owner 2026-09-04):申请后 30 天内重新登录可撤销,
 * 到期由 platform-api 的 account-deletion-purge 清扫。
 */
export const ACCOUNT_DELETION_RETENTION_DAYS = 30;

export interface DeletionRequestResult {
  deletionRequestedAt: string;
  /** 保留期到期、可被清扫的时刻(ISO)。 */
  purgeAt: string;
  revokedSessions: number;
  unboundIdentities: number;
}

/** 保留期到期时刻 = 申请时刻 + 30 天。 */
export function accountPurgeAt(deletionRequestedAt: string): string {
  return new Date(
    new Date(deletionRequestedAt).getTime() +
      ACCOUNT_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** Throw 400 if a user-supplied account does not meet the format rules (§4.2). */
export function assertValidAccount(account: string): void {
  if (!ACCOUNT_RE.test(account)) {
    throw new BadRequestException(
      "account must start with a letter, contain only letters/digits/underscore, and be 3–24 chars",
    );
  }
}

/**
 * AccountService — identity-core user lifecycle (User + Identities + credentials).
 * Composes the user repository with the Argon2id PasswordHasher. Owns NO
 * org/workspace/membership logic (that is @vxture/service-organization) and NO
 * login/session/token flows (those land in the identity-server, Batch 4).
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserReadRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  /** Create a user; hashes the password (Argon2id) when provided. */
  async createUser(input: CreateUserInput): Promise<UserView> {
    // Account is optional: when the caller supplies one it must pass the format
    // rules; when absent the repo assigns the default `_{user_no}`.
    const account = input.account?.trim() || null;
    if (account) assertValidAccount(account);
    const passwordHash = input.password
      ? await this.hasher.hash(input.password)
      : null;
    return this.users.createUser({
      account,
      email: input.email ? input.email.toLowerCase().trim() : null,
      emailVerified: input.emailVerified ?? false,
      phone: input.phone,
      phoneVerified: input.phoneVerified ?? true,
      name: input.name ?? null,
      passwordHash,
    });
  }

  /**
   * Fill empty name/email on an existing user from a federated provider. Phone
   * already anchored the account; this only populates blanks (never overwrites,
   * never merges). A colliding email is skipped silently. See §6.
   */
  /** Idempotent growth-baseline heal (loyalty.user_points; onboarding item 10). */
  ensureUserPoints(userId: string): Promise<void> {
    return this.users.ensureUserPoints(userId);
  }

  backfillProfile(userId: string, input: BackfillProfileInput): Promise<void> {
    return this.users.backfillProfile(userId, input);
  }

  getUserById(userId: string): Promise<UserView | null> {
    return this.users.getUserById(userId);
  }

  findUserByIdentifier(identifier: string) {
    return this.users.findUserByIdentifier(identifier);
  }

  /**
   * Verify an identifier (account|email|phone) + password. Returns the user on
   * success, null otherwise. Constant-ish: a missing user still runs a verify to
   * blunt user-enumeration timing (only meaningful once a dummy hash is used;
   * acceptable for MVP). No side effects (login auditing lives in identity-server).
   */
  async verifyCredential(
    identifier: string,
    password: string,
  ): Promise<UserView | null> {
    const record = await this.users.findUserByIdentifier(identifier);
    if (!record || !record.passwordHash) return null;
    const ok = await this.hasher.verify(password, record.passwordHash);
    if (!ok) return null;
    // Checked AFTER the password verifies so a disabled account can't be probed
    // via this flag. Username+password login is off; phone/email/social still work.
    if (record.accountLoginDisabled) {
      throw new UnauthorizedException("account_login_disabled");
    }
    return {
      id: record.id,
      account: record.account,
      email: record.email,
      phone: record.phone,
      name: record.name,
      status: record.status,
      avatarHash: record.avatarHash,
    };
  }

  /** Load a user's custom avatar bytes; null when none (caller serves default). */
  getAvatar(userId: string): Promise<AvatarRecord | null> {
    return this.users.getAvatar(userId);
  }

  /** Store/replace a user's custom avatar; mirrors the hash onto the user row. */
  setAvatar(userId: string, input: SetAvatarInput): Promise<void> {
    return this.users.setAvatar(userId, input);
  }

  /** Remove a user's custom avatar (falls back to the frontend default). */
  deleteAvatar(userId: string): Promise<void> {
    return this.users.deleteAvatar(userId);
  }

  /** Set or change a user's password (hashes plaintext with Argon2id). */
  async setPassword(userId: string, password: string): Promise<void> {
    const hash = await this.hasher.hash(password);
    await this.users.setPassword(userId, hash);
  }

  /**
   * Self-service initial password setup, for a user who registered via
   * phone/social login and has no credential row yet (no old password to
   * verify). Refuses (400) if a password is already set — those users must go
   * through `changePassword` instead.
   */
  async setInitialPassword(userId: string, password: string): Promise<void> {
    const record = await this.users.findCredentialById(userId);
    if (!record) throw new NotFoundException("account_not_found");
    if (record.passwordHash) {
      throw new BadRequestException("password_already_set");
    }
    await this.setPassword(userId, password);
  }

  /** Update mutable profile fields (name/email/bio/timezone/language). */
  updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserView | null> {
    return this.users.updateProfile(userId, input);
  }

  /**
   * Change password after verifying the current one. Returns false if the user
   * has no credential or the current password is wrong (caller maps to 400/403).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const record = await this.users.findCredentialById(userId);
    if (!record?.passwordHash) return false;
    if (!(await this.hasher.verify(currentPassword, record.passwordHash))) {
      return false;
    }
    await this.users.setPassword(userId, await this.hasher.hash(newPassword));
    return true;
  }

  /** Atomically update the user's verified phone anchor. Throws ConflictException if taken. */
  changePhone(userId: string, newPhone: string): Promise<UserView | null> {
    return this.users.changePhone(userId, newPhone);
  }

  /** Atomically replace the email + mark it verified. Throws ConflictException if taken. */
  changeEmail(userId: string, newEmail: string): Promise<UserView | null> {
    return this.users.changeEmail(userId, newEmail);
  }

  /** Mark the user's current email verified (verify-current flow). */
  markEmailVerified(userId: string): Promise<UserView | null> {
    return this.users.markEmailVerified(userId);
  }

  /** Mark the user's current phone verified (verify-current flow). */
  markPhoneVerified(userId: string): Promise<UserView | null> {
    return this.users.markPhoneVerified(userId);
  }

  /**
   * Enable/disable username+password login. Refuses to disable the last usable
   * login path — the user must keep a verified phone OR verified email OR a bound
   * social identity, so they can never lock themselves out.
   */
  async setAccountLoginEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<UserView | null> {
    if (!enabled) {
      const user = await this.users.getUserById(userId);
      if (!user) return null;
      const identities = await this.users.listIdentitiesByUser(userId);
      const hasOtherPath =
        (user.phoneVerified ?? false) ||
        (user.emailVerified ?? false) ||
        identities.length > 0;
      if (!hasOtherPath) {
        throw new BadRequestException("cannot_disable_last_login_method");
      }
    }
    return this.users.setAccountLoginDisabled(userId, !enabled);
  }

  /**
   * Change the username (account). Enforces format (§4.2), the once-per-30-days
   * cooldown (§1.1), and uniqueness (ConflictException from the repo). A no-op
   * when the username is unchanged. Throws BadRequestException when the cooldown
   * has not elapsed.
   */
  async changeUsername(
    userId: string,
    newAccount: string,
  ): Promise<UserView | null> {
    const account = newAccount.trim();
    assertValidAccount(account);
    const user = await this.users.getUserById(userId);
    if (!user) return null;
    if (user.account.toLowerCase() === account.toLowerCase()) return user;
    if (user.accountChangedAt) {
      const elapsed = Date.now() - new Date(user.accountChangedAt).getTime();
      if (elapsed < USERNAME_CHANGE_COOLDOWN_MS) {
        const nextAt = new Date(
          new Date(user.accountChangedAt).getTime() +
            USERNAME_CHANGE_COOLDOWN_MS,
        ).toISOString();
        throw new BadRequestException(
          `username can only be changed once every ${USERNAME_CHANGE_COOLDOWN_DAYS} days; next change allowed after ${nextAt}`,
        );
      }
    }
    return this.users.changeAccount(userId, account);
  }

  bindIdentity(input: BindIdentityInput): Promise<void> {
    return this.users.bindIdentity(input);
  }

  /** Unbind a federated identity (by provider) from the user. */
  removeIdentity(userId: string, provider: string): Promise<void> {
    return this.users.removeIdentity(userId, provider);
  }

  findUserByProviderSubject(provider: string, providerSubject: string) {
    return this.users.findUserByProviderSubject(provider, providerSubject);
  }

  listIdentitiesByUser(userId: string): Promise<IdentityRecord[]> {
    return this.users.listIdentitiesByUser(userId);
  }

  getLastLogin(userId: string): Promise<LastLoginRecord | null> {
    return this.users.getLastLogin(userId);
  }

  /** Recent login attempts (success + failed), newest first. */
  listLoginHistory(userId: string, limit = 20): Promise<LoginHistoryEntry[]> {
    return this.users.listLoginHistory(userId, limit);
  }

  /** Active central sessions for the user (device management, §1.5). */
  listSessions(userId: string): Promise<AuthSessionRecord[]> {
    return this.users.listSessions(userId);
  }

  /** Remote-logout one of the user's sessions; true when revoked. */
  revokeSession(userId: string, sid: string): Promise<boolean> {
    return this.users.revokeSession(userId, sid);
  }

  // ── Admin-delegated actions (C12) — an operator acting on a customer account.
  //   Unlike the self-service methods above, these have no anti-lockout guard: a
  //   platform operator may fully disable an account. Callers (auth-bff internal
  //   router) enforce realm isolation (target must be a customer, else 404).

  /** Full-disable a customer account (status='disabled') and revoke all its sessions. */
  async adminDisableAccount(
    userId: string,
  ): Promise<{ user: UserView; revoked: number }> {
    const user = await this.users.adminSetAccountStatus(userId, "disabled");
    if (!user) {
      throw new NotFoundException("account_not_found");
    }
    const revoked = await this.users.revokeAllSessions(userId);
    return { user, revoked };
  }

  /** Re-enable a disabled customer account (status='active'). */
  async adminEnableAccount(userId: string): Promise<UserView> {
    const user = await this.users.adminSetAccountStatus(userId, "active");
    if (!user) {
      throw new NotFoundException("account_not_found");
    }
    return user;
  }

  /** Force-logout: revoke all of the customer's active sessions; returns the count. */
  async adminForceLogout(userId: string): Promise<{ revoked: number }> {
    const user = await this.users.getUserById(userId);
    if (!user) {
      throw new NotFoundException("account_not_found");
    }
    const revoked = await this.users.revokeAllSessions(userId);
    return { revoked };
  }

  // ── Self-service deletion (050-account §7) ──────────────────────────────
  //   资格判定(组织 owner / 未清账单 / 付费余额 / 在途退款开票 / 有钱在途的订单)不在
  //   这里——那些事实分属 organization / billing / subscription,由 console-bff 的
  //   AccountDeletionAggregator 汇总后才调本方法。本方法只管账号自己这一段:状态、
  //   会话、刷新令牌、三方绑定。

  /**
   * Enter the retention window: active → deleting, revoke every session and
   * refresh token, unbind all federated identities. 404 when gone, 409 when
   * already deleting or otherwise not active.
   */
  async requestDeletion(userId: string): Promise<DeletionRequestResult> {
    const user = await this.users.getUserById(userId);
    if (!user) throw new NotFoundException("account_not_found");
    if (user.status === "deleting") {
      throw new ConflictException("account_already_deleting");
    }
    if (user.status !== "active") {
      throw new ConflictException("account_not_active");
    }
    const updated = await this.users.requestDeletion(userId);
    if (!updated?.deletionRequestedAt) {
      throw new ConflictException("account_not_active");
    }
    const revokedSessions = await this.users.revokeAllSessions(userId);
    await this.users.revokeAllRefreshTokens(userId);
    const unboundIdentities = await this.users.removeAllIdentities(userId);
    return {
      deletionRequestedAt: updated.deletionRequestedAt,
      purgeAt: accountPurgeAt(updated.deletionRequestedAt),
      revokedSessions,
      unboundIdentities,
    };
  }

  /** Undo within the retention window: deleting → active. 409 when not deleting. */
  async cancelDeletion(userId: string): Promise<UserView> {
    const user = await this.users.cancelDeletion(userId);
    if (!user) throw new ConflictException("account_not_deleting");
    return user;
  }

  /** Users whose 30-day window has elapsed and that still await the purge. */
  listDeletionDue(limit = 50): Promise<string[]> {
    return this.users.listDeletionDue(ACCOUNT_DELETION_RETENTION_DAYS, limit);
  }

  /** Anonymise + soft-delete one due user; true when this call did the work. */
  purgeUser(userId: string): Promise<boolean> {
    return this.users.purgeUser(userId);
  }
}
