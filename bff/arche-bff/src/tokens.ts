/**
 * tokens.ts — DI tokens for arche-bff's data plane.
 * @package @vxture/bff-arche
 *
 * Split read/write the same way admin-bff does: the RO pool can be pointed at a
 * reporting replica via REPORTING_RO_DATABASE_URL without touching write paths.
 */
export const ARCHE_BFF_RO_POOL = "ARCHE_BFF_RO_POOL";
export const ARCHE_BFF_RW_POOL = "ARCHE_BFF_RW_POOL";
