/**
 * Forward the current-cookie workspace projection through the trusted host bridge.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category route
 * @author AI-Generated
 * @date 2026-11-24
 */
import { portalRequest } from "../../../../lib/runtime";
export async function GET(request: Request): Promise<Response> {
  const response = await portalRequest("/api/portal/workspace", {
    signal: request.signal,
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}
