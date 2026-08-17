"use client";

/* 变更审计 — 三个来源，一页，按 tab 切换。
 *
 * 2026-08-14 由三个独立页合并（设计文件 §5）。合并的理由只有一条：这三处回答的是
 * **同一个问题**——谁改了什么。一次合规追溯不该需要先知道那条记录躺在哪个产品的库里。
 *
 * **不做字段合并。** `change_records` / `mgmt_event` / `audit_logs` 字段形状并不相同：
 * Atlas 那份有「改动字段名」和「未归属尝试」，runos 那份有「对象版本前后」和
 * 「来源控制台」，opera 那份有「结果 + 错误码」。要合成一张表就得有映射层，而映射层
 * 会**悄悄决定哪些字段不重要**——被丢掉的恰恰常常是各自最有价值的那一列。所以这里
 * 做的是「看得到三处都在这儿」，不是假装它们是同一张表。
 *
 * **tab 顺序不是随便排的**：平台留痕在前，因为它是唯一**跨域**的一份（模型面、能力面、
 * 产品登记，凡是经过 opera 的写都在里面），是「先看哪儿」的答案；另外两个是「上游那边
 * 究竟看到了什么」的下钻，包含直连上游、绕过 opera 的写。
 *
 * **`?source=` 进地址栏**：审计场景里「把这一页发给同事」是常规动作，而 tab 状态不进
 * URL 的话发过去的永远是默认 tab。跳转壳也靠它——旧的 `/audit/atlas` 落到
 * `/audit/changes?source=atlas` 而不是让人再点一次。
 *
 * 两条运行事实流（`capability_call` / `task_outcome`）**不在这里**，在「运行监控 ·
 * 调用日志」：它们是监测信号不是问责证据，同一批一并迁走。 */

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { AtlasChangeTable } from "./AtlasChangeTable";
import { PlatformChangeTable } from "./PlatformChangeTable";
import { RunosChangeTable } from "./RunosChangeTable";

/** 与 `?source=` 的取值一一对应。 */
const SOURCES = ["platform", "atlas", "runos"] as const;
type Source = (typeof SOURCES)[number];

const SOURCE_META: Record<Source, { label: string; covers: string }> = {
  platform: {
    label: "平台 · opera",
    covers:
      "经过 opera 的每一次写，跨模型面 / 能力面 / 产品登记三个域。与 admin 共用同一张平台审计表。看不到绕过本门户直连上游做的改动。",
  },
  atlas: {
    label: "模型面 · Atlas",
    covers:
      "Atlas 收到的每一次 /capability/* 写，含直连 Atlas 做的、以及被守卫挡在 handler 之前的失败尝试。只记改了哪些字段的名字，不记改成了什么——这个面的请求体里带密钥明文。",
  },
  runos: {
    label: "能力面 · Runos",
    covers:
      "Runos 的 mgmt_event：谁、通过哪个控制台、改了什么，带对象版本前后。能力调用与任务反馈两条流是运行事实，不在这里，见「运行监控 · 调用日志」。",
  },
};

function isSource(v: string | null): v is Source {
  return v !== null && (SOURCES as readonly string[]).includes(v);
}

export default function ChangeAuditPage() {
  return (
    /* `useSearchParams` 要求边界；fallback 给 null 而不是骨架屏——这一层只解析一个
       查询参数，闪一下骨架比直接出内容更晃眼。 */
    <Suspense fallback={null}>
      <ChangeAudit />
    </Suspense>
  );
}

function ChangeAudit() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("source");
  const source: Source = isSource(raw) ? raw : "platform";

  const onChange = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params.toString());
      /* 默认 tab 不写进地址：`/audit/changes` 与 `/audit/changes?source=platform`
         是同一个东西，地址栏里少一段噪音。 */
      if (next === "platform") p.delete("source");
      else p.set("source", next);
      const qs = p.toString();
      router.replace(qs ? `/audit/changes?${qs}` : "/audit/changes", {
        scroll: false,
      });
    },
    [params, router],
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="clipboard"
        title="变更审计"
        description="谁、什么时间、改了什么。三个来源各记一部分且互相不能替代，按 tab 切换——刻意不合并成一张表，三者字段形状不同。全部只读：三处都是数据库层面的 append-only。"
      />

      <Tabs value={source} onValueChange={onChange}>
        <TabsList className="w-full justify-start">
          {SOURCES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {SOURCE_META[s].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SOURCES.map((s) => (
          <TabsContent key={s} value={s} className="flex flex-col gap-md pt-md">
            {/* 每个 tab 先说清它覆盖什么、**不**覆盖什么——三份来源的边界正是这页
                存在的理由，不写出来就只是三张长得不一样的表摆在一起。 */}
            <p className="text-body-sm text-muted-foreground">
              {SOURCE_META[s].covers}
            </p>
            {/* 未选中的 tab 不挂载：三条流各自会打上游接口，全挂等于进页面就发三个
                请求，其中两个的结果没人看。Radix 缺省即卸载未选中项。 */}
            {s === "platform" ? (
              <PlatformChangeTable />
            ) : s === "atlas" ? (
              <AtlasChangeTable />
            ) : (
              <RunosChangeTable />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </ViewLayout>
  );
}
