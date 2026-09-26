/**
 * product-seat.types.ts — 产品席位的读写形状
 * @package @vxture/service-subscription
 * @layer Domain
 * @category Types
 */

/** 当前占着某产品席位的一个人。 */
export interface ProductSeatHolder {
  userId: string;
  userNo: string;
  /** 优先档案里的显示名，回落到登录账号。 */
  displayName: string | null;
  grantedAt: string;
}

/** 一个工作区里某个**被订阅覆盖的产品**的席位实况。 */
export interface WorkspaceProductSeats {
  productId: string;
  productCode: string;
  productName: string;
  /** 此刻覆盖这个产品的订阅（授予时由库现算，这里只用于展示溯源）。 */
  subscriptionId: string;
  /** -1 = 无限（目录哨兵）；null = 读不到，界面显示「—」不显示 0。 */
  seatMax: number | null;
  occupied: number;
  holders: ProductSeatHolder[];
}

/**
 * 指派席位的结果。失败原因分四种，**每一种对应一句不同的话**——合成一句「指派失败」
 * 会把「席位满了」「他已经有了」「这个产品没订阅」「他不在这个工作区」说成同一件事。
 */
export type ProductSeatGrantOutcome =
  | { ok: true; seatId: string }
  | {
      ok: false;
      reason:
        | "seat_limit_reached"
        | "already_granted"
        | "product_not_covered"
        | "not_a_member";
    };
