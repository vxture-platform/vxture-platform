import { Inject, Injectable } from "@nestjs/common";
import { PgProductSeatRepository } from "../repository/pg-product-seat.repository";
import type {
  ProductSeatGrantOutcome,
  ProductRosterScope,
  ProductRosterPage,
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

  // ============================================================================
  // Seat and authorized-user reads
  // ============================================================================

  /** 这个工作区每个被覆盖产品的上限 / 占用 / 占用者。 */
  listWorkspaceSeats(workspaceId: string): Promise<WorkspaceProductSeats[]> {
    return this.repo.listWorkspaceSeats(workspaceId);
  }

  /**
   * Read eligible identities without granting or revoking product access.
   * @param scope - Verified organization, workspace and calling product.
   * @param afterSubject - Exclusive pagination position, or null for the first page.
   * @param limit - Maximum page size validated by the caller.
   * @returns A live page, or null if the OBO reader is no longer eligible.
   * @throws Error When the live authority read fails.
   */
  listAuthorizedUsers(
    scope: ProductRosterScope,
    afterSubject: string | null,
    limit: number,
  ): Promise<ProductRosterPage | null> {
    return this.repo.listAuthorizedUsers(scope, afterSubject, limit);
  }

  /** Product entry uses the same assignments as Console and operator management. */
  hasUserAccess(input: {
    subject: string;
    orgId: string;
    workspaceId: string;
    productCode: string;
  }): Promise<boolean> {
    return this.repo.hasUserAccess(input);
  }

  // ============================================================================
  // Seat mutations
  // ============================================================================

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
