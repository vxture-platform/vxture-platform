/**
 * iconDictionary.ts - 图标名称字典
 * @package @vxture/design-ui
 *
 * 功能：按用途分组定义全部图标，`iconDictionary` 与 `IconName` 均由分组推导
 *       新增图标：在此文件对应分组和 iconRegistry.ts 中同时添加
 *       命名规则：每个语义只保留一个规范 key，不设同义别名
 *
 * 分组是**数据不是注释**：图标选择器、预览面都要按组呈现，八十多个名字平铺出来
 * 找不到东西。写成注释就只有读源码的人看得见。
 *
 * @copyright Vxture Team
 * @layer Domain
 * @category Types
 */

export const ICON_GROUPS = [
  {
    label: "导航",
    icons: [
      "home",
      "arrow-left",
      "arrow-right",
      "arrow-left-right",
      "arrow-up",
      "arrow-down",
      "arrow-long-right",
      "chevron-left",
      "chevron-right",
      "chevron-up",
      "chevron-down",
      "caret-double-up",
      "caret-double-down",
      "caret-double-left",
      "caret-double-right",
      "caret-up-down", // 表头/选择器排序指示
      "arrows-down-up", // 纵向交换/排序
      "arrow-bend-up-left", // 回复/返回上级
      "arrow-bend-up-right", // 转发
      "caret-left-bold",
      "caret-right-bold",
      "squares-four",
      "external-link", // 站外/新窗口打开
      "link",
      "sort-ascending",
      "sort-descending",
      "push-pin", // 置顶/固定
      "sidebar", // 侧栏收放
    ],
  },
  {
    label: "操作",
    icons: [
      "search",
      "app-grid",
      "settings", // 齿轮/设置（原 cog 已合并）
      "help",
      "bell",
      "more-vertical",
      "edit",
      "key",
      "lock", // 密码/机密字段
      "eye", // 明文可见（密码可见性切换）
      "eye-slash", // 明文隐藏（密码可见性切换）
      "trash", // 删除（原 delete 已合并）
      "plus", // 新增（原 add 已合并）
      "minus", // 减少；复选框半选态的指示符
      "x",
      "check",
      "copy",
      "play",
      "stop",
      "text-indent",
      "text-outdent",
      "sign-out",
      "download",
      "upload",
      "refresh",
      "undo",
      "filter",
      "share",
      "archive",
      "prohibit", // 禁用/封禁
      "pause",
      "dots-three", // 水平省略号（更多操作）
      "drag", // 拖拽手柄
      "printer",
      "power",
      "sign-in",
      "qr-code",
      "save",
      "text-t", // 文本/排版
      "list-checks", // 核对清单
      "target", // 目标/OKR
      "timer", // 时限/超时
      "percent", // 折扣/费率
    ],
  },
  {
    label: "状态",
    icons: [
      "success",
      "error",
      "warning",
      "info",
      "spinner", // 加载中
      "circle-dashed", // 待定/排队态
      "flag",
      "seal-check", // 已认证/官方
    ],
  },
  {
    label: "云服务与智能体",
    icons: [
      "agent",
      "workflow",
      "trigger",
      "database",
      "cloud",
      "plug",
      "server",
      "cube",
      "building-library",
      "cpu",
      "hard-drive",
      "rocket", // 发布/上线
      "terminal",
      "plugs-connected", // 集成已连
      "puzzle", // 插件/扩展
      "brain", // 模型能力/推理
      "magic-wand", // 一键生成/优化
      "lightning", // 快捷指令/加速
      "faders", // 参数调节/模型设置
      "package", // 交付物/制品
    ],
  },
  {
    label: "数据与内容",
    icons: [
      "chart-bar", // 图表（原 chart 已合并）
      "table",
      "code",
      "api",
      "graph",
      "lightbulb",
      "sparkles",
      "shield-check",
      "chart-line-up", // 上升趋势图表（trend-up 是行内趋势符号，本 key 是图表语义）
      "chart-pie-slice", // 单一份额强调（chart-pie=整盘构成、chart-pie-slice=单一份额）
      "tree-structure", // 组织树/流程图
      "git-branch", // 版本/分支
      "stack", // 层叠/环境
      "kanban", // 看板
    ],
  },
  {
    label: "文件与文档",
    icons: [
      "file",
      "file-text",
      "folder",
      "folder-open",
      "clipboard",
      "book-open",
      "newspaper",
      "graduation-cap", // 教程/学习中心
    ],
  },
  {
    label: "商业与账务",
    icons: [
      "credit-card",
      "receipt",
      "wallet",
      "coins",
      "currency-cny",
      "ticket", // 券/工单
      "gift",
      "scales", // 结算/对账
      "gauge", // 用量/配额仪表
      "trend-up",
      "trend-down",
      "chart-line",
      "chart-pie",
    ],
  },
  {
    label: "安全与凭证",
    icons: [
      "shield",
      "shield-warning",
      "fingerprint",
      "certificate",
      "lock-open",
    ],
  },
  {
    label: "用户与组织",
    icons: [
      "user",
      "role", // 角色/权限主体
      "user-switch",
      "buildings",
      "users", // 用户组（原 user-group 已合并）
      "medal",
      "star",
      "user-plus", // 邀请/添加成员
      "user-circle",
      "building", // 单一场所（buildings=企业/多主体，building=单一建筑）
    ],
  },
  {
    label: "通讯与联系",
    icons: [
      "mail",
      "phone",
      "wechat",
      "github",
      "linkedin",
      "chat-circle",
      "paperplane-tilt",
      "megaphone", // 公告
      "headset", // 客服/支持
      "video-camera",
      "microphone",
      "paperclip", // 附件
      "image",
      "chat-dots", // 会话进行中
      "waveform", // 语音波形
      "translate", // 翻译
    ],
  },
  {
    label: "时间与位置",
    icons: [
      "calendar", // 日历（原 calendar-days 已合并）
      "clock",
      "clock-counter-clockwise",
      "map-pin", // 地图标记（原 map-marker 已合并）
    ],
  },
  {
    label: "视图与主题",
    icons: [
      "sun",
      "moon",
      "globe",
      "corners-out", // 伪全屏展开
      "corners-in", // 伪全屏收起
      "maximize", // 原生全屏展开（ArrowsOutSimple）
      "minimize", // 原生全屏收起（ArrowsInSimple）
      "list", // 列表视图
      "rows", // 密度切换
      "device-mobile",
      "desktop",
    ],
  },
  {
    label: "反馈与互动",
    icons: ["thumbs-up", "thumbs-down"],
  },
  {
    label: "系统保留",
    icons: ["placeholder"],
  },
] as const satisfies readonly {
  readonly label: string;
  readonly icons: readonly string[];
}[];

/**
 * 全部图标名称，按分组顺序摊平。
 *
 * 分组是唯一录入处——这里不再另写一份，两份清单迟早对不上。
 */
export const iconDictionary: readonly IconName[] = ICON_GROUPS.flatMap(
  (group) => group.icons,
);

/**
 * 图标名称类型
 *
 * 由 ICON_GROUPS 推导，新增图标需同时更新本文件与 iconRegistry.ts
 */
export type IconName = (typeof ICON_GROUPS)[number]["icons"][number];
