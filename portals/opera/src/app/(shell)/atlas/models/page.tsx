"use client";

/* Model Registry — opera-atlas-design.md §5：CRUD + Capability Tag。
 *
 * 写路径跑在本地状态上（BFF 未通，见 mocks/atlas.ts）。Provider 下拉取自
 * Provider 列表而不是自由文本：模型必须挂在已接入的 Provider 上，这条约束
 * 交给控件表达比交给校验器表达便宜。 */

import { useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  Badge,
  BulkActionBar,
  Button,
  Checkbox,
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
  Label,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  NativeSelect,
  Pagination,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useToast,
  useListPagination,
} from "@vxture/design-system";
import { models as seed, providers, type ModelRow } from "@/mocks/atlas";
import { RESOURCE_STATUS_META } from "@/lib/status";

/** 能力标签的全集，opera-atlas-design.md §5「模型能力」。 */
const CAPABILITIES = [
  "Chat",
  "Reasoning",
  "Embedding",
  "Vision",
  "Image",
  "Audio",
  "Video",
  "Tool Calling",
];

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: ModelRow }
  | { kind: "retire"; row: ModelRow }
  | null;

interface ModelDraft {
  code: string;
  name: string;
  provider: string;
  version: string;
  contextWindow: string;
  capabilities: string[];
}

const EMPTY_DRAFT: ModelDraft = {
  code: "",
  name: "",
  provider: providers[0]?.name ?? "",
  version: "",
  contextWindow: "",
  capabilities: ["Chat"],
};

