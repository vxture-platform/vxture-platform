/**
 * principal-no.ts — 三个主体可视码的统一展示形状(U- / T- / W-)。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 *
 * 主体码 v4「三号解耦」(2026-09-05,data_identity_200_schema §11):三个号各自独立
 * 取号、互不推导,号形 10 位 = 类别位(1 用户 / 2 租户 / 3 工作空间)+ 随机 8 位 +
 * Luhn 校验位。界面上一律带字母前缀展示,三处口径必须一致——此前是三套写法
 * (用户 `USR_ID: 1799…`、租户 `T-2765…`、工作空间裸号),前缀在此收口。
 *
 * 不分组:10 位数字整段展示,复制粘贴进工单 / 搜索框不必再剔空格(订单号一类
 * 长单号仍走各自的分组件,与本件无关)。
 */

export type PrincipalKind = "user" | "tenant" | "workspace";

const PREFIX: Record<PrincipalKind, string> = {
  user: "U",
  tenant: "T",
  workspace: "W",
};

/** `1799729056` → `U-1799729056`;空值返回 null(调用方决定占位符)。 */
export function formatPrincipalNo(
  no: string | number | null | undefined,
  kind: PrincipalKind,
): string | null {
  if (no === null || no === undefined || no === "") return null;
  return `${PREFIX[kind]}-${no}`;
}

/** 同上,空值回退到调用方给的占位符(通常是 `common.empty` 的「—」)。 */
export function formatPrincipalNoOr(
  no: string | number | null | undefined,
  kind: PrincipalKind,
  fallback: string,
): string {
  return formatPrincipalNo(no, kind) ?? fallback;
}
