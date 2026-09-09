import type { BreadcrumbItem } from "@/entities/console";

const routeLabels = new Map<string, string>([
  ["/", "dashboard"],
  ["/todos", "todos"],
  ["/inbox", "inbox"],
  ["/profile", "profile"],
  ["/tenant", "tenant"],
  ["/tenant/verification", "tenantVerification"],
  // 提交与结果拆两页(owner 2026-09-06):面包屑最后一节要有名字,别显示 "apply"
  ["/tenant/verification/apply", "tenantVerificationApply"],
  // 旧路由保留跳转,面包屑在跳转那一帧仍有名字
  ["/personal-tenant", "personalTenant"],
  ["/organization", "organization"],
  ["/members", "members"],
  ["/workspaces", "workspaces"],
  // 批 9:邀请记录 / 角色管理 / 权限管理都是成员管理的二级页;面包屑最后一节
  // 要有名字,别显示 "invitations" / "roles" / "permissions"
  ["/members/invitations", "membersInvitations"],
  ["/members/roles", "membersRoles"],
  ["/members/permissions", "membersPermissions"],
  // 旧路由保留跳转,面包屑在跳转那一帧仍有名字
  ["/roles", "roles"],
  ["/invitations", "invitations"],
  ["/subscription", "subscription"],
  ["/billing", "billing"],
  // 发票与抬头是费用中心的二级页(owner 2026-09-06);面包屑最后一节要有名字
  ["/billing/invoices", "billingInvoices"],
  ["/vouchers", "vouchers"],
  ["/quotas", "quotas"],
  // 加油包支付页 2026-09-08 迁到费用中心;旧地址保留跳转,
  // 面包屑在跳转那一帧仍要有名字(与 /roles、/invitations 同体例)
  ["/quotas/addon-pay", "addonPay"],
  ["/billing/addon-pay", "addonPay"],
  ["/usage", "usage"],
  ["/notifications", "notifications"],
  ["/audit-logs", "auditLogs"],
  ["/security", "security"],
  ["/settings", "settings"],
  ["/tenant-settings", "tenantSettings"],
]);

export function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ href: "/", label: "dashboard" }];
  }

  const breadcrumbs: BreadcrumbItem[] = [{ href: "/", label: "dashboard" }];
  let currentPath = "";

  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`;
    breadcrumbs.push({
      href: currentPath,
      label: routeLabels.get(currentPath) ?? segment,
    });
  }

  return breadcrumbs;
}
