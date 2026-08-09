/**
 * tokens.ts — DI tokens for opera-bff's data plane.
 * @package @vxture/bff-opera
 *
 * Split read/write the same way admin-bff does: the RO pool can be pointed at a
 * reporting replica via REPORTING_RO_DATABASE_URL without touching write paths.
 */
export const OPERA_BFF_RO_POOL = "OPERA_BFF_RO_POOL";
export const OPERA_BFF_RW_POOL = "OPERA_BFF_RW_POOL";
