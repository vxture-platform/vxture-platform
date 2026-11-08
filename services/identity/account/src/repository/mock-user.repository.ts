// ⚠️ 跨层引用: Reuse infrastructure phone normalization to match PostgreSQL behavior.
import { toE164 } from "@vxture/core-utils";
import { ConflictException, Injectable } from "@nestjs/common";
import { ACCOUNT_DELETION_RETENTION_DAYS } from "../types/account.types";
import type {
  AvatarRecord,
  BackfillProfileInput,
  BindIdentityInput,
  AuthSessionRecord,
  CreateUserRecord,
  IdentityRecord,
  LastLoginRecord,
  LoginHistoryEntry,
  SetAvatarInput,
  SignInDeviceHistory,
  AdminStatusChange,
  UpdateProfileInput,
  UserCredentialRecord,
  UserReadRepository,
  CustomerSecurityMutation,
  CustomerDeletionTransactionResult,
  CustomerSecuritySnapshot,
  UserView,
} from "../types/account.types";

/**
 * In-memory user repository for offline/no-DB mode (mirrors @vxture/service-iam's
 * MockAccountRepository). Seeded with the sample "zhangsan" user, including the
 * Argon2id hash of "Zhangsan@2026" (same as deploy seed-sample.mjs), so password
 * verification works without a database.
 */
@Injectable()
export class MockUserRepository implements UserReadRepository {
  /** Growth baseline is a no-op in the in-memory mock. */
  async ensureUserPoints(_userId: string): Promise<void> {}

  private readonly users = new Map<string, UserCredentialRecord>();
  /** 注册补齐已完成的 user id（对应 account.users.profile_completed_at 非空）。 */
  private readonly profileCompleted = new Set<string>();
  private readonly identities = new Map<string, string>(); // `${provider}:${subject}` -> userId
  private readonly avatars = new Map<string, AvatarRecord>();
  // 与库里的 user_no 同形(§11 v4「三号解耦」):10 位 = 类别位 1 + 随机 8 + Luhn,
  // 这样离线跑出来的默认句柄 `_{user_no}` 与生产是同一个形状。
  private nextUserNo(): number {
    const body = `1${Math.floor(Math.random() * 100_000_000)
      .toString()
      .padStart(8, "0")}`;
    return Number(`${body}${luhnCheckDigit(body)}`);
  }

  constructor() {
    const zhangsan: UserCredentialRecord = {
      id: "00000000-0000-4000-a000-000000000100",
      account: "zhangsan",
      email: "zhangsan@vxture.dev",
      phone: "+8613800000000",
      name: "Zhang San",
      status: "active",
      avatarHash: null,
      passwordHash:
        "$argon2id$v=19$m=65536,t=3,p=1$pUVn35kL4wFENmQod/eumQ$XquxuvjNWvJq+xXqbDxUlmN1gHJgE+QgnlIju1hAGMM",
    };
    this.users.set(zhangsan.id, zhangsan);
  }

  async createUser(record: CreateUserRecord): Promise<UserView> {
    const id = crypto.randomUUID();
    const userNo = this.nextUserNo();
    const view: UserCredentialRecord = {
      id,
      userNo: String(userNo),
      account: record.account?.trim() || `_${userNo}`,
      email: record.email?.trim().toLowerCase() ?? null,
      emailVerified: Boolean(record.email) && record.emailVerified,
      phone: record.phone,
      phoneVerified: record.phoneVerified,
      name: record.name,
      status: "active",
      avatarHash: null,
      passwordHash: record.passwordHash ?? null,
    };
    this.users.set(id, view);
    return toView(view);
  }

  async getUserById(userId: string): Promise<UserView | null> {
    const u = this.users.get(userId);
    return u && (u.status === "active" || u.status === "deleting")
      ? toView(u)
      : null;
  }

  async isAccountAvailable(
    account: string,
    excludeUserId: string,
  ): Promise<boolean> {
    const user = await this.findUserByIdentifier(account);
    return !user || user.id === excludeUserId;
  }

