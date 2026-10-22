/**
 * Persist raw capability facts; quota deduction remains a separate concern.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-10-21
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  CapabilityUsageInput,
  CapabilityUsageReceipt,
} from "./capability-usage";

@Injectable()
export class CapabilityUsageService {
  // --- Receiver transaction -------------------------------------------------
  constructor(@Inject("COMMERCE_PG_POOL") private readonly pool: Pool) {}

  /** A unique insert serializes simultaneous deliveries, including lost replies. */
  async ingest(input: CapabilityUsageInput): Promise<CapabilityUsageReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Resolve at the receiver; a reporter cannot manufacture a catalog item.
      const identity = await client.query<{ product_id: string }>(
        `select p.id as product_id from product.products p
         where p.product_code = $1 and (p.deleted_at is null or exists (
           select 1 from metering.capability_usage_events e
           where e.reported_by='runos' and e.source_event_id=$3 and e.product_id=p.id))
           and exists (select 1 from tenancy.workspaces w where w.id = $2)`,
        [input.productCode, input.workspaceId, input.sourceEventId],
      );
      const productId = identity.rows[0]?.product_id;
      if (!productId)
        throw new BadRequestException("unknown_usage_attribution");
      const values = [
        input.workspaceId,
        productId,
        input.callId,
        input.capabilityId,
        input.metric,
        input.amount,
        input.unit,
        input.occurredAt,
      ];
      const inserted = await client.query<{ id: string }>(
        `insert into metering.capability_usage_events
         (id, reported_by, source_event_id, workspace_id, product_id, call_id,
          capability_id, metric_key, amount, unit, occurred_at)
         values ($1, 'runos', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (reported_by, source_event_id) do nothing returning id`,
        [randomUUID(), input.sourceEventId, ...values],
      );
      let eventId = inserted.rows[0]?.id;
      const replayed = !eventId;
      // --- Stable acknowledgement after concurrent or lost-response delivery ---
      if (!eventId) {
        const previous = await client.query<{ id: string; matches: boolean }>(
          `select id, (workspace_id=$2 and product_id=$3 and call_id=$4 and
           capability_id=$5 and metric_key=$6 and amount=$7 and unit=$8 and occurred_at=$9) as matches
           from metering.capability_usage_events where reported_by='runos' and source_event_id=$1`,
          [input.sourceEventId, ...values],
        );
        if (!previous.rows[0]?.matches)
          throw new ConflictException("capability_usage_idempotency_conflict");
        eventId = previous.rows[0].id;
      }
      await client.query("commit");
      return {
        recorded: true,
        capability_event_id: eventId,
        source_event_id: input.sourceEventId,
        replayed,
        settlement: "not_configured",
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
