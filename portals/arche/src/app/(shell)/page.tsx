"use client";

/* 治理总览 — Arche 平台治理平面首页。
 *
 * PR① 阶段:本页只立信息架构与入口。真实治理仪表(账号/角色/审计/合规的当前态与
 * 待办)在 PR② 随各页从 admin 平台自治域迁入后接入。此处不接假数据——一个显示
 * 虚构数字的治理台在运营者面前是误导不是功能。 */

import { Banner, EntryCard, ViewHeader } from "@vxture/design-system";

export default function GovernanceOverviewPage() {
  return (
    <>
      <ViewHeader
        icon="squares-four"
        title="治理总览"
        description="平台身份权限、安全审计、风控合规与系统配置的入口。最高信任层,与商业(admin)、运维(opera)两面分立。"
      />
      <Banner
        tone="info"
        title="脚手架阶段"
        description="治理各页将于 PR② 从 admin 平台自治域迁入(页面与 arche-bff router 一并搬入)。当前为占位入口。"
      />
      <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
        <EntryCard
          href="/admins"
          icon="fingerprint"
          title="平台用户"
          meta="身份权限"
          description="内部运营账号的开通、停用与凭证"
        />
        <EntryCard
          href="/roles"
          icon="role"
          title="平台角色"
          meta="身份权限"
          description="操作角色与其 rank"
        />
        <EntryCard
          href="/permissions"
          icon="list-checks"
          title="权限策略"
          meta="身份权限"
          description="域 / 板块 / 页面 / 操作四级权限树"
        />
        <EntryCard
          href="/audit-logs"
          icon="clipboard"
          title="审计日志"
          meta="安全审计"
          description="操作员动作的全量问责流水"
        />
        <EntryCard
          href="/risk-records"
          icon="shield-check"
          title="风险记录"
          meta="安全审计"
          description="风控命中与处置"
        />
        <EntryCard
          href="/compliance-events"
          icon="certificate"
          title="合规事件"
          meta="安全审计"
          description="合规义务事件与留痕"
        />
        <EntryCard
          href="/settings"
          icon="settings"
          title="系统设置"
          meta="系统配置"
          description="平台级通用设置、参数与开关"
        />
        <EntryCard
          href="/notification-logs"
          icon="terminal"
          title="发送记录"
          meta="通知基座"
          description="系统通知的投递流水与状态"
        />
      </div>
    </>
  );
}
