import { Inject, Injectable } from "@nestjs/common";
import { PgProductSeatRepository } from "../repository/pg-product-seat.repository";
import type {
  ProductSeatGrantOutcome,
  WorkspaceProductSeats,
} from "../types/product-seat.types";

/**
 * 产品席位服务（owner 2026-09-27 裁定①②）。
 *
 * 薄一层：上限判据在库里（`trg_product_seats_enforce_limit`），占用明细的组装在仓库层。
 * 这一层存在的意义是给 BFF 一个稳定的调用面——console 客户自助与 admin 运营代操作会是
 * 两个调用方，它们要问的是同一个问题。
 */
@Injectable()
export class ProductSeatService {
  constructor(
    // Explicit token: esbuild 不 emit design:paramtypes 到 BFF bundle。
    @Inject(PgProductSeatRepository)
    private readonly repo: PgProductSeatRepository,
  ) {}

  /** 这个工作区每个被覆盖产品的上限 / 占用 / 占用者。 */
  listWorkspaceSeats(workspaceId: string): Promise<WorkspaceProductSeats[]> {
    return this.repo.listWorkspaceSeats(workspaceId);
  }

  grant(input: {
    workspaceId: string;
    productId: string;
    userId: string;
    grantedBy: string | null;
  }): Promise<ProductSeatGrantOutcome> {
    return this.repo.grant(input);
  }

  revoke(input: {
    workspaceId: string;
    productId: string;
    userId: string;
    revokedBy: string | null;
  }): Promise<boolean> {
    return this.repo.revoke(input);
  }
}
