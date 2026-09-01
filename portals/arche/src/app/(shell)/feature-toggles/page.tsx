"use client";

/* 开关控制 — 占位页(PR① 脚手架)。真实页面与 arche-bff router 于 PR② 从 admin
 * 平台自治域迁入。此处不接假数据。 */

import { EmptyState, ViewHeader } from "@vxture/design-system";

export default function Page() {
  return (
    <>
      <ViewHeader
        icon="tree-structure"
        title="开关控制"
        description="特性开关的启停与灰度"
      />
      <EmptyState
        title="待 PR② 迁移"
        description="此页将从 admin 平台自治域(/feature-toggles)迁入,含页面与 arche-bff router。"
      />
    </>
  );
}
