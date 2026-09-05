/**
 * index.ts - Vxture Core Utilities Package
 * @package @vxture/core-utils
 * @description
 *   Platform-level utilities for Vxture, including logging and error handling.
 */

// ============================================
// Utils Types
// ============================================

export type {
  Maybe,
  Nullable,
  Optional,
  Class,
  FunctionType,
  DeepPartial,
  DeepReadonly,
  LogRecord,
  LoggerConfig,
} from "./types/utils.types";
export { LogLevel, DEFAULT_LOGGER_CONFIG } from "./types/utils.types";

// ============================================
// Utils Functions & Classes
// ============================================

export {
  getNodeEnv,
  isProduction,
  isDevelopment,
  isTest,
  isStaging,
  isNode,
  isBrowser,
  VxLogger,
  logger,
  isString,
  isNumber,
  isBoolean,
  isFunction,
  isSymbol,
  isDefined,
  isNotNull,
  isPresent,
  isObject,
  isArray,
  isEmptyObject,
  isEmptyArray,
  isNonEmptyString,
  isValidUrl,
  isUuid,
  normalizePhoneNumber,
  toE164,
  DEFAULT_PHONE_COUNTRY,
  extractClientIp,
  chooseDevFallback,
} from "./utils";

export type {
  NormalizedPhone,
  ClientIpRequest,
  DevFallbackChoice,
} from "./utils";

// ============================================
// Product Taxonomy (product_type 单一权威源)
// ============================================

export {
  PRODUCT_TYPES,
  PRODUCT_TYPE_DEFS,
  isValidProductType,
  productTypeFamily,
  productTypeLabel,
} from "./product-taxonomy";
export type {
  ProductType,
  ProductTypeFamily,
  ProductTypeDef,
} from "./product-taxonomy";

// ============================================
// Industry Taxonomy (租户所属行业 自定义清单单一权威源)
// ============================================

export {
  INDUSTRIES,
  INDUSTRY_DEFS,
  industryLabel,
  isValidIndustry,
} from "./industry-taxonomy";
export type { Industry, IndustryDef } from "./industry-taxonomy";

// ============================================
// Release Stage (product 成熟度轴单一权威源)
// ============================================

export {
  RELEASE_STAGES,
  RELEASE_STAGE_DEFS,
  isValidReleaseStage,
  releaseStageLabel,
  isReleaseStageSubscribable,
} from "./release-stage";
export type { ReleaseStage, ReleaseStageDef } from "./release-stage";

// ============================================
// Tenant console permission catalog (customer realm 治理 RBAC 的代码侧镜像)
// ============================================

export {
  TENANT_PERMISSION_CODES,
  WORKSPACE_PERMISSION_CODES,
  TENANT_ROLE_CODES,
  TENANT_MENU_CODES,
  TENANT_MENU_TREE,
  TENANT_MENU_BY_ROUTE,
  TENANT_PERMISSION_PAGE,
  TENANT_PERMISSION_DEFS,
  isTenantPermissionCode,
  isGovernancePermissionCode,
  capabilitySatisfies,
  hasCapability,
  hasAnyCapability,
} from "./tenant-permissions";
export type {
  TenantPermissionCode,
  WorkspacePermissionCode,
  GovernancePermissionCode,
  TenantPermissionCategory,
  TenantPermissionDef,
  TenantRoleCode,
  TenantMenuCode,
  TenantMenuNode,
} from "./tenant-permissions";
