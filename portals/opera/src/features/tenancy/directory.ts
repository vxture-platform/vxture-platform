/**
 * directory.ts — 租户 / 工作区查号台，以及**工作区怎么显示**这条全局规则。
 * @package @vxture/opera
 * @layer Presentation
 *
 * ## 规则：工作区一律以租户为主导
 *
 * owner 2026-08-14 定，来自实测：几乎每个租户都只有一个工作区，且名字清一色是
 * `Default` / `默认工作空间`。**单独显示工作区名，一屏会得到几十行一模一样的字**
 * ——比显示 uuid 更糟，因为 uuid 至少看得出彼此不同，而重复的名字看起来像是已经
 * 区分开了。
 *
 * 所以工作区在**任何**场景下都是「租户名 · 工作区名」，租户在前。数据模型上
 * tenant → workspace 是 1:N，实际长期是 1:1，兼容按 1:N 处理但显示按"租户为主、
 * 工作区为限定"来排。
 *
 * 这条规则集中在这里而不是每页各写一遍：拼接一旦下放到调用方，就会有人少拼一次，
 * 那一页立刻退化成"全是默认工作空间"，而且看起来完全正常。
 *
 * 查号台本身读平台的 `tenancy.*`（opera-bff `/api/tenancy/directory`）。Atlas 的
 * reqlog 和 runos 的审计流里存的都是裸 uuid，它们自己也不知道这些 id 叫什么名字
 * ——租户目录是平台的东西，跨库松引用，不是外键。
 */

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatPrincipalNo } from "@/lib/principal-no";

export interface WorkspaceEntry {
  id: string;
  name: string;
  /** 工作区可视码。 */
  workspaceNo: string;
  tenantId: string;
  /** 租户名（org_name）——显示时的主导部分。 */
  tenantName: string;
  tenantNo: string;
}

export interface TenantEntry {
  name: string;
  tenantNo: string;
}

export interface TenancyDirectory {
  /** tenantId → 租户名与可视码。 */
  tenants: Readonly<Record<string, TenantEntry>>;
  /** workspaceId → 工作区条目（**含租户**）。 */
  workspaces: Readonly<Record<string, WorkspaceEntry>>;
}

const EMPTY: TenancyDirectory = { tenants: {}, workspaces: {} };

/**
 * 按 id 批量查名字与可视码。**查不到不抛错**：名字是让表可读的增益，不是数据本身，
 * 读不到不该让整页打不开——但也**不退回显示 id**：id 是 UUID，owner 铁律是任何界面不展示
 * UUID。查不到就说「未知租户 / 未知工作区」。
 *
 * 传进来的数组每次渲染都是新引用，所以内部按排序后的字符串做依赖，避免重复请求。
 */
export function useTenancyDirectory(
  tenantIds: readonly string[],
  workspaceIds: readonly string[],
): TenancyDirectory {
  const [directory, setDirectory] = useState<TenancyDirectory>(EMPTY);

  const tenantKey = [...new Set(tenantIds)].sort().join(",");
  const workspaceKey = [...new Set(workspaceIds)].sort().join(",");

  useEffect(() => {
    if (tenantKey === "" && workspaceKey === "") return;
    const p = new URLSearchParams();
    if (tenantKey) p.set("tenantIds", tenantKey);
    if (workspaceKey) p.set("workspaceIds", workspaceKey);

    let cancelled = false;
    void api
      .get<{
        tenants: { id: string; name: string; tenantNo: string }[];
        workspaces: WorkspaceEntry[];
      }>(`/api/tenancy/directory?${p.toString()}`)
      .then((d) => {
        if (cancelled) return;
        setDirectory({
          tenants: Object.fromEntries(
            d.tenants.map((t) => [
              t.id,
              { name: t.name, tenantNo: t.tenantNo },
            ]),
          ),
          workspaces: Object.fromEntries(d.workspaces.map((w) => [w.id, w])),
        });
      })
      .catch(() => {
        /* 保持空表：所有行显示「未知租户 / 未知工作区」，不退回 id。 */
      });
    return () => {
      cancelled = true;
    };
  }, [tenantKey, workspaceKey]);

  return directory;
}

/**
 * 工作区的显示形态：**租户主导，工作区限定**。
 *
 * `primary` 是租户名，`secondary` 是工作区名——调用方按自己的版面决定是上下两行
 * 还是一行斜杠分隔，但**顺序不由调用方决定**。
 *
 * 查不到时 `primary` 是「未知工作区」、`secondary` 为空、`title` 为空。此前退回 workspaceId
 * 本身，理由是「显示一个 id 是诚实的"我不知道它叫什么"」——但那个 id 是 UUID，违反 owner 铁律
 * （任何界面不展示 UUID）。「未知工作区」同样诚实，而且不假装知道它叫什么。
 *
 * `title`（悬停提示）给的是**可视码**，对工单用的就是它，不是 UUID。
 */
export function workspaceDisplay(
  directory: TenancyDirectory,
  workspaceId: string | null | undefined,
): { primary: string; secondary: string | null; title: string | null } | null {
  if (!workspaceId) return null;
  const entry = directory.workspaces[workspaceId];
  if (!entry) {
    return { primary: "未知工作区", secondary: null, title: null };
  }
  return {
    primary: entry.tenantName,
    secondary: entry.name,
    title: [
      `${entry.tenantName} · ${entry.name}`,
      formatPrincipalNo(entry.tenantNo, "tenant"),
      formatPrincipalNo(entry.workspaceNo, "workspace"),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** 租户的显示形态：名字 + 可视码。查不到是「未知租户」，**不退回 UUID**。 */
export function tenantDisplay(
  directory: TenancyDirectory,
  tenantId: string | null | undefined,
): { name: string; tenantNo: string | null } | null {
  if (!tenantId) return null;
  const entry = directory.tenants[tenantId];
  if (!entry) return { name: "未知租户", tenantNo: null };
  return {
    name: entry.name,
    tenantNo: formatPrincipalNo(entry.tenantNo, "tenant"),
  };
}

/** 一行式写法，用于表格里放不下两行的格子、以及 CSV 导出。 */
export function workspaceLabel(
  directory: TenancyDirectory,
  workspaceId: string | null | undefined,
): string {
  const d = workspaceDisplay(directory, workspaceId);
  if (!d) return "—";
  return d.secondary ? `${d.primary} · ${d.secondary}` : d.primary;
}
