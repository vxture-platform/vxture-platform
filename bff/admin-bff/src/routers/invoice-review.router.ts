/**
 * invoice-review.router.ts - Review customer applications in place.
 * @package @vxture/bff-admin
 * @layer Application
 * @category Router
 * @author AI-Generated
 * @date 2026-10-22
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { assertAnyCapability } from "../auth/capability";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { ADMIN_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/console.types";

// ============================================================================
// Request validation
// ============================================================================
interface ReviewBody {
  action?: unknown;
  reason?: unknown;
  invoiceElectronicNo?: unknown;
  invoiceCode?: unknown;
  invoiceFileUrl?: unknown;
  taxAmount?: unknown;
  issuedAt?: unknown;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(value: unknown, max: number, required = true): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new BadRequestException("请完整填写发票信息");
    return null;
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new BadRequestException("发票信息格式错误");
  return value.trim();
}

// ============================================================================
// Operator lifecycle
// ============================================================================
@Controller("api/invoices")
export class InvoiceReviewRouter {
  constructor(@Inject(ADMIN_BFF_RW_POOL) private readonly pool: Pool) {}

  @Post(":id/review")
  async review(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: ReviewBody,
  ): Promise<{ ok: true }> {
    assertAnyCapability(req, ["commerce:invoice.manage"]);
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!UUID.test(id)) throw new BadRequestException("发票申请 id 非法");
    if (!body || !["approve", "reject", "issue"].includes(String(body.action)))
      throw new BadRequestException("不支持的发票动作");
    const reason = text(body.reason, 512)!;
    const issuing = body.action === "issue";
    const number = issuing ? text(body.invoiceElectronicNo, 64) : null;
    const code = issuing ? text(body.invoiceCode, 64, false) : null;
    const file = issuing ? text(body.invoiceFileUrl, 2048) : null;
    const issuedAt = issuing ? text(body.issuedAt, 64) : null;
    const tax = issuing ? text(body.taxAmount, 13) : "0";
    if (issuing) {
      try {
        const url = new URL(file!);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("Invalid file URL");
      } catch {
        throw new BadRequestException("发票文件必须是 HTTPS 地址");
      }
      if (
        !issuedAt ||
        !/^\d{4}-\d{2}-\d{2}T/.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      )
        throw new BadRequestException("开具时间格式错误");
      if (!tax || !/^\d{1,10}(\.\d{1,2})?$/.test(tax))
        throw new BadRequestException("税额格式错误");
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{
        invoice_status: string;
        tenant_id: string;
        invoice_no: string;
        tax_valid: boolean;
      }>(
        `select invoice_status, tenant_id, invoice_no, $2::numeric <= invoice_amount as tax_valid
           from billing.invoice_receipts where id = $1 and deleted_at is null for update`,
        [id, tax],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException("开票申请不存在");
      const allowed =
        body.action === "approve"
          ? row.invoice_status === "applying"
          : issuing
            ? row.invoice_status === "approved"
            : ["applying", "approved"].includes(row.invoice_status);
      if (!allowed) throw new ConflictException("申请状态已变化,请刷新后重试");
      if (issuing && !row.tax_valid)
        throw new BadRequestException("税额不能超过价税合计");
      if (issuing) {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`invoice-number:${number}`],
        );
        const duplicate = await client.query(
          `select 1 from billing.invoice_receipts where id <> $1
          and invoice_electronic_no = $2 and deleted_at is null and invoice_status in ('issued', 'sent') limit 1`,
          [id, number],
        );
        if (duplicate.rowCount)
          throw new ConflictException("该实际发票号码已登记");
      }
      const status =
        body.action === "approve"
          ? "approved"
          : issuing
            ? "issued"
            : "rejected";
      await client.query(
        `update billing.invoice_receipts set invoice_status = $2::varchar, status_remark = $3,
          auditor_id = $4, audit_at = now(), updated_at = now(),
          invoice_electronic_no = coalesce($5, invoice_electronic_no),
          invoice_code = coalesce($6, invoice_code), invoice_file_url = coalesce($7, invoice_file_url),
          issued_at = coalesce($8::timestamptz, issued_at), tax_amount = case when $2::varchar = 'issued' then $9::numeric else tax_amount end
          where id = $1`,
        [id, status, reason, req.user.id, number, code, file, issuedAt, tax],
      );
      await insertOperatorAuditLog(client, req, {
        action: `billing.invoice.${String(body.action)}`,
        resourceType: "invoice_receipt",
        resourceId: row.invoice_no,
        tenantId: row.tenant_id,
        before: { status: row.invoice_status },
        after: { status, reason },
      });
      await client.query("commit");
      return { ok: true };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
}
