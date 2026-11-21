/**
 * pg-voucher-claims.ts - Authenticated preview and atomic customer ownership binding.
 * @package @vxture/service-promotion
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { VoucherScope } from "../types/promotion.types";
import {
  identity,
  normalizeBatch,
  type BatchConfiguration,
} from "./batch-input";
import { VoucherClaimCredentials } from "./claim-credentials";

export interface ClaimVoucherCommand {
  secret: string;
  target: "user" | "workspace";
  idempotencyKey: string;
}
interface ClaimRow {
  id: string;
  batch_id: string;
  code: string;
  status: string;
  used_count: number;
  max_uses: number;
  assigned_tenant_id: string | null;
  assigned_user_id: string | null;
  assigned_workspace_id: string | null;
  expires_at: Date | null;
  kind: BatchConfiguration["kind"];
  funding_valid: boolean;
  name: string;
  effect: Record<string, unknown>;
  tenant_id: string | null;
  batch_status: string;
  total_count: number;
  policy_snapshot: Record<string, unknown> | null;
  valid_from: Date;
  valid_until: Date;
  claim_until: Date | null;
  use_valid_days: number | null;
  per_user_limit: number;
  per_workspace_limit: number | null;
  per_tenant_limit: number | null;
}
export interface VoucherClaimPreview {
  code: string;
  batchName: string;
  kind: string;
  effect: Record<string, unknown>;
  expiresAt: string;
  claimUntil: string;
  useValidDays: number | null;
  returnPolicy: "none" | "full_reversal_only";
  tenantName: string;
  workspaceName: string;
}
export interface VoucherClaimResult {
  voucherId: string;
  code: string;
  tenantId: string;
  workspaceId: string;
  target: "user" | "workspace";
  expiresAt: string;
}

// ===========================================================================
// The credential, target scope and request key never select another actor.
// ===========================================================================
function unavailable(): never {
  throw new BadRequestException("领取凭证不可用，请核对凭证或联系发放方");
}
function normalizeScope(scope: VoucherScope): VoucherScope {
  return {
    tenantId: identity(scope.tenantId, "tenantId"),
    userId: identity(scope.userId, "userId"),
    workspaceId: identity(scope.workspaceId, "workspaceId"),
  };
}
function requestKey(input: unknown): string {
  const key = typeof input === "string" ? input.trim() : "";
  if (!key || key.length > 128)
    throw new BadRequestException("idempotencyKey 必填，最长 128 字");
  return key;
}
/** Validate live tenant and workspace membership. @param client - Trusted database connection. @param scope - Verified session scope. @returns Human-readable current context. @throws {ForbiddenException} For inactive or inaccessible contexts. */
export async function assertVoucherClaimScope(
  client: Pick<PoolClient, "query">,
  scope: VoucherScope,
) {
  const row = (
    await client.query<{ tenant_name: string; workspace_name: string }>(
      `select t.name tenant_name,w.name workspace_name
    from tenancy.tenants t join tenancy.workspaces w on w.tenant_id=t.id
    join account.users u on u.id=$2
    where t.id=$1 and w.id=$3 and t.status='active' and t.deleted_at is null
      and w.status='active' and w.deleted_at is null and u.status='active' and u.deleted_at is null
      and (t.owner_user_id=$2 or (exists(select 1 from tenancy.tenant_memberships m where m.tenant_id=t.id and m.user_id=$2 and m.status='active')
        and exists(select 1 from tenancy.workspace_memberships wm where wm.workspace_id=w.id and wm.user_id=$2 and wm.status='active')))`,
      [scope.tenantId, scope.userId, scope.workspaceId],
    )
  ).rows[0];
  if (!row) throw new ForbiddenException("当前租户或工作空间不可访问");
  return row;
}
const SELECT_CLAIM = `select v.id,v.batch_id,v.code,v.status,v.used_count,v.max_uses,
  v.assigned_tenant_id,v.assigned_user_id,v.assigned_workspace_id,v.expires_at,
  case when b.kind<>'recharge_card' then true
    when jsonb_typeof(b.effect->'face_value_cents') is distinct from 'number' then false
    when (b.effect->>'face_value_cents')::numeric=0 then v.funding_payment_id is null and v.funding_order_id is null
    else exists(select 1 from billing.wallet_card_allocations a join billing.payments p on p.id=a.payment_id where a.voucher_id=v.id and a.status='reserved' and a.payment_id=v.funding_payment_id and a.amount*100=(b.effect->>'face_value_cents')::numeric and p.tenant_id=b.tenant_id) end funding_valid,
  b.kind,b.name,b.effect,b.tenant_id,b.status batch_status,b.total_count,b.policy_snapshot,
  b.valid_from,b.valid_until,b.claim_until,b.use_valid_days,b.per_user_limit,b.per_workspace_limit,b.per_tenant_limit
  from promotion.vouchers v join promotion.voucher_batches b on b.id=v.batch_id
  where v.claim_token_digest=$1 and v.claim_key_version=$2`;
