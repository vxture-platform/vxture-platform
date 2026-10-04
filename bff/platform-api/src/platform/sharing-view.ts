/**
 * sharing-view.ts — request parsing for the C2 visible-set resolution API
 * (product_310 P4.3; channel spec = product_200 §3.2, storage semantics =
 * data_sharing_100 §4). Pure logic, unit-testable without Nest.
 */

import { PRODUCT_CODE_RE } from "./product-code";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VisibleSetQuery {
  workspaceId: string;
  productCode: string;
}

export function parseVisibleSetQuery(query: {
  workspace_id?: string;
  product?: string;
}): VisibleSetQuery {
  const workspaceId = query.workspace_id?.trim() ?? "";
  if (!UUID_RE.test(workspaceId)) {
    throw new Error("workspace_id must be a UUID");
  }
  const productCode = query.product?.trim() ?? "";
  if (!PRODUCT_CODE_RE.test(productCode)) {
    throw new Error("product must be a product code");
  }
  return { workspaceId, productCode };
}
