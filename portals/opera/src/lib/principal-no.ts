/**
 * principal-no.ts — 三个主体可视码的统一展示形状（U- / T- / W-）。
 * @package @vxture/opera
 * @layer Application
 * @category Lib
 *
 * **实现已上提到 `@vxture-platform/shared`**（2026-09-21）。
 *
 * 此前这是**第三份**拷贝（console 一份、opera 一份、admin 一处都没有），而且三份
 * 不一样：opera 这份只认 T- / W-，`PrincipalKind` 里没有 `user`。同一件事三套写法，
 * 正是 console 那份文件当初要消灭的东西。owner 2026-09-21 实看 admin 缺 T- 前缀时
 * 一并收口。
 *
 * 本文件保留为薄再导出，opera 的 4 个调用点不用改。类型从两值放宽到三值是兼容的。
 */

export {
  principalPrefix,
  formatPrincipalNo,
  formatPrincipalNoOr,
} from "@vxture-platform/shared";
export type { PrincipalKind } from "@vxture-platform/shared";
