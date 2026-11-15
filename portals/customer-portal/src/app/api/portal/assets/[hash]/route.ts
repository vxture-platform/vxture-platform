/**
 * Same-origin access to assets referenced by the currently published portal version.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category route
 * @author AI-Generated
 * @date 2026-11-15
 */
import { portalRequest } from "../../../../../lib/runtime";

export async function GET(
  _request: Request,
  route: { params: Promise<{ hash: string }> },
): Promise<Response> {
  const { hash } = await route.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response(null, { status: 404 });
  const response = await portalRequest(`/api/portal/assets/${hash}`);
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
