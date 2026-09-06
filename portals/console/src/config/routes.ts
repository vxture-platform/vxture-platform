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
  // 批 9:邀请记录与角色管理成为成员管理的二级页;面包屑最后一节要有名字,
  // 别显示 "invitations" / "roles"
  ["/members/invitations", "membersInvitations"],
  ["/members/roles", "membersRoles"],
  // 旧路由保留跳转,面包屑在跳转那一帧仍有名字
  ["/roles", "roles"],
  ["/invitations", "invitations"],
  ["/subscription", "subscription"],
  ["/billing", "billing"],
  ["/vouchers", "vouchers"],
  ["/quotas", "quotas"],
  ["/quotas/addon-pay", "addonPay"],
  ["/usage", "usage"],
  ["/atlas", "atlas"],
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
