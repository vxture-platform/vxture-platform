/**
 * pg-voucher-management.ts - Reviewed, budgeted and audited voucher operations.
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
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { VoucherClaimCredentials } from "./claim-credentials";
import {
  count,
  identity,
  normalizeBatch,
  parseRechargeEffect,
  type AssignVoucherCommand,
  type BatchAction,
  type CreateBatchCommand,
  type OperatorCommand,
} from "./batch-input";

// ===========================================================================
// Durable command execution and audit helpers
// ===========================================================================
interface BatchRow {
  revision: string;
  id: string;
  tenant_id: string | null;
  kind: string;
  name: string;
  code_prefix: string | null;
  effect: Record<string, unknown>;
  total_count: number;
  issued_count: number;
  per_user_limit: number;
  per_workspace_limit: number | null;
  per_tenant_limit: number | null;
  valid_from: Date;
  valid_until: Date;
  claim_until: Date | null;
  use_valid_days: number | null;
  status: string;
  created_by: string | null;
  reviewed_by: string | null;
  frozen_at: Date | null;
  policy_snapshot: Record<string, unknown> | null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function batchForUpdate(
  client: PoolClient,
  id: string,
): Promise<BatchRow> {
  const row = (
    await client.query<BatchRow>(
      "select *,extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1 for update",
      [id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException("批次不存在");
  return row;
}
async function audit(
  client: PoolClient,
  operation: string,
  actor: string,
  batch: string,
  event: string,
  reason: string,
  metadata: object = {},
  voucher: string | null = null,
) {
  await client.query(
    `insert into promotion.voucher_events(operation_id,batch_id,voucher_id,event_type,actor_realm,actor_id,reason,metadata)
    values ($1,$2,$3,$4,'operator',$5,$6,$7::jsonb)`,
    [operation, batch, voucher, event, actor, reason, JSON.stringify(metadata)],
  );
}
async function validateReferences(
  client: PoolClient,
  config: ReturnType<typeof normalizeBatch>,
) {
  if (
    config.tenantId &&
    !(
      await client.query(
        "select id from tenancy.tenants where id=$1 and status='active' and deleted_at is null",
        [config.tenantId],
      )
    ).rows.length
  )
    throw new BadRequestException("目标租户不存在或已停用");
  if (config.kind === "invite") {
    const plan = (
      await client.query<{ plan_code: string; is_public: boolean }>(
        `select p.plan_code,p.is_public from product.plans p
      left join product.plan_versions v on v.plan_id=p.id and v.status='published'
      where ($1::text is null or p.plan_code=$1) and ($2::uuid is null or v.id=$2)
        and p.status='active' and p.deleted_at is null limit 1`,
        [
          config.effect.plan_code ?? null,
          config.effect.plan_version_id ?? null,
        ],
      )
    ).rows[0];
    if (!plan) throw new BadRequestException("找不到套餐或可邀请的已发布版本");
    if (plan.is_public)
      throw new BadRequestException(
        `套餐「${plan.plan_code}」本来就对外开放，不需要邀请`,
      );
  }
  if (config.kind === "redemption") {
    const version = await client.query(
      `select v.id from product.plan_versions v join product.plans p on p.id=v.plan_id
       where v.id=$1 and v.status='published' and v.is_locked and p.status='active' and p.deleted_at is null
         and exists(select 1 from product.plan_components c join product.products pr on pr.id=c.product_id
           where c.plan_version_id=v.id and c.component_role='primary' and pr.status='active' and pr.deleted_at is null)`,
      [config.effect.plan_version_id],
    );
    if (!version.rows.length)
      throw new BadRequestException("兑换目标必须是有效套餐的已发布冻结版本");
  }
  if (config.kind === "extension" && config.effect.applicable_product_codes) {
    const codes = config.effect.applicable_product_codes as string[];
    const products = await client.query(
      "select product_code from product.products where product_code=any($1::text[]) and status='active' and deleted_at is null",
      [codes],
    );
    if (products.rows.length !== codes.length)
      throw new BadRequestException("展期范围包含不存在或已停用的产品");
  }
}

/** Operator domain boundary; every command owns its transaction and durable receipt. */
export interface VoucherFundingHooks {
  lockSource(
    client: PoolClient,
    source: { paymentId: string; tenantId: string; amountCents: number },
  ): Promise<void>;
  reserve(
    client: PoolClient,
    allocation: { voucherId: string; paymentId: string; amountCents: number },
  ): Promise<void>;
  lockRelease(client: PoolClient, voucherId: string): Promise<void>;
  release(client: PoolClient, voucherId: string): Promise<void>;
}
export class PgVoucherManagement {
  constructor(
    private readonly pool: Pool,
    private readonly funding?: VoucherFundingHooks,
    private readonly options: { replayOnly?: boolean } = {},
  ) {}

