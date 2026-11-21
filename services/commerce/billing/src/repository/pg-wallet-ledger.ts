/**
 * pg-wallet-ledger.ts - Wallet postings with immutable source allocations.
 * @package @vxture/service-billing
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type {
  WalletCommand,
  WalletContext,
  WalletResult,
  WalletSummary,
  WalletHistoryPage,
  WalletHistoryRecord,
} from "../types/wallet.types";
import { positiveWalletCents, walletAmount, walletCents } from "./wallet-money";

// ===========================================================================
// Internal inputs are application-authorized; no customer-supplied source IDs.
// ===========================================================================
function uuid(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  )
    throw new BadRequestException("钱包标识非法");
  return value.toLowerCase();
}
function conflict(message = "钱包来源无法核实，请联系运营核对"): never {
  throw new ConflictException(message);
}
interface Lot {
  id: string;
  kind: "principal" | "bonus";
  remaining: string;
  expires_at: Date | null;
}
interface Posting {
  id: string;
  lotId: string;
  type: "credit" | "consume" | "restore" | "expire" | "reclaim";
  cents: number;
  debitId?: string;
}
function normalize(context: WalletContext, command: WalletCommand) {
  const scope: WalletContext = {
    ...context,
    tenantId: uuid(context.tenantId),
    actorId: uuid(context.actorId),
  };
  if (
    !/^[A-Z]{3}$/.test(scope.currency) ||
    !["customer", "operator", "system"].includes(scope.actorType)
  )
    throw new BadRequestException("钱包币种或操作身份非法");
  const key = command?.idempotencyKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
    throw new BadRequestException("钱包请求标识非法");
  let normalized: WalletCommand;
  switch (command.action) {
    case "principal":
      normalized = {
        action: command.action,
        idempotencyKey: key,
        amountCents: positiveWalletCents(command.amountCents),
        paymentId: uuid(command.paymentId),
        ...(command.cardAllocationId
          ? { cardAllocationId: uuid(command.cardAllocationId) }
          : {}),
      };
      break;
    case "bonus": {
      let expiresAt: string | undefined;
      if (command.expiresAt !== undefined) {
        if (
          typeof command.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(command.expiresAt))
        )
          throw new BadRequestException("赠额到期时间非法");
        expiresAt = new Date(command.expiresAt).toISOString();
      }
      normalized = {
        action: command.action,
        idempotencyKey: key,
        amountCents: positiveWalletCents(command.amountCents),
        ...(expiresAt ? { expiresAt } : {}),
      };
      break;
    }
    case "consume":
      normalized = {
        action: command.action,
        idempotencyKey: key,
        amountCents: positiveWalletCents(command.amountCents),
      };
      break;
    case "restore":
      normalized = {
        action: command.action,
        idempotencyKey: key,
        amountCents: positiveWalletCents(command.amountCents),
        consumptionId: uuid(command.consumptionId),
      };
      break;
    case "reclaim":
      normalized = {
        action: command.action,
        idempotencyKey: key,
        lotId: uuid(command.lotId),
        ...(command.amountCents !== undefined
          ? { amountCents: positiveWalletCents(command.amountCents) }
          : {}),
      };
      break;
    case "expire":
      normalized = { action: command.action, idempotencyKey: key };
      break;
    default:
      throw new BadRequestException("钱包操作非法");
  }
  if (command.invoiceId !== undefined)
    normalized.invoiceId = uuid(command.invoiceId);
  return {
    scope,
    command: normalized,
    hash: createHash("sha256")
      .update(JSON.stringify({ scope, command: normalized }))
      .digest("hex"),
  };
}

export class PgWalletLedger {
  constructor(private readonly pool: Pool) {}

  /** Lock a destination before acquiring voucher locks. @param client - Caller transaction after cash-source locks. @param scope - Verified tenant and currency. @returns No value. @throws {ConflictException} For legacy or inconsistent balances. */
  async lockAccountInTransaction(client: PoolClient, scope: WalletContext) {
    await client.query(
      "insert into billing.credits(tenant_id,currency) values($1,$2) on conflict(tenant_id) do nothing",
      [uuid(scope.tenantId), scope.currency],
    );
    const wallet = (
      await client.query<{ id: string; balance: string; currency: string }>(
        "select id,balance::text,currency from billing.credits where tenant_id=$1 for update",
        [scope.tenantId],
      )
    ).rows[0]!;
    const tracked =
      (
        await client.query(
          "select credit_id from billing.wallet_accounts where credit_id=$1",
          [wallet.id],
        )
      ).rows.length > 0;
    const sum = (
      await client.query<{ balance: string }>(
        "select coalesce(sum(e.amount),0)::text balance from billing.wallet_entries e join billing.wallet_lots l on l.id=e.lot_id where l.credit_id=$1",
        [wallet.id],
      )
    ).rows[0]!;
    if (
      wallet.currency !== scope.currency ||
      (walletCents(wallet.balance) !== 0 && !tracked) ||
      walletCents(sum.balance) !== walletCents(wallet.balance)
    )
      conflict("钱包币种或历史来源待核对，暂不可兑换充值卡");
  }

  /** Post an authorized wallet command atomically. @param context - Verified tenant and actor. @param command - Trusted application intent. @returns Stable receipt for identical retries. @throws {ConflictException} For unverified funds, stale sources or insufficient balance. */
  async post(
    context: WalletContext,
    command: WalletCommand,
  ): Promise<WalletResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await this.postInTransaction(client, context, command);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Post within application orchestration. @param client - Caller-owned transaction; source payments precede wallet locks, and voucher locks follow them. Caller must roll back on failure. @param context - Verified tenant/actor, never request-body ownership. @param input - Authorized intent; principal requires a dedicated, paid, non-subscription invoice. @returns Original receipt for a matching key. @throws {ConflictException} When any source, ownership or balance check fails. */
  async postInTransaction(
    client: PoolClient,
    context: WalletContext,
    input: WalletCommand,
  ): Promise<WalletResult> {
    const { scope, command, hash } = normalize(context, input);
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `wallet:${scope.tenantId}:${command.idempotencyKey}`,
    ]);
    const prior = (
      await client.query<{ request_hash: string; result: WalletResult }>(
        `select o.request_hash,o.result from billing.wallet_operations o join billing.credits c on c.id=o.credit_id where c.tenant_id=$1 and o.idempotency_key=$2`,
        [scope.tenantId, command.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        conflict("同一钱包请求标识的参数或身份已改变");
      return prior.result;
    }
    if (command.invoiceId) {
      const invoice = (
        await client.query<{ tenant_id: string; currency: string }>(
          "select tenant_id,currency from billing.invoices where id=$1 and deleted_at is null for update",
          [command.invoiceId],
        )
      ).rows[0];
      if (
        !invoice ||
        invoice.tenant_id !== scope.tenantId ||
        invoice.currency !== scope.currency
      )
        conflict("钱包账单归属或币种不一致");
    }
    if (command.action === "principal")
      await this.lockFundingInTransaction(
        client,
        scope,
        command.paymentId,
        command.amountCents,
        command.cardAllocationId,
      );
    await client.query(
      "insert into billing.credits(tenant_id,currency) values($1,$2) on conflict(tenant_id) do nothing",
      [scope.tenantId, scope.currency],
    );
    const wallet = (
      await client.query<{
        id: string;
        balance: string;
        currency: string;
      }>(
        "select id,balance::text,currency from billing.credits where tenant_id=$1 for update",
        [scope.tenantId],
      )
    ).rows[0]!;
    if (wallet.currency !== scope.currency) conflict("钱包币种不一致");
    // Read time after waiting for the wallet lock, not from its pre-lock projection.
    const now = (
      await client.query<{ now: Date }>("select clock_timestamp() as now")
    ).rows[0]!.now;
    const tracked =
      (
        await client.query(
          "select credit_id from billing.wallet_accounts where credit_id=$1",
          [wallet.id],
        )
      ).rows.length > 0;
    if (!tracked) {
      if (walletCents(wallet.balance) !== 0)
        conflict("历史钱包余额尚未完成来源核对");
      await client.query(
        "insert into billing.wallet_accounts(credit_id) values($1)",
        [wallet.id],
      );
    }
    const lots = (
      await client.query<Lot>(
        `select l.id,l.kind,l.expires_at,coalesce(sum(e.amount),0)::text remaining from billing.wallet_lots l left join billing.wallet_entries e on e.lot_id=l.id
       where l.credit_id=$1 group by l.id order by case when l.kind='bonus' then 0 else 1 end,l.expires_at nulls last,l.created_at,l.id`,
        [wallet.id],
      )
    ).rows;
    const total = lots.reduce((n, l) => n + walletCents(l.remaining), 0);
    if (total !== walletCents(wallet.balance)) conflict();
    const postings: Posting[] = [];
    let lotId: string | null = null,
      restored = 0,
      expired = 0;
    const add = (
      lot: string,
      type: Posting["type"],
      cents: number,
      debitId?: string,
    ) => {
      if (cents)
        postings.push({
          id: randomUUID(),
          lotId: lot,
          type,
          cents,
          ...(debitId ? { debitId } : {}),
        });
    };
    // =======================================================================
    // Gift first, earliest expiration first; principal has no expiration.
    // =======================================================================
    if (command.action === "principal" || command.action === "bonus") {
      if (
        command.action === "bonus" &&
        command.expiresAt &&
        Date.parse(command.expiresAt) <= now.getTime()
      )
        throw new BadRequestException("赠额到期时间必须在未来");
      lotId = randomUUID();
      add(lotId, "credit", command.amountCents);
    } else if (command.action === "consume") {
      let needed = command.amountCents;
      for (const lot of lots) {
        if (lot.expires_at && lot.expires_at <= now) continue;
        const used = Math.min(needed, walletCents(lot.remaining));
        add(lot.id, "consume", -used);
        needed -= used;
        if (!needed) break;
      }
      if (needed) conflict("钱包可用余额不足");
    } else if (command.action === "restore") {
      const original = (
        await client.query<{
          id: string;
          lot_id: string;
          available: string;
          expires_at: Date | null;
        }>(
          `select d.id,d.lot_id,(-d.amount-coalesce((select sum(r.amount) from billing.wallet_entries r where r.debit_entry_id=d.id),0))::text available,l.expires_at
         from billing.wallet_entries d join billing.wallet_operations o on o.id=d.operation_id join billing.wallet_lots l on l.id=d.lot_id
         join billing.transactions t on t.id=o.transaction_id
         where o.id=$1 and o.credit_id=$2 and o.action='consume' and d.entry_type='consume'
           and ($3::uuid is null or t.bill_id=$3) order by d.created_at,d.id`,
          [command.consumptionId, wallet.id, command.invoiceId ?? null],
        )
      ).rows;
      if (!original.length) conflict("消费记录不属于当前钱包");
      let needed = command.amountCents;
      for (const debit of original) {
        const value = Math.min(needed, walletCents(debit.available));
        add(debit.lot_id, "restore", value, debit.id);
        if (value && debit.expires_at && debit.expires_at <= now) {
          add(debit.lot_id, "expire", -value);
          expired += value;
        }
        needed -= value;
        if (!needed) break;
      }
      if (needed) conflict("退回金额超过原消费的未退金额");
      restored = command.amountCents;
    } else if (command.action === "expire") {
      for (const lot of lots)
        if (lot.kind === "bonus" && lot.expires_at && lot.expires_at <= now) {
          const value = walletCents(lot.remaining);
          add(lot.id, "expire", -value);
          expired += value;
        }
    } else {
      const lot = lots.find((l) => l.id === command.lotId);
      if (!lot || lot.kind !== "bonus")
        conflict("只允许回收当前钱包的剩余赠额");
      if (
        command.amountCents !== undefined &&
        walletCents(lot.remaining) !== command.amountCents
      )
        conflict("原赠额剩余不足，不能自动冲回");
      add(lot.id, "reclaim", -walletCents(lot.remaining));
    }
    const delta = postings.reduce((n, e) => n + e.cents, 0),
      after = walletCents(wallet.balance) + delta;
    if (after < 0) conflict();
    const operationId = randomUUID(),
      transactionId = randomUUID();
    const result: WalletResult = {
      operationId,
      transactionId,
      action: command.action,
      amount: walletAmount(delta),
      balance: walletAmount(after),
      restoredAmount: walletAmount(restored),
      expiredAmount: walletAmount(expired),
      lotId,
    };
    // Principal is a transfer of proven cash, not another recharge receipt.
    await client.query(
      `insert into billing.transactions(id,tenant_id,transaction_no,trade_type,amount,currency,balance_before,balance_after,trade_status,related_no,remark,actor_type,actor_id,bill_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,'success',$9,$10,$11,$12,$13)`,
      [
        transactionId,
        scope.tenantId,
        `WT-${randomUUID().replaceAll("-", "")}`,
        command.action === "bonus"
          ? "grant"
          : command.action === "consume"
            ? "consume"
            : command.action === "restore"
              ? "refund"
              : "adjust",
        result.amount,
        scope.currency,
        wallet.balance,
        result.balance,
        operationId,
        `wallet ${command.action}`,
        scope.actorType,
        scope.actorId,
        command.invoiceId ?? null,
      ],
    );
    await client.query(
      `insert into billing.wallet_operations(id,credit_id,idempotency_key,request_hash,action,actor_type,actor_id,transaction_id,result) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        operationId,
        wallet.id,
        command.idempotencyKey,
        hash,
        command.action,
        scope.actorType,
        scope.actorId,
        transactionId,
        JSON.stringify(result),
      ],
    );
    if (lotId && command.action === "principal" && command.cardAllocationId) {
      const transfer = await client.query(
        "update billing.wallet_card_allocations set status='transferred',principal_lot_id=$2,updated_at=clock_timestamp() where id=$1 and status='reserved' and payment_id=$3 and amount=$4",
        [
          command.cardAllocationId,
          lotId,
          command.paymentId,
          walletAmount(command.amountCents),
        ],
      );
      if (transfer.rowCount !== 1) conflict("充值卡资金已被转入或释放");
    }
    if (lotId && (command.action === "principal" || command.action === "bonus"))
      await client.query(
        "insert into billing.wallet_lots(id,credit_id,operation_id,kind,amount,funding_payment_id,expires_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          lotId,
          wallet.id,
          operationId,
          command.action,
          walletAmount(command.amountCents),
          command.action === "principal" ? command.paymentId : null,
          command.action === "bonus" ? (command.expiresAt ?? null) : null,
        ],
      );
    for (const e of postings)
      await client.query(
        "insert into billing.wallet_entries(id,operation_id,lot_id,entry_type,amount,debit_entry_id) values($1,$2,$3,$4,$5,$6)",
        [
          e.id,
          operationId,
          e.lotId,
          e.type,
          walletAmount(e.cents),
          e.debitId ?? null,
        ],
      );
    await client.query(
      "update billing.credits set balance=$2,total_granted=total_granted+$3,total_consumed=greatest(total_consumed+$4::numeric,0),version=version+1,updated_at=clock_timestamp() where id=$1",
      [
        wallet.id,
        result.balance,
        command.action === "principal" || command.action === "bonus"
          ? walletAmount(command.amountCents)
          : "0.00",
        command.action === "consume"
          ? walletAmount(command.amountCents)
          : command.action === "restore"
            ? walletAmount(-restored)
            : "0.00",
      ],
    );
    return result;
  }

  // =========================================================================
  // Funding locks serialize all destinations spending the same cash payment.
  // =========================================================================
  /** Lock and verify dedicated cash before any wallet or voucher lock. @param client - Caller transaction. @param scope - Authenticated destination. @param paymentId - Frozen sales source. @param cents - Required principal. @param allocationId - Existing card reservation being transferred. @returns No value. @throws {ConflictException} For invalid or exhausted sources. */
  async lockFundingInTransaction(
    client: PoolClient,
    scope: WalletContext,
    paymentId: string,
    cents: number,
    allocationId?: string,
  ) {
    await client.query(
      "select i.id from billing.invoices i join billing.payments p on p.bill_id=i.id where p.id=$1 order by i.id for update of i",
      [paymentId],
    );
    const source = (
      await client.query<{
        paid_amount: string;
        currency: string;
        tenant_id: string;
        bill_id: string;
      }>(
        `select p.paid_amount,p.currency,p.tenant_id,p.bill_id from billing.payments p join billing.invoices i on i.id=p.bill_id
       join billing.transactions t on t.id=p.transaction_id
       where p.id=$1 and p.pay_status='paid' and p.pay_source in ('online','offline') and p.paid_at is not null
         and i.tenant_id=p.tenant_id and i.currency=p.currency and i.bill_status='paid' and i.deleted_at is null
         and i.order_id is null and i.subscription_id is null and i.bill_type='one_off'
         and not exists(select from billing.payments other where other.transaction_id=t.id and other.id<>p.id)
         and i.paid_amount=(select sum(settled.paid_amount) from billing.payments settled where settled.bill_id=i.id and settled.pay_status='paid')
         and not exists(select from billing.invoice_items ii where ii.bill_id=i.id and ii.subscription_id is not null)
         and t.tenant_id=p.tenant_id and t.bill_id=i.id and t.currency=p.currency and t.amount=p.paid_amount
         and t.trade_type='recharge' and t.trade_status='success' and t.balance_before=t.balance_after
       for update of p`,
        [paymentId],
      )
    ).rows[0];
    if (
      !source ||
      source.tenant_id !== scope.tenantId ||
      source.currency !== scope.currency
    )
      conflict("本金必须来自当前租户真实已入账的独立销售收款");
    const allocated = (
      await client.query<{ amount: string }>(
        `select (coalesce((select sum(amount) from billing.wallet_lots where funding_payment_id=$1),0)+
       coalesce((select sum(amount) from billing.refund_allocations where payment_id=$1 and status in ('reserved','succeeded')),0)+
       coalesce((select sum(amount) from billing.wallet_card_allocations where payment_id=$1 and status='reserved' and id is distinct from $2::uuid),0))::text amount`,
        [paymentId, allocationId ?? null],
      )
    ).rows[0]!;
    if (
      allocationId &&
      !(
        await client.query(
          `select a.id from billing.wallet_card_allocations a join promotion.vouchers v on v.id=a.voucher_id
       where a.id=$1 and a.payment_id=$2 and a.amount=$3 and a.status='reserved' and v.funding_payment_id=a.payment_id`,
          [allocationId, paymentId, walletAmount(cents)],
        )
      ).rows.length
    )
      conflict("充值卡资金分配不可用");
    if (walletCents(allocated.amount) + cents > walletCents(source.paid_amount))
      conflict("原收款可分配本金不足");
    if (
      (
        await client.query(
          "select id from billing.refunds r where (r.pay_record_id=$1 or r.bill_id=$2) and r.audit_status<>'rejected' and r.refund_status<>'failed' and not exists(select from billing.refund_allocations a where a.refund_id=r.id)",
          [paymentId, source.bill_id],
        )
      ).rows.length
    )
      conflict("原收款存在未核实的退款");
  }

  /** Read scoped evidence with the same snapshot for counts and entries. @param tenantId - Application-authorized tenant. @param page - One-based page. @param pageSize - Bounded page size. @returns Source allocations, original debit references and visible payment numbers. @throws {BadRequestException} For malformed paging. */
  async history(
    tenantId: string,
    page = 1,
    pageSize = 20,
  ): Promise<WalletHistoryPage> {
    tenantId = uuid(tenantId);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 1_000_000 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException("钱包账本分页非法");
    const row = (
      await this.pool.query<{ total: number; items: WalletHistoryRecord[] }>(
        `with scoped as (select o.* from billing.wallet_operations o join billing.credits c on c.id=o.credit_id where c.tenant_id=$1),
       selected as (select * from scoped order by created_at desc,id desc limit $2 offset $3)
       select (select count(*)::int from scoped) total,coalesce(jsonb_agg(jsonb_build_object(
         'operationId',o.id,'action',o.action,'transactionNo',t.transaction_no,'createdAt',o.created_at,'result',o.result,
         'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'lotId',l.id,'kind',l.kind,'type',e.entry_type,
           'amount',e.amount::text,'debitEntryId',e.debit_entry_id,'paymentNo',p.pay_order_no,'expiresAt',l.expires_at) order by e.created_at,e.id),'[]'::jsonb)
           from billing.wallet_entries e join billing.wallet_lots l on l.id=e.lot_id left join billing.payments p on p.id=l.funding_payment_id where e.operation_id=o.id)
       ) order by o.created_at desc,o.id desc),'[]'::jsonb) items from selected o join billing.transactions t on t.id=o.transaction_id`,
        [tenantId, pageSize, (page - 1) * pageSize],
      )
    ).rows[0]!;
    return { ...row, page, pageSize };
  }

  /** Read a coherent classification without initializing or guessing legacy funds. @param tenantId - Application-authorized tenant. @returns Stored total and proven source balances; unknown values remain null. */
  async summary(tenantId: string): Promise<WalletSummary> {
    const row = (
      await this.pool.query<{
        currency: string;
        balance: string;
        tracked: boolean;
        principal: string;
        bonus: string;
        expired: string;
      }>(
        `select c.currency,c.balance::text,exists(select from billing.wallet_accounts a where a.credit_id=c.id) tracked,
       coalesce(sum(e.amount) filter(where l.kind='principal'),0)::text principal,
       coalesce(sum(e.amount) filter(where l.kind='bonus'),0)::text bonus,
       coalesce(sum(e.amount) filter(where l.kind='bonus' and l.expires_at<=statement_timestamp()),0)::text expired
       from billing.credits c left join billing.wallet_lots l on l.credit_id=c.id left join billing.wallet_entries e on e.lot_id=l.id
       where c.tenant_id=$1 group by c.id`,
        [uuid(tenantId)],
      )
    ).rows[0];
    if (!row)
      return {
        status: "absent",
        currency: "CNY",
        balance: "0.00",
        principalBalance: null,
        bonusBalance: null,
        availableBalance: null,
        expiredBonusBalance: null,
      };
    const status = !row.tracked
      ? "unverified"
      : walletCents(row.principal) + walletCents(row.bonus) ===
          walletCents(row.balance)
        ? "ready"
        : "inconsistent";
    return {
      status,
      currency: row.currency,
      balance: row.balance,
      principalBalance:
        status === "ready" ? walletAmount(walletCents(row.principal)) : null,
      bonusBalance:
        status === "ready" ? walletAmount(walletCents(row.bonus)) : null,
      availableBalance:
        status === "ready"
          ? walletAmount(walletCents(row.balance) - walletCents(row.expired))
          : null,
      expiredBonusBalance:
        status === "ready" ? walletAmount(walletCents(row.expired)) : null,
    };
  }
}
