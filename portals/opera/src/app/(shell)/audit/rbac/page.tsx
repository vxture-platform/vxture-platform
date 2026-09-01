"use client";

/* RBAC — 不是 opera 的职责，归 arche 治理平面统一授权（三平面拆分 2026-09-02）。
 *
 * admin / opera / arche 的登录鉴权同读一套 `admin.operator_role` / `operator_permission` /
 * `operator_account` 表，但账号开通（凭证/MFA 初始化）与角色权限调整统一收口在
 * arche 治理面——多个门户各开一套写路径（甚至只读镜像）去读同一张鉴权表，容易在
 * 未来演变成多套事实来源。opera 这里只出跳转入口，不自建管理面或镜像视图。 */

import {
  Banner,
  Button,
  Icon,
  Section,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import {
  buildArchePermissionsUrl,
  buildArcheRolesUrl,
} from "@/lib/admin-entry";

function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function RbacPage() {
  return (
    <ViewLayout>
      <ViewHeader
        icon="role"
        title="权限管理"
        description="运营角色 × 权限 × 账号管理统一收口在 arche 治理平面，opera 不重建这套鉴权面。"
      />

      <Banner
        tone="info"
        title="归属 arche 治理平面：统一授权"
        description="admin / opera / arche 共用同一套 admin.operator_* 鉴权表，但角色/权限/账号的管理动作（含账号开通涉及的凭证与 MFA 初始化）统一在 arche 治理平面完成，避免多个门户各开一套写路径改同一张表。"
      />

      <Section title="前往管理" icon="external-link" level={2}>
        <div className="flex flex-wrap gap-sm">
          <Button
            variant="secondary"
            onClick={() => openInNewTab(buildArcheRolesUrl())}
          >
            <Icon name="role" size="sm" aria-hidden="true" />
            平台角色（arche）
          </Button>
          <Button
            variant="secondary"
            onClick={() => openInNewTab(buildArchePermissionsUrl())}
          >
            <Icon name="faders" size="sm" aria-hidden="true" />
            权限策略（arche）
          </Button>
        </div>
      </Section>
    </ViewLayout>
  );
}
