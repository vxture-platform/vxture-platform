"use client";

/* Audit — opera-top-level-design.md §8：谁 / 什么时间 / 修改什么；
 * Provider / Model / Endpoint / Router / Key 变更全量留痕。 */

import { useMemo, useState } from "react";
import {
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  NativeSelect,
  Pagination,
  type DataTableSort,
  type FilterBarView,
  useListPagination,
  ViewHeader,
} from "@vxture/design-system";
import { auditTrail } from "@/mocks/atlas";

/** 动作档取自现有留痕，避免筛选项与数据脱节。 */
const ACTIONS = Array.from(new Set(auditTrail.map((r) => r.action)));

export default function AuditPage() {
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("all");
  const [sort, setSort] = useState<DataTableSort>({
    columnId: "time",
    direction: "desc",
  });

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const rows = auditTrail.filter(
      (r) =>
        (action === "all" || r.action === action) &&
        (kw === "" ||
          r.target.toLowerCase().includes(kw) ||
          r.actor.toLowerCase().includes(kw)),
    );
    return [...rows].sort((a, b) =>
      sort.direction === "asc"
        ? a.time.localeCompare(b.time)
        : b.time.localeCompare(a.time),
    );
  }, [keyword, action, sort]);

  const filtered = keyword !== "" || action !== "all";
  const pager = useListPagination(visible);
  const [view, setView] = useState<FilterBarView>("list");
  /* 选择列全站占位（owner 定）：留痕只读，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
      pageCount={pager.pageCount}
      total={auditTrail.length}
      filteredTotal={visible.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  return (
    <ListPageTemplate
      header={
        <ViewHeader
          icon="clipboard"
          title="Audit"
          description="配置变更审计：谁、什么时间、改了什么。只读，不可删改。"
        />
      }
      filters={
        <FilterBar
          view={view}
          onViewChange={setView}
          count={
            visible.length === auditTrail.length
              ? auditTrail.length
              : `${visible.length} / ${auditTrail.length}`
          }
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="搜索对象 / 操作者…"
              aria-label="搜索留痕"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                pager.resetPage();
              }}
            />
          </InputGroup>
          <NativeSelect
            wrapperClassName="w-fit"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              pager.resetPage();
            }}
            aria-label="动作筛选"
          >
            <option value="all">全部动作</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
      }
      table={
        view === "list" ? (
          <DataTable
            columns={[
              {
                id: "time",
                header: "时间",
                cell: (r) => r.time,
                sortable: true,
              },
              { id: "actor", header: "操作者", cell: (r) => r.actor },
              { id: "action", header: "动作", cell: (r) => r.action },
              {
                id: "target",
                header: "对象",
                cell: (r) => (
                  <span className="text-label-md text-foreground">
                    {r.target}
                  </span>
                ),
              },
              {
                id: "detail",
                header: "明细",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {r.detail}
                  </span>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r) => r.id}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            sort={sort}
            onSortChange={setSort}
            footer={pagination}
            empty={
              <EmptyState
                title={filtered ? "没有匹配的留痕" : "暂无变更留痕"}
                description={
                  filtered
                    ? "换个动作或关键词再看。"
                    : "配置尚未发生过变更。审计只记录写操作，读操作不留痕。"
                }
              />
            }
          />
        ) : (
          <div className="flex flex-col gap-sm">
            <ListCardGrid>
              {pager.pageRows.map((r) => (
                <ListCard
                  key={r.id}
                  title={r.target}
                  description={`${r.time} · ${r.actor}`}
                  status={<Badge variant="secondary">{r.action}</Badge>}
                  meta={<span>{r.detail}</span>}
                />
              ))}
            </ListCardGrid>
            {pagination}
          </div>
        )
      }
    />
  );
}
