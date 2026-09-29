/**
 * Shell-level shared types for the console shell chrome.
 * 视图（应用中心 / 控制台）与抽屉类型，供 AppShell / Header / ShellDrawer 共享。
 */

export type ShellView = "appcenter" | "console";

/* 两种：通知与帮助。
 *
 * 「系统设置」抽屉曾是第三种，2026-08-30 连同分支一起删（header 的齿轮直接去
 * /settings，那一支没有任何入口，内容又全是编造的值）。
 *
 * 「帮助」是 2026-09-29 加的：顶栏那颗「?」在此之前 onClick 是空函数，
 * owner 第 5 条裁决把它定成一个抽屉（列未关闭的工单与各自最后一次动静）。
 * 它**不承载已读**——已读只在消息中心一处，见 `HelpDrawer` 的文件头。 */
export type ShellDrawerType = "notifications" | "help";
