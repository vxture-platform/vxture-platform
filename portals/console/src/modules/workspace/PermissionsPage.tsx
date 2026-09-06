"use client";

/**
 * PermissionsPage.tsx — 权限管理(成员管理的二级页)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 路由 `/members/permissions`。批 9(owner 2026-09-06):角色管理与权限管理拆成
 * 两个二级页——角色页答「有哪些角色」,本页答「有哪些权限、哪个角色有」。此前两问
 * 挤在一屏(一张角色目录 + 一张权限矩阵),矩阵又长,角色目录被压在最上面几行。
 *
 * **呈现照治理平面既有的那两页**(owner 2026-09-06「全面参考」,
 * `portals/arche/src/modules/admin-permissions/AdminPermissionsPage.tsx`):
 *   · 树拍平成表——层级由缩进 + `L{depth}` 徽章表达,表头 / 骨架 / 空态交给 DataTable;
 *   · 展开收起是行首的 ghost 按钮,没有子级就禁用;
 *   · 主辅信息走 `TableTitleCell`,权限类型是**类目不是严重度**,用色只为在一棵深树里分得开;
 *   · 筛选行 = 搜索 + 类型 + 重置,命中子节点时连祖先一起留下(不然结果没有上下文)。
 * 不搬的是写侧(新建 / 编辑 / 停用 + step-up):权限目录由平台统一定义,租户改不了,
 * DB 层就不成立(permissions 无 tenant_id,data_identity_200 §6/§13)。所以本页**只读**。
 *
 * 矩阵的行 = 权限目录(`access.permissions`)的树:板块 → 页面 → 操作码,与侧栏
 * 信息架构同构;没有操作码的页面标「成员均可见」。列 = 五个角色 ✓。
 * 治理 RBAC ≠ 业务授权(铁律):本页只解释「谁能做哪些治理动作」,产品内的功能
 * 权限由产品按订阅档位自行门控。本页由 tenant.member.read 门控。
 *
 * 角色的图标、显示名与固定序都走 `components/role-tag`(owner 2026-09-06:角色一律
 * icon + 名);权限点的名字在本页词条里。矩阵的列头用轻量版(图标 + 名,不套贴标)
 * ——五个角色列各塞一枚贴标会把表头撑成两倍高。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  IconName,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  TENANT_PERMISSION_CODES,
  WORKSPACE_PERMISSION_CODES,
} from "@vxture/core-utils";
import { RoleHeaderLabel, roleRank } from "@/components/role-tag";
import { fetchTenantPermissions, fetchTenantRoles } from "@/api/console-bff";
import { consoleDomains } from "@/config/navigation";
import type {
  TenantPermissionRecord,
  TenantRoleRecord,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection, SignalList } from "@/layout/shell";

/** 目录里的操作码(权威在 core-utils);角色的图标、显示名与排序归 components/role-tag。 */
const KNOWN_PERMS = new Set<string>([
  ...TENANT_PERMISSION_CODES,
  ...WORKSPACE_PERMISSION_CODES,
]);