  async findUserByIdentifier(
    identifier: string,
  ): Promise<UserCredentialRecord | null> {
    const id = identifier.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.status !== "active" && u.status !== "deleting") continue;
      if (
        u.account.toLowerCase() === id ||
        (u.email && u.email.toLowerCase() === id) ||
        u.phone === identifier.trim()
      ) {
        return u;
      }
    }
    return null;
  }

  async findUserByUserNo(userNo: string): Promise<{
    id: string;
    userNo: string;
    name: string | null;
    account: string | null;
    email: string | null;
    phone: string | null;
  } | null> {
    const raw = userNo.trim();
    if (!/^\d{1,20}$/.test(raw)) return null;
    const hit = [...this.users.values()].find(
      (u) => u.status !== "deleted" && (u.userNo ?? "").trim() === raw,
    );
    return hit
      ? {
          id: hit.id,
          userNo: hit.userNo ?? raw,
          name: hit.name ?? null,
          account: hit.account ?? null,
          email: hit.email ?? null,
          phone: hit.phone ?? null,
        }
      : null;
  }

  async findCredentialById(
    userId: string,
  ): Promise<UserCredentialRecord | null> {
    const u = this.users.get(userId);
    return u && (u.status === "active" || u.status === "deleting") ? u : null;
  }

  /** Mirror the atomic proof checks used by the PostgreSQL repository. */
  async applySelfSecurity(
    userId: string,
    mutation: CustomerSecurityMutation,
  ): Promise<void> {
    const user = this.users.get(userId);
    const e = mutation.snapshot;
    if (
      !user ||
      user.status !== "active" ||
      user.phone !== e.phone ||
      user.email !== e.email ||
      user.account !== e.account ||
      Boolean(user.phoneVerified) !== e.phoneVerified ||
      Boolean(user.emailVerified) !== e.emailVerified ||
      Boolean(user.accountLoginDisabled) !== e.accountLoginDisabled ||
      Boolean(user.emailLoginDisabled) !== Boolean(e.emailLoginDisabled) ||
      Boolean(user.passwordHash) !== e.hasPassword ||
      user.passwordHash !== mutation.expectedPasswordHash
    )
      throw new ConflictException("security_proof_stale");
    const { operation, target } = mutation;
    if (
      [...this.users.values()].some(
        (u) =>
          u.id !== userId &&
          (operation === "phone-change"
            ? u.phone === (toE164(target) ?? target)
            : operation === "email-change"
              ? u.email === target
              : operation === "username"
                ? u.account === target
                : false),
      )
    )
      throw new ConflictException("security_target_in_use");
    if (operation === "phone-change") {
      user.phone = toE164(target) ?? target;
      user.phoneVerified = true;
    } else if (operation === "email-change") {
      user.email = target;
      user.emailVerified = true;
    } else if (operation === "phone-verify") user.phoneVerified = true;
    else if (operation === "email-verify") user.emailVerified = true;
    else if (operation === "password") {
      if (!mutation.passwordHash)
        throw new ConflictException("password_required");
      user.passwordHash = mutation.passwordHash;
    } else if (operation === "email-login") {
      if (!["true", "false"].includes(target) || !user.phoneVerified)
        throw new ConflictException("verified_phone_required");
      if (target === "true" && !user.emailVerified)
        throw new ConflictException("verified_email_required");
      user.emailLoginDisabled = target === "false";
    } else if (operation === "username") {
      if (
        user.accountChangedAt &&
        Date.now() - new Date(user.accountChangedAt).getTime() < 30 * 86400000
      )
        throw new ConflictException("username_change_cooldown");
      user.account = target;
      user.accountChangedAt = new Date().toISOString();
    } else if (
      operation === "identity-unlink" ||
      operation === "account-login"
    ) {
      const identities = [...this.identities.entries()].filter(
        ([, id]) => id === userId,
      );
      const remaining = identities.filter(
        ([key]) =>
          operation !== "identity-unlink" || !key.startsWith(target + ":"),
      );
      const passwordAvailable =
        Boolean(user.passwordHash) &&
        (operation === "account-login"
          ? target === "true"
          : !user.accountLoginDisabled);
      if (
        !user.phoneVerified &&
        !(user.emailVerified && !user.emailLoginDisabled) &&
        !passwordAvailable &&
        !remaining.length
      )
        throw new ConflictException("cannot_remove_last_login_method");
      if (operation === "identity-unlink") {
        const subjects = identities
          .filter(([key]) => key.startsWith(target + ":"))
          .map(([key]) => key.slice(target.length + 1))
          .sort();
        if (
          JSON.stringify(subjects) !== JSON.stringify(e.identitySubjects ?? [])
        )
          throw new ConflictException("security_proof_stale");
        if (remaining.length === identities.length)
          throw new ConflictException("identity_not_bound");
        for (const [key] of identities)
          if (key.startsWith(target + ":")) this.identities.delete(key);
      } else {
        if (target === "true" && !user.passwordHash)
          throw new ConflictException("password_required");
        user.accountLoginDisabled = target === "false";
      }
    } else throw new ConflictException("invalid_security_operation");
    await this.revokeAllSessions(userId);
    await this.revokeAllRefreshTokens(userId);
  }

  async setPassword(
    userId: string,
    passwordHash: string,
    revokeSessions = true,
  ): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    if (!revokeSessions && u.passwordHash)
      throw new ConflictException("password_already_set");
    u.passwordHash = passwordHash;
    if (revokeSessions) {
      await this.revokeAllSessions(userId);
      await this.revokeAllRefreshTokens(userId);
    }
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u || u.status === "deleted") return null;
    if (input.name !== undefined) u.name = input.name;
    if (input.email != null) {
      const email = input.email.trim().toLowerCase();
      if (u.email !== email) u.emailVerified = false;
      u.email = email;
    }
    if (input.bio !== undefined) u.bio = input.bio;
    if (input.gender !== undefined && input.gender !== null) {
      u.gender = input.gender === "" ? null : input.gender;
    }
    // 与 pg-user.repository 同一套三态:null = 不改,'' = 清成 null,其它 = 设值。
    if (input.timezone !== undefined && input.timezone !== null) {
      u.timezone = input.timezone === "" ? null : input.timezone;
    }
    if (input.language !== undefined) u.language = input.language;
    return toView(u);
  }

  async backfillProfile(
    userId: string,
    input: BackfillProfileInput,
  ): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    // Fill blanks only; skip an email already taken by another user.
    if (!u.name && input.name) u.name = input.name;
    if (!u.email && input.email) {
      const email = input.email.toLowerCase().trim();
      const taken = [...this.users.values()].some(
        (o) => o.id !== userId && o.email?.toLowerCase() === email,
      );
      if (!taken) {
        u.email = email;
        u.emailVerified = input.emailVerified ?? false;
      }
    }
  }

  async bindIdentity(input: BindIdentityInput): Promise<boolean> {
    const key = `${input.provider}:${input.providerSubject}`;
    /* 与 pg 那侧同义:已经绑过的再绑一次**什么都没改**,回 false。 */
    if (this.identities.get(key) === input.userId) return false;
    this.identities.set(key, input.userId);
    return true;
  }

  async removeIdentity(userId: string, provider: string): Promise<boolean> {
    let removed = false;
    for (const [key, uid] of this.identities.entries()) {
      if (uid === userId && key.startsWith(`${provider}:`)) {
        this.identities.delete(key);
        removed = true;
      }
    }
    return removed;
  }

  async findUserByProviderSubject(
    provider: string,
    providerSubject: string,
  ): Promise<UserView | null> {
    const userId = this.identities.get(`${provider}:${providerSubject}`);
    return userId ? this.getUserById(userId) : null;
  }

  async getAvatar(userId: string): Promise<AvatarRecord | null> {
    return this.avatars.get(userId) ?? null;
  }

  async setAvatar(userId: string, input: SetAvatarInput): Promise<void> {
    this.avatars.set(userId, {
      data: input.data,
      contentType: input.contentType,
      hash: input.hash,
    });
    const u = this.users.get(userId);
    if (u) u.avatarHash = input.hash;
  }

  async deleteAvatar(userId: string): Promise<void> {
    this.avatars.delete(userId);
    const u = this.users.get(userId);
    if (u) u.avatarHash = null;
  }

  async changePhone(
    userId: string,
    newPhone: string,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    u.phone = newPhone;
    u.phoneVerified = true;
    return toView(u);
  }

  async changeEmail(
    userId: string,
    newEmail: string,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const email = newEmail.toLowerCase().trim();
    const taken = [...this.users.values()].some(
      (o) => o.id !== userId && o.email?.toLowerCase() === email,
    );
    if (taken) throw new ConflictException("email already in use");
    u.email = email;
    u.emailVerified = true;
    return toView(u);
  }

  async markEmailVerified(
    userId: string,
    expectedEmail: string,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u || !u.email || u.email !== expectedEmail.trim().toLowerCase())
      return null;
    u.emailVerified = true;
    return toView(u);
  }

  async markPhoneVerified(userId: string): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    u.phoneVerified = true;
    return toView(u);
  }

  async setAccountLoginDisabled(
    userId: string,
    disabled: boolean,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    u.accountLoginDisabled = disabled;
    return toView(u);
  }

  /** 与 pg 实现同口径：查不到这个人按「已完成」处理（不把不存在的用户引去补齐页）。 */
  async isProfileCompleted(userId: string): Promise<boolean> {
    const u = this.users.get(userId);
    if (!u) return true;
    return this.profileCompleted.has(userId);
  }

  async markProfileCompleted(userId: string): Promise<void> {
    if (this.users.has(userId)) this.profileCompleted.add(userId);
  }

  async changeAccount(
    userId: string,
    newAccount: string,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const account = newAccount.trim();
    const taken = [...this.users.values()].some(
      (o) =>
        o.id !== userId && o.account.toLowerCase() === account.toLowerCase(),
    );
    if (taken) throw new ConflictException("username already in use");
    u.account = account;
    u.accountChangedAt = new Date().toISOString();
    return toView(u);
  }

  async listIdentitiesByUser(userId: string): Promise<IdentityRecord[]> {
    const result: IdentityRecord[] = [];
    for (const [key, uid] of this.identities.entries()) {
      if (uid === userId) {
        const [provider, ...subjectParts] = key.split(":");
        result.push({
          provider: provider ?? key,
          providerSubject: subjectParts.join(":"),
          connectedAt: new Date().toISOString(),
        });
      }
    }
    return result;
  }

  async getLastLogin(_userId: string): Promise<LastLoginRecord | null> {
    return null;
  }

  async listLoginHistory(
    _userId: string,
    _limit: number,
  ): Promise<LoginHistoryEntry[]> {
    return [];
  }

  /**
   * 离线模式没有登录流水。回 `priorSuccesses: 0` 的含义是**明确的**:
   * 「一次成功登录都没见过」⇒ 按 isUnseenDevice 的第二条,一条提醒都不发。
   * 这正是离线 / 单测该有的行为——mock 库上发通知只会让本机跑出与生产不同的结论。
   */
  async listRecentSignInDevices(
    _userId: string,
    _withinDays: number,
  ): Promise<SignInDeviceHistory> {
    return { priorSuccesses: 0, userAgents: [] };
  }

  /** 离线模式没有 tenancy 表。null ⇒ 安全通知一条也发不出(各自记一行 no_personal_tenant)。 */
  async findPersonalTenantId(_userId: string): Promise<string | null> {
    return null;
  }

  async listSessions(_userId: string): Promise<AuthSessionRecord[]> {
    return [];
  }

  async revokeSession(_userId: string, _sid: string): Promise<boolean> {
    return false;
  }

  async adminSetAccountStatus(
    userId: string,
    status: "active" | "disabled",
  ): Promise<AdminStatusChange | null> {
    const u = this.users.get(userId);
    if (!u || u.status === "deleted") return null;
    const changed = u.status !== status;
    u.status = status;
    return { user: toView(u), changed };
  }

  /** Admin reads include disabled accounts but exclude purged tombstones. */
  async findUserForAdmin(userId: string): Promise<UserView | null> {
    const u = this.users.get(userId);
    return u && u.status !== "deleted" ? toView(u) : null;
  }

  async revokeAllSessions(_userId: string): Promise<number> {
    return 0;
  }

  async revokeAllRefreshTokens(_userId: string): Promise<number> {
    return 0;
  }

  async removeAllIdentities(userId: string): Promise<number> {
    return this.removeIdentityRecords(userId);
  }

  // ============================================================================
  // Customer lifecycle (no awaits inside an in-memory state transition)
  // ============================================================================

  private removeIdentityRecords(userId: string): number {
    let removed = 0;
    for (const [key, owner] of this.identities) {
      if (owner !== userId) continue;
      this.identities.delete(key);
      removed++;
    }
    return removed;
  }

  async requestDeletion(
    userId: string,
    snapshot?: CustomerSecuritySnapshot,
  ): Promise<CustomerDeletionTransactionResult | null> {
    const u = this.users.get(userId);
    if (!u || u.status !== "active") return null;
    if (
      snapshot &&
      (u.phone !== snapshot.phone ||
        u.email !== snapshot.email ||
        u.account !== snapshot.account ||
        Boolean(u.phoneVerified) !== snapshot.phoneVerified ||
        Boolean(u.emailVerified) !== snapshot.emailVerified ||
        Boolean(u.accountLoginDisabled) !== snapshot.accountLoginDisabled ||
        Boolean(u.passwordHash) !== snapshot.hasPassword)
    )
      return null;
    const deletionRequestedAt = new Date().toISOString();
    u.status = "deleting";
    u.deletionRequestedAt = deletionRequestedAt;
    return {
      deletionRequestedAt,
      revokedSessions: 0,
      unboundIdentities: this.removeIdentityRecords(userId),
    };
  }

  async cancelDeletion(
    userId: string,
    expectedRequestedAt?: string,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (
      !u ||
      u.status !== "deleting" ||
      !u.deletionRequestedAt ||
      (expectedRequestedAt !== undefined &&
        u.deletionRequestedAt !== expectedRequestedAt) ||
      !(
        Date.parse(u.deletionRequestedAt) +
          ACCOUNT_DELETION_RETENTION_DAYS * 86400000 >
        Date.now()
      )
    )
      return null;
    u.status = "active";
    u.deletionRequestedAt = null;
    return toView(u);
  }

  async listDeletionDue(
    retentionDays: number,
    limit: number,
  ): Promise<string[]> {
    return [...this.users.values()]
      .filter(
        (u) =>
          u.status === "deleting" &&
          u.deletionRequestedAt &&
          Date.parse(u.deletionRequestedAt) + retentionDays * 86400000 <=
            Date.now(),
      )
      .sort(
        (a, b) =>
          Date.parse(a.deletionRequestedAt!) -
          Date.parse(b.deletionRequestedAt!),
      )
      .slice(0, Math.min(Math.max(limit, 1), 500))
      .map((u) => u.id);
  }

  async purgeUser(userId: string): Promise<boolean> {
    const u = this.users.get(userId);
    if (
      !u ||
      u.status !== "deleting" ||
      !u.deletionRequestedAt ||
      !(
        Date.parse(u.deletionRequestedAt) +
          ACCOUNT_DELETION_RETENTION_DAYS * 86400000 <=
        Date.now()
      )
    )
      return false;
    u.status = "deleted";
    u.account = `deleted_${u.userNo ?? u.id}`;
    u.email = null;
    u.phone = `deleted:${u.id.slice(0, 24)}`;
    u.accountLoginDisabled = true;
    u.passwordHash = null;
    u.name = null;
    u.avatarHash = null;
    u.bio = null;
    u.gender = null;
    this.avatars.delete(userId);
    this.removeIdentityRecords(userId);
    return true;
  }
}

/** Luhn 校验位(与 DDL 的 public.luhn_check_digit 同规则;§11 v4)。 */
function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true; // 自右向左,紧邻校验位的那位起加倍
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

function toView(u: UserCredentialRecord): UserView {
  return {
    id: u.id,
    account: u.account,
    email: u.email,
    // Preserve explicit verification evidence, including the unverified state.
    emailVerified: u.emailVerified ?? false,
    phone: u.phone,
    phoneVerified: u.phoneVerified ?? false,
    accountLoginDisabled: u.accountLoginDisabled ?? false,
    name: u.name,
    status: u.status,
    avatarHash: u.avatarHash,
    bio: u.bio ?? null,
    gender: u.gender ?? null,
    timezone: u.timezone ?? null,
    language: u.language ?? null,
    accountChangedAt: u.accountChangedAt ?? null,
    ...(u.userNo ? { userNo: u.userNo } : {}),
    deletionRequestedAt: u.deletionRequestedAt ?? null,
    hasPassword: u.passwordHash != null,
  };
}
