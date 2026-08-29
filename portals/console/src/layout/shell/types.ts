/**
 * Shell-level shared types for the console shell chrome.
 * 视图（应用中心 / 控制台）与抽屉类型，供 AppShell / Header / ShellDrawer 共享。
 */

export type ShellView = "appcenter" | "console";

/* 只剩通知一种：「系统设置」抽屉没有入口（header 的齿轮直接去 /settings），
 * 其内容又全是编造的值，2026-08-30 连同分支一起删。 */
export type ShellDrawerType = "notifications";
