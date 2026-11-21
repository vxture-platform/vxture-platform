/**
 * order-creation-operation.ts - Atomic cross-domain order creation and replay.
 * @package @vxture/bff-console
 * @layer Application
 * @category orchestration
 * @author AI-Generated
 * @date 2026-11-19
 */
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

// ===========================================================================
// Request identity and response receipts
// ===========================================================================
export interface OrderCreationIdentity {
  userId: string;
  tenantId: string;
  workspaceId: string;
  key?: string | undefined;
  request: Record<string, unknown>;
}

/**
 * Run order creation and promotion effects within one commit boundary.
 * @param pool - Application pool, also used by the participating domain services.
 * @param identity - Verified scope, client request key and normalized parameters.
 * @param create - Domain calls using the same client, followed by optional promotion effects.
 * @returns The original response, including for a retried request.
 * @throws {BadRequestException} When the request key is malformed.
 * @throws {ConflictException} When a key is reused for different parameters.
 */
export async function withOrderCreationOperation<T extends object>(
  pool: Pool,
  identity: OrderCreationIdentity,
  create: (client: PoolClient) => Promise<{
    result: T;
    onCreated?: ((operationId: string) => Promise<void>) | undefined;
  }>,
): Promise<T> {
  const key = identity.key ?? randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key))
    throw new BadRequestException("idempotencyKey 非法");
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        tenantId: identity.tenantId,
        workspaceId: identity.workspaceId,
        ...identity.request,
      }),
    )
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    // This lock is per actor and key, independent of the request hash or tenant.
    // Changing the context with the same key must conflict rather than bypass it.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `customer:create_order:${identity.userId}:${key}`,
    ]);
    const prior = await client.query<{ request_hash: string; result: T }>(
      `select request_hash,result from promotion.voucher_operations
        where actor_realm='customer' and actor_id=$1 and operation_type='create_order' and idempotency_key=$2`,
      [identity.userId, key],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash)
        throw new ConflictException({
          code: "IDEMPOTENCY_CONFLICT",
          message: "请求标识已用于不同的下单参数，请重新确认。",
        });
      await client.query("commit");
      return prior.rows[0].result;
    }
    const created = await create(client);
    const operationId = randomUUID();
    // Insert the completed receipt once; it remains immutable after commit.
    await client.query(
      `insert into promotion.voucher_operations
      (id,actor_realm,actor_id,operation_type,idempotency_key,request_hash,result)
      values ($1,'customer',$2,'create_order',$3,$4,$5::jsonb)`,
      [operationId, identity.userId, key, hash, JSON.stringify(created.result)],
    );
    await created.onCreated?.(operationId);
    await client.query("commit");
    return created.result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
