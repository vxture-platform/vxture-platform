"use client";

/* 审计日志 — 占位页(PR① 脚手架)。真实页面与 arche-bff router 于 PR② 从 admin
 * 平台自治域迁入。此处不接假数据。 */

import { EmptyState, ViewHeader } from "@vxture/design-system";

export default function Page() {
  return (
    <>
      <ViewHeader
        icon="clipboard"
        title="审计日志"
        description="操作员动作的全量问责流水"
      />
      <EmptyState
        title="待 PR② 迁移"
        description="此页将从 admin 平台自治域(/audit-logs)迁入,含页面与 arche-bff router。"
      />
    </>
  );
}