function check(
  row: ClaimRow | undefined,
  scope: VoucherScope,
  now: Date,
): asserts row is ClaimRow {
  if (
    !row ||
    row.status !== "issued" ||
    !row.funding_valid ||
    row.used_count !== 0 ||
    row.max_uses !== 1 ||
    row.assigned_tenant_id ||
    row.assigned_user_id ||
    row.assigned_workspace_id ||
    row.batch_status !== "active" ||
    row.policy_snapshot?.compensation_batch ||
    (row.tenant_id && row.tenant_id !== scope.tenantId) ||
    now < row.valid_from ||
    now >= row.valid_until ||
    now >= (row.claim_until ?? row.valid_until) ||
    (row.expires_at && now >= row.expires_at)
  )
    unavailable();
  try {
    normalizeBatch({
      kind: row.kind,
      name: row.name,
      effect: row.effect,
      tenantId: row.tenant_id,
      totalCount: Math.max(1, row.total_count),
      validFrom: row.valid_from.toISOString(),
      validUntil: row.valid_until.toISOString(),
    });
  } catch {
    unavailable();
  }
}
function expiry(row: ClaimRow, now: Date): Date {
  return new Date(
    Math.min(
      row.valid_until.getTime(),
      row.expires_at?.getTime() ?? Infinity,
      row.use_valid_days == null
        ? Infinity
        : now.getTime() + row.use_valid_days * 86400000,
    ),
  );
}
async function assertInvitationTarget(
  client: Pick<PoolClient, "query">,
  row: ClaimRow,
) {
  if (row.kind === "redemption") {
    const target = await client.query(
      `select v.id from product.plan_versions v join product.plans p on p.id=v.plan_id
      where v.id::text=$1 and v.status='published' and v.is_locked and p.status='active' and p.deleted_at is null`,
      [row.effect.plan_version_id],
    );
    if (!target.rows.length) unavailable();
    return;
  }
  if (row.kind !== "invite") return;
  const target = await client.query(
    `select p.id from product.plans p join product.plan_versions v on v.plan_id=p.id
    where p.status='active' and p.deleted_at is null and not p.is_public and v.status='published'
      and ($1::text is null or p.plan_code=$1) and ($2::text is null or v.id::text=$2) limit 1`,
    [
      row.effect.plan_code ?? row.effect.planCode ?? null,
      row.effect.plan_version_id ?? row.effect.planVersionId ?? null,
    ],
  );
  if (!target.rows.length) unavailable();
}

async function assertClaimLimits(
  client: Pick<PoolClient, "query">,
  row: ClaimRow,
  scope: VoucherScope,
  target: "user" | "workspace",
) {
  const counts = (
    await client.query<{
      users: string;
      workspaces: string;
      tenants: string;
      unknown_tenants: string;
    }>(
      `select
        count(*) filter(where v.assigned_user_id=$2 or exists(select 1 from promotion.voucher_events e where e.voucher_id=v.id and e.event_type='voucher_claimed' and e.actor_realm='customer' and e.actor_id=$2)) users,
        count(*) filter(where v.assigned_workspace_id=$3) workspaces,
        count(*) filter(where v.assigned_tenant_id=$4 or (v.assigned_tenant_id is null and ($5::uuid=$4 or v.assigned_workspace_id in(select id from tenancy.workspaces where tenant_id=$4)))) tenants,
        count(*) filter(where v.assigned_tenant_id is null and v.assigned_workspace_id is null and $5::uuid is null) unknown_tenants
        from promotion.vouchers v where v.batch_id=$1 and (v.status<>'issued') and (v.claimed_at is not null or v.assigned_user_id is not null or v.assigned_workspace_id is not null or v.assigned_tenant_id is not null)`,
      [
        row.batch_id,
        scope.userId,
        scope.workspaceId,
        scope.tenantId,
        row.tenant_id,
      ],
    )
  ).rows[0]!;
  if (
    Number(counts.users) >= row.per_user_limit ||
    (target === "workspace" &&
      row.per_workspace_limit != null &&
      Number(counts.workspaces) >= row.per_workspace_limit) ||
    (row.per_tenant_limit != null &&
      (Number(counts.tenants) >= row.per_tenant_limit ||
        Number(counts.unknown_tenants) > 0))
  )
    unavailable();
}

// ===========================================================================
// Preview is read-only. Claim locks the batch before its voucher, never orders.
// ===========================================================================
export class PgVoucherClaims {
  constructor(
    private readonly pool: Pool,
    private readonly credentials: VoucherClaimCredentials,
  ) {}

  /** Recover a committed result without a secret. @param pool - Customer database role. @param scope - Verified current context. @param idempotencyKey - Original request identity. @returns A scoped result or null, including for another context's key. @throws {BadRequestException} For an invalid key or scope. @throws {ForbiddenException} For inaccessible contexts. */
  static async result(
    pool: Pool,
    scope: VoucherScope,
    idempotencyKey: unknown,
  ): Promise<VoucherClaimResult | null> {
    scope = normalizeScope(scope);
    const key = requestKey(idempotencyKey);
    await assertVoucherClaimScope(pool, scope);
    const receipt = await pool.query<{ result: VoucherClaimResult }>(
      `select result from promotion.voucher_operations
      where actor_realm='customer' and actor_id=$1 and operation_type='voucher_claim' and idempotency_key=$2
        and result->>'tenantId'=$3 and result->>'workspaceId'=$4`,
      [scope.userId, key, scope.tenantId, scope.workspaceId],
    );
    return receipt.rows[0]?.result ?? null;
  }

