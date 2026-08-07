"use client";

/* Router — opera-atlas-design.md §7：Atlas 1.0 只做 Primary / Failover；
 * Weight / Canary 是 2.0 范围，Banner 说明。
 *
 * 路由表按清单模式呈现（owner 2026-08-03）：工具行 + list/cards 双视图 +
 * 选择/序号/操作列。路由的写路径在 Endpoint 页，这里的行操作即跳转过去。 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListCard,
  ListCardGrid,
  Pagination,
  Section,
  StatusBadge,
  TableTitleCell,
  type FilterBarView,
  useListPagination,
  useToast,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { endpoints, type EndpointRow } from "@/mocks/atlas";

export default function RouterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState<FilterBarView>("list");
  /* 选择列全站占位（owner 定）：路由行暂无批量动作，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw === ""
      ? endpoints
      : endpoints.filter(
          (e) =>
            e.code.toLowerCase().includes(kw) ||
            e.primaryModel.toLowerCase().includes(kw) ||
            (e.fallbackModel ?? "").toLowerCase().includes(kw),
        );
  }, [keyword]);

  const pager = useListPagination(filtered);

  const rowMenu = (e: EndpointRow) => (
    <ActionMenu
      label={`${e.code} 操作`}
      items={[
        {
          id: "route",
          label: "调整路由",
          icon: "tree-structure",
          onSelect: () => router.push("/atlas/endpoints"),
        },
        {
          id: "history",
          label: "变更记录",
          icon: "clock-counter-clockwise",
          onSelect: () =>
            toast({
              tone: "info",
              title: `${e.code} 路由变更记录`,
              description: "全量留痕在 Audit；按对象过滤随功能期接入。",
            }),
        },
      ]}
    />
  );

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
      pageCount={pager.pageCount}
      total={endpoints.length}
      filteredTotal={filtered.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  const routeMeta = (e: EndpointRow) =>
    e.fallbackModel ? (
      <>
        <Badge>Primary</Badge>
        <span className="text-code-sm text-foreground">{e.primaryModel}</span>
        <Badge variant="secondary">Fallback</Badge>
        <span className="text-code-sm text-foreground">{e.fallbackModel}</span>
        <span>超时 / 5xx 触发</span>
      </>
    ) : (
      <>
        <Badge>Primary</Badge>
        <span className="text-code-sm text-foreground">{e.primaryModel}</span>
        <span>未配置 fallback——单模型直路由</span>
      </>
    );

  return (
    <ViewLayout>
      <ViewHeader
        icon="tree-structure"
        title="Router"
        description="模型选择由 Router 完成：业务只依赖 Endpoint，切换模型不改业务代码。当前支持 Single / Failover 两种模式。"
      />

      <Banner
        tone="info"
        title="Atlas 1.0 路由范围"
        description="Weight 与 Canary 路由在 Atlas 2.0 排期；本期变更仅 Primary / Fallback，所有变更进入 Audit。"
      />

      <Section
        title="Endpoint 路由表"
        icon="plug"
        level={2}
        description="每个入口的 Primary / Fallback 指派；路由细节到 Endpoint 页调整。"
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view={view}
            onViewChange={setView}
            count={
              filtered.length === endpoints.length
                ? endpoints.length
                : `${filtered.length} / ${endpoints.length}`
            }
            actions={<Button variant="outline">路由变更记录</Button>}
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索 Endpoint / 模型…"
                aria-label="搜索路由"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
          </FilterBar>

          {view === "list" ? (
            <DataTable
              columns={[
                {
                  id: "code",
                  header: "Endpoint",
                  cell: (e) => (
                    <TableTitleCell
                      icon="plug"
                      title={<span className="font-mono">{e.code}</span>}
                      description={e.category}
                      onTitleClick={() => router.push("/atlas/endpoints")}
                    />
                  ),
                },
                {
                  id: "primary",
                  header: "Primary",
                  cell: (e) => (
                    <span className="text-code-sm">{e.primaryModel}</span>
                  ),
                },
                {
                  id: "fallback",
                  header: "Fallback",
                  cell: (e) =>
                    e.fallbackModel ? (
                      <span className="text-code-sm">{e.fallbackModel}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
                {
                  id: "mode",
                  header: "模式",
                  cell: (e) => (
                    <Badge variant={e.fallbackModel ? "default" : "secondary"}>
                      {e.fallbackModel ? "Failover" : "Single"}
                    </Badge>
                  ),
                },
                {
                  id: "enabled",
                  header: "状态",
                  cell: (e) => (
                    <StatusBadge tone={e.enabled ? "success" : "neutral"} dot>
                      {e.enabled ? "生效中" : "已停用"}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={pager.pageRows}
              rowKey={(e) => e.id}
              selectedKeys={selected}
              onSelectionChange={setSelected}
              indexStart={pager.indexStart}
              rowActions={rowMenu}
              footer={pagination}
            />
          ) : (
            <div className="flex flex-col gap-sm">
              <ListCardGrid>
                {pager.pageRows.map((e) => (
                  <ListCard
                    key={e.id}
                    icon="plug"
                    title={<span className="font-mono">{e.code}</span>}
                    description={e.category}
                    onTitleClick={() => router.push("/atlas/endpoints")}
                    status={
                      <StatusBadge tone={e.enabled ? "success" : "neutral"} dot>
                        {e.enabled ? "生效中" : "已停用"}
                      </StatusBadge>
                    }
                    actions={rowMenu(e)}
                    meta={routeMeta(e)}
                  />
                ))}
              </ListCardGrid>
              {pagination}
            </div>
          )}
        </div>
      </Section>
    </ViewLayout>
  );
}
