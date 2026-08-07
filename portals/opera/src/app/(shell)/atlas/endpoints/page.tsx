"use client";

/* Endpoint — opera-atlas-design.md §6：统一能力入口，业务系统只依赖 Endpoint。
 * 路由两档（§7 Single / Failover）也落在这里：primary 必填，fallback 留空
 * 即 Single。
 *
 * 模型选择用 Combobox 而不是原生 select：模型注册中心会长到几十条，且业务侧
 * 记的是编码不是名称，需要可搜索的下拉。 */

import { useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  BulkActionBar,
  Button,
  Combobox,
  DataTable,
  DialogForm,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FilterBar,
  type FilterBarView,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  Pagination,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useToast,
  useListPagination,
} from "@vxture/design-system";
import { endpoints as seed, models, type EndpointRow } from "@/mocks/atlas";

/** fallback 的"不设"档。空串在 Combobox 里选不中，需要一个显式值。 */
const NO_FALLBACK = "__none__";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: EndpointRow }
  | { kind: "route"; row: EndpointRow }
  | null;

interface EndpointDraft {
  code: string;
  category: string;
  primaryModel: string;
  fallbackModel: string;
}

const EMPTY_DRAFT: EndpointDraft = {
  code: "",
  category: "Chat",
  primaryModel: "",
  fallbackModel: NO_FALLBACK,
};

