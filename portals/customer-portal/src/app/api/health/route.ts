/**
 * Process liveness without claiming backend readiness.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category route
 * @author AI-Generated
 * @date 2026-11-15
 */
export function GET() {
  return Response.json({ status: "ok", service: "customer-portal" });
}
