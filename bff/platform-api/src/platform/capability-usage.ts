/**
 * Validate infrastructure measurements without interpreting them as charges.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category types
 * @author AI-Generated
 * @date 2026-10-21
 */
import { BadRequestException } from "@nestjs/common";
import { PRODUCT_CODE_RE } from "./product-code";

// --- Wire types ------------------------------------------------------------
export interface CapabilityUsageInput {
  workspaceId: string;
  productCode: string;
  sourceEventId: string;
  callId: string;
  capabilityId: string;
  metric: "runos.call" | "runos.sandbox_mb_ms";
  amount: string;
  unit: "call" | "mb_ms";
  occurredAt: Date;
}

export interface CapabilityUsageReceipt {
  recorded: true;
  capability_event_id: string;
  source_event_id: string;
  replayed: boolean;
  settlement: "not_configured";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[\x21-\x7e]{1,256}$/;

// --- Closed-shape validation ------------------------------------------------
/**
 * Accept one closed shape so mixed payloads cannot silently lose fields.
 * @param body The raw capability measurement request.
 * @returns Validated measurement and caller attribution.
 * @throws BadRequestException When fields, units or timestamps are invalid.
 */
export function parseCapabilityUsage(
  body: Record<string, unknown>,
): CapabilityUsageInput {
  const fail = (): never => {
    throw new BadRequestException("invalid_capability_usage");
  };
  if (
    Object.keys(body).some(
      (key) => !["workspace_id", "product", "capability_usage"].includes(key),
    )
  )
    fail();
  const raw = body.capability_usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "event_id",
          "call_id",
          "capability_id",
          "metric",
          "amount",
          "unit",
          "occurred_at",
        ].includes(key),
    )
  )
    fail();
  if (typeof body.workspace_id !== "string" || !UUID.test(body.workspace_id))
    return fail();
  if (typeof body.product !== "string" || !PRODUCT_CODE_RE.test(body.product))
    return fail();
  if (typeof value.event_id !== "string" || !UUID.test(value.event_id))
    return fail();
  if (typeof value.call_id !== "string" || !ID.test(value.call_id))
    return fail();
  if (typeof value.capability_id !== "string" || !ID.test(value.capability_id))
    return fail();
  if (
    typeof value.amount !== "string" ||
    !/^(0|[1-9]\d{0,18})$/.test(value.amount) ||
    BigInt(value.amount) > 9223372036854775807n
  )
    return fail();
  if (value.metric !== "runos.call" && value.metric !== "runos.sandbox_mb_ms")
    return fail();
  if (
    value.metric === "runos.call"
      ? value.unit !== "call" || value.amount !== "1"
      : value.unit !== "mb_ms"
  )
    return fail();
  if (
    typeof value.occurred_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.occurred_at,
    )
  )
    return fail();
  const occurredAt = new Date(value.occurred_at);
  const wallTime = new Date(
    value.occurred_at.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z"),
  );
  if (
    !Number.isFinite(occurredAt.getTime()) ||
    !Number.isFinite(wallTime.getTime()) ||
    wallTime.toISOString().slice(0, 19) !== value.occurred_at.slice(0, 19) ||
    occurredAt.getTime() > Date.now() + 300_000
  )
    return fail();
  return {
    workspaceId: body.workspace_id.toLowerCase(),
    productCode: body.product,
    sourceEventId: value.event_id.toLowerCase(),
    callId: value.call_id,
    capabilityId: value.capability_id,
    metric: value.metric,
    amount: value.amount,
    unit: value.unit as CapabilityUsageInput["unit"],
    occurredAt,
  };
}