export default function EndpointsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EndpointRow[]>(seed);
  const [keyword, setKeyword] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [view, setView] = useState<FilterBarView>("list");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<EndpointDraft>(EMPTY_DRAFT);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw === ""
      ? rows
      : rows.filter((r) => r.code.toLowerCase().includes(kw));
  }, [rows, keyword]);

  const pager = useListPagination(filtered);

  const setEnabledBulk = (enabled: boolean) => {
    const ids = new Set(selectedKeys);
    setRows((all) => all.map((r) => (ids.has(r.id) ? { ...r, enabled } : r)));
    toast({
      tone: enabled ? "success" : "warning",
      title: `${ids.size} 个 Endpoint 已${enabled ? "启用" : "停用"}`,
    });
    setSelectedKeys([]);
  };

  /** 已下线的模型不能挂：挂上去等于给 Endpoint 埋一个必然失败的 primary。 */
  const modelItems = useMemo(
    () =>
      models
        .filter((m) => m.status !== "disabled")
        .map((m) => ({ value: m.code, label: m.code })),
    [],
  );

  const fallbackItems = useMemo(
    () => [{ value: NO_FALLBACK, label: "不设（Single 路由）" }, ...modelItems],
    [modelItems],
  );

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDialog({ kind: "create" });
  };

  const openFrom = (row: EndpointRow, kind: "edit" | "route") => {
    setDraft({
      code: row.code,
      category: row.category,
      primaryModel: row.primaryModel,
      fallbackModel: row.fallbackModel ?? NO_FALLBACK,
    });
    setDialog({ kind, row });
  };

  const setEnabled = (row: EndpointRow, enabled: boolean) => {
    setRows((all) => all.map((r) => (r.id === row.id ? { ...r, enabled } : r)));
    toast({
      tone: enabled ? "success" : "warning",
      title: `${row.code} 已${enabled ? "启用" : "停用"}`,
      description: enabled
        ? "调用方可以再次访问该入口。"
        : "调用方会收到 404；先确认没有业务还在用它。",
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;

    const fallback =
      draft.fallbackModel === NO_FALLBACK ? null : draft.fallbackModel;

    if (dialog.kind === "create") {
      setRows((all) => [
        ...all,
        {
          id: `e-${draft.code}`,
          code: draft.code,
          category: draft.category,
          primaryModel: draft.primaryModel,
          fallbackModel: fallback,
          enabled: true,
          qps: 0,
        },
      ]);
      toast({
        tone: "success",
        title: `${draft.code} 已创建`,
        description: fallback
          ? `Failover：${draft.primaryModel} → ${fallback}`
          : `Single：${draft.primaryModel}`,
      });
    } else {
      setRows((all) =>
        all.map((r) =>
          r.id === dialog.row.id
            ? {
                ...r,
                code: draft.code,
                category: draft.category,
                primaryModel: draft.primaryModel,
                fallbackModel: fallback,
              }
            : r,
        ),
      );
      toast({
        tone: "success",
        title:
          dialog.kind === "route"
            ? `${dialog.row.code} 路由已更新`
            : `${draft.code} 已保存`,
        description: fallback
          ? `Failover：${draft.primaryModel} → ${fallback}`
          : `Single：${draft.primaryModel}`,
      });
    }

    setDialog(null);
  };

  const routeOnly = dialog?.kind === "route";
  const formOpen =
    dialog?.kind === "create" || dialog?.kind === "edit" || routeOnly;
  const draftValid =
    draft.primaryModel !== "" &&
    (routeOnly || draft.code.trim() !== "") &&
    draft.fallbackModel !== draft.primaryModel;

  const rowMenu = (r: EndpointRow) => (
    <ActionMenu
      label={`${r.code} 操作`}
      items={[
        {
          id: "route",
          label: "调整路由",
          icon: "tree-structure",
          onSelect: () => openFrom(r, "route"),
        },
        {
          id: "edit",
          label: "编辑",
          icon: "edit",
          onSelect: () => openFrom(r, "edit"),
        },
        r.enabled
          ? {
              id: "disable",
              label: "停用",
              icon: "pause" as const,
              danger: true,
              separatorBefore: true,
              onSelect: () => setEnabled(r, false),
            }
          : {
              id: "enable",
              label: "启用",
              icon: "play" as const,
              separatorBefore: true,
              onSelect: () => setEnabled(r, true),
            },
      ]}
    />
  );

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
      pageCount={pager.pageCount}
      total={rows.length}
      filteredTotal={filtered.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="plug"
            title="Endpoint"
            description="统一能力入口（chat/default、embedding/default…）。业务系统永远访问 Endpoint，不直接访问模型。"
          />
        }
        filters={
          <FilterBar
            view={view}
            onViewChange={setView}
            actions={
              <Button onClick={openCreate}>
                <Icon name="plus" size="sm" />
                新建 Endpoint
              </Button>
            }
            count={
              filtered.length === rows.length
                ? rows.length
                : `${filtered.length} / ${rows.length}`
            }
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索 Endpoint…"
                aria-label="搜索 Endpoint"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
          </FilterBar>
        }
        bulkBar={
          <BulkActionBar
            count={selectedKeys.length}
            noun="个"
            onClear={() => setSelectedKeys([])}
            actions={[
              {
                id: "enable",
                label: "启用",
                icon: "play",
                onSelect: () => setEnabledBulk(true),
              },
              {
                id: "disable",
                label: "停用",
                icon: "pause",
                danger: true,
                onSelect: () => setEnabledBulk(false),
              },
            ]}
          />
        }
        table={
          view === "list" ? (
            <DataTable
              columns={[
                {
                  id: "code",
                  header: "Endpoint",
                  cell: (r) => (
                    <TableTitleCell
                      icon="plug"
                      title={<span className="font-mono">{r.code}</span>}
                      description={r.category}
                      onTitleClick={() => openFrom(r, "edit")}
                    />
                  ),
                },
                {
                  id: "primary",
                  header: "Primary",
                  cell: (r) => (
                    <span className="text-code-sm">{r.primaryModel}</span>
                  ),
                },
                {
                  id: "fallback",
                  header: "Fallback",
                  cell: (r) =>
                    r.fallbackModel ? (
                      <span className="text-code-sm">{r.fallbackModel}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
                {
                  id: "qps",
                  header: "QPS",
                  align: "right",
                  cell: (r) => r.qps,
                },
                {
                  id: "enabled",
                  header: "状态",
                  cell: (r) => (
                    <StatusBadge tone={r.enabled ? "success" : "neutral"} dot>
                      {r.enabled ? "已启用" : "已停用"}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={pager.pageRows}
              rowKey={(r) => r.id}
              selectedKeys={selectedKeys}
              onSelectionChange={setSelectedKeys}
              indexStart={pager.indexStart}
              rowActions={rowMenu}
              footer={pagination}
            />
          ) : (
            <div className="flex flex-col gap-sm">
              <ListCardGrid>
                {pager.pageRows.map((r) => (
                  <ListCard
                    key={r.id}
                    icon="plug"
                    title={<span className="font-mono">{r.code}</span>}
                    description={r.category}
                    onTitleClick={() => openFrom(r, "edit")}
                    status={
                      <StatusBadge tone={r.enabled ? "success" : "neutral"} dot>
                        {r.enabled ? "已启用" : "已停用"}
                      </StatusBadge>
                    }
                    actions={rowMenu(r)}
                    meta={
                      <span className="font-mono">
                        {r.primaryModel}
                        {r.fallbackModel ? ` → ${r.fallbackModel}` : ""} · QPS{" "}
                        {r.qps}
                      </span>
                    }
                  />
                ))}
              </ListCardGrid>
              {pagination}
            </div>
          )
        }
      />

      <DialogForm
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={
          routeOnly
            ? `调整路由 · ${dialog.row.code}`
            : dialog?.kind === "edit"
              ? "编辑 Endpoint"
              : "新建 Endpoint"
        }
        description="primary 必填；留空 fallback 即 Single 路由，设了就是 Failover——primary 失败时自动切过去。"
        submitLabel={dialog?.kind === "create" ? "创建" : "保存"}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        <FieldGroup>
          {routeOnly ? null : (
            <>
              <Field>
                <FieldLabel htmlFor="endpoint-code">Endpoint 编码</FieldLabel>
                <Input
                  id="endpoint-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="chat/default"
                />
                <FieldDescription>
                  业务侧写死在配置里，创建后改动等于让调用方 404。
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="endpoint-category">类别</FieldLabel>
                <Input
                  id="endpoint-category"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                  placeholder="Chat"
                />
              </Field>
            </>
          )}

          <Field>
            <FieldLabel>Primary 模型</FieldLabel>
            <Combobox
              items={modelItems}
              value={draft.primaryModel}
              onValueChange={(v) => setDraft({ ...draft, primaryModel: v })}
              placeholder="选择模型"
              searchPlaceholder="搜索模型编码…"
            />
            <FieldDescription>已下线的模型不在列表里。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Fallback 模型</FieldLabel>
            <Combobox
              items={fallbackItems}
              value={draft.fallbackModel}
              onValueChange={(v) => setDraft({ ...draft, fallbackModel: v })}
              placeholder="不设（Single 路由）"
              searchPlaceholder="搜索模型编码…"
            />
            <FieldDescription>
              不能与 primary 相同——同一个模型挂两档，failover 等于没有。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </DialogForm>
    </>
  );
}