/** 页面路由 → 侧栏词条键(与导航同一份标签,不再为本页另写一套名字)。 */
const PAGE_LABEL_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  consoleDomains.flatMap((d) =>
    d.sections.flatMap((s) => s.items.map((it) => [it.href, it.labelKey])),
  ),
);
/** 板块菜单码 → 侧栏分组词条键(tenant.menu.account_tenant → accountTenant)。 */
function sectionKeyOf(code: string): string {
  return code
    .replace(/^tenant\.menu\./, "")
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

type RowKind = "section" | "page" | "perm" | "group";
type KindFilter = "all" | "page" | "perm";

/**
 * 行的类目 → 语气与图标。三者是**类目**不是严重度(与治理平面的 `PERM_TYPE_TONE`
 * 同一判断):用色只为在一棵深树里一眼分开板块、页面与操作码。
 */
const KIND_META: Record<
  RowKind,
  { tone: StatusBadgeTone; icon: IconName; labelKey: string }
> = {
  section: { tone: "brand", icon: "squares-four", labelKey: "kind.section" },
  page: { tone: "info", icon: "table", labelKey: "kind.page" },
  perm: { tone: "warning", icon: "key", labelKey: "kind.perm" },
  group: { tone: "neutral", icon: "info", labelKey: "kind.group" },
};

/**
 * 层级缩进:深度 → 左内距类。
 *
 * 定长表而不是算出来的值:内联 style 承载间距会被 `ds/no-inline-design-style` 拦,
 * `ps-[Nrem]` 会被 `ds/no-app-tailwind-arbitrary-scale` 拦(与治理平面同一处理)。
 */
const DEPTH_INDENT = ["ps-0", "ps-md", "ps-lg", "ps-xl"] as const;
function depthIndentClass(depth: number) {
  return DEPTH_INDENT[Math.min(Math.max(depth, 0), DEPTH_INDENT.length - 1)];
}

interface MatrixNode {
  key: string;
  kind: RowKind;
  code: string;
  label: string;
  depth: number;
  /** 页面没有操作码:任何成员可见。 */
  openToAll: boolean;
  /** 搜索用的一行文本(码 + 名 + 上级名)。 */
  searchText: string;
  children: MatrixNode[];
}

/** 当前展开状态下**可见**的节点,拍平成一维——拍平之后它就是一张普通表。 */
function flattenVisible(
  nodes: readonly MatrixNode[],
  expanded: Set<string>,
  out: MatrixNode[] = [],
) {
  for (const node of nodes) {
    out.push(node);
    if (node.children.length && expanded.has(node.key)) {
      flattenVisible(node.children, expanded, out);
    }
  }
  return out;
}

/** 所有有子级的 key——默认全展开:静止那一帧就该看得见矩阵,不该等人去点。 */
function collectExpandable(nodes: readonly MatrixNode[], out: string[] = []) {
  for (const node of nodes) {
    if (node.children.length) {
      out.push(node.key);
      collectExpandable(node.children, out);
    }
  }
  return out;
}

export function PermissionsPage() {
  const t = useTranslations("permissionsPage");
  // 角色名归角色管理页那份词条(见文件头)
  const tableLabels = useTableLabels();
  const tSidebar = useTranslations("sidebar");
  const router = useRouter();
  const { session } = useConsoleSession();

  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [permissions, setPermissions] = useState<TenantPermissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([fetchTenantRoles(), fetchTenantPermissions()])
      .then(([roleRows, permRows]) => {
        if (!active) return;
        setRoles(roleRows);
        setPermissions(permRows);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id]);

  const permLabel = (code: string): string =>
    KNOWN_PERMS.has(code) ? t(`perm.${code.replace(/\./g, "_")}`) : code;

  // 列按固定序展示(owner→guest),未知码排尾;判据与角色页共用一份
  const orderedRoles = useMemo(
    () =>
      [...roles].sort((a, b) => roleRank(a.roleCode) - roleRank(b.roleCode)),
    [roles],
  );

  // ── 目录树 → 矩阵树(板块 → 页面 → 操作码;没挂页面的操作码归「其他」)──────
  const { tree, permCount } = useMemo(() => {
    const byParent = new Map<string | null, TenantPermissionRecord[]>();
    for (const p of permissions) {
      const list = byParent.get(p.parentCode) ?? [];
      list.push(p);
      byParent.set(p.parentCode, list);
    }
    const bySort = (a: TenantPermissionRecord, b: TenantPermissionRecord) =>
      a.sort - b.sort || a.permissionCode.localeCompare(b.permissionCode);
    const roots = [...(byParent.get(null) ?? [])].sort(bySort);
    const nodes: MatrixNode[] = [];
    let count = 0;

    const permNode = (
      p: TenantPermissionRecord,
      depth: number,
      parentLabel: string,
    ): MatrixNode => {
      count += 1;
      const label = permLabel(p.permissionCode);
      return {
        key: p.permissionCode,
        kind: "perm",
        code: p.permissionCode,
        label,
        depth,
        openToAll: false,
        searchText: `${p.permissionCode} ${label} ${parentLabel}`.toLowerCase(),
        children: [],
      };
    };

    for (const section of roots.filter((r) => r.permissionType === "menu")) {
      const sectionKey = `sections.${sectionKeyOf(section.permissionCode)}`;
      const sectionLabel = tSidebar.has(sectionKey)
        ? tSidebar(sectionKey)
        : section.permissionName;
      const pageNodes: MatrixNode[] = [];

      for (const page of [...(byParent.get(section.permissionCode) ?? [])].sort(
        bySort,
      )) {
        const perms = [...(byParent.get(page.permissionCode) ?? [])]
          .filter((p) => p.permissionType === "api")
          .sort(bySort);
        const labelKey = page.routePath
          ? PAGE_LABEL_KEY[page.routePath]
          : undefined;
        const pageLabel = labelKey
          ? tSidebar(`items.${labelKey}`)
          : page.permissionName;
        pageNodes.push({
          key: page.permissionCode,
          kind: "page",
          code: page.permissionCode,
          label: pageLabel,
          depth: 1,
          openToAll: perms.length === 0,
          searchText:
            `${page.routePath ?? ""} ${pageLabel} ${sectionLabel}`.toLowerCase(),
          children: perms.map((p) => permNode(p, 2, pageLabel)),
        });
      }

      nodes.push({
        key: section.permissionCode,
        kind: "section",
        code: section.permissionCode,
        label: sectionLabel,
        depth: 0,
        openToAll: false,
        searchText: sectionLabel.toLowerCase(),
        children: pageNodes,
      });
    }

    const orphans = roots.filter((r) => r.permissionType === "api");
    if (orphans.length > 0) {
      const groupLabel = t("matrix.groupOther");
      nodes.push({
        key: "__other__",
        kind: "group",
        code: "",
        label: groupLabel,
        depth: 0,
        openToAll: false,
        searchText: groupLabel.toLowerCase(),
        children: orphans.sort(bySort).map((p) => permNode(p, 1, groupLabel)),
      });
    }
    return { tree: nodes, permCount: count };
    // permLabel / tSidebar 随 t 变;t 随 locale 变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, t, tSidebar]);

  /* 默认全展开:静止那一帧就该看得见矩阵。钉在树本身上——树重建(切租户 / 换语言)
     时重新铺开,用户自己收起的那几个不必跨数据保留。 */
  useEffect(() => {
    setExpanded(new Set(collectExpandable(tree)));
  }, [tree]);

  /** 命中子节点时连祖先一起留下——只留命中的那一行,读者看不出它在哪个板块下。 */
  const filteredTree = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kindOk = (node: MatrixNode) =>
      kindFilter === "all" ||
      (kindFilter === "perm" && node.kind === "perm") ||
      (kindFilter === "page" && node.kind === "page");
    if (!q && kindFilter === "all") return tree;

    const keep = (node: MatrixNode): MatrixNode | null => {
      const children = node.children
        .map(keep)
        .filter((c): c is MatrixNode => c !== null);
      const selfHit = (!q || node.searchText.includes(q)) && kindOk(node);
      if (selfHit || children.length) return { ...node, children };
      return null;
    };
    return tree.map(keep).filter((n): n is MatrixNode => n !== null);
  }, [tree, query, kindFilter]);

  const visibleRows = useMemo(
    () => flattenVisible(filteredTree, expanded),
    [filteredTree, expanded],
  );

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: "perms",
        icon: "key",
        label: t("metrics.perms"),
        value: String(permCount),
        help: t("metrics.permsHelp"),
        tags: [t("metrics.permsHint")],
      },
      {
        id: "roles",
        icon: "shield-check",
        label: t("metrics.roles"),
        value: String(orderedRoles.length),
        help: t("metrics.rolesHelp"),
        tags: [t("metrics.rolesTag")],
      },
      {
        id: "model",
        icon: "lock",
        label: t("metrics.model"),
        value: t("metrics.modelValue"),
        help: t("metrics.modelHelp"),
        tags: [t("metrics.modelHint")],
      },
    ],
    [permCount, orderedRoles.length, t],
  );

  const grantSets = useMemo(
    () =>
      new Map(
        orderedRoles.map((r) => [
          r.roleCode,
          new Set(r.permissions.map((p) => p.permissionCode)),
        ]),
      ),
    [orderedRoles],
  );

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const matrixColumns: DataTableColumn<MatrixNode>[] = [
    {
      id: "perm",
      header: t("matrix.colPerm"),
      cell: (row) => {
        const meta = KIND_META[row.kind];
        const isOpen = expanded.has(row.key);
        return (
          <span
            className={`flex min-w-0 items-center gap-sm ${depthIndentClass(row.depth)}`}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => toggle(row.key)}
              disabled={!row.children.length}
              aria-label={isOpen ? t("matrix.collapse") : t("matrix.expand")}
            >
              <Icon
                name={
                  row.children.length && isOpen
                    ? "chevron-down"
                    : "chevron-right"
                }
                size="xs"
                fallback="chevron-right"
              />
            </Button>
            <Icon
              name={meta.icon}
              size="sm"
              fallback="placeholder"
              className="shrink-0 text-muted-foreground"
            />
            <TableTitleCell
              title={row.label}
              titleSuffix={
                <>
                  {row.children.length ? (
                    <Badge>
                      {t("matrix.childCount", { count: row.children.length })}
                    </Badge>
                  ) : null}
                  {row.openToAll ? (
                    <Badge variant="outline">{t("matrix.openToAll")}</Badge>
                  ) : null}
                </>
              }
              {...(row.kind === "perm" ? { description: row.code } : {})}
            />
          </span>
        );
      },
    },
    {
      id: "kind",
      header: t("matrix.colKind"),
      align: "center",
      cell: (row) => {
        const meta = KIND_META[row.kind];
        return (
          <StatusBadge tone={meta.tone} icon={false}>
            {t(meta.labelKey)}
          </StatusBadge>
        );
      },
    },
    ...orderedRoles.map<DataTableColumn<MatrixNode>>((r) => ({
      id: `role-${r.roleCode}`,
      header: <RoleHeaderLabel code={r.roleCode} fallback={r.roleName} />,
      align: "center",
      cell: (row) =>
        row.kind !== "perm" ? null : grantSets
            .get(r.roleCode)
            ?.has(row.code) ? (
          <Icon name="check" size="sm" fallback="check" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    })),
  ];

  function resetFilters() {
    setQuery("");
    setKindFilter("all");
  }

  return (
    <ViewLayout>
      <ViewHeader
        icon="key"
        title={t("title")}
        description={t("description")}
        action={
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/members/roles")}
            >
              <Icon name="shield-check" size="xs" fallback="placeholder" />
              <span>{t("viewRoles")}</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/members")}
            >
              <Icon name="arrow-left" size="xs" fallback="placeholder" />
              <span>{t("backToMembers")}</span>
            </Button>
          </>
        }
      />

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      <PageSection
        icon="key"
        level={2}
        title={t("matrix.title")}
        description={t("matrix.description")}
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.listOnly")}
            count={t("filters.count", { count: visibleRows.length })}
            aria-label={t("filters.groupLabel")}
            onReset={resetFilters}
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("filters.searchPlaceholder")}
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label={t("filters.searchAriaLabel")}
              />
            }
          >
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={kindFilter}
              onChange={(event) =>
                setKindFilter(event.target.value as KindFilter)
              }
              aria-label={t("filters.kindAriaLabel")}
            >
              <option value="all">{t("filters.kindAll")}</option>
              <option value="page">{t("kind.page")}</option>
              <option value="perm">{t("kind.perm")}</option>
            </NativeSelect>
          </FilterBar>

          <DataTable<MatrixNode>
            labels={tableLabels}
            columns={matrixColumns}
            rows={visibleRows}
            rowKey={(row) => row.key}
            loading={loading}
            empty={
              <EmptyState
                title={loadFailed ? t("loadFailed") : t("matrix.empty")}
                {...(loadFailed ? {} : { description: t("matrix.emptyHint") })}
                action={
                  loadFailed ? undefined : (
                    <Button variant="outline" size="md" onClick={resetFilters}>
                      <Icon name="x" size="xs" fallback="placeholder" />
                      <span>{t("filters.reset")}</span>
                    </Button>
                  )
                }
              />
            }
          />
        </div>
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            {
              title: t("notes.readTitle"),
              description: t("notes.readBody"),
            },
            {
              title: t("notes.openTitle"),
              description: t("notes.openBody"),
            },
            {
              title: t("notes.scopeTitle"),
              description: t("notes.scopeBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
