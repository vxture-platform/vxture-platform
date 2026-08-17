"use client";

/* Endpoint — Runos 没有独立的 Endpoint 列表接口（2026-08-11 读
 * vxture-runos service/src/registry/registry.controller.ts 核对）：端点永远
 * 挂在某个 capability 的某个版本下，注册（POST /capability/endpoints）与状态
 * 切换（PATCH /capability/endpoint-instances/:id/state，v0.8.0 改名）都是 capability 详情的一部分，
 * 不是独立集合——真实接口没有 `GET /capability/endpoints`，硬造一个"全局端点
 * 列表"页面等于在没有数据源的地方拼一份假列表。管理入口在 Capability 页的
 * 详情抽屉里。 */

import { Banner, Button, ViewHeader, ViewLayout } from "@vxture/design-system";
import Link from "next/link";

export default function RunosEndpointsPage() {
  return (
    <ViewLayout>
      <ViewHeader
        icon="plug"
        title="Endpoint"
        description="按能力版本登记的物理端点。"
      />
      <Banner
        tone="info"
        title="没有独立列表——在 Capability 详情里管理"
        description="Runos 真实接口里 Endpoint 永远挂在某个 Capability 的某个版本下，没有 GET /capability/endpoints 这种全局列表。注册端点、切换 active / draining / disabled 状态，都在 Capability 页点开对应能力的详情抽屉里做。"
      />
      <Link href="/capability/registry">
        <Button variant="outline">前往 Capability</Button>
      </Link>
    </ViewLayout>
  );
}
