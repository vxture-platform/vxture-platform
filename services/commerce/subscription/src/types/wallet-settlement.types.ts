/**
 * wallet-settlement.types.ts - Application-injected source wallet transaction port.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category types
 * @author AI-Generated
 * @date 2026-11-20
 */
import type { PoolClient } from "pg";

export interface WalletSettlementContext {
  tenantId: string;
  currency: string;
  actorType: "customer" | "operator" | "system";
  actorId: string;
}

export type WalletSettlementCommand = {
  idempotencyKey: string;
  invoiceId?: string;
} & (
  | { action: "consume" | "bonus"; amountCents: number }
  | { action: "restore"; amountCents: number; consumptionId: string }
  | { action: "reclaim"; lotId: string; amountCents: number }
);

export interface WalletSettlementPort {
  /** Post on the caller's transaction; failures must roll back the whole operation. */
  postInTransaction(
    client: PoolClient,
    context: WalletSettlementContext,
    command: WalletSettlementCommand,
  ): Promise<{
    operationId: string;
    transactionId: string;
    lotId: string | null;
  }>;
}

/** Parse persisted two-decimal money without silently rounding corrupted values. */
export function settlementCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Invalid persisted settlement amount");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents))
    throw new Error("Settlement amount overflow");
  return cents;
}
