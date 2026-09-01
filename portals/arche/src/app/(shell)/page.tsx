"use client";

/* 治理总览 — Arche 平台治理平面首页。
 *
 * 各治理页(身份权限/安全审计/系统配置/通知审计)已从 admin 平台自治域迁入并上线
 * (三平面拆分 cutover,2026-09-02);本页为入口聚合。真实治理仪表(当前态与待办)
 * 待有真数据源再接——此处不接假数据,一个显示虚构数字的治理台是误导不是功能。 */

import { EntryCard, ViewHeader } from "@vxture/design-system";

export default function GovernanceOverviewPage() {
  return (
    <>
      <ViewHeader
        icon="squares-four"
        title="治理总览"
        description="平台身份权限、安全审计、风控合规与系统配置的入口。最高信任层,与商业(admin)、运维(opera)两面分立。"
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
          meta="通知审计"
          description="系统通知的投递流水与状态"
        />
      </div>
    </>
  );
}
