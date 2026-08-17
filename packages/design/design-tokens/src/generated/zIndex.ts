/**
 * zIndex.ts - 叠放次序（与 --z-index-* 同源）。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category Tokens
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-token-ts.mjs
 *   权威：scripts/design-tokens/semantic-policy.mjs
 *
 * 首选用 `z-<role>` 工具类；本表供内联 style、portal 容器等拿不到类名的场合使用。
 */

export const Z_INDEX = {
  base: 0, // 文档流基线
  raised: 10, // 同层内的轻微抬起，如 hover 卡片
  sticky: 100, // 粘性表头 / 工具栏
  overlay: 300, // 浮层遮罩
  drawer: 400, // 低于 modal——模态可从抽屉内唤起
  modal: 500, // 模态对话框
  popover: 600, // 高于 modal——气泡可用在模态内
  dropdown: 650, // 高于 popover——ActionMenu 这类 portal 化下拉菜单常挂在表格行操作上，而表格常年出现在 Drawer/Dialog 内部（如详情抽屉的行操作），下拉必须能压过触发它的任意容器；同时仍压过粘性表头。2026-08-12 由 200 上调：原值低于 drawer(400)，Drawer 内的 ActionMenu portal 后被抽屉自身盖住，点了没反应（products 页 OIDC 客户端抽屉行操作实测复现）
  toast: 700, // 全局反馈，不应被浮层遮挡
  notification: 800, // 常驻更久且可堆叠，压在 toast 之上
  tooltip: 900, // 必须最高，否则被所描述的元素遮挡
  max: 9999, // 逃生档；新增使用需在 PR 说明
} as const;

export type ZIndexRole = keyof typeof Z_INDEX;
export type ZIndexValue = (typeof Z_INDEX)[ZIndexRole];