  private async execute<T extends object>(
    actor: string,
    type: string,
    command: OperatorCommand,
    payload: object,
    work: (
      client: PoolClient,
      operation: string,
      reason: string,
      record: (
        batch: string,
        event: string,
        reason: string,
        metadata?: object,
        voucher?: string | null,
      ) => void,
    ) => Promise<{ batchId: string; result: T }>,
  ): Promise<T> {
    actor = identity(actor, "operatorId");
    const key =
        typeof command?.idempotencyKey === "string"
          ? command.idempotencyKey.trim()
          : "",
      reason = typeof command?.reason === "string" ? command.reason.trim() : "";
    if (!key || key.length > 128)
      throw new BadRequestException("idempotencyKey 必填，最长 128 字");
    if (!reason || reason.length > 500)
      throw new BadRequestException("操作理由必填，最长 500 字");
    const hash = createHash("sha256")
      .update(canonical({ ...payload, reason }))
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // A request lock also serializes create commands before a batch exists.
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`voucher:operator:${actor}:${type}:${key}`],
      );
      const prior = (
        await client.query<{ request_hash: string; result: T }>(
          "select request_hash,result from promotion.voucher_operations where actor_realm='operator' and actor_id=$1 and operation_type=$2 and idempotency_key=$3",
          [actor, type, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash)
          throw new ConflictException("同一幂等键的操作参数已改变");
        await client.query("commit");
        return prior.result;
      }
      // A consumed proof can recover a committed result, never start fresh work.
      if (this.options.replayOnly)
        throw new ConflictException({
          code: "VOUCHER_STEP_UP_RECEIPT_MISSING",
          message: "step_up_required",
        });
      const operation = randomUUID();
      const events: Array<{
        batch: string;
        event: string;
        reason: string;
        metadata: object;
        voucher: string | null;
      }> = [];
      const outcome = await work(
        client,
        operation,
        reason,
        (batch, event, eventReason, metadata = {}, voucher = null) => {
          events.push({ batch, event, reason: eventReason, metadata, voucher });
        },
      );
      await client.query(
        "insert into promotion.voucher_operations(id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,batch_id,result) values ($1,'operator',$2,$3,$4,$5,$6,$7::jsonb)",
        [
          operation,
          actor,
          type,
          key,
          hash,
          outcome.batchId,
          JSON.stringify(outcome.result),
        ],
      );
      for (const event of events)
        await audit(
          client,
          operation,
          actor,
          event.batch,
          event.event,
          event.reason,
          event.metadata,
          event.voucher,
        );
      await client.query("commit");
      return outcome.result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // Draft configuration, separate review, lifecycle and budget approval
  // =========================================================================
  /** Create an unissued draft. @param actor - Authenticated operator. @param command - Configuration and receipt identity. @returns Draft identity. @throws {BadRequestException} For invalid configuration. */
  async createBatch(
    actor: string,
    command: CreateBatchCommand,
  ): Promise<{ batchId: string }> {
    actor = identity(actor, "operatorId");
    const config = normalizeBatch(command);
    return this.execute(
      actor,
      "batch_create",
      command,
      config,
      async (client, _operation, reason, record) => {
        await validateReferences(client, config);
        const id = randomUUID();
        await client.query(
          `insert into promotion.voucher_batches(id,tenant_id,kind,name,code_prefix,effect,total_count,per_user_limit,valid_from,valid_until,status,created_by,policy_snapshot,claim_until,use_valid_days,per_workspace_limit,per_tenant_limit)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,'draft',$11,$12::jsonb,$13,$14,$15,$16)`,
          [
            id,
            config.tenantId,
            config.kind,
            config.name,
            config.codePrefix,
            JSON.stringify(config.effect),
            config.totalCount,
            config.perUserLimit,
            config.validFrom,
            config.validUntil,
            actor,
            JSON.stringify({ return_policy: config.returnPolicy }),
            config.claimUntil,
            config.useValidDays,
            config.perWorkspaceLimit,
            config.perTenantLimit,
          ],
        );
        record(id, "batch_created", reason, { configuration: config });
        return { batchId: id, result: { batchId: id } };
      },
    );
  }

  /** Manage a batch under its budget lock. @param actor - Authenticated operator. @param id - Batch identity. @param command - Reviewed lifecycle command. @returns Durable operation result. @throws {ConflictException} For stale state or self approval. */
  async actOnBatch(
    actor: string,
    id: string,
    command: BatchAction,
  ): Promise<{ batchId: string; operationId: string; status: string }> {
    actor = identity(actor, "operatorId");
    id = identity(id, "batchId");
    if (
      !command ||
      ![
        "configure",
        "review",
        "pause",
        "resume",
        "archive",
        "request_budget",
        "approve_budget",
      ].includes(command.action)
    )
      throw new BadRequestException("未知批次操作");
    const config =
      command.action === "configure"
        ? normalizeBatch(command.configuration)
        : null;
    const revision =
      command.action === "review" ? command.expectedRevision : null;
    if (
      command.action === "review" &&
      (typeof revision !== "string" || !/^\d+\.\d+$/.test(revision))
    )
      throw new BadRequestException("请重新读取待审核配置版本");
    const total =
      command.action === "request_budget"
        ? count(command.totalCount, "totalCount")
        : null;
    const requestId =
      command.action === "approve_budget"
        ? identity(command.requestOperationId, "requestOperationId")
        : null;
    return this.execute(
      actor,
      `batch_${command.action}`,
      command,
      { id, action: command.action, config, total, requestId, revision },
      async (client, operation, reason, record) => {
        const batch = await batchForUpdate(client, id);
        if (batch.policy_snapshot?.compensation_batch)
          throw new ConflictException("补偿专用批次不参与普通运营操作");
        if (batch.status === "archived")
          throw new ConflictException("已归档批次不可再操作");
        if (config) {
          if (
            batch.status !== "draft" ||
            batch.issued_count !== 0 ||
            batch.frozen_at
          )
            throw new ConflictException(
              "仅未发行草稿可以修改经济配置；已发行配置冻结",
            );
          if (batch.created_by !== actor)
            throw new ForbiddenException("仅草稿创建者可以修改配置");
          await validateReferences(client, config);
          await client.query(
            `update promotion.voucher_batches set tenant_id=$2,kind=$3,name=$4,code_prefix=$5,effect=$6::jsonb,total_count=$7,per_user_limit=$8,valid_from=$9,valid_until=$10,policy_snapshot=$11::jsonb,claim_until=$12,use_valid_days=$13,per_workspace_limit=$14,per_tenant_limit=$15,updated_at=now() where id=$1`,
            [
              id,
              config.tenantId,
              config.kind,
              config.name,
              config.codePrefix,
              JSON.stringify(config.effect),
              config.totalCount,
              config.perUserLimit,
              config.validFrom,
              config.validUntil,
              JSON.stringify({ return_policy: config.returnPolicy }),
              config.claimUntil,
              config.useValidDays,
              config.perWorkspaceLimit,
              config.perTenantLimit,
            ],
          );
        } else if (command.action === "review") {
          if (batch.revision !== revision)
            throw new ConflictException("草稿配置已变化，请重新读取后审核");
          if (batch.status !== "draft" || batch.created_by === actor)
            throw new ConflictException("待审核草稿须由另一位运营审核");
          const checked = normalizeBatch({
            kind: batch.kind as CreateBatchCommand["kind"],
            name: batch.name,
            effect: batch.effect,
            totalCount: batch.total_count,
            perUserLimit: batch.per_user_limit,
            validFrom: batch.valid_from.toISOString(),
            validUntil: batch.valid_until.toISOString(),
            tenantId: batch.tenant_id,
          });
          await validateReferences(client, checked);
          if (batch.valid_until.getTime() <= Date.now())
            throw new ConflictException("批次已过有效期");
          await client.query(
            "update promotion.voucher_batches set status='active',reviewed_by=$2,reviewed_at=now(),updated_at=now() where id=$1",
            [id, actor],
          );
        } else if (command.action === "request_budget") {
          if (batch.status === "draft" || total! <= batch.total_count)
            throw new ConflictException(
              "发行总量仅允许申请增加；草稿请修改配置",
            );
        } else if (command.action === "approve_budget") {
          const request = (
            await client.query<{
              actor_id: string;
              result: { previousTotal: number; totalCount: number };
            }>(
              "select actor_id,result from promotion.voucher_operations where id=$1 and batch_id=$2 and operation_type='batch_request_budget' and actor_realm='operator'",
              [requestId, id],
            )
          ).rows[0];
          if (!request || request.actor_id === actor)
            throw new ConflictException("增额申请不存在或不能自行审批");
          const approved = (
            await client.query(
              "select 1 from promotion.voucher_operations where batch_id=$1 and operation_type='batch_approve_budget' and result->>'requestOperationId'=$2",
              [id, requestId],
            )
          ).rows.length;
          if (
            approved ||
            request.result.previousTotal !== batch.total_count ||
            request.result.totalCount <= batch.total_count
          )
            throw new ConflictException(
              "增额申请已处理或预算已变化，请重新申请",
            );
          await client.query(
            "update promotion.voucher_batches set total_count=$2,updated_at=now() where id=$1",
            [id, request.result.totalCount],
          );
        } else {
          const next =
            command.action === "pause"
              ? "paused"
              : command.action === "resume"
                ? "active"
                : "archived";
          if (
            (next === "paused" && batch.status !== "active") ||
            (next === "active" && batch.status !== "paused")
          )
            throw new ConflictException("批次状态已变化");
          if (next === "active" && batch.valid_until.getTime() <= Date.now())
            throw new ConflictException("批次已过有效期");
          await client.query(
            "update promotion.voucher_batches set status=$2,updated_at=now() where id=$1",
            [id, next],
          );
        }
        const current = (
          await client.query<{ status: string }>(
            "select status from promotion.voucher_batches where id=$1",
            [id],
          )
        ).rows[0]!;
        const result = {
          batchId: id,
          operationId: operation,
          status: current.status,
          ...(total
            ? { previousTotal: batch.total_count, totalCount: total }
            : {}),
          ...(requestId ? { requestOperationId: requestId } : {}),
        };
        record(id, `batch_${command.action}`, reason, {
          before: { status: batch.status, totalCount: batch.total_count },
          ...result,
          ...(config ? { configuration: config } : {}),
          ...(command.action === "review"
            ? { approvedConfiguration: batch }
            : {}),
        });
        return { batchId: id, result };
      },
    );
  }

  // =========================================================================
  // Assignment owns batch -> voucher locks and cumulative lifetime limits.
  // =========================================================================
  /** Preissue anonymous single-use instances. @param actor - Authenticated operator. @param batchId - Reviewed batch. @param command - Budget and durable request identity. @param credentials - Configured rotating claim keys. @returns Identities on every retry; secrets only on the initial successful execution. @throws {ConflictException} For unavailable batches or exhausted budget. */
  async issueClaimCredentials(
    actor: string,
    batchId: string,
    command: OperatorCommand & { count: number; fundingPaymentId?: string },
    credentials: VoucherClaimCredentials,
  ) {
    const id = identity(batchId, "batchId"),
      amount = count(command?.count, "count", 200);
    const paymentId = command.fundingPaymentId
      ? identity(command.fundingPaymentId, "fundingPaymentId")
      : null;
    const secrets: Array<{ voucherId: string; code: string; secret: string }> =
      [];
    const result = await this.execute(
      actor,
      "voucher_issue",
      command,
      { id, amount, ...(paymentId ? { paymentId } : {}) },
      async (client, _operation, reason, record) => {
        // Read the source before locking the batch; revalidate after the lock.
        const initial = (
          await client.query<BatchRow>(
            "select * from promotion.voucher_batches where id=$1",
            [id],
          )
        ).rows[0];
        if (!initial) throw new NotFoundException("批次不存在");
        const cash =
          initial.kind === "recharge_card"
            ? parseRechargeEffect(initial.effect).face_value_cents
            : 0;
        if (cash > 0) {
          if (!paymentId || !initial.tenant_id || !this.funding)
            throw new BadRequestException(
              "本金卡须绑定销售租户，并从已确认真实收款发行",
            );
          await this.funding.lockSource(client, {
            paymentId,
            tenantId: initial.tenant_id,
            amountCents: cash * amount,
          });
        } else if (paymentId)
          throw new BadRequestException("非本金卡不接受收款来源");
        const batch = await batchForUpdate(client, id);
        if (
          batch.kind !== initial.kind ||
          canonical(batch.effect) !== canonical(initial.effect) ||
          batch.tenant_id !== initial.tenant_id
        )
          throw new ConflictException("批次配置已改变，请刷新后重新发行");
        if (
          batch.status !== "active" ||
          batch.policy_snapshot?.compensation_batch ||
          batch.valid_from.getTime() > Date.now() ||
          (batch.claim_until ?? batch.valid_until).getTime() <= Date.now()
        )
          throw new ConflictException("批次不在可发行状态或期限内");
        if (batch.issued_count + amount > batch.total_count)
          throw new ConflictException("批次发行量不足");
        const checked = normalizeBatch({
          kind: batch.kind as CreateBatchCommand["kind"],
          name: batch.name,
          effect: batch.effect,
          totalCount: Math.max(1, batch.total_count),
          validFrom: batch.valid_from.toISOString(),
          validUntil: batch.valid_until.toISOString(),
          tenantId: batch.tenant_id,
        });
        await validateReferences(client, checked);
        const voucherIds: string[] = [],
          codes: string[] = [];
        for (let i = 0; i < amount; i++) {
          const voucherId = randomUUID(),
            code = `${batch.code_prefix ?? "VX-"}${randomBytes(16).toString("hex").toUpperCase()}`;
          const token = credentials.generate();
          await client.query(
            `insert into promotion.vouchers(id,batch_id,code,status,max_uses,expires_at,claim_token_digest,claim_key_version,funding_payment_id)
          values ($1,$2,$3,'issued',1,$4,$5,$6,$7)`,
            [
              voucherId,
              id,
              code,
              batch.valid_until,
              token.digest,
              token.version,
              paymentId,
            ],
          );
          if (cash > 0 && paymentId)
            await this.funding!.reserve(client, {
              voucherId,
              paymentId,
              amountCents: cash,
            });
          voucherIds.push(voucherId);
          codes.push(code);
          secrets.push({ voucherId, code, secret: token.secret });
          record(
            id,
            "voucher_issued",
            reason,
            { keyVersion: token.version },
            voucherId,
          );
        }
        await client.query(
          "update promotion.voucher_batches set issued_count=issued_count+$2,frozen_at=coalesce(frozen_at,now()),updated_at=now() where id=$1",
          [id, amount],
        );
        return { batchId: id, result: { batchId: id, voucherIds, codes } };
      },
    );
    return { ...result, credentials: secrets, replayed: secrets.length === 0 };
  }

  // =========================================================================
  /** Assign new single-use instances. @param actor - Operator identity. @param command - Explicit tenant and target. @returns Original codes on replay. @throws {ConflictException} For insufficient budget or lifetime limits. */
  async assign(
    actor: string,
    command: AssignVoucherCommand,
  ): Promise<{ codes: string[]; voucherIds: string[] }> {
    actor = identity(actor, "operatorId");
    if (!command || typeof command !== "object")
      throw new BadRequestException("发放参数必填");
    const id = identity(command.batchId, "batchId"),
      amount = count(command.count, "count", 200);
    const user = command.targetUserId
      ? identity(command.targetUserId, "targetUserId")
      : null;
    const workspace = command.targetWorkspaceId
      ? identity(command.targetWorkspaceId, "targetWorkspaceId")
      : null;
    const requestedTenant = command.targetTenantId
      ? identity(command.targetTenantId, "targetTenantId")
      : null;
    if (user && workspace)
      throw new BadRequestException("user / workspace 目标二选一");
    return this.execute(
      actor,
      "voucher_assign",
      command,
      { id, amount, user, workspace, requestedTenant },
      async (client, _operation, reason, record) => {
        const batch = await batchForUpdate(client, id);
        if (
          batch.status !== "active" ||
          batch.policy_snapshot?.compensation_batch ||
          ![
            "discount",
            "credit_voucher",
            "invite",
            "redemption",
            "extension",
            "recharge_card",
          ].includes(batch.kind)
        )
          throw new ConflictException("批次不可发放");
        if (
          batch.valid_from.getTime() > Date.now() ||
          (batch.claim_until ?? batch.valid_until).getTime() <= Date.now()
        )
          throw new ConflictException("不在发放期限内");
        if (batch.issued_count + amount > batch.total_count)
          throw new ConflictException("批次发行量不足");
        if (batch.kind === "invite" && !user && !workspace)
          throw new BadRequestException("邀请券必须定向到具体用户或工作空间");
        let tenant = batch.tenant_id ?? requestedTenant;
        if (
          batch.tenant_id &&
          requestedTenant &&
          batch.tenant_id !== requestedTenant
        )
          throw new BadRequestException("目标租户与批次不符");
        if (workspace) {
          const target = (
            await client.query<{ tenant_id: string }>(
              "select tenant_id from tenancy.workspaces where id=$1 and status='active' and deleted_at is null",
              [workspace],
            )
          ).rows[0];
          if (!target || (tenant && tenant !== target.tenant_id))
            throw new BadRequestException("工作空间不存在或不属于目标租户");
          tenant = target.tenant_id;
        }
        if (!tenant)
          throw new BadRequestException("平台级发放必须指定目标租户或工作空间");
        if (
          !(
            await client.query(
              "select id from tenancy.tenants where id=$1 and status='active' and deleted_at is null",
              [tenant],
            )
          ).rows.length
        )
          throw new BadRequestException("目标租户不可用");
        if (
          user &&
          !(
            await client.query(
              `select u.id from account.users u join tenancy.tenants t on t.id=$2
        where u.id=$1 and u.deleted_at is null and u.status='active' and (t.owner_user_id=u.id or exists
        (select 1 from tenancy.tenant_memberships m where m.tenant_id=t.id and m.user_id=u.id and m.status='active'))`,
              [user, tenant],
            )
          ).rows.length
        )
          throw new BadRequestException("目标用户不是有效租户成员");
        // All prior assignments count, including revoked, expired and redeemed instances.
        const prior = (
          await client.query<{
            users: string;
            workspaces: string;
            tenants: string;
            unknown_tenants: string;
          }>(
            `select
        count(*) filter (where assigned_user_id=$2 or exists(select 1 from promotion.voucher_events e where e.voucher_id=promotion.vouchers.id and e.event_type='voucher_claimed' and e.actor_realm='customer' and e.actor_id=$2)) users,
        count(*) filter (where assigned_workspace_id=$3) workspaces,
        count(*) filter (where assigned_tenant_id=$4 or (assigned_tenant_id is null and ($5::uuid=$4 or assigned_workspace_id in (select id from tenancy.workspaces where tenant_id=$4)))) tenants,
        count(*) filter (where assigned_tenant_id is null and assigned_workspace_id is null and $5::uuid is null) unknown_tenants
        from promotion.vouchers where batch_id=$1 and (claim_key_version is null or claimed_at is not null)`,
            [id, user, workspace, tenant, batch.tenant_id],
          )
        ).rows[0]!;
        if (batch.per_tenant_limit != null && Number(prior.unknown_tenants) > 0)
          throw new ConflictException(
            "历史券的租户归属待核对，不能自动增加发放",
          );
        if (
          (user && Number(prior.users) + amount > batch.per_user_limit) ||
          (workspace &&
            batch.per_workspace_limit != null &&
            Number(prior.workspaces) + amount > batch.per_workspace_limit) ||
          (batch.per_tenant_limit != null &&
            Number(prior.tenants) + amount > batch.per_tenant_limit)
        )
          throw new ConflictException("超出批次累计发放上限（撤销不恢复限额）");
        // Reject unsupported legacy economic rules rather than issuing unusable instances.
        const checked = normalizeBatch({
          kind: batch.kind as CreateBatchCommand["kind"],
          name: batch.name,
          effect: batch.effect,
          totalCount: Math.max(1, batch.total_count),
          validFrom: batch.valid_from.toISOString(),
          validUntil: batch.valid_until.toISOString(),
          tenantId: tenant,
        });
        if (
          checked.kind === "recharge_card" &&
          parseRechargeEffect(checked.effect).face_value_cents > 0
        )
          throw new BadRequestException(
            "本金卡必须从销售收款生成领取凭证，不支持无来源定向发放",
          );
        await validateReferences(client, checked);
        const codes: string[] = [],
          voucherIds: string[] = [];
        for (let i = 0; i < amount; i++) {
          const code = `${batch.code_prefix ?? "VX-"}${Array.from(randomBytes(24), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")}`;
          const voucher = randomUUID();
          await client.query(
            `insert into promotion.vouchers(id,batch_id,code,status,max_uses,assigned_tenant_id,assigned_user_id,assigned_workspace_id,claimed_at,expires_at)
          values ($1,$2,$3,'assigned',1,$4,$5,$6,now(),least($7::timestamptz,case when $8::int is null then $7::timestamptz else now()+$8*interval '1 day' end))`,
            [
              voucher,
              id,
              code,
              tenant,
              user,
              workspace,
              batch.valid_until,
              batch.use_valid_days,
            ],
          );
          record(
            id,
            "voucher_assigned",
            reason,
            { tenantId: tenant, userId: user, workspaceId: workspace },
            voucher,
          );
          codes.push(code);
          voucherIds.push(voucher);
        }
        await client.query(
          "update promotion.voucher_batches set issued_count=issued_count+$2,frozen_at=coalesce(frozen_at,now()),updated_at=now() where id=$1",
          [id, amount],
        );
        return { batchId: id, result: { codes, voucherIds } };
      },
    );
  }

  /** Revoke unused instances without releasing issuance or claim budgets. @param actor - Operator identity. @param voucherId - Instance identity. @param command - Reason and receipt. @returns Terminal revocation result. @throws {ConflictException} For reserved or used vouchers. */
  async revoke(
    actor: string,
    voucherId: string,
    command: OperatorCommand,
  ): Promise<{ voucherId: string; status: string }> {
    actor = identity(actor, "operatorId");
    voucherId = identity(voucherId, "voucherId");
    return this.execute(
      actor,
      "voucher_revoke",
      command,
      { voucherId },
      async (client, _operation, reason, record) => {
        const initial = (
          await client.query<{ batch_id: string }>(
            "select batch_id from promotion.vouchers where id=$1",
            [voucherId],
          )
        ).rows[0];
        if (!initial) throw new NotFoundException("券不存在");
        const funded =
          (
            await client.query(
              "select id from billing.wallet_card_allocations where voucher_id=$1",
              [voucherId],
            )
          ).rows.length > 0;
        if (funded) {
          if (!this.funding)
            throw new ConflictException("付费充值卡须通过资金来源编排撤回");
          await this.funding.lockRelease(client, voucherId);
        }
        const batch = await batchForUpdate(client, initial.batch_id);
        if (batch.policy_snapshot?.compensation_batch)
          throw new ConflictException("补偿专用券须通过补偿意图处理");
        const voucher = (
          await client.query<{ status: string; used_count: number }>(
            "select status,used_count from promotion.vouchers where id=$1 for update",
            [voucherId],
          )
        ).rows[0]!;
        if (voucher.status === "reserved")
          throw new ConflictException("券已被订单占用，请先处理关联订单");
        if (
          !["issued", "assigned", "expired"].includes(voucher.status) ||
          voucher.used_count !== 0
        )
          throw new ConflictException("已核销或已撤回券不可撤回");
        await client.query(
          "update promotion.vouchers set status='revoked' where id=$1",
          [voucherId],
        );
        if (funded) await this.funding!.release(client, voucherId);
        record(batch.id, "voucher_revoked", reason, {}, voucherId);
        return { batchId: batch.id, result: { voucherId, status: "revoked" } };
      },
    );
  }
}
