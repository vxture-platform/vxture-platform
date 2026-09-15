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
import { isPlatformSentinel } from "@/lib/visible-id";
import { knownTenant, knownWorkspace } from "./known-subjects";

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
 * 两种查不到，**分开叫**（owner 2026-09-15：「未知工作区」太模糊，要让人懂得这是什么）：
 *  - **平台哨兵**（全零 UUID）→ `SYSTEM` · 平台自检。Atlas 自检探测的消耗记在它名下，是 Atlas
 *    的运维成本，不属于任何租户。
 *  - **真实 id 但平台库里没有、已查明来历** → 按 `known-subjects.ts` 的登记显示（如「Atlas 实测」）。
 *  - **真实 id 但平台库里没有** → 「平台无此工作区」。用量记录里的主体在平台库里不存在——是
 *    主体不在，不是查询失败（查号台对软删的也照常回名字）。
 * 两种都**不退回 UUID**（owner 铁律：任何界面不展示 UUID）。
 *
 * `title`（悬停提示）给的是**可视码**，对工单用的就是它，不是 UUID。
 */
export function workspaceDisplay(
  directory: TenancyDirectory,
  workspaceId: string | null | undefined,
): { primary: string; secondary: string | null; title: string | null } | null {
  if (!workspaceId) return null;
  if (isPlatformSentinel(workspaceId)) {
    return { primary: "SYSTEM", secondary: "平台自检", title: SENTINEL_TITLE };
  }
  const entry = directory.workspaces[workspaceId];
  if (!entry) {
    const known = knownWorkspace(workspaceId);
    if (known) {
      return {
        primary: known.name,
        secondary: known.detail,
        title: known.title,
      };
    }
    return {
      primary: "平台无此工作区",
      secondary: null,
      title:
        "这条记录挂在一个平台库里不存在的工作区上——是主体不在，不是查询失败。",
    };
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

/** Atlas 自检探测记在平台哨兵名下的说明，工作区与租户两处共用。 */
const SENTINEL_TITLE =
  "Atlas 自检探测的消耗：记在平台哨兵名下，是 Atlas 的运维成本，不属于任何租户。";

/** 租户的显示形态：名字 + 可视码。平台哨兵是 SYSTEM · 平台自检，平台库里没有的是「平台无此租户」，**不退回 UUID**。 */
export function tenantDisplay(
  directory: TenancyDirectory,
  tenantId: string | null | undefined,
): { name: string; tenantNo: string | null } | null {
  if (!tenantId) return null;
  if (isPlatformSentinel(tenantId))
    return { name: "SYSTEM", tenantNo: "平台自检" };
  const entry = directory.tenants[tenantId];
  if (!entry) {
    const known = knownTenant(tenantId);
    return known
      ? { name: known.name, tenantNo: known.detail }
      : { name: "平台无此租户", tenantNo: null };
  }
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
