/**
 * Product-bound full-scan reconciliation over retained provisioning facts.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-10-12
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Pool } from "pg";
import { PROVISIONING_READ_POOL } from "../providers/pg-pool.provider";
import type {
  ProvisioningReadItem,
  ProvisioningReadPage,
} from "../types/provisioning-read.types";

interface Cursor {
  v: 1;
  product: string;
  createdAt: string;
  id: string;
}
interface Row extends ProvisioningReadItem {
  id: string;
  created_at: string;
}

// ── Input and cursor validation ────────────────────────────────────────

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function decodeCursor(raw: unknown, productCode: string): Cursor | null {
  if (raw === undefined) return null;
  try {
    if (
      typeof raw !== "string" ||
      raw.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(raw)
    )
      throw new Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error();
    const cursor = JSON.parse(bytes.toString("utf8")) as Partial<Cursor> | null;
    if (
      !cursor ||
      typeof cursor !== "object" ||
      Array.isArray(cursor) ||
      cursor.v !== 1 ||
      cursor.product !== productCode ||
      typeof cursor.createdAt !== "string" ||
      !TIMESTAMP_RE.test(cursor.createdAt) ||
      !Number.isFinite(Date.parse(cursor.createdAt)) ||
      new Date(cursor.createdAt).toISOString().slice(0, 19) !==
        cursor.createdAt.slice(0, 19) ||
      typeof cursor.id !== "string" ||
      !UUID_RE.test(cursor.id) ||
      Object.keys(cursor).length !== 4
    )
      throw new Error();
    return cursor as Cursor;
  } catch {
    throw new BadRequestException({
      code: "PROVISIONING_READ_CURSOR_INVALID",
      message: "Invalid provisioning cursor for this product.",
      retryable: false,
      field: "cursor",
    });
  }
}

function parseLimit(raw: unknown): number {
  if (raw === undefined) return 100;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw))
    throw new BadRequestException({
      code: "PROVISIONING_READ_LIMIT_INVALID",
      message: "Limit must be a positive safe integer.",
      retryable: false,
      field: "limit",
    });
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit))
    throw new BadRequestException({
      code: "PROVISIONING_READ_LIMIT_INVALID",
      message: "Limit must be a positive safe integer.",
      retryable: false,
      field: "limit",
    });
  return Math.min(limit, 200);
}

// ── Read model ─────────────────────────────────────────────────────────

/** Read facts for one authenticated product without write-side services. */
@Injectable()
export class ProvisioningReadService {
  private readonly logger = new Logger(ProvisioningReadService.name);
  constructor(@Inject(PROVISIONING_READ_POOL) private readonly pool: Pool) {}

  /** Read one page; callers start again from the beginning on the next round. */
  async list(
    productCode: string,
    query: Record<string, unknown>,
  ): Promise<ProvisioningReadPage> {
    if (Object.keys(query).some((key) => key !== "cursor" && key !== "limit"))
      throw new BadRequestException({
        code: "PROVISIONING_READ_QUERY_INVALID",
        message: "Only cursor and limit query parameters are supported.",
        retryable: false,
      });
    const limit = parseLimit(query["limit"]);
    const cursor = decodeCursor(query["cursor"], productCode);
    // Immutable creation order avoids ACK/state updates moving rows between pages.
    // Preserve PostgreSQL microseconds as text: JS Date truncates them and skips rows.
    const result = await this.pool
      .query<Row>(
        `select pr.id, pr.workspace_id, pr.tenant_id, pr.status as state,
              pr.version as seq,
              to_char(pr.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
              to_char(pr.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
         from provisioning.provisionings pr
         join product.products p on p.id = pr.product_id
        where p.product_code = $1 and p.status = 'active' and p.deleted_at is null
          and pr.status in ('pending', 'provisioned', 'deprovisioned')
          and ($2::timestamptz is null or (pr.created_at, pr.id) > ($2::timestamptz, $3::uuid))
        order by pr.created_at, pr.id
        limit $4`,
        [productCode, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      )
      .catch((cause: unknown) => {
        this.logger.error(
          "Provisioning reconciliation read failed",
          cause instanceof Error ? cause.stack : String(cause),
        );
        throw new ServiceUnavailableException(
          {
            code: "PROVISIONING_READ_UNAVAILABLE",
            message: "Provisioning reconciliation is temporarily unavailable.",
            retryable: true,
          },
          { cause },
        );
      });
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map(
        ({ workspace_id, tenant_id, state, seq, updated_at }) => ({
          workspace_id,
          tenant_id,
          state,
          seq,
          updated_at,
        }),
      ),
      nextCursor:
        result.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                product: productCode,
                createdAt: last.created_at,
                id: last.id,
              } satisfies Cursor),
            ).toString("base64url")
          : null,
    };
  }
}
