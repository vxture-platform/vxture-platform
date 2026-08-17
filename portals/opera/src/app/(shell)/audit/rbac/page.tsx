"use client";

/* RBAC — 不是 opera 的职责，归 admin 统一授权（2026-08-12 owner 裁定）。
 *
 * admin 与 opera 的登录鉴权同读一套 `admin.operator_role` / `operator_permission` /
 * `operator_account` 表，但账号开通（凭证/MFA 初始化）与角色权限调整统一收口在
 * admin——两个门户各开一套写路径（甚至只读镜像）去读同一张鉴权表，容易在未来
 * 演变成两套事实来源。opera 这里只出跳转入口，不自建管理面或镜像视图。 */

import {
  Banner,
  Button,
  Icon,
  Section,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import {
  buildAdminPermissionsUrl,
  buildAdminRolesUrl,
} from "@/lib/admin-entry";

function openAdmin(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function RbacPage() {
  return (
    <ViewLayout>
      <ViewHeader
        icon="role"
        title="权限管理"
        description="运营角色 × 权限 × 账号管理统一收口在 admin，opera 不重建这套鉴权面。"
      />

      <Banner
        tone="info"
        title="归属 admin：统一授权"
        description="admin 与 opera 共用同一套 admin.operator_* 鉴权表，但角色/权限/账号的管理动作（含账号开通涉及的凭证与 MFA 初始化）统一在 admin 完成，避免两个门户各开一套写路径改同一张表。"
      />

      <Section title="前往管理" icon="external-link" level={2}>
        <div className="flex flex-wrap gap-sm">
          <Button
            variant="secondary"
            onClick={() => openAdmin(buildAdminRolesUrl())}
          >
            <Icon name="role" size="sm" aria-hidden="true" />
            运营角色（admin）
          </Button>
          <Button
            variant="secondary"
            onClick={() => openAdmin(buildAdminPermissionsUrl())}
          >
            <Icon name="faders" size="sm" aria-hidden="true" />
            权限策略（admin）
          </Button>
        </div>
      </Section>
    </ViewLayout>
  );
}
