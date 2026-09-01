"use client";

/* 个人信息 —— 运营者本人账户（三平面拆分 2026-09-02 / Phase B 收敛 2026-09-02）。
 *
 * 入口在用户弹出面板的「个人信息」。本页给**只读自视**（会话下发的身份：显示名 /
 * 邮箱 + 认证态 / 角色），写侧自助（改邮箱/通行密钥/…）统一收敛到身份层的**账户中心**
 * （accounts 门户 /account，同源 vx_sid_op 鉴权）——opera 只出跳转入口，不在本门户
 * 重建写表单（避免各门户各写一份）。 */

import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  Icon,
  Section,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { operatorAccountCenterUrl } from "@/lib/account-center";

function openAccountCenter(): void {
  window.open(operatorAccountCenterUrl(), "_blank", "noopener,noreferrer");
}

export default function PersonalInfoPage() {
  const { operator } = useOperatorSession();

  return (
    <ViewLayout>
      <ViewHeader
        icon="user"
        title="个人信息"
        description="你的运营者账户信息，与运营台同源。更改邮箱、管理通行密钥等在账户中心完成。"
      />

      {operator ? (
        <>
          {!operator.emailVerified ? (
            <Banner
              tone="warning"
              title="邮箱未验证"
              description="未验证的邮箱无法用于密码找回。请在账户中心更改并验证邮箱。"
            />
          ) : null}

          <Section title="账户" icon="user" level={2}>
            <DetailList>
              <DetailRow label="显示名">{operator.displayName}</DetailRow>
              <DetailRow label="邮箱">
                {operator.email || "未设置"}
                {operator.email ? (
                  operator.emailVerified ? (
                    <StatusBadge tone="success">已验证</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">未验证</StatusBadge>
                  )
                ) : null}
              </DetailRow>
              <DetailRow label="角色">{operator.role || "—"}</DetailRow>
            </DetailList>
          </Section>

          <Section title="账户中心" icon="external-link" level={2}>
            <div className="flex flex-col gap-sm">
              <p className="text-body-sm text-muted-foreground">
                更改邮箱、管理通行密钥等账户与安全设置，统一在账户中心完成（新标签打开）。
              </p>
              <div>
                <Button variant="secondary" onClick={openAccountCenter}>
                  <Icon name="external-link" size="sm" aria-hidden="true" />
                  前往账户中心
                </Button>
              </div>
            </div>
          </Section>
        </>
      ) : (
        <Banner
          tone="info"
          title="未登录"
          description="没有获取到当前运营者会话。请重新登录后查看个人信息。"
        />
      )}
    </ViewLayout>
  );
}
