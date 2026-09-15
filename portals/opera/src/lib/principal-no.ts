/**
 * principal-no.ts — 主体可视码的展示形状（T- 租户 / W- 工作区）。
 * @package @vxture/opera
 * @layer Application
 * @category Lib
 *
 * owner 铁律：**任何界面不展示 UUID，一律用可视码**。主体码 v4（data_identity_200_schema
 * §11）三个号各自独立取号，10 位 = 类别位 + 随机 8 位 + Luhn；界面一律带字母前缀、不分组，
 * 复制进工单不必剔空格。
 *
 * 与 console 的 `lib/principal-no.ts` 同一口径——三个平台可以重复、不能互相引用，所以各自一份。
 */

export type PrincipalKind = "tenant" | "workspace";

const PREFIX: Record<PrincipalKind, string> = {
  tenant: "T",
  workspace: "W",
};

/** `2765014410` → `T-2765014410`；空值返回 null（调用方决定占位）。 */
export function formatPrincipalNo(
  no: string | number | null | undefined,
  kind: PrincipalKind,
): string | null {
  if (no === null || no === undefined || no === "") return null;
  return `${PREFIX[kind]}-${no}`;
}
