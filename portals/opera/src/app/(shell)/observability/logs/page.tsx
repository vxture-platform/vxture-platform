"use client";

/* Logs — opera-top-level-design.md §7：Application / System / Audit 三类日志，
 * 此页承载运行日志（Audit 独立在 Security 域）。
 *
 * 只读页，但筛选是真的：日志页不筛选就没法用。时间列可排序（最新在前是默认，
 * 排查历史时要反过来看）。 */

import { useMemo, useState } from "react";
import {
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  NativeSelect,
  Pagination,
  StatusBadge,
  type DataTableSort,
  type FilterBarView,
  useListPagination,
  ViewHeader,
} from "@vxture/design-system";
import { logs } from "@/mocks/atlas";
import { LOG_LEVEL_META, type LogLevel } from "@/lib/status";

const SOURCES = ["gateway", "router", "metering", "health", "registry"];

export default function LogsPage() {
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState<DataTableSort>({
    columnId: "time",
    direction: "desc",
  });
  const [view, setView] = useState<FilterBarView>("list");
  /* 选择列全站占位（owner 定）：日志暂无批量动作，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const rows = logs.filter(
      (r) =>
        (level === "all" || r.level === level) &&
        (source === "all" || r.source === source) &&
        (kw === "" ||
          r.message.toLowerCase().includes(kw) ||
          r.trace.toLowerCase().includes(kw)),
    );
    /* 时间是 HH:mm:ss 定长串，字典序即时间序——不必解析成日期。 */
    return [...rows].sort((a, b) =>
      sort.direction === "asc"
        ? a.time.localeCompare(b.time)
        : b.time.localeCompare(a.time),
    );
  }, [keyword, level, source, sort]);

  const filtered = keyword !== "" || level !== "all" || source !== "all";
  const pager = useListPagination(visible);

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
      pageCount={pager.pageCount}
      total={logs.length}
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
          icon="terminal"
          title="Logs"
          description="网关、路由、计量与健康探测的运行日志；每条可跳转链路追踪。"
        />
      }
      filters={
        <FilterBar
          view={view}
          onViewChange={setView}
          count={
            visible.length === logs.length
              ? logs.length
              : `${visible.length} / ${logs.length}`
          }
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="搜索日志内容 / Trace…"
              aria-label="搜索日志"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                pager.resetPage();
              }}
            />
          </InputGroup>
          <NativeSelect
            wrapperClassName="w-fit"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as LogLevel | "all");
              pager.resetPage();
            }}
            aria-label="级别筛选"
          >
            <option value="all">全部级别</option>
            <option value="error">ERROR</option>
            <option value="warn">WARN</option>
            <option value="info">INFO</option>
          </NativeSelect>
          <NativeSelect
            wrapperClassName="w-fit"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              pager.resetPage();
            }}
            aria-label="来源筛选"
          >
            <option value="all">全部来源</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
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
              {
                id: "level",
                header: "级别",
                cell: (r) => (
                  <StatusBadge tone={LOG_LEVEL_META[r.level].tone}>
                    {LOG_LEVEL_META[r.level].label}
                  </StatusBadge>
                ),
              },
              { id: "source", header: "来源", cell: (r) => r.source },
              { id: "message", header: "内容", cell: (r) => r.message },
              {
                id: "trace",
                header: "Trace",
                align: "right",
                cell: (r) => <Kbd>{r.trace}</Kbd>,
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
                title={filtered ? "没有匹配的日志" : "窗口内没有日志"}
                description={
                  filtered
                    ? "放宽级别或来源，或换个关键词。"
                    : "该时间窗口内没有产生任何运行日志。"
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
                  title={r.message}
                  description={`${r.time} · ${r.source}`}
                  status={
                    <StatusBadge tone={LOG_LEVEL_META[r.level].tone}>
                      {LOG_LEVEL_META[r.level].label}
                    </StatusBadge>
                  }
                  meta={<Kbd>{r.trace}</Kbd>}
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
