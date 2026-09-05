/**
 * account.types.ts — service contracts for @vxture/service-account.
 * Identity core: User + Identities (federation) + credentials.
 * docs/design/platform-data-architecture-schema.md §4 identity (users / account / credential).
 */

/** Public view of an identity-core user. */
export interface UserView {
  id: string;
  account: string;
  email: string | null;
  /** Whether the email is verified (email_verified_at IS NOT NULL). */
  emailVerified?: boolean;
  phone: string;
  /** Whether the phone is verified (phone_verified_at IS NOT NULL; the mandatory anchor → normally true). */
  phoneVerified?: boolean;
  /** Whether username+password login is disabled (account_login_disabled). Other login paths unaffected. */
  accountLoginDisabled?: boolean;
  name: string | null;
  status: string;
  /** Content hash of the custom avatar (NULL = no custom avatar → frontend default). */
  avatarHash: string | null;
  /** Free-text self introduction (console info spec §1.1). */
  bio?: string | null;
  /** 性别:账号页显示为先生 / 女士 / 未设定(NULL)。 */
  gender?: "male" | "female" | null;
  /** IANA timezone preference, e.g. "Asia/Shanghai" (§1.1). */
  timezone?: string | null;
  /** UI language preference, e.g. "zh-CN" (§1.1). */
  language?: string | null;
  /** ISO timestamp the username was last changed; null = never (§1.1 rate limit). */
  accountChangedAt?: string | null;
  /** Stable public user number (bigint as string). */
  userNo?: string;
  /** ISO timestamp of account creation. */
  createdAt?: string;
  /** Whether the user has a password credential set (false for phone/social-only registrants). */
  hasPassword?: boolean;
  /** ISO timestamp the user asked to delete the account (status='deleting'); null otherwise. */
  deletionRequestedAt?: string | null;
}

/** Mutable profile fields a user may edit (console info spec §1.1). */
export interface UpdateProfileInput {
  name?: string | null;
  email?: string | null;
  bio?: string | null;
  /** 性别:male / female;空串 = 清除;undefined / null = 不改(与其它字段的 coalesce 语义一致)。 */
  gender?: "male" | "female" | "" | null;
  timezone?: string | null;
  language?: string | null;
}

/** Stored custom avatar bytes (account.user_avatars). */
export interface AvatarRecord {
  data: Buffer;
  contentType: string;
  hash: string;
}

/** Write a user's custom avatar (upsert bytes + mirror hash onto the user row). */
export interface SetAvatarInput {
  data: Buffer;
  contentType: string;
  hash: string;
  /** Provenance: upload | feishu | dingtalk | google. */
  source: string;
}

/** User view plus the (Argon2id) password hash, for credential checks. */
export interface UserCredentialRecord extends UserView {
  passwordHash: string | null;
}

/** Service-facing input to create a user (plaintext password, optional). */
export interface CreateUserInput {
  /** Login handle. When absent, the repo defaults it to `_{user_no}`. Unique.
   * When supplied it must pass account-format validation (letter-start). */
  account?: string | null;
  /** Optional, may be unverified. Unique when present. */
  email?: string | null;
  /** Whether the provider/caller asserts the email is verified (sets email_verified_at). */
  emailVerified?: boolean;
  /** Required strong global anchor. Unique. */
  phone: string;
  /** Whether the phone is verified at creation (sets phone_verified_at). Default true. */
  phoneVerified?: boolean;
  name?: string | null;
  /** Plaintext password; hashed (Argon2id) before storage. Omit for code-only users. */
  password?: string | null;
}

/** Repository-facing record (password already hashed). */
export interface CreateUserRecord {
  /** Null → repo assigns the default `_{user_no}` from the freshly allocated number. */
  account: string | null;
  email: string | null;
  /** Sets email_verified_at when the email is present and asserted verified. */
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
  name: string | null;
  passwordHash: string | null;
}

/** Fill empty profile fields from a federated provider (never overwrites, never merges). */
export interface BackfillProfileInput {
  name?: string | null;
  email?: string | null;
  /** When the email is asserted verified by the provider, also set email_verified_at. */
  emailVerified?: boolean;
}

/** A federated identity bound to a user (identity.identities row). */
export interface IdentityRecord {
  provider: string;
  providerSubject: string;
  connectedAt: string;
}

/** Last successful login event from session.login_attempts. */
export interface LastLoginRecord {
  loginAt: string;
  ipAddress: string;
  userAgent: string | null;
  countryCode: string | null;
}

/** A login attempt from session.login_attempts (history list, §1.5). */
export interface LoginHistoryEntry {
  loginAt: string;
  ipAddress: string;
  userAgent: string | null;
  countryCode: string | null;
  authMethod: string;
  result: string;
}

/** An active central session (session.auth_sessions) — device list, §1.5. */
export interface AuthSessionRecord {
  sid: string;
  authMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  createdAt: string;
  expiresAt: string;
}

/** Bind a federated identity (Google/feishu/dingtalk/…) to a user. */
export interface BindIdentityInput {
  userId: string;
  provider: string;
  providerSubject: string;
  metadata?: Record<string, unknown> | null;
}

