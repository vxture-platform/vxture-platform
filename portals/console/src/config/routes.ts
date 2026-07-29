import type { BreadcrumbItem } from "@/entities/console";

const routeLabels = new Map<string, string>([
  ["/", "dashboard"],
  ["/todos", "todos"],
  ["/profile", "profile"],
  ["/personal-tenant", "personalTenant"],
  ["/organization", "organization"],
  ["/members", "members"],
  ["/roles", "roles"],
  ["/invitations", "invitations"],
  ["/subscription", "subscription"],
  ["/billing", "billing"],
  ["/quotas", "quotas"],
  ["/atlas", "atlas"],
  ["/notifications", "notifications"],
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