  /** Preview without consuming. @param scope - Verified current context. @param secret - Confidential credential. @returns Effect and binding context. @throws {BadRequestException} For every unavailable credential. */
  async preview(
    scope: VoucherScope,
    secret: unknown,
    target: "user" | "workspace" = "user",
  ): Promise<VoucherClaimPreview> {
    if (!["user", "workspace"].includes(target))
      throw new BadRequestException("请选择个人或当前工作空间");
    scope = normalizeScope(scope);
    const { digest, version } = this.credentials.digest(secret);
    const context = await assertVoucherClaimScope(this.pool, scope);
    const row = (
      await this.pool.query<ClaimRow>(SELECT_CLAIM, [digest, version])
    ).rows[0];
    const now = new Date();
    check(row, scope, now);
    await assertInvitationTarget(this.pool, row);
    await assertClaimLimits(this.pool, row, scope, target);
    return {
      code: row.code,
      batchName: row.name,
      kind: row.kind,
      effect: row.effect,
      expiresAt: expiry(row, now).toISOString(),
      claimUntil: (row.claim_until ?? row.valid_until).toISOString(),
      useValidDays: row.use_valid_days,
      returnPolicy:
        row.policy_snapshot?.return_policy === "full_reversal_only"
          ? "full_reversal_only"
          : "none",
      tenantName: context.tenant_name,
      workspaceName: context.workspace_name,
    };
  }

  /** Bind once with a durable receipt. @param scope - Verified current context. @param command - Secret, explicit target and stable retry identity. @returns Original successful binding on an identical retry. @throws {ConflictException} For changed retry parameters. */
  async claim(
    scope: VoucherScope,
    command: ClaimVoucherCommand,
  ): Promise<VoucherClaimResult> {
    scope = normalizeScope(scope);
    const { digest, version } = this.credentials.digest(command?.secret);
    if (!["user", "workspace"].includes(command?.target))
      throw new BadRequestException("请选择个人或当前工作空间");
    const key = requestKey(command.idempotencyKey);
    const target = command.target,
      hash = createHash("sha256")
        .update(JSON.stringify({ ...scope, digest, target }))
        .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`voucher:customer:${scope.userId}:voucher_claim:${key}`],
      );
      await assertVoucherClaimScope(client, scope);
      const prior = (
        await client.query<{
          request_hash: string;
          result: VoucherClaimResult;
        }>(
          `select request_hash,result from promotion.voucher_operations
        where actor_realm='customer' and actor_id=$1 and operation_type='voucher_claim' and idempotency_key=$2`,
          [scope.userId, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash)
          throw new ConflictException("同一幂等键的领取参数已改变");
        await client.query("commit");
        return prior.result;
      }
      const initial = (
        await client.query<ClaimRow>(SELECT_CLAIM, [digest, version])
      ).rows[0];
      if (!initial) unavailable();
      await client.query(
        "select id from promotion.voucher_batches where id=$1 for update",
        [initial.batch_id],
      );
      const row = (
        await client.query<ClaimRow>(`${SELECT_CLAIM} for update of v`, [
          digest,
          version,
        ])
      ).rows[0];
      const now = (
        await client.query<{ now: Date }>("select clock_timestamp() now")
      ).rows[0]!.now;
      check(row, scope, now);
      await assertInvitationTarget(client, row);
      await assertClaimLimits(client, row, scope, target);
      const expiresAt = expiry(row, now).toISOString();
      const changed = await client.query(
        `update promotion.vouchers set status='assigned',assigned_tenant_id=$2,
        assigned_user_id=$3,assigned_workspace_id=$4,claimed_at=$5,expires_at=$6 where id=$1 and status='issued' and used_count=0`,
        [
          row.id,
          scope.tenantId,
          target === "user" ? scope.userId : null,
          target === "workspace" ? scope.workspaceId : null,
          now,
          expiresAt,
        ],
      );
      if (changed.rowCount !== 1) unavailable();
      const result: VoucherClaimResult = {
        voucherId: row.id,
        code: row.code,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        target,
        expiresAt,
      };
      const operation = randomUUID();
      await client.query(
        `insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result)
        values ($1,'customer',$2,'voucher_claim',$3,$4,$5,$6::jsonb)`,
        [
          operation,
          scope.userId,
          key,
          hash,
          row.batch_id,
          JSON.stringify(result),
        ],
      );
      await client.query(
        `insert into promotion.voucher_events(operation_id,batch_id,voucher_id,event_type,actor_realm,actor_id,reason,metadata)
        values($1,$2,$3,'voucher_claimed','customer',$4,'客户确认领取',$5::jsonb)`,
        [
          operation,
          row.batch_id,
          row.id,
          scope.userId,
          JSON.stringify({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            target,
          }),
        ],
      );
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