/** Data access contract for identity-core users (raw SQL impl + mock impl). */
export interface UserReadRepository {
  /** Idempotent growth-baseline heal (loyalty.user_points). */
  ensureUserPoints(userId: string): Promise<void>;
  createUser(record: CreateUserRecord): Promise<UserView>;
  getUserById(userId: string): Promise<UserView | null>;
  findUserByIdentifier(
    identifier: string,
  ): Promise<UserCredentialRecord | null>;
  findCredentialById(userId: string): Promise<UserCredentialRecord | null>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  /** Update mutable profile fields (name/email/bio/timezone/language); returns the updated view or null. */
  updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserView | null>;
  /** Fill empty name/email from a provider; skips (no throw) on email collision. */
  backfillProfile(userId: string, input: BackfillProfileInput): Promise<void>;
  bindIdentity(input: BindIdentityInput): Promise<void>;
  /** Unbind a federated identity (by provider) from the user; no-op if absent. */
  removeIdentity(userId: string, provider: string): Promise<void>;
  findUserByProviderSubject(
    provider: string,
    providerSubject: string,
  ): Promise<UserView | null>;
  /** Load a user's custom avatar bytes; null when none. */
  getAvatar(userId: string): Promise<AvatarRecord | null>;
  /** Upsert a user's custom avatar bytes and mirror the hash onto the user row. */
  setAvatar(userId: string, input: SetAvatarInput): Promise<void>;
  /** Remove a user's custom avatar (delete bytes + clear the user's hash). */
  deleteAvatar(userId: string): Promise<void>;
  /** Atomically update a user's verified phone anchor. Throws ConflictException if taken. */
  changePhone(userId: string, newPhone: string): Promise<UserView | null>;
  /** Atomically replace the email + set email_verified_at=now(). Throws ConflictException if taken. */
  changeEmail(userId: string, newEmail: string): Promise<UserView | null>;
  /** Set email_verified_at=now() for the user's current email (verify-current). */
  markEmailVerified(userId: string): Promise<UserView | null>;
  /** Set phone_verified_at=now() for the user's current phone (verify-current). */
  markPhoneVerified(userId: string): Promise<UserView | null>;
  /** Enable/disable username+password login (account_login_disabled flag). */
  setAccountLoginDisabled(
    userId: string,
    disabled: boolean,
  ): Promise<UserView | null>;
  /**
   * Change the username (account) and stamp account_changed_at = now().
   * The 30-day cooldown is enforced by the service before calling. Returns the
   * updated view, or null when the user is gone. Throws ConflictException when
   * the new username is already taken.
   */
  changeAccount(userId: string, newAccount: string): Promise<UserView | null>;
  /** All federated identities currently bound to the user (from identity.identities). */
  listIdentitiesByUser(userId: string): Promise<IdentityRecord[]>;
  /** Most recent successful login event for the user (from session.login_attempts). */
  getLastLogin(userId: string): Promise<LastLoginRecord | null>;
  /** Recent login attempts (success + failed), newest first, capped by limit. */
  listLoginHistory(userId: string, limit: number): Promise<LoginHistoryEntry[]>;
  /** Active central sessions for the user (tenant realm), newest activity first. */
  listSessions(userId: string): Promise<AuthSessionRecord[]>;
  /** Revoke one of the user's sessions by sid; true when a row was revoked. */
  revokeSession(userId: string, sid: string): Promise<boolean>;
  /**
   * Admin: set account.users.status ('active'|'disabled'). Full disable blocks all
   * login paths (not just password). Returns the updated view, or null when gone.
   */
  adminSetAccountStatus(
    userId: string,
    status: "active" | "disabled",
  ): Promise<UserView | null>;
  /** Admin: revoke ALL of the user's active customer-realm sessions; returns the count. */
  revokeAllSessions(userId: string): Promise<number>;
  /** Revoke ALL of the user's active refresh tokens (session.refresh_tokens); returns the count. */
  revokeAllRefreshTokens(userId: string): Promise<number>;
  /** Unbind every federated identity of the user; returns the count removed. */
  removeAllIdentities(userId: string): Promise<number>;
  /**
   * Self-service deletion (050-account §7): active → deleting, stamp
   * deletion_requested_at = now(). Returns the updated view, or null when the
   * user is gone or not active (the caller maps to 404 / 409).
   */
  requestDeletion(userId: string): Promise<UserView | null>;
  /** Undo a pending deletion: deleting → active, clear deletion_requested_at. Null when not deleting. */
  cancelDeletion(userId: string): Promise<UserView | null>;
  /** Users whose retention window has elapsed (status='deleting', not yet purged), oldest first. */
  listDeletionDue(retentionDays: number, limit: number): Promise<string[]>;
  /**
   * Purge a user after the retention window: anonymise the identifiers,
   * drop profile / avatar / credentials / identities, set deleted_at. Idempotent;
   * true when this call performed the purge.
   */
  purgeUser(userId: string): Promise<boolean>;
}
