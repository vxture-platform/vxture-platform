import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PgBillingRepository } from "../repository/pg-billing.repository";
import type {
  InvoiceRecord,
  InvoiceDetail,
  CreditRecord,
  ListInvoicesParams,
  ListInvoicesResult,
  CreateInvoiceInput,
  TenantBillingOverview,
  UpdateInvoiceStatusInput,
} from "../types/billing.types";

@Injectable()
export class BillingService {
  constructor(
    // Explicit token: esbuild does not emit design:paramtypes metadata into the
    // BFF bundle, so implicit constructor injection silently resolves to
    // undefined at runtime (this.billing.listInvoices → TypeError). See the
    // repository's own @Inject(COMMERCE_PG_POOL) for the same pattern.
    @Inject(PgBillingRepository)
    private readonly billing: PgBillingRepository,
  ) {}

  async listInvoices(params: ListInvoicesParams): Promise<ListInvoicesResult> {
    return this.billing.listInvoices(params);
  }

  getTenantBillingOverview(tenantId: string): Promise<TenantBillingOverview> {
    return this.billing.getTenantBillingOverview(tenantId);
  }

  async getInvoice(id: string): Promise<InvoiceRecord> {
    const record = await this.billing.getInvoiceById(id);
    if (!record) throw new NotFoundException(`账单 ${id} 不存在`);
    return record;
  }

  async getInvoiceDetail(id: string): Promise<InvoiceDetail> {
    const record = await this.billing.getInvoiceDetail(id);
    if (!record) throw new NotFoundException(`账单 ${id} 不存在`);
    return record;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceDetail> {
    if (!input.items.length)
      throw new ConflictException("账单至少包含一个明细项");
    return this.billing.createInvoice(input);
  }

  async markAsPaid(
    id: string,
    data: { paymentMethod: string; transactionNo: string; operatorId?: string },
  ): Promise<InvoiceRecord> {
    const invoice = await this.getInvoice(id);
    if (invoice.billStatus === "paid")
      throw new ConflictException("账单已支付");
    if (invoice.billStatus === "cancelled")
      throw new ConflictException("账单已取消");

    const result = await this.billing.updateInvoiceStatus(id, {
      billStatus: "paid",
      paidAt: new Date(),
      paymentMethod: data.paymentMethod,
      transactionNo: data.transactionNo,
      ...(data.operatorId !== undefined ? { operatorId: data.operatorId } : {}),
      paidAmount: parseFloat(invoice.payableAmount),
    });
    return result!;
  }

  async cancelInvoice(
    id: string,
    operatorId?: string,
    remark?: string,
  ): Promise<InvoiceRecord> {
    const invoice = await this.getInvoice(id);
    if (invoice.billStatus === "paid")
      throw new ConflictException("已支付账单不可取消");
    if (invoice.billStatus === "cancelled")
      throw new ConflictException("账单已取消");

    const result = await this.billing.updateInvoiceStatus(id, {
      billStatus: "cancelled",
      ...(operatorId !== undefined ? { operatorId } : {}),
      ...(remark !== undefined ? { operateRemark: remark } : {}),
    });
    return result!;
  }

  async updateInvoiceStatus(
    id: string,
    input: UpdateInvoiceStatusInput,
  ): Promise<InvoiceRecord> {
    await this.getInvoice(id);
    const result = await this.billing.updateInvoiceStatus(id, input);
    return result!;
  }

  async getCreditBalance(tenantId: string): Promise<CreditRecord | null> {
    return this.billing.getCreditByTenantId(tenantId);
  }
}
