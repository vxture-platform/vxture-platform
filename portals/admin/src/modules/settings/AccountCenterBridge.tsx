"use client";

/* 账户中心入口 —— Phase B 收敛（2026-09-02）。
 *
 * 运营者账户自助（改邮箱/通行密钥等）统一收敛到身份层 accounts 门户的账户中心;admin
 * 原来的内嵌邮箱自助（OperatorAccountSettings + admin-bff `operator/contact` 代理）随之
 * 退役。本页只出跳转入口（新标签打开,同源 vx_sid_op 已认证）。 */

import { Button, Icon } from "@vxture/design-system";
import { operatorAccountCenterUrl } from "@/lib/account-center";

export function AccountCenterBridge() {
  return (
    <div className="flex flex-col gap-md p-lg">
      <h2 className="text-title-sm font-semibold">账户中心</h2>
      <p className="text-body-sm text-muted-foreground">
        账户与安全设置（更改并验证邮箱、管理通行密钥等）已统一到账户中心，admin
        / opera / arche 共用同一处，改一次处处生效（新标签打开）。
      </p>
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            window.open(
              operatorAccountCenterUrl(),
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          <Icon name="external-link" size="sm" aria-hidden="true" />
          前往账户中心
        </Button>
      </div>
    </div>
  );
}
