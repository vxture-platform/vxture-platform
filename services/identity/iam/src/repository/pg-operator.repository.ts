/**
 * pg-operator.repository.ts - operator 运营账号认证仓储（operator realm）
 * @package @vxture/service-iam
 * @layer Infrastructure
 * @category repository
 *
 * Shared operator (admin.operator_account) authentication for the OIDC IdP operator
 * realm. Mirrors admin-bff's PlatformAuthService credential check, lifted here so
 * the IdP (auth-bff) can authenticate operators directly — ops.* is fully isolated
 * from identity.* / iam.* (no FK, no cross-read). The token only carries the coarse
 * operator_role; fine-grained authorization is re-queried by admin-bff against
 * admin.operator_role_permission (D-6). The password hash lives in
 * admin.operator_credential (1-1) and is verified with Argon2id (hash-wasm),
 * PHC-interoperable with the platform hasher. See identity-platform-operator.md §4.
 */
import { argon2Verify, argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { IAM_PG_POOL } from "../tokens";

/**
 * The raw inputs feeding the MFA policy resolver (identity-platform-operator.md
 * §2.2) plus the operator's current enrollment state. Read in one shot so the
 * two-step login state machine can call decideMfa() without extra round-trips.
 */
export interface OperatorMfaContext {
  /** Platform default — admin.settings `operator.mfa.policy`. */
  platformDefault: string | null;
  /** Role floor — admin.operator_role.mfa_min_level. */
  roleFloor: string | null;
  /** Per-operator override — admin.operator_mfa.policy (null when no row yet). */
  personalPolicy: string | null;
  /** admin.operator_mfa.totp_enabled. */
  totpEnabled: boolean;
  /** count(admin.operator_webauthn_credential). */
  webauthnCredentialCount: number;
  /** admin.operator_mfa.webauthn_required (high-privilege: passkey mandatory). */
  webauthnRequired: boolean;
}

interface OperatorMfaContextRow {
  platform_default: string | null;
  role_floor: string | null;
  personal_policy: string | null;
  totp_enabled: boolean;
  webauthn_count: number;
  webauthn_required: boolean;
}

/** A registered WebAuthn credential's identity (for excludeCredentials). */
export interface OperatorWebauthnCredentialSummary {
  credentialId: string;
  transports: string[];
}

/** Input to persist a verified WebAuthn credential. */
export interface InsertOperatorWebauthnCredential {
  operatorId: string;
  credentialId: string;
  /** COSE public key bytes. */
  publicKey: Buffer;
  signCount: number | bigint;
  transports: string[];
  aaguid?: string | null;
  label?: string | null;
}

/** A registered WebAuthn credential with the material needed to verify assertions. */
export interface OperatorWebauthnCredentialForAuth {
  credentialId: string;
  /** COSE public key bytes. */
  publicKey: Buffer;
  /** Stored signature counter (clone-rollback baseline). */
  signCount: number;
  transports: string[];
}

/** A registered WebAuthn credential for management UI (no secret material). */
export interface OperatorWebauthnCredentialDetail {
  /** Row id (uuid) — the management handle. */
  id: string;
  label: string | null;
  aaguid: string | null;
  transports: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Minimal operator identity for session establishment + token claims. */
export interface OperatorView {
  id: string;
  username: string;
  /** operator_account.status → access_token account_status. */
  status: string;
  /** operator_role.role_code → access_token operator_role (coarse; fine-grained re-queried). */
  roleCode: string;
  /** operator_account.email → OIDC email claim (RPs like Cloudflare Access require it). */
  email: string | null;
}

interface OperatorRow {
  id: string;
  username: string;
  status: string;
  password_hash: string | null;
  role_code: string;
  email: string | null;
}

const SELECT_OPERATOR = `
  select a.id, a.username, a.status, c.password_hash, a.email, r.role_code
    from admin.operator_account a
    join admin.operator_role r
      on r.id = a.role_id
     and r.status = 'active'
    left join admin.operator_credential c
      on c.operator_id = a.id
   where a.deleted_at is null
     and a.status = 'active'
`;

function toView(row: OperatorRow): OperatorView {
  return {
    id: row.id,
    username: row.username,
    status: row.status,
    roleCode: row.role_code,
    email: row.email,
  };
}

@Injectable()
export class PgOperatorRepository {
  constructor(@Inject(IAM_PG_POOL) private readonly pool: Pool) {}

  /**
   * Authenticate an operator by username/email/phone + password against
   * admin.operator_account + admin.operator_credential (Argon2id). Returns the view
   * on success, null on unknown/disabled operator or a bad secret (caller maps to
   * invalid credentials). No PLG, no phone anchor, no self-registration — operator
   * accounts are pre-provisioned.
   */
  async authenticateOperator(
    identifier: string,
    password: string,
  ): Promise<OperatorView | null> {
    if (!identifier.trim() || !password) return null;

    const result = await this.pool.query<OperatorRow>(
      `${SELECT_OPERATOR}
         and (
           lower(a.username) = lower($1)
           or lower(coalesce(a.email, '')) = lower($1)
           or coalesce(a.phone, '') = $1
         )
       limit 1`,
      [identifier.trim()],
    );
    const row = result.rows[0];
    if (!row || !row.password_hash) return null;

    const ok = await argon2Verify({ password, hash: row.password_hash });
    if (!ok) return null;

    await this.recordLastLogin(row.id);
    return toView(row);
  }

  /**
   * Verify an operator's CURRENT password by id (self-service password change,
   * Phase B.2). Unlike authenticateOperator it does NOT record a last-login — this
   * is a re-auth check, not a login. Returns false for unknown / passwordless /
   * mismatch.
   */
  async verifyOperatorPassword(
    operatorId: string,
    password: string,
  ): Promise<boolean> {
    if (!operatorId.trim() || !password) return false;
    const result = await this.pool.query<OperatorRow>(
      `${SELECT_OPERATOR}
         and a.id = $1
       limit 1`,
      [operatorId],
    );
    const row = result.rows[0];
    if (!row?.password_hash) return false;
    return argon2Verify({ password, hash: row.password_hash });
  }

  /** Read an active operator by id (for token re-issuance / refresh). */
  async findById(operatorId: string): Promise<OperatorView | null> {
    const result = await this.pool.query<OperatorRow>(
      `${SELECT_OPERATOR}
         and a.id = $1
       limit 1`,
      [operatorId],
    );
    const row = result.rows[0];
    return row ? toView(row) : null;
  }

  /**
   * Admin-facing read of an operator by id REGARDLESS of status (admin must see a
   * disabled operator to re-enable it; SELECT_OPERATOR filters status='active').
   * Returns id/username/status/roleCode, or null for unknown / soft-deleted.
   * Used by the internal admin-delegation endpoints (realm check + anti-lockout).
   */
  async getOperatorAdminView(operatorId: string): Promise<{
    id: string;
    username: string;
    status: string;
    roleCode: string;
    roleRank: number;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
    phoneVerified: boolean;
  } | null> {
    const result = await this.pool.query<{
      id: string;
      username: string;
      status: string;
      role_code: string;
      role_rank: number;
      email: string | null;
      email_verified: boolean;
      phone: string | null;
      phone_verified: boolean;
    }>(
      `select a.id, a.username, a.status, a.email, a.email_verified,
              a.phone, a.phone_verified, r.role_code, r.rank as role_rank
         from admin.operator_account a
         join admin.operator_role r on r.id = a.role_id
        where a.id = $1 and a.deleted_at is null
        limit 1`,
      [operatorId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          username: row.username,
          status: row.status,
          roleCode: row.role_code,
          roleRank: Number(row.role_rank ?? 0),
          email: row.email,
          emailVerified: Boolean(row.email_verified),
          phone: row.phone,
          phoneVerified: Boolean(row.phone_verified),
        }
      : null;
  }

  /** Count active (non-deleted, status='active') operators — anti-lockout guard. */
  async countActiveOperators(): Promise<number> {
    const result = await this.pool.query<{ n: number }>(
      `select count(*)::int as n
         from admin.operator_account
        where deleted_at is null and status = 'active'`,
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  /**
   * Set an operator's OWN contact (email|phone) AFTER self-service code
   * verification, marking it verified (TD-017 §③). Only the self-service verify
   * path reaches here, so the new value is proven owned → *_verified=true, which
   * restores out-of-band-delivery eligibility. Throws 23505 on unique collision
   * (caller maps to 409). Returns false if the operator is gone/soft-deleted.
   */
  async setOperatorContactVerified(
    operatorId: string,
    targetType: "email" | "phone",
    value: string,
  ): Promise<boolean> {
    const col = targetType === "email" ? "email" : "phone";
    const verifiedCol =
      targetType === "email" ? "email_verified" : "phone_verified";
    const result = await this.pool.query<{ id: string }>(
      `update admin.operator_account
          set ${col} = $2, ${verifiedCol} = true, updated_at = now()
        where id = $1 and deleted_at is null
        returning id`,
      [operatorId, value],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Mark the CURRENT email on file as verified, without changing its value —
   * used when a token-authenticated flow (reset/create completion) proves the
   * operator controls whatever email the token was mailed to (TD-017 §③⑤).
   * No-op (but harmless) if there is no email on file.
   */
  async markOwnEmailVerified(operatorId: string): Promise<void> {
    await this.pool.query(
      `update admin.operator_account
          set email_verified = true, updated_at = now()
        where id = $1 and deleted_at is null and email is not null`,
      [operatorId],
    );
  }

  /** Fetch a role's rank + code (create-operator rank gate: actor.rank > newRole.rank). */
  async getRoleForRankCheck(
    roleId: string,
  ): Promise<{ rank: number; roleCode: string } | null> {
    const result = await this.pool.query<{ rank: number; role_code: string }>(
      `select rank, role_code from admin.operator_role where id = $1`,
      [roleId],
    );
    const row = result.rows[0];
    return row
      ? { rank: Number(row.rank ?? 0), roleCode: row.role_code }
      : null;
  }

  /**
   * Create a new operator account (TD-017 §③⑤ create-operator). NO credential is
   * inserted here — the internal caller mints an out-of-band initial-setup token
   * (same flow as reset-password) and mails it to `email`; the operator sets their
   * own password via the public completion endpoint, which also marks the email
   * verified (proves reachability — the account has no credential yet, so an
   * unverified initial email carries no takeover value, unlike a rewritten email
   * on an EXISTING credentialed account, which reset-password refuses at §③).
   * Throws pg 23505 on username/email/phone collision (caller maps to 409).
   */
  async createOperator(input: {
    roleId: string;
    username: string;
    displayName: string;
    email: string;
    phone: string | null;
    createdBy: string;
  }): Promise<{ id: string }> {
    const result = await this.pool.query<{ id: string }>(
      `insert into admin.operator_account
         (role_id, username, display_name, email, email_verified, phone, phone_verified,
          status, account_type, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, false, $5, false, 'active', 'personal', $6, now(), now())
       returning id`,
      [
        input.roleId,
        input.username,
        input.displayName,
        input.email,
        input.phone,
        input.createdBy,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("operator_create_failed");
    }
    return row;
  }

  /**
   * Set an operator's account status (admin.operator_account.status), for the
   * internal admin delegation (disable/enable). Session revocation is the caller's
   * responsibility (disable must also revoke sessions). Returns the new status, or
   * null if the operator does not exist / is soft-deleted.
   */
  async setOperatorStatus(
    operatorId: string,
    status: string,
    updatedBy: string | null,
  ): Promise<string | null> {
    const result = await this.pool.query<{ status: string }>(
      `update admin.operator_account
          set status = $2, updated_by = $3, updated_at = now()
        where id = $1 and deleted_at is null
        returning status`,
      [operatorId, status, updatedBy],
    );
    return result.rows[0]?.status ?? null;
  }

  /**
   * Transactionally disable an operator with the last-super_admin survival guard
   * (TD-019): the previous implementation checked `countActiveSuperAdmins` and
   * performed `setOperatorStatus` as two separate, non-transactional calls, so
   * two concurrent disables of TWO DIFFERENT super_admins could each read "the
   * other one is still active" before either committed, and both proceed —
   * leaving zero active super_admins.
   *
   * Fix: lock the FULL set of currently-active super_admin rows with
   * `SELECT ... FOR UPDATE` — deliberately NOT excluding the target — before
   * deciding anything. Whichever concurrent call acquires this lock first
   * blocks every other call touching the same super_admin set (cross-process:
   * row locks are enforced by Postgres itself, not per-connection, so this
   * also correctly serializes against admin-bff's role-change demotion path,
   * which takes the identical lock — see ADMIN_ROLE_RANKS_SQL guard in
   * platform-admins.router.ts). The second caller only proceeds after the
   * first commits, and by then sees the POST-commit state, so the survival
   * count is always accurate.
   */
  async disableOperatorGuarded(
    operatorId: string,
    updatedBy: string,
  ): Promise<
    | { ok: true; status: string }
    | { ok: false; reason: "not_found" | "last_super_admin" }
  > {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const locked = await client.query<{ id: string }>(
        `select a.id
           from admin.operator_account a
           join admin.operator_role r on r.id = a.role_id
          where a.deleted_at is null
            and a.status = 'active'
            and r.role_code = 'super_admin'
          order by a.id
          for update of a`,
      );
      const lockedIds = new Set(locked.rows.map((r) => r.id));
      if (lockedIds.has(operatorId) && lockedIds.size - 1 < 1) {
        await client.query("rollback");
        return { ok: false, reason: "last_super_admin" };
      }
      const updated = await client.query<{ status: string }>(
        `update admin.operator_account
            set status = 'disabled', updated_by = $2, updated_at = now()
          where id = $1 and deleted_at is null
          returning status`,
        [operatorId, updatedBy],
      );
      if (!updated.rows[0]) {
        await client.query("rollback");
        return { ok: false, reason: "not_found" };
      }
      await client.query("commit");
      return { ok: true, status: updated.rows[0].status };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Admin-delegated MFA reset: wipe an operator's enrolled second factors (TOTP secret,
   * WebAuthn credentials, recovery codes) so they re-enroll on next login. The POLICY
   * (operator_mfa.policy / webauthn_required) is intentionally KEPT — only the enrollment
   * is cleared, so the requirement still forces re-enroll. Transactional (all-or-nothing,
   * so no partial factor survives). Returns false if the operator is unknown / soft-deleted.
   */
  async resetOperatorMfa(operatorId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const exists = await client.query(
        `select 1 from admin.operator_account
          where id = $1 and deleted_at is null`,
        [operatorId],
      );
      if (!exists.rowCount) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `update admin.operator_mfa
            set totp_secret = null,
                totp_enabled = false,
                totp_confirmed_at = null,
                enrolled_at = null,
                updated_at = now()
          where operator_id = $1`,
        [operatorId],
      );
      await client.query(
        `delete from admin.operator_webauthn_credential where operator_id = $1`,
        [operatorId],
      );
      await client.query(
        `delete from admin.operator_recovery_code where operator_id = $1`,
        [operatorId],
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

  /**
   * Set/replace an operator's password (Argon2id, encoded PHC), upserting
   * admin.operator_credential. For the internal admin-delegated reset flow (P1b-β).
   * Resets failed_attempts + clears locked_until (a reset also unlocks). The caller is
   * responsible for authorization + session revocation. `forceChange` sets
   * force_password_change (e.g. an initial/temporary credential). Returns false if the
   * operator does not exist / is soft-deleted.
   */
  async setOperatorPassword(
    operatorId: string,
    newPassword: string,
    options?: { forceChange?: boolean },
  ): Promise<boolean> {
    const exists = await this.pool.query(
      `select 1 from admin.operator_account
        where id = $1 and deleted_at is null`,
      [operatorId],
    );
    if (!exists.rowCount) return false;
    const passwordHash = await argon2id({
      password: newPassword,
      salt: randomBytes(16),
      parallelism: 4,
      iterations: 3,
      memorySize: 65536,
      hashLength: 32,
      outputType: "encoded",
    });
    await this.pool.query(
      `insert into admin.operator_credential
         (operator_id, password_hash, password_changed_at, force_password_change,
          failed_attempts, locked_until, created_at, updated_at)
       values ($1, $2, now(), $3, 0, null, now(), now())
       on conflict (operator_id) do update
         set password_hash = excluded.password_hash,
             password_changed_at = now(),
             force_password_change = excluded.force_password_change,
             failed_attempts = 0,
             locked_until = null,
             updated_at = now()`,
      [operatorId, passwordHash, options?.forceChange ?? false],
    );
    return true;
  }

  /**
   * Read the MFA policy inputs + enrollment state for an operator in one query:
   * the role floor (operator_role.mfa_min_level), the personal override
   * (operator_mfa.policy), the enrollment flags (totp + webauthn count), and the
   * platform default (admin.settings `operator.mfa.policy`). Returns null for an
   * unknown operator. Feeds decideMfa() in the two-step login flow.
   */
  async getMfaContext(operatorId: string): Promise<OperatorMfaContext | null> {
    const result = await this.pool.query<OperatorMfaContextRow>(
      `select
         r.mfa_min_level as role_floor,
         m.policy        as personal_policy,
         coalesce(m.totp_enabled, false) as totp_enabled,
         coalesce(m.webauthn_required, false) as webauthn_required,
         (select count(*)::int
            from admin.operator_webauthn_credential w
           where w.operator_id = a.id) as webauthn_count,
         (select s.config_value
            from admin.settings s
           where s.config_key = 'operator.mfa.policy'
           limit 1) as platform_default
       from admin.operator_account a
       join admin.operator_role r on r.id = a.role_id
       left join admin.operator_mfa m on m.operator_id = a.id
      where a.id = $1
      limit 1`,
      [operatorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      platformDefault: row.platform_default ?? null,
      roleFloor: row.role_floor ?? null,
      personalPolicy: row.personal_policy ?? null,
      totpEnabled: row.totp_enabled === true,
      webauthnCredentialCount: Number(row.webauthn_count ?? 0),
      webauthnRequired: row.webauthn_required === true,
    };
  }

  /**
   * Read the operator's TOTP enrollment: the stored secret (ENCRYPTED — decrypted
   * by the caller) and whether TOTP is confirmed/enabled. null when no operator_mfa
   * row exists yet.
   */
  async getTotpEnrollment(
    operatorId: string,
  ): Promise<{ secret: string | null; enabled: boolean } | null> {
    const result = await this.pool.query<{
      totp_secret: string | null;
      totp_enabled: boolean;
    }>(
      `select totp_secret, totp_enabled
         from admin.operator_mfa where operator_id = $1 limit 1`,
      [operatorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { secret: row.totp_secret, enabled: row.totp_enabled === true };
  }

  /**
   * Stage a pending (unconfirmed) TOTP secret for enrollment. Upserts the
   * operator_mfa row, resetting any prior TOTP to unconfirmed so a fresh enroll
   * fully replaces it. The secret MUST already be encrypted by the caller.
   */
  async upsertPendingTotpSecret(
    operatorId: string,
    encryptedSecret: string,
  ): Promise<void> {
    await this.pool.query(
      `insert into admin.operator_mfa
         (operator_id, totp_secret, totp_enabled, totp_confirmed_at, created_at, updated_at)
       values ($1, $2, false, null, now(), now())
       on conflict (operator_id) do update
         set totp_secret = excluded.totp_secret,
             totp_enabled = false,
             totp_confirmed_at = null,
             updated_at = now()`,
      [operatorId, encryptedSecret],
    );
  }

  /**
   * Replace an operator's recovery codes with a fresh batch (hashes only).
   * Atomic: clears the old set then inserts the new one, so a regeneration never
   * leaves a mixed/partial set. Hashes MUST be produced by the caller.
   */
  async replaceRecoveryCodes(
    operatorId: string,
    codeHashes: string[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from admin.operator_recovery_code where operator_id = $1`,
        [operatorId],
      );
      for (const hash of codeHashes) {
        await client.query(
          `insert into admin.operator_recovery_code (operator_id, code_hash, created_at)
           values ($1, $2, now())`,
          [operatorId, hash],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically consume a recovery code: mark the matching UNUSED code as used and
   * report whether one was spent. The single UPDATE … WHERE used_at IS NULL makes
   * it single-use and race-safe (a concurrent reuse updates 0 rows).
   */
  async consumeRecoveryCode(
    operatorId: string,
    codeHash: string,
  ): Promise<boolean> {
    const r = await this.pool.query(
      `update admin.operator_recovery_code
          set used_at = now()
        where operator_id = $1 and code_hash = $2 and used_at is null`,
      [operatorId, codeHash],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Confirm + enable a staged TOTP secret (after first-code verification). */
  async enableTotp(operatorId: string): Promise<void> {
    await this.pool.query(
      `update admin.operator_mfa
          set totp_enabled = true,
              totp_confirmed_at = now(),
              enrolled_at = coalesce(enrolled_at, now()),
              updated_at = now()
        where operator_id = $1`,
      [operatorId],
    );
  }

  /**
   * List an operator's registered WebAuthn credentials (id + transports) — used
   * to build excludeCredentials so the same authenticator isn't re-registered.
   */
  async listWebauthnCredentials(
    operatorId: string,
  ): Promise<OperatorWebauthnCredentialSummary[]> {
    const r = await this.pool.query<{
      credential_id: string;
      transports: string[] | null;
    }>(
      `select credential_id, transports
         from admin.operator_webauthn_credential
        where operator_id = $1
        order by created_at asc`,
      [operatorId],
    );
    return r.rows.map((row) => ({
      credentialId: row.credential_id,
      transports: row.transports ?? [],
    }));
  }

  /**
   * Load an operator's WebAuthn credentials with the material needed to verify
   * an assertion (public key + signature counter). Used to build allowCredentials
   * and to look up the credential the authenticator asserted with.
   */
  async getWebauthnCredentialsForAuth(
    operatorId: string,
  ): Promise<OperatorWebauthnCredentialForAuth[]> {
    const r = await this.pool.query<{
      credential_id: string;
      public_key: Buffer;
      sign_count: string;
      transports: string[] | null;
    }>(
      `select credential_id, public_key, sign_count, transports
         from admin.operator_webauthn_credential
        where operator_id = $1
        order by created_at asc`,
      [operatorId],
    );
    return r.rows.map((row) => ({
      credentialId: row.credential_id,
      publicKey: row.public_key,
      signCount: Number(row.sign_count),
      transports: row.transports ?? [],
    }));
  }

  /** List an operator's WebAuthn credentials for the management UI (no secrets). */
  async listWebauthnCredentialsDetailed(
    operatorId: string,
  ): Promise<OperatorWebauthnCredentialDetail[]> {
    const r = await this.pool.query<{
      id: string;
      label: string | null;
      aaguid: string | null;
      transports: string[] | null;
      created_at: Date;
      last_used_at: Date | null;
    }>(
      `select id, label, aaguid, transports, created_at, last_used_at
         from admin.operator_webauthn_credential
        where operator_id = $1
        order by created_at asc`,
      [operatorId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      label: row.label,
      aaguid: row.aaguid,
      transports: row.transports ?? [],
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  /** Rename a credential (by row id, scoped to the operator). Returns true if found. */
  async renameWebauthnCredential(
    operatorId: string,
    id: string,
    label: string,
  ): Promise<boolean> {
    const r = await this.pool.query(
      `update admin.operator_webauthn_credential
          set label = $3
        where operator_id = $1 and id = $2`,
      [operatorId, id, label.slice(0, 64)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Revoke a credential (by row id, scoped to the operator). Returns true if found. */
  async deleteWebauthnCredential(
    operatorId: string,
    id: string,
  ): Promise<boolean> {
    const r = await this.pool.query(
      `delete from admin.operator_webauthn_credential
        where operator_id = $1 and id = $2`,
      [operatorId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Persist the new signature counter after a successful assertion. */
  async updateWebauthnSignCount(
    operatorId: string,
    credentialId: string,
    signCount: number | bigint,
  ): Promise<void> {
    await this.pool.query(
      `update admin.operator_webauthn_credential
          set sign_count = $3, last_used_at = now()
        where operator_id = $1 and credential_id = $2`,
      [operatorId, credentialId, String(signCount)],
    );
  }

  /** Persist a verified WebAuthn credential (registration ceremony result). */
  async insertWebauthnCredential(
    input: InsertOperatorWebauthnCredential,
  ): Promise<void> {
    await this.pool.query(
      `insert into admin.operator_webauthn_credential
         (operator_id, credential_id, public_key, sign_count, transports, aaguid, label, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        input.operatorId,
        input.credentialId,
        input.publicKey,
        String(input.signCount),
        input.transports,
        input.aaguid ?? null,
        input.label ?? null,
      ],
    );
  }

  private async recordLastLogin(operatorId: string): Promise<void> {
    await this.pool.query(
      `update admin.operator_account set last_login_at = now() where id = $1`,
      [operatorId],
    );
  }
}
