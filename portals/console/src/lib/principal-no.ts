/**
 * principal-no.ts — 三个主体可视码的统一展示形状（U- / T- / W-）。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 *
 * **实现已上提到 `@vxture-platform/shared`**（2026-09-21）：admin 也要用同一份口径
 * ——owner 实看发现 admin 有 62 处在裸显示这三种码。各门户各抄一份，正是这个件当初
 * 要消灭的那件事。
 *
 * 本文件保留为薄再导出，console 的 11 个调用点不用改。新代码可以直接从
 * `@vxture-platform/shared` 取。
 */

export {
  principalPrefix,
  formatPrincipalNo,
  formatPrincipalNoOr,
  normalizePrincipalNoInput,
  validatePrincipalNo,
} from "@vxture-platform/shared";
export type {
  PrincipalKind,
  PrincipalNoProblem,
} from "@vxture-platform/shared";
