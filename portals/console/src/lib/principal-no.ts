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

/**
 * 某一类主体码的展示前缀(含连字符),如 `U-`。
 *
 * 输入框要把它做成固定前置,所以需要单独取。别用 `formatPrincipalNo("", kind)` 代替:
 * 那个函数对空串返回 null,拿到的永远是调用方写死的兜底,「与展示同源」就成了空话。
 */
export function principalPrefix(kind: PrincipalKind): string {
  return `${PREFIX[kind]}-`;
}

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

/**
 * 反向:把人**粘进来的东西**规整成裸号(owner 2026-09-10)。
 *
 * 界面上一律带前缀展示(`U-1799729056`),于是复制过来的十有八九带着它;
 * 后端收的却是裸数字。不规整的话,粘贴 → 查不到 → 人以为号错了,而号是对的。
 *
 * 收得宽一点,因为人会怎么复制是不可控的:
 *   `U-1799729056` / `u-1799729056` / `U1799729056` / `1799729056`
 *   带空格、全角空格、前后换行的,也都收。
 * 但**只剔前缀与空白,不改数字**:把非数字字符一并滤掉会让「1799 729O56」
 * 这种 O/0 手误静默变成另一个号——那比查不到糟得多。
 */
export function normalizePrincipalNoInput(
  raw: string,
  kind: PrincipalKind,
): string {
  const trimmed = raw.replace(/[\s　]/g, "");
  const prefix = PREFIX[kind];
  const re = new RegExp(`^${prefix}[-_]?`, "i");
  return trimmed.replace(re, "");
}
