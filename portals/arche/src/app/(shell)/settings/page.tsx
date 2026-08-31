"use client";

/* 系统设置 — 占位页(PR① 脚手架)。真实页面与 arche-bff router 于 PR② 从 admin
 * 平台自治域迁入。此处不接假数据。 */

import { EmptyState, ViewHeader } from "@vxture/design-system";

export default function Page() {
  return (
    <>
      <ViewHeader
        icon="settings"
        title="系统设置"
        description="平台级通用设置"
      />
      <EmptyState
        title="待 PR② 迁移"
        description="此页将从 admin 平台自治域(/settings)迁入,含页面与 arche-bff router。"
      />
    </>
  );
}
