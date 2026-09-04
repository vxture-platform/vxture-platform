import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { toE164 } from "@vxture/core-utils";
import { ACCOUNT_PG_POOL } from "../tokens";
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

interface UserRow {
  id: string;
  account: string;
  email: string | null;
  email_verified_at: string | null;
  phone: string;
  phone_verified_at: string | null;
  name: string | null;
  status: string;
  avatar_hash: string | null;
  bio: string | null;
  timezone: string | null;
  language: string | null;
  account_changed_at: string | null;
  account_login_disabled: boolean | null;
  user_no: string | null;
  created_at: string | null;
  has_password: boolean | null;
  deletion_requested_at?: string | null;
}

/**
 * 读路径放行的状态:active 之外还有 deleting(自助删除的 30 天保留期,050-account §7)。
 * 保留期内用户仍能登录——登录后由 console 提示「撤销删除并重新启用」;disabled /
 * pending 照旧隐身。三条读谓词共用这一句,别各写各的。
 */
const READABLE_STATUS_SQL = `u.status in ('active', 'deleting')`;

interface UserCredentialRow {
  id: string;
  account: string;
  email: string | null;
  phone: string;
  name: string | null;
  status: string;
  avatar_hash: string | null;
  account_login_disabled: boolean | null;
  password_hash: string | null;
}

/**
 * Raw-SQL repository for identity-core users over the new `identity` schema
 * (users / identities / user_credential). Mirrors the @vxture/service-iam
 * pg-repository convention (pg.Pool, no Prisma).
 */
@Injectable()
export class PgUserRepository implements UserReadRepository {
  constructor(@Inject(ACCOUNT_PG_POOL) private readonly pool: Pool) {}

  async createUser(record: CreateUserRecord): Promise<UserView> {
    const id = crypto.randomUUID();
    const phone = toE164(record.phone) ?? record.phone.trim();
    const email = record.email ? record.email.toLowerCase().trim() : null;
    const emailVerified = Boolean(email) && record.emailVerified;
    let account = record.account?.trim() || "";

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Allocate the stable public user number first so it seeds the default
      // username (`_{user_no}`) when the caller supplied none.
      // user_no 走 account.principal_no_seq（与 account.users.user_no 的列默认值、
      // 以及 tenant_no 同一条序列+公式，见 ddl/10_account.sql、95_triggers.sql）——
      // 用户与组织租户共享主体号空间，跨表永不撞号。旧写法 `account.user_no_seq`
      // 是 identity.*→account.* 迁移遗留的死序列（生产从未建），会 500。
      const seq = await client.query<{ user_no: string }>(
        `select nextval('account.principal_no_seq') * 1000
                + floor(random() * 1000)::bigint as user_no`,
      );
      const userNo = seq.rows[0]?.user_no;
      if (!userNo) throw new Error("failed to allocate user_no");
      if (!account) account = `_${userNo}`;
      // phone is a mandatory verified anchor → phone_verified_at is always set.
      // (Registration verifies the phone before creating the user.)
      // email_verified_at is set only when the email is asserted verified.
      await client.query(
        `insert into account.users
           (id, user_no, account, email, email_verified_at, phone, phone_verified_at,
            status, created_at, updated_at)
         values ($1, $2, $3, $4, case when $6 then now() else null end,
                 $5, now(), 'active', now(), now())`,
        [id, userNo, account, email, phone, emailVerified],
      );
      // Display/localization fields live on the 1:1 user_profile table (§4.1.2);
      // the core auth row (users) never carries them.
      await client.query(
        `insert into account.user_profiles (user_id, display_name, created_at, updated_at)
         values ($1, $2, now(), now())`,
        [id, record.name ?? null],
      );
      if (record.passwordHash) {
        await client.query(
          `insert into credential.user_credentials (user_id, password_hash, created_at, updated_at)
           values ($1, $2, now(), now())`,
          [id, record.passwordHash],
        );
      }
      // Growth baseline (loyalty.user_points): every user carries a zero-balance
      // row from birth (user-onboarding checklist item 4; fix 2026-07-06 — the
      // row was previously only seeded for the sample user, never at runtime).
      await client.query(
        `insert into loyalty.user_points (user_id, total_points, updated_at)
         values ($1, 0, now()) on conflict (user_id) do nothing`,
        [id],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if (isUniqueViolation(error)) {
        throw new ConflictException("account, email or phone already in use");
      }
      throw error;
    } finally {
      client.release();
    }

    return {
      id,
      account,
      email,
      phone,
      name: record.name ?? null,
      status: "active",
      avatarHash: null,
    };
  }

