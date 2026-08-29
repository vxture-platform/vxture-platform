"use client";

/* 系统配置 — opera 目前**没有任何运营者可配的参数**（2026-08-30 核对）。
 *
 * 此前这一页是一张凭空写出来的表单：健康探测间隔 60 秒、计量聚合窗口、审计保留
 * 365 天、自动 Failover、降级通知——每个字段都是字面量默认值，没有任何东西加载
 * 它、保存它（「保存」按钮 disabled），opera-bff 里也没有 settings 表或端点。描述里
 * 断言的事实（审计保留 365 天）没有任何配置支撑，还与 console 那页写的 180 天互相
 * 矛盾。一张看起来能改、实际上什么都不连的表单，比一句「没有」更误导。
 *
 * 这一页现在只做两件事：说清楚没有可配项；把**由代码与规格定下、真实生效**的几条
 * 运行事实按只读列出来，每条给出依据文档与它生效的页面。等真有第一个可配参数
 * （有表、有端点、有加载与保存）再回到表单形态——不是先画表单等后端。
 *
 * JSX 文本里的换行只落在本来就有空格的地方：两个汉字之间断行，渲染出来是一个
 * 多余的空格。 */

import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  Icon,
  Section,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import Link from "next/link";

/* 规格正文在仓里，控制台只给出处不复制内容——复制一份就是第二个会过期的事实来源。
   仓已公开（2026-08-28），链接直达 main 上的文件；路径同时以文字给出，链接失效时
   出处仍在。 */
const SPEC_BASE =
  "https://github.com/vxture-platform/vxture-platform/blob/main/docs/20-specs/000-platform/opera";

const SPECS = {
  serviceMonitor: {
    file: "20-service-monitor.md",
    href: `${SPEC_BASE}/20-service-monitor.md`,
  },
  shellMount: {
    file: "10-shell-mount-contract.md",
    href: `${SPEC_BASE}/10-shell-mount-contract.md`,
  },
} as const;

function SpecLink({ file, href }: { file: string; href: string }) {
  return (
    <Button asChild variant="link" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <Icon name="external-link" size="sm" aria-hidden="true" />
        规格 {file}
      </a>
    </Button>
  );
}

function PageLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>{label}</Link>
    </Button>
  );
}

export default function SettingsPage() {
  return (
    <ViewLayout>
      <ViewHeader
        icon="settings"
        title="系统配置"
        description="opera 控制台自身的配置。目前没有运营者可配的参数；下面列的是由代码与规格定下的运行事实，只读。"
      />

      <Banner
        tone="info"
        title="还没有可配置项"
        description="opera-bff 没有配置表，也没有配置端点，控制台的行为全部由代码与规格决定。这一页不放表单：字段能改、保存不连，比没有更误导。第一个真正可配的参数出现时（有表、有端点、有加载与保存），再在这里开表单。"
      />

      <Section
        title="服务状态探测"
        icon="server"
        level={2}
        description="生效于「运行监控 · 服务状态」。探的是接入平台的产品线，不是平台自身的门户与 BFF。"
        action={<SpecLink {...SPECS.serviceMonitor} />}
      >
        <DetailList>
          <DetailRow
            label="探测间隔"
            actions={<PageLink href="/ops/health" label="打开服务状态" />}
          >
            30 秒；页面隐藏时停止，回到前台立即补取一次（规格 §4）。
          </DetailRow>
          <DetailRow label="存活端点（liveness）">
            <code>/api/health</code>（Next.js 前端）· <code>/healthz</code>
            （NestJS 后端）。两条路径并发探，先拿到的非 404
            响应视为命中；路径约定归 025 标准（规格 §3）。
          </DetailRow>
          <DetailRow label="就绪端点（readiness，可选）">
            <code>/api/ready</code> · <code>/readyz</code>。两条都 404
            记「未实现」，两条都连不上记「不可达」；readiness 在 025
            里是可选项，没接的产品显示「未实现」不算异常。
          </DetailRow>
          <DetailRow label="探测持久化">
            无。每次请求现探，不落库、不缓存趋势；趋势与告警不在服务状态页范围（规格
            §5）。
          </DetailRow>
        </DetailList>
      </Section>

      <Section
        title="上游模块挂载"
        icon="plugs-connected"
        level={2}
        description="Atlas 与 Runos 的管理界面都在 opera 内，经同源 /api/* 代理到各自的上游；没有任何 provider 自建的模块挂在路径下。"
        action={<SpecLink {...SPECS.shellMount} />}
      >
        <DetailList>
          <DetailRow
            label="模型管理 · Atlas"
            actions={<PageLink href="/model/services" label="打开模型服务" />}
          >
            在 opera 内实现（/model/*），经同源 <code>/api/*</code> 代理到 Atlas
            管理接口，不经 nginx 路径挂载（规格 §2）。
          </DetailRow>
          <DetailRow
            label="能力管理 · Runos"
            actions={
              <PageLink href="/capability/registry" label="打开能力注册" />
            }
          >
            同上，在 opera 内实现（/capability/*），经同源 <code>/api/*</code>{" "}
            代理到 Runos 管理接口（规格 §2）。
          </DetailRow>
          <DetailRow label="路径挂载位 /atlas/*、/runos/*">
            目前为空。联邦路径挂载仍是保留路线：将来某个 provider
            真的自建独立模块时按规格 §2
            的五步接入；现在不要据挂载位推断「已有模块挂在那里」。
          </DetailRow>
        </DetailList>
      </Section>
    </ViewLayout>
  );
}
