import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PgAddonRepository } from "../repository/pg-addon.repository";
import type {
  AddonPackRecord,
  AddonPurchaseRecord,
  CreateAddonOrderInput,
  DeclareAddonPaymentInput,
} from "../types/addon.types";

/**
 * Addon pack purchase orchestration (加油包自助购买闭环, owner 2026-08-20).
 * Thin layer over PgAddonRepository: maps the repo's coded errors to HTTP
 * exceptions and logs settlement outcomes. Business shape (order → offline
 * declare → operator confirm → WS-level pool grant) lives in the repository's
 * transactions; the TTL sweep is driven by platform-api's payment-expiry job.
 */
@Injectable()
export class AddonService {
  private readonly logger = new Logger(AddonService.name);

  constructor(
    @Inject(PgAddonRepository) private readonly repo: PgAddonRepository,
  ) {}

  async listPacks(): Promise<AddonPackRecord[]> {
    return this.repo.listPacks();
  }

  async listPurchases(workspaceId: string): Promise<AddonPurchaseRecord[]> {
    return this.repo.listPurchases(workspaceId);
  }

  async listPendingOps(): Promise<AddonPurchaseRecord[]> {
    return this.repo.listPendingOps();
  }

  async getByOrderNo(orderNo: string): Promise<AddonPurchaseRecord | null> {
    return this.repo.getByOrderNo(orderNo);
  }

  async createOrder(
    input: CreateAddonOrderInput,
  ): Promise<AddonPurchaseRecord> {
    try {
      const record = await this.repo.createOrder(input);
      this.logger.log(
        `addon order placed: ${record.orderNo} (${record.packCode}, ws ${record.workspaceId})`,
      );
      return record;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async declarePayment(input: DeclareAddonPaymentInput): Promise<void> {
    try {
      await this.repo.declarePayment(input);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async cancelOrder(input: {
    orderNo: string;
    tenantId: string;
    reason: string;
  }): Promise<void> {
    try {
      await this.repo.cancelOrder(input);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** Operator settlement; null = already settled (re-drive no-op). */
  async confirmPayment(input: {
    purchaseId: string;
    operatorId: string | null;
    remark?: string;
  }): Promise<AddonPurchaseRecord | null> {
    try {
      const record = await this.repo.confirmPayment(input);
      if (record) {
        this.logger.log(
          `addon order settled: ${record.orderNo} → pool ${record.quotaPoolId} (${record.metricKey} +${record.amount})`,
        );
      }
      return record;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async sweepExpiredOrders(fallbackTtlMinutes: number): Promise<number> {
    return this.repo.sweepExpiredOrders(fallbackTtlMinutes);
  }

  private mapError(err: unknown): Error {
    const code = err instanceof Error ? err.message : "";
    switch (code) {
      case "addon_pack_not_found":
        return new NotFoundException("加油包不存在或已下架");
      case "addon_order_not_found":
        return new NotFoundException("加油包订单不存在");
      case "addon_order_already_pending":
        return new ConflictException(
          "该加油包已有待支付订单,请先完成或取消原订单",
        );
      case "addon_order_not_pending":
        return new ConflictException("订单不是待支付状态");
      default:
        return err instanceof Error ? err : new Error(String(err));
    }
  }
}
