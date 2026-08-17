/**
 * step-up.decorator.ts — 标记需要二次验证的高危路由。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * `product_250` v0.4（owner 2026-08-13）把 step-up 的**执行位**定在 console 层：
 * 判据归 platform 目录（`admin.operator_permission.requires_step_up`）、执行归
 * console/BFF、**provider 不做这个判断**——provider 无 UI 跑不了仪式，且它能看到
 * 的 `amr` 是会话级语义（"登录时用过 MFA"，可能 8 小时前），不是操作级的
 * "此刻本人在键盘前"。
 *
 * **MVP 形态（本次）：路由级静态标注。** 目录里现有的 provider 相关码
 * （`model:provider.manage` / `capability:runos.manage`）是**粗粒度**的——同一个码
 * 覆盖"改 provider 简介"（无害）与"轮换密钥"（凭证材料），整码标 step-up 会把
 * 无害编辑也卡上二次验证。M-2 要求的操作级词表归 provider 定义、尚未交回
 * （已 issue 交办 atlas#165 / runos#67），在那之前用静态标注把**该保护的那几条**
 * 先保护上。
 *
 * **目标形态：目录驱动。** 词表交回后，这里改为按路由声明的操作码查
 * `requires_step_up`，静态标注退役。届时"什么算高危"只有目录一处定义，不再散落
 * 在装饰器里——这是 M-2 的原意。
 *
 * 只标**写**路由。读路由永不 gate（identity-platform-operator.md §2.3）。
 */
import { SetMetadata } from "@nestjs/common";

export const REQUIRE_STEP_UP = "operator:require-step-up";

export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP, true);

/**
 * host-only step-up 凭证 cookie。**与 admin 的刻意不同名**
 * （admin 是 `vx_op_stepup`）：两个门户的凭证 `aud` 不同（`opera` vs `admin`），
 * 同名会让浏览器在同一父域下互相覆盖，表现为"在 admin 验过之后 opera 也放行"
 * ——那等于把两个门户的高危闸门连成一个。
 */
export function stepUpCookieName(secure: boolean): string {
  return secure ? "__Host-vx_opera_stepup" : "vx_opera_stepup";
}
