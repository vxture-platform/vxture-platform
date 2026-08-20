import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PgReceiptRepository } from "../repository/pg-receipt.repository";
import type {
  ApplyInvoiceReceiptInput,
  BillingAddressRecord,
  InvoiceReceiptRecord,
  UpsertBillingAddressInput,
} from "../types/receipt.types";

/**
 * Customer-side invoicing (发票) orchestration — 抬头簿 + 申请开票。Thin over
 * PgReceiptRepository: input shape checks + coded-error → HTTP mapping.
 * The operator side (admin 发票台账/开具/寄送, already live) owns every
 * transition after 'applying'.
 */
@Injectable()
export class InvoiceReceiptService {
  private readonly logger = new Logger(InvoiceReceiptService.name);

  constructor(
    @Inject(PgReceiptRepository) private readonly repo: PgReceiptRepository,
  ) {}

  async listAddresses(tenantId: string): Promise<BillingAddressRecord[]> {
    return this.repo.listAddresses(tenantId);
  }

  async createAddress(
    input: UpsertBillingAddressInput,
  ): Promise<BillingAddressRecord> {
    this.assertAddressShape(input);
    return this.repo.createAddress(input);
  }

  async updateAddress(
    id: string,
    input: UpsertBillingAddressInput,
  ): Promise<BillingAddressRecord> {
    this.assertAddressShape(input);
    const record = await this.repo.updateAddress(id, input);
    if (!record) throw new NotFoundException("开票抬头不存在");
    return record;
  }

  async setDefaultAddress(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const ok = await this.repo.setDefaultAddress(id, tenantId, userId);
    if (!ok) throw new NotFoundException("开票抬头不存在");
  }

  async deleteAddress(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const ok = await this.repo.deleteAddress(id, tenantId, userId);
    if (!ok) throw new NotFoundException("开票抬头不存在");
  }

  async listReceipts(tenantId: string): Promise<InvoiceReceiptRecord[]> {
    return this.repo.listReceipts(tenantId);
  }

  async applyReceipt(
    input: ApplyInvoiceReceiptInput,
  ): Promise<InvoiceReceiptRecord> {
    try {
      const record = await this.repo.applyReceipt(input);
      this.logger.log(
        `invoice receipt applied: ${record.invoiceNo} (bill ${record.billNo ?? record.billId}, ${record.invoiceType})`,
      );
      return record;
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      switch (code) {
        case "receipt_bill_not_found":
          throw new NotFoundException("账单不存在");
        case "receipt_bill_not_paid":
          throw new ConflictException("账单尚未结清,暂不可开票");
        case "receipt_already_applied":
          throw new ConflictException("该账单已有开票申请,请勿重复提交");
        case "receipt_address_not_found":
          throw new NotFoundException("开票抬头不存在");
        case "receipt_type_mismatch":
          throw new BadRequestException(
            "发票类型与抬头类型不匹配(专票须用增值税专用抬头)",
          );
        case "receipt_special_needs_tax_no":
          throw new BadRequestException(
            "专票抬头缺少税号或开户信息,请先补全抬头",
          );
        default:
          throw err;
      }
    }
  }

  /** 抬头形状校验:专票强制税号 + 开户信息(申请时二次校验兜底)。 */
  private assertAddressShape(input: UpsertBillingAddressInput): void {
    if (!input.title.trim()) throw new BadRequestException("抬头不能为空");
    if (input.invoiceTaxType === "special") {
      if (!input.taxNo?.trim())
        throw new BadRequestException("专票抬头必须填写税号");
      if (!input.bankName?.trim() || !input.bankAccount?.trim()) {
        throw new BadRequestException("专票抬头必须填写开户行与账号");
      }
    }
  }
}