  /** Idempotent growth-baseline heal (user-onboarding checklist item 10). */
  async ensureUserPoints(userId: string): Promise<void> {
    await this.pool.query(
      `insert into loyalty.user_points (user_id, total_points, updated_at)
       values ($1, 0, now()) on conflict (user_id) do nothing`,
      [userId],
    );
  }

  async getUserById(userId: string): Promise<UserView | null> {
    const result = await this.pool.query<UserRow>(
      `select u.id, u.account, u.email, u.email_verified_at::text as email_verified_at,
              u.phone, u.phone_verified_at::text as phone_verified_at,
              p.display_name as name, u.status, p.avatar_hash, p.bio, p.timezone, p.language,
              u.account_changed_at::text as account_changed_at,
              u.account_login_disabled,
              u.user_no::text as user_no, u.created_at::text as created_at,
              (c.password_hash is not null) as has_password,
              u.deletion_requested_at::text as deletion_requested_at
         from account.users u
         left join account.user_profiles p on p.user_id = u.id
         left join credential.user_credentials c on c.user_id = u.id
        where u.id = $1 and u.deleted_at is null and ${READABLE_STATUS_SQL}
        limit 1`,
      [userId],
    );
    return mapUser(result.rows[0]);
  }

  async findUserByIdentifier(
    identifier: string,
  ): Promise<UserCredentialRecord | null> {
    const raw = identifier.trim();
    // Phone may be presented in different formats; match canonical E.164 too.
    const e164 = toE164(raw);
    const result = await this.pool.query<UserCredentialRow>(
      `select u.id, u.account, u.email, u.phone, p.display_name as name, u.status, p.avatar_hash, u.account_login_disabled, c.password_hash
         from account.users u
         left join credential.user_credentials c on c.user_id = u.id
         left join account.user_profiles p on p.user_id = u.id
        where u.deleted_at is null and ${READABLE_STATUS_SQL}
          and (
            lower(u.account) = lower($1)
            or lower(coalesce(u.email, '')) = lower($1)
            or u.phone = $1
            or u.phone = $2
          )
        limit 1`,
      [raw, e164 ?? raw],
    );
    return mapCredential(result.rows[0]);
  }

