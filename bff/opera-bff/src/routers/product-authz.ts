/**
 * product-authz.ts — capability gate shared by every `api/products/*` router.
 * @package @vxture/bff-opera
 * @layer Application
 * @category router
 * @description
 *   `platform:product.read` / `platform:product.manage` and the two assert
 *   helpers used to live inside product-catalog.router.ts. The integration
 *   signals router (2026-08-31) is a second `api/products/:id/*` reader and
 *   must gate exactly the same way — one definition, two consumers, no
 *   second copy that can drift.
 *
 * @author AI-Generated
 * @date 2026-08-31
 */
import type { Request } from "express";
import { notEntitled, unauthenticated } from "../errors/api-error";
import type { RequestContext } from "../types/request-context";

export const PRODUCT_READ = "platform:product.read";
export const PRODUCT_MANAGE = "platform:product.manage";

/**
 * Read gate: a session plus either capability (manage implies read).
 *
 * @throws {ApiError} 401 `AUTH_NO_SESSION` / 403 `NOT_ENTITLED`
 */
export function assertCanRead(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities?.includes(PRODUCT_READ) &&
    !req.capabilities?.includes(PRODUCT_MANAGE)
  ) {
    throw notEntitled(PRODUCT_READ);
  }
}

/**
 * Write gate: a session plus the manage capability.
 *
 * @throws {ApiError} 401 `AUTH_NO_SESSION` / 403 `NOT_ENTITLED`
 */
export function assertCanManage(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities?.includes(PRODUCT_MANAGE)) {
    throw notEntitled(PRODUCT_MANAGE);
  }
}
