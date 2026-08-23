/**
 * state.ts — Atlas 对象状态语汇的门户入口。
 * @package @vxture/opera
 * @layer Presentation
 *
 * **实现已迁到 `@vxture-platform/shared`**（`constants/atlas-state.constants.ts`）。
 * 本文件只做转出，理由是这套判断有**两个门户**在读（opera 与 admin），而它的核心是一句
 * 会被读错的话——「`deprecated` 仍可解析、只是不再推荐」。同一个字段被两处各判一次，
 * 迟早有一处判反，而判反的表现是界面正常、结论悄悄错。
 *
 * 保留这一层薄转出而不是让页面直接 import 共享包：页面里 `@/features/atlas/...` 是
 * atlas 域的统一入口（旁边就是 `lifecycle.ts`），少一次"这个到底从哪儿来"的追问。
 */

export {
  isEnabled,
  isServing,
  isInForce,
  type ObjectState,
  type ModelState,
  type KeyState,
} from "@vxture-platform/shared";