export default function ModelsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ModelRow[]>(seed);
  const [keyword, setKeyword] = useState("");
  const [capability, setCapability] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [view, setView] = useState<FilterBarView>("list");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_DRAFT);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (capability === "all" || r.capabilities.includes(capability)) &&
        (kw === "" ||
          r.code.toLowerCase().includes(kw) ||
          r.name.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, capability]);

  const pager = useListPagination(filtered);

  const setStatusBulk = (status: ModelRow["status"]) => {
    const ids = new Set(selectedKeys);
    setRows((all) => all.map((r) => (ids.has(r.id) ? { ...r, status } : r)));
    toast({
      tone: status === "disabled" ? "warning" : "success",
      title: `${ids.size} 个模型已${status === "disabled" ? "下线" : "上线"}`,
    });
    setSelectedKeys([]);
  };

  /** 只接入中的 Provider 能挂新模型；已停用的不出现在下拉里。 */
  const selectableProviders = providers.filter((p) => p.status !== "disabled");

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDialog({ kind: "create" });
  };

  const openEdit = (row: ModelRow) => {
    setDraft({
      code: row.code,
      name: row.name,
      provider: row.provider,
      version: row.version,
      contextWindow: row.contextWindow,
      capabilities: [...row.capabilities],
    });
    setDialog({ kind: "edit", row });
  };

  const toggleCapability = (cap: string) =>
    setDraft((d) => ({
      ...d,
      capabilities: d.capabilities.includes(cap)
        ? d.capabilities.filter((c) => c !== cap)
        : [...d.capabilities, cap],
    }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.kind === "retire") {
      setRows((all) =>
        all.map((r) =>
          r.id === dialog.row.id ? { ...r, status: "disabled" } : r,
        ),
      );
      toast({
        tone: "warning",
        title: `${dialog.row.code} 已下线`,
        description:
          "引用它的 Endpoint 会落到 fallback；没有 fallback 的会报错。",
      });
    } else if (dialog.kind === "create") {
      setRows((all) => [
        ...all,
        {
          id: `m-${draft.code}`,
          code: draft.code,
          name: draft.name,
          provider: draft.provider,
          version: draft.version,
          contextWindow: draft.contextWindow,
          capabilities: draft.capabilities,
          status: "active",
        },
      ]);
      toast({
        tone: "success",
        title: `${draft.code} 已注册`,
        description: "到 Endpoint 把它挂成 primary 或 fallback 才会有流量。",
      });
    } else {
      setRows((all) =>
        all.map((r) =>
          r.id === dialog.row.id
            ? {
                ...r,
                code: draft.code,
                name: draft.name,
                provider: draft.provider,
                version: draft.version,
                contextWindow: draft.contextWindow,
                capabilities: draft.capabilities,
              }
            : r,
        ),
      );
      toast({ tone: "success", title: `${draft.code} 已保存` });
    }

    setDialog(null);
  };

  const draftValid =
    draft.code.trim() !== "" &&
    draft.name.trim() !== "" &&
    draft.capabilities.length > 0;
  const editing = dialog?.kind === "edit";

  const rowMenu = (r: ModelRow) => (
    <ActionMenu
      label={`${r.code} 操作`}
      items={[
        {
          id: "edit",
          label: "编辑",
          icon: "edit",
          onSelect: () => openEdit(r),
        },
        r.status === "disabled"
          ? {
              id: "restore",
              label: "重新上线",
              icon: "play" as const,
              onSelect: () => {
                setRows((all) =>
                  all.map((x) =>
                    x.id === r.id ? { ...x, status: "active" } : x,
                  ),
                );
                toast({ tone: "success", title: `${r.code} 已重新上线` });
              },
            }
          : {
              id: "retire",
              label: "下线",
              icon: "prohibit" as const,
              danger: true,
              separatorBefore: true,
              onSelect: () => setDialog({ kind: "retire", row: r }),
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
            icon="brain"
            title="Model Registry"
            description="统一模型注册中心：模型编码、能力标签与上下文窗口。业务系统不直连模型，只经 Endpoint。"
          />
        }
        filters={
          <FilterBar
            view={view}
            onViewChange={setView}
            actions={
              <Button onClick={openCreate}>
                <Icon name="plus" size="sm" />
                注册模型
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
                placeholder="搜索模型编码…"
                aria-label="搜索模型"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={capability}
              onChange={(e) => {
                setCapability(e.target.value);
                pager.resetPage();
              }}
              aria-label="能力筛选"
            >
              <option value="all">全部能力</option>
              {CAPABILITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </FilterBar>
        }
        bulkBar={
          <BulkActionBar
            count={selectedKeys.length}
            noun="个"
            onClear={() => setSelectedKeys([])}
            actions={[
              {
                id: "restore",
                label: "重新上线",
                icon: "play",
                onSelect: () => setStatusBulk("active"),
              },
              {
                id: "retire",
                label: "下线",
                icon: "prohibit",
                danger: true,
                onSelect: () => setStatusBulk("disabled"),
              },
            ]}
          />
        }
        table={
          view === "list" ? (
            <DataTable
              columns={[
                {
                  id: "model",
                  header: "模型",
                  cell: (r) => (
                    <TableTitleCell
                      icon="brain"
                      title={r.name}
                      description={r.code}
                      onTitleClick={() => openEdit(r)}
                    />
                  ),
                },
                { id: "provider", header: "Provider", cell: (r) => r.provider },
                { id: "version", header: "版本", cell: (r) => r.version },
                {
                  id: "context",
                  header: "上下文",
                  align: "right",
                  cell: (r) => r.contextWindow,
                },
                {
                  id: "capabilities",
                  header: "能力",
                  cell: (r) => (
                    <span className="flex flex-wrap gap-2xs">
                      {r.capabilities.map((c) => (
                        <Badge key={c} variant="secondary">
                          {c}
                        </Badge>
                      ))}
                    </span>
                  ),
                },
                {
                  id: "status",
                  header: "状态",
                  cell: (r) => (
                    <StatusBadge tone={RESOURCE_STATUS_META[r.status].tone} dot>
                      {RESOURCE_STATUS_META[r.status].label}
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
                    icon="brain"
                    title={r.name}
                    description={r.code}
                    onTitleClick={() => openEdit(r)}
                    status={
                      <StatusBadge
                        tone={RESOURCE_STATUS_META[r.status].tone}
                        dot
                      >
                        {RESOURCE_STATUS_META[r.status].label}
                      </StatusBadge>
                    }
                    actions={rowMenu(r)}
                    meta={
                      <>
                        <span>
                          {r.provider} · {r.version} · {r.contextWindow}
                        </span>
                        {r.capabilities.map((c) => (
                          <Badge key={c} variant="secondary">
                            {c}
                          </Badge>
                        ))}
                      </>
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
        open={dialog?.kind === "create" || editing}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="lg"
        title={editing ? "编辑模型" : "注册模型"}
        description="编码是业务侧唯一认得的标识；能力标签决定它能被哪类 Endpoint 挂载。"
        submitLabel={editing ? "保存" : "注册"}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="model-code">编码</FieldLabel>
            <Input
              id="model-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="gpt-5-mini"
            />
            <FieldDescription>
              Router 与计量都按它聚合，注册后不可改。
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="model-name">名称</FieldLabel>
            <Input
              id="model-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="GPT-5 Mini"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="model-provider">Provider</FieldLabel>
            <NativeSelect
              id="model-provider"
              value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
            >
              {selectableProviders.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription>
              已停用的 Provider 不在列表里——挂上去也不会有流量。
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="model-version">版本</FieldLabel>
            <Input
              id="model-version"
              value={draft.version}
              onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              placeholder="2026-05"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="model-context">上下文窗口</FieldLabel>
            <Input
              id="model-context"
              value={draft.contextWindow}
              onChange={(e) =>
                setDraft({ ...draft, contextWindow: e.target.value })
              }
              placeholder="200K"
            />
          </Field>

          <Field>
            <FieldLabel>能力标签</FieldLabel>
            <div className="flex flex-wrap gap-x-lg gap-y-sm">
              {CAPABILITIES.map((c) => (
                <span key={c} className="flex items-center gap-xs">
                  <Checkbox
                    id={`cap-${c}`}
                    checked={draft.capabilities.includes(c)}
                    onCheckedChange={() => toggleCapability(c)}
                  />
                  <Label htmlFor={`cap-${c}`}>{c}</Label>
                </span>
              ))}
            </div>
            <FieldDescription>至少选一项。</FieldDescription>
          </Field>
        </FieldGroup>
      </DialogForm>

      <DialogForm
        open={dialog?.kind === "retire"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        danger
        title={
          dialog?.kind === "retire" ? `下线 ${dialog.row.code}` : "下线模型"
        }
        description="下线后不再接受新请求。把它挂成 primary 的 Endpoint 会落到 fallback，没有 fallback 的会直接报错——先去 Endpoint 确认。"
        submitLabel="下线"
        onSubmit={submit}
      />
    </>
  );
}
