/**
 * Process liveness and explicit integration readiness.
 * @package @vxture/workbench
 * @layer Presentation
 * @category route
 * @author AI-Generated
 * @date 2026-11-05
 */
export const dynamic = "force-dynamic";

/**
 * Report readiness without exposing internal upstream addresses.
 * @returns Liveness plus configuration readiness, never inferred auth health.
 */
export function GET(): Response {
  return Response.json({
    status: "ok",
    service: "workbench",
    configured: {
      auth:
        Boolean(process.env.WORKBENCH_BFF_PROXY_URL) ||
        process.env.WORKBENCH_SAME_ORIGIN_BFF === "1",
      catalog:
        Boolean(process.env.WORKBENCH_CATALOG_PROXY_URL) ||
        process.env.WORKBENCH_SAME_ORIGIN_CATALOG === "1",
    },
  });
}