  async findCredentialById(
    userId: string,
  ): Promise<UserCredentialRecord | null> {
    const result = await this.pool.query<UserCredentialRow>(
      `select u.id, u.account, u.email, u.phone, p.display_name as name, u.status, p.avatar_hash, u.account_login_disabled, c.password_hash
         from account.users u
         left join credential.user_credentials c on c.user_id = u.id
         left join account.user_profiles p on p.user_id = u.id
        where u.id = $1 and u.deleted_at is null and ${READABLE_STATUS_SQL}
        limit 1`,
      [userId],
    );
    return mapCredential(result.rows[0]);
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `insert into credential.user_credentials (user_id, password_hash, created_at, updated_at)
       values ($1, $2, now(), now())
       on conflict (user_id) do update set
         password_hash = excluded.password_hash,
         password_changed_at = now(),
         updated_at = now()`,
      [userId, passwordHash],
    );
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserView | null> {
    const email = input.email != null ? input.email.toLowerCase().trim() : null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // email stays on the core auth table.
      await client.query(
        `update account.users
            set email = coalesce($2, email), updated_at = now()
          where id = $1 and deleted_at is null`,
        [userId, email],
      );
      // display/localization fields live on user_profile (1:1); upsert so a caller
      // that never triggered profile creation still gets a row. coalesce keeps the
      // current value when the param is null (leave-unchanged sentinel).
      await client.query(
        `insert into account.user_profiles
           (user_id, display_name, bio, timezone, language, created_at, updated_at)
         values ($1, $2, $3, $4, $5, now(), now())
         on conflict (user_id) do update set
           display_name = coalesce(excluded.display_name, account.user_profiles.display_name),
           bio          = coalesce(excluded.bio, account.user_profiles.bio),
           timezone     = coalesce(excluded.timezone, account.user_profiles.timezone),
           language     = coalesce(excluded.language, account.user_profiles.language),
           updated_at   = now()`,
        [
          userId,
          input.name ?? null,
          input.bio ?? null,
          input.timezone ?? null,
          input.language ?? null,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if (isUniqueViolation(error)) {
        throw new ConflictException("email already in use");
      }
      throw error;
    } finally {
      client.release();
    }
    return this.getUserById(userId);
  }

  async backfillProfile(
    userId: string,
    input: BackfillProfileInput,
  ): Promise<void> {
    const email = input.email ? input.email.toLowerCase().trim() : null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // fill blanks only, never overwrite. email_verified_at is set only when we
      // are actually filling the email now AND it's asserted verified.
      await client.query(
        `update account.users
            set email = coalesce(email, $2),
                email_verified_at = case
                  when email is null and $2 is not null and $3 then now()
                  else email_verified_at end,
                updated_at = now()
          where id = $1 and deleted_at is null`,
        [userId, email, input.emailVerified ?? false],
      );
      // display_name fill-blank on user_profile (keep existing when present).
      await client.query(
        `insert into account.user_profiles (user_id, display_name, created_at, updated_at)
         values ($1, $2, now(), now())
         on conflict (user_id) do update set
           display_name = coalesce(account.user_profiles.display_name, excluded.display_name),
           updated_at = now()`,
        [userId, input.name ?? null],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      // A colliding email must not break login (§6): skip the backfill silently.
      if (isUniqueViolation(error)) return;
      throw error;
    } finally {
      client.release();
    }
  }

  async bindIdentity(input: BindIdentityInput): Promise<void> {
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    try {
      await this.pool.query(
        `insert into identity.identities
           (user_id, provider, provider_subject, metadata, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())
         on conflict (provider, provider_subject) do nothing`,
        [
          input.userId,
          input.provider.trim(),
          input.providerSubject.trim(),
          metadata,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("identity already bound");
      }
      throw error;
    }
  }

  async removeIdentity(userId: string, provider: string): Promise<void> {
    await this.pool.query(
      `delete from identity.identities
        where user_id = $1 and provider = $2`,
      [userId, provider.trim()],
    );
  }

  async findUserByProviderSubject(
    provider: string,
    providerSubject: string,
  ): Promise<UserView | null> {
    const result = await this.pool.query<{ user_id: string }>(
      `select user_id from identity.identities
        where provider = $1 and provider_subject = $2
        limit 1`,
      [provider.trim(), providerSubject.trim()],
    );
    const userId = result.rows[0]?.user_id;
    return userId ? this.getUserById(userId) : null;
  }

  async getAvatar(userId: string): Promise<AvatarRecord | null> {
    const result = await this.pool.query<{
      data: Buffer;
      content_type: string;
      hash: string;
    }>(
      `select data, content_type, hash from account.user_avatars
        where user_id = $1 limit 1`,
      [userId],
    );
    const row = result.rows[0];
    return row
      ? { data: row.data, contentType: row.content_type, hash: row.hash }
      : null;
  }

  async setAvatar(userId: string, input: SetAvatarInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into account.user_avatars (user_id, data, content_type, hash, source, updated_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (user_id) do update set
           data = excluded.data,
           content_type = excluded.content_type,
           hash = excluded.hash,
           source = excluded.source,
           updated_at = now()`,
        [userId, input.data, input.contentType, input.hash, input.source],
      );
      await client.query(
        `insert into account.user_profiles (user_id, avatar_hash, created_at, updated_at)
         values ($1, $2, now(), now())
         on conflict (user_id) do update set
           avatar_hash = excluded.avatar_hash, updated_at = now()`,
        [userId, input.hash],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async changeAccount(
    userId: string,
    newAccount: string,
  ): Promise<UserView | null> {
    const account = newAccount.trim();
    try {
      await this.pool.query(
        `update account.users
            set account = $2, account_changed_at = now(), updated_at = now()
          where id = $1 and deleted_at is null and status = 'active'`,
        [userId, account],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("username already in use");
      }
      throw error;
    }
    return this.getUserById(userId);
  }

  async changePhone(
    userId: string,
    newPhone: string,
  ): Promise<UserView | null> {
    const phone = toE164(newPhone) ?? newPhone.trim();
    try {
      await this.pool.query(
        `update account.users
            set phone = $2, phone_verified_at = now(), updated_at = now()
          where id = $1 and deleted_at is null and status = 'active'`,
        [userId, phone],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("phone already in use");
      }
      throw error;
    }
    return this.getUserById(userId);
  }

  async changeEmail(
    userId: string,
    newEmail: string,
  ): Promise<UserView | null> {
    const email = newEmail.toLowerCase().trim();
    try {
      await this.pool.query(
        `update account.users
            set email = $2, email_verified_at = now(), updated_at = now()
          where id = $1 and deleted_at is null and status = 'active'`,
        [userId, email],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("email already in use");
      }
      throw error;
    }
    return this.getUserById(userId);
  }

  async markEmailVerified(userId: string): Promise<UserView | null> {
    await this.pool.query(
      `update account.users
          set email_verified_at = now(), updated_at = now()
        where id = $1 and email is not null and deleted_at is null and status = 'active'`,
      [userId],
    );
    return this.getUserById(userId);
  }

  async markPhoneVerified(userId: string): Promise<UserView | null> {
    await this.pool.query(
      `update account.users
          set phone_verified_at = now(), updated_at = now()
        where id = $1 and deleted_at is null and status = 'active'`,
      [userId],
    );
    return this.getUserById(userId);
  }

  async setAccountLoginDisabled(
    userId: string,
    disabled: boolean,
  ): Promise<UserView | null> {
    await this.pool.query(
      `update account.users
          set account_login_disabled = $2, updated_at = now()
        where id = $1 and deleted_at is null and status = 'active'`,
      [userId, disabled],
    );
    return this.getUserById(userId);
  }

  async deleteAvatar(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from account.user_avatars where user_id = $1`,
        [userId],
      );
      await client.query(
        `update account.user_profiles set avatar_hash = null, updated_at = now()
          where user_id = $1`,
        [userId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listIdentitiesByUser(userId: string): Promise<IdentityRecord[]> {
    const result = await this.pool.query<{
      provider: string;
      provider_subject: string;
      created_at: string;
    }>(
      `select provider, provider_subject, created_at::text as created_at
         from identity.identities
        where user_id = $1
        order by created_at asc`,
      [userId],
    );
    return result.rows.map((r) => ({
      provider: r.provider,
      providerSubject: r.provider_subject,
      connectedAt: r.created_at,
    }));
  }

  async getLastLogin(userId: string): Promise<LastLoginRecord | null> {
    const result = await this.pool.query<{
      created_at: string;
      ip_address: string;
      user_agent: string | null;
      country_code: string | null;
    }>(
      `select created_at::text as created_at, ip_address, user_agent, country_code
         from session.login_attempts
        where user_id = $1 and result = 'success'
        order by created_at desc
        limit 1`,
      [userId],
    );
    const row = result.rows[0];
    return row
      ? {
          loginAt: row.created_at,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          countryCode: row.country_code,
        }
      : null;
  }

  async listLoginHistory(
    userId: string,
    limit: number,
  ): Promise<LoginHistoryEntry[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const result = await this.pool.query<{
      created_at: string;
      ip_address: string;
      user_agent: string | null;
      country_code: string | null;
      auth_method: string;
      result: string;
    }>(
      `select created_at::text as created_at, ip_address, user_agent,
              country_code, auth_method, result
         from session.login_attempts
        where user_id = $1
          and created_at > now() - interval '30 days'
        order by created_at desc
        limit $2`,
      [userId, cap],
    );
    return result.rows.map((r) => ({
      loginAt: r.created_at,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      countryCode: r.country_code,
      authMethod: r.auth_method,
      result: r.result,
    }));
  }

  async listSessions(userId: string): Promise<AuthSessionRecord[]> {
    const result = await this.pool.query<{
      sid: string;
      auth_method: string;
      ip_address: string | null;
      user_agent: string | null;
      last_active_at: string;
      created_at: string;
      expires_at: string;
    }>(
      `select sid, auth_method, ip_address, user_agent,
              last_active_at::text as last_active_at,
              created_at::text as created_at,
              expires_at::text as expires_at
         from session.auth_sessions
        where user_id = $1 and realm = 'customer'
          and status = 'active' and expires_at > now()
        order by last_active_at desc`,
      [userId],
    );
    return result.rows.map((r) => ({
      sid: r.sid,
      authMethod: r.auth_method,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      lastActiveAt: r.last_active_at,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }

  async revokeSession(userId: string, sid: string): Promise<boolean> {
    const result = await this.pool.query(
      `update session.auth_sessions
          set status = 'revoked', revoked_at = now()
        where sid = $1 and user_id = $2 and status = 'active'`,
      [sid, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async adminSetAccountStatus(
    userId: string,
    status: "active" | "disabled",
  ): Promise<UserView | null> {
    await this.pool.query(
      `update account.users
          set status = $2, updated_at = now()
        where id = $1 and deleted_at is null`,
      [userId, status],
    );
    return this.getUserById(userId);
  }

  async revokeAllSessions(userId: string): Promise<number> {
    const result = await this.pool.query(
      `update session.auth_sessions
          set status = 'revoked', revoked_at = now()
        where user_id = $1 and realm = 'customer' and status = 'active'`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

  async revokeAllRefreshTokens(userId: string): Promise<number> {
    const result = await this.pool.query(
      `update session.refresh_tokens
          set status = 'revoked'
        where user_id = $1 and status = 'active'`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

  async removeAllIdentities(userId: string): Promise<number> {
    const result = await this.pool.query(
      `delete from identity.identities where user_id = $1`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

  // ── 自助删除(050-account §7):active → deleting(保留期)→ 清扫 ──────────

  async requestDeletion(userId: string): Promise<UserView | null> {
    const result = await this.pool.query(
      `update account.users
          set status = 'deleting', deletion_requested_at = now(), updated_at = now()
        where id = $1 and deleted_at is null and status = 'active'
        returning id`,
      [userId],
    );
    if ((result.rowCount ?? 0) === 0) return null;
    return this.getUserById(userId);
  }

  async cancelDeletion(userId: string): Promise<UserView | null> {
    const result = await this.pool.query(
      `update account.users
          set status = 'active', deletion_requested_at = null, updated_at = now()
        where id = $1 and deleted_at is null and status = 'deleting'
        returning id`,
      [userId],
    );
    if ((result.rowCount ?? 0) === 0) return null;
    return this.getUserById(userId);
  }

  async listDeletionDue(
    retentionDays: number,
    limit: number,
  ): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `select id
         from account.users
        where status = 'deleting' and deleted_at is null
          and deletion_requested_at is not null
          and deletion_requested_at < now() - make_interval(days => $1)
        order by deletion_requested_at asc
        limit $2`,
      [retentionDays, Math.min(Math.max(limit, 1), 500)],
    );
    return result.rows.map((r) => r.id);
  }

  /**
   * 清扫 = 脱敏 + 软删,不物理删主体行:user_no 永不回收(050-account §1),订单 /
   * 账单 / 审计里的裸 user_id 还要能解引用到"一个已删除的用户"。三个唯一标识改成
   * 不可能再被人占用的形状(account 走 deleted_<user_no>,phone 走 deleted:<id 前缀>,
   * email 置空),展示资料清空,凭据 / 三方绑定 / 头像整行删掉。
   */
  async purgeUser(userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const marked = await client.query(
        `update account.users
            set account = 'deleted_' || user_no::text,
                email = null,
                phone = 'deleted:' || left(id::text, 24),
                account_login_disabled = true,
                deleted_at = now(),
                updated_at = now()
          where id = $1 and status = 'deleting' and deleted_at is null
          returning id`,
        [userId],
      );
      if ((marked.rowCount ?? 0) === 0) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `update account.user_profiles
            set display_name = null, avatar_url = null, avatar_hash = null,
                gender = null, birthday = null, bio = null, updated_at = now()
          where user_id = $1`,
        [userId],
      );
      await client.query(
        `delete from account.user_avatars where user_id = $1`,
        [userId],
      );
      await client.query(
        `delete from credential.user_credentials where user_id = $1`,
        [userId],
      );
      await client.query(`delete from identity.identities where user_id = $1`, [
        userId,
      ]);
      await client.query(
        `update session.auth_sessions
            set status = 'revoked', revoked_at = now()
          where user_id = $1 and status = 'active'`,
        [userId],
      );
      await client.query(
        `update session.refresh_tokens set status = 'revoked'
          where user_id = $1 and status = 'active'`,
        [userId],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapUser(row?: UserRow): UserView | null {
  if (!row) return null;
  const view: UserView = {
    id: row.id,
    account: row.account,
    email: row.email,
    emailVerified: row.email_verified_at != null,
    phone: row.phone,
    phoneVerified: row.phone_verified_at != null,
    accountLoginDisabled: row.account_login_disabled ?? false,
    name: row.name,
    status: row.status,
    avatarHash: row.avatar_hash,
    bio: row.bio,
    timezone: row.timezone,
    language: row.language,
    accountChangedAt: row.account_changed_at,
  };
  if (row.user_no != null) view.userNo = row.user_no;
  if (row.created_at != null) view.createdAt = row.created_at;
  view.hasPassword = row.has_password ?? false;
  view.deletionRequestedAt = row.deletion_requested_at ?? null;
  return view;
}

function mapCredential(row?: UserCredentialRow): UserCredentialRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    account: row.account,
    email: row.email,
    phone: row.phone,
    name: row.name,
    status: row.status,
    avatarHash: row.avatar_hash,
    accountLoginDisabled: row.account_login_disabled ?? false,
    passwordHash: row.password_hash,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}
