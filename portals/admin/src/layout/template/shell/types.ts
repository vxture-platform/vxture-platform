/**
 * Shell-level shared types for the admin shell chrome.
 * 顶层视图（运营域 / 自治域，对齐 AdminWorkspaceId）与抽屉类型，
 * 供 AdminAppShell / AdminHeader / TemplateDrawer 共享。
 */

import type { AdminWorkspaceId } from "@/config/navigation";

/** 顶层视图 = 管理工作域（launcher 切换）。 */
export type ShellView = AdminWorkspaceId;

export type ShellDrawerType = "notifications" | "settings";
