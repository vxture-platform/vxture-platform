import { ConflictException, Injectable } from "@nestjs/common";
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
  UpdateProfileInput,
  UserCredentialRecord,
  UserReadRepository,
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
      account: record.account?.trim() || `_${userNo}`,
      email: record.email,
      phone: record.phone,
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
    return u ? toView(u) : null;
  }

  async findUserByIdentifier(
    identifier: string,
  ): Promise<UserCredentialRecord | null> {
    const id = identifier.trim().toLowerCase();
    for (const u of this.users.values()) {
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

  async findCredentialById(
    userId: string,
  ): Promise<UserCredentialRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) u.passwordHash = passwordHash;
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    if (input.name !== undefined) u.name = input.name;
    if (input.email !== undefined) u.email = input.email;
    if (input.bio !== undefined) u.bio = input.bio;
    if (input.gender !== undefined && input.gender !== null) {
      u.gender = input.gender === "" ? null : input.gender;
    }
    if (input.timezone !== undefined) u.timezone = input.timezone;
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
      if (!taken) u.email = email;
    }
  }

  async bindIdentity(input: BindIdentityInput): Promise<void> {
    this.identities.set(
      `${input.provider}:${input.providerSubject}`,
      input.userId,
    );
  }

  async removeIdentity(userId: string, provider: string): Promise<void> {
    for (const [key, uid] of this.identities.entries()) {
      if (uid === userId && key.startsWith(`${provider}:`)) {
        this.identities.delete(key);
      }
    }
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

  async markEmailVerified(userId: string): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    if (u.email) u.emailVerified = true;
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

  async listSessions(_userId: string): Promise<AuthSessionRecord[]> {
    return [];
  }

  async revokeSession(_userId: string, _sid: string): Promise<boolean> {
    return false;
  }

  async adminSetAccountStatus(
    userId: string,
    status: "active" | "disabled",
  ): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    u.status = status;
    return toView(u);
  }

  async revokeAllSessions(_userId: string): Promise<number> {
    return 0;
  }

  async revokeAllRefreshTokens(_userId: string): Promise<number> {
    return 0;
  }

  async removeAllIdentities(_userId: string): Promise<number> {
    return 0;
  }

  async requestDeletion(userId: string): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u || u.status !== "active") return null;
    u.status = "deleting";
    return toView(u);
  }

  async cancelDeletion(userId: string): Promise<UserView | null> {
    const u = this.users.get(userId);
    if (!u || u.status !== "deleting") return null;
    u.status = "active";
    return toView(u);
  }

  async listDeletionDue(
    _retentionDays: number,
    _limit: number,
  ): Promise<string[]> {
    return [];
  }

  async purgeUser(_userId: string): Promise<boolean> {
    return false;
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
    // Mock has no verified-at timestamps: phone is the mandatory verified anchor
    // (always true); email is treated as unverified offline.
    emailVerified: u.emailVerified ?? false,
    phone: u.phone,
    phoneVerified: u.phoneVerified ?? true,
    accountLoginDisabled: u.accountLoginDisabled ?? false,
    name: u.name,
    status: u.status,
    avatarHash: u.avatarHash,
    bio: u.bio ?? null,
    gender: u.gender ?? null,
    timezone: u.timezone ?? null,
    language: u.language ?? null,
    accountChangedAt: u.accountChangedAt ?? null,
    hasPassword: u.passwordHash != null,
  };
}
