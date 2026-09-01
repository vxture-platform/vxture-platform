"use client";

/* 个人信息 —— 运营者本人账户自助（三平面拆分 2026-09-02）。
 *
 * 入口在用户弹出面板的「个人信息」。opera 侧目前是**只读自视**：显示会话里下发的
 * 身份（显示名 / 邮箱 + 认证态 / 角色），字段与 admin `OperatorAccountSettings` 同源
 * （`admin.operator_account`，经 access_token claims 下发）。
 *
 * opera-bff 尚无运营者自助的写端点（改邮箱/手机/密码/MFA），故本页不放会 404 的写
 * 表单——一张能改、保存不连的表单比只读更误导（同 /settings 的判据）。写侧自助补齐
 * （统一到身份层的 operator-self 端点）后再开表单。 */

import {
  Banner,
  DetailList,
  DetailRow,
  Section,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";

export default function PersonalInfoPage() {
  const { operator } = useOperatorSession();

  return (
    <ViewLayout>
      <ViewHeader
        icon="user"
        title="个人信息"
        description="你的运营者账户信息，与运营台同源。"
      />

      {operator ? (
        <>
          {!operator.emailVerified ? (
            <Banner
              tone="warning"
              title="邮箱未验证"
              description="未验证的邮箱无法用于密码找回。邮箱更改与验证请在运营台（admin）的账户设置中完成。"
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
