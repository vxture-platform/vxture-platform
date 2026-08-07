"use client";

/* API Key — opera-atlas-design.md §9：Internal / External 两类，
 * 创建 / 吊销 / 禁用 / 轮换。
 *
 * 签发与轮换是**唯一一次**能看到明文的时刻，所以它们不走"操作完弹个 toast"
 * 的路子：结果单独开一个对话框，明文只读展示 + 复制，关掉就再也拿不回来。
 * 列表里永远只有前缀。 */

import { useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  Badge,
  Banner,
  BulkActionBar,
  Button,
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
  Kbd,
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
import { apiKeys as seed, type ApiKeyRow } from "@/mocks/atlas";
import { KEY_STATUS_META } from "@/lib/status";

type KeyKind = ApiKeyRow["kind"];

type DialogState =
  | { kind: "issue" }
  | { kind: "rotate"; row: ApiKeyRow }
  | { kind: "revoke"; row: ApiKeyRow }
  | null;

/** 明文只在内存里活到用户关掉对话框为止，不进列表、不进 state 之外的任何地方。 */
interface RevealState {
  name: string;
  secret: string;
  rotated: boolean;
}

interface KeyDraft {
  name: string;
  kind: KeyKind;
  owner: string;
}

const EMPTY_DRAFT: KeyDraft = { name: "", kind: "internal", owner: "" };

/** 演示用的明文生成；接 BFF 后由服务端签发，前端只负责展示一次。 */
function fakeSecret(kind: KeyKind) {
  const body = Array.from({ length: 32 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 36),
    ),
  ).join("");
  return `vxk_${kind === "internal" ? "int" : "ext"}_${body}`;
}

export default function KeysPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ApiKeyRow[]>(seed);
  const [keyword, setKeyword] = useState("");
  const [kindFilter, setKindFilter] = useState<KeyKind | "all">("all");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<KeyDraft>(EMPTY_DRAFT);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [view, setView] = useState<FilterBarView>("list");

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (kindFilter === "all" || r.kind === kindFilter) &&
        (kw === "" ||
          r.name.toLowerCase().includes(kw) ||
          r.prefix.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, kindFilter]);

  const pager = useListPagination(filtered);

  /** 批量只做可逆动作（禁用/启用）；吊销不可撤销，必须逐个走确认框。 */
  const setStatusBulk = (status: "active" | "disabled") => {
    const ids = new Set(selectedKeys);
    setRows((all) =>
      all.map((r) =>
        ids.has(r.id) && r.status !== "revoked" ? { ...r, status } : r,
      ),
    );
    toast({
      tone: status === "active" ? "success" : "warning",
      title: `${ids.size} 把 Key 已${status === "active" ? "启用" : "禁用"}`,
      description: "已吊销的 Key 不受批量操作影响。",
    });
    setSelectedKeys([]);
  };

  const setStatus = (row: ApiKeyRow, status: ApiKeyRow["status"]) => {
    setRows((all) => all.map((r) => (r.id === row.id ? { ...r, status } : r)));
    toast({
      tone: status === "active" ? "success" : "warning",
      title: `${row.name} ${KEY_STATUS_META[status].label}`,
      description:
        status === "revoked"
          ? "吊销不可撤销，持有方需要重新申请。"
          : "已留痕进 Audit。",
    });
  };

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast({ tone: "success", title: "已复制到剪贴板" });
    } catch {
      toast({
        tone: "danger",
        title: "复制失败",
        description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
      });
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.kind === "revoke") {
      setStatus(dialog.row, "revoked");
    } else if (dialog.kind === "issue") {
      const secret = fakeSecret(draft.kind);
      setRows((all) => [
        ...all,
        {
          id: `k-${draft.name}`,
          name: draft.name,
          kind: draft.kind,
          owner: draft.owner,
          prefix: `${secret.slice(0, 12)}…`,
          status: "active",
          lastUsed: "从未",
          createdAt: "刚刚",
        },
      ]);
      setReveal({ name: draft.name, secret, rotated: false });
    } else {
      const secret = fakeSecret(dialog.row.kind);
      setRows((all) =>
        all.map((r) =>
          r.id === dialog.row.id
            ? { ...r, prefix: `${secret.slice(0, 12)}…`, lastUsed: "从未" }
            : r,
        ),
      );
      setReveal({ name: dialog.row.name, secret, rotated: true });
    }

    setDialog(null);
  };

  const draftValid = draft.name.trim() !== "" && draft.owner.trim() !== "";

  const rowMenu = (r: ApiKeyRow) => (
    <ActionMenu
      label={`${r.name} 操作`}
      items={[
        {
          id: "rotate",
          label: "轮换",
          icon: "refresh",
          disabled: r.status !== "active",
          onSelect: () => setDialog({ kind: "rotate", row: r }),
        },
        r.status === "disabled"
          ? {
              id: "enable",
              label: "启用",
              icon: "play" as const,
              onSelect: () => setStatus(r, "active"),
            }
          : {
              id: "disable",
              label: "禁用",
              icon: "pause" as const,
              disabled: r.status !== "active",
              onSelect: () => setStatus(r, "disabled"),
            },
        {
          id: "revoke",
          label: "吊销",
          icon: "prohibit",
          danger: true,
          separatorBefore: true,
          disabled: r.status === "revoked",
          onSelect: () => setDialog({ kind: "revoke", row: r }),
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
            icon="key"
            title="API Key"
            description="服务间调用走 Internal Key，外部应用走 External Key；轮换与吊销全部留痕进 Audit。"
          />
        }
        filters={
          <FilterBar
            view={view}
            onViewChange={setView}
            actions={
              <Button
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setDialog({ kind: "issue" });
                }}
              >
                <Icon name="plus" size="sm" />
                签发 Key
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
                placeholder="搜索名称 / 前缀…"
                aria-label="搜索 Key"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={kindFilter}
              onChange={(e) => {
                setKindFilter(e.target.value as KeyKind | "all");
                pager.resetPage();
              }}
              aria-label="类型筛选"
            >
              <option value="all">全部类型</option>
              <option value="internal">Internal</option>
              <option value="external">External</option>
            </NativeSelect>
          </FilterBar>
        }
        bulkBar={
          <BulkActionBar
            count={selectedKeys.length}
            noun="把"
            onClear={() => setSelectedKeys([])}
            actions={[
              {
                id: "enable",
                label: "启用",
                icon: "play",
                onSelect: () => setStatusBulk("active"),
              },
              {
                id: "disable",
                label: "禁用",
                icon: "pause",
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
                  id: "name",
                  header: "名称",
                  cell: (r) => (
                    <TableTitleCell
                      icon="key"
                      title={r.name}
                      description={r.owner}
                    />
                  ),
                },
                {
                  id: "kind",
                  header: "类型",
                  cell: (r) => (
                    <Badge
                      variant={r.kind === "internal" ? "secondary" : "outline"}
                    >
                      {r.kind === "internal" ? "Internal" : "External"}
                    </Badge>
                  ),
                },
                {
                  id: "prefix",
                  header: "前缀",
                  cell: (r) => <Kbd>{r.prefix}</Kbd>,
                },
                {
                  id: "status",
                  header: "状态",
                  cell: (r) => (
                    <StatusBadge tone={KEY_STATUS_META[r.status].tone} dot>
                      {KEY_STATUS_META[r.status].label}
                    </StatusBadge>
                  ),
                },
                { id: "lastUsed", header: "最近使用", cell: (r) => r.lastUsed },
                { id: "createdAt", header: "签发于", cell: (r) => r.createdAt },
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
                    icon="key"
                    title={r.name}
                    description={r.owner}
                    status={
                      <StatusBadge tone={KEY_STATUS_META[r.status].tone} dot>
                        {KEY_STATUS_META[r.status].label}
                      </StatusBadge>
                    }
                    actions={rowMenu(r)}
                    meta={
                      <>
                        <Badge
                          variant={
                            r.kind === "internal" ? "secondary" : "outline"
                          }
                        >
                          {r.kind === "internal" ? "Internal" : "External"}
                        </Badge>
                        <Kbd>{r.prefix}</Kbd>
                        <span>
                          最近使用 {r.lastUsed} · 签发于 {r.createdAt}
                        </span>
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
        open={dialog?.kind === "issue"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="签发 API Key"
        description="明文只在签发完成的那一次展示，此后只能轮换。"
        submitLabel="签发"
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="key-name">名称</FieldLabel>
            <Input
              id="key-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="runa-engine"
            />
            <FieldDescription>调用方在日志与计量里按它归集。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="key-kind">类型</FieldLabel>
            <NativeSelect
              id="key-kind"
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as KeyKind })
              }
            >
              <option value="internal">Internal（服务间调用）</option>
              <option value="external">External（外部应用）</option>
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor="key-owner">归属</FieldLabel>
            <Input
              id="key-owner"
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              placeholder="Runa / 外部合作方"
            />
          </Field>
        </FieldGroup>
      </DialogForm>

      <DialogForm
        open={dialog?.kind === "rotate"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        title={
          dialog?.kind === "rotate" ? `轮换 ${dialog.row.name}` : "轮换 Key"
        }
        description="旧 Key 立即失效。持有方换上新值之前，调用会全部返回 401——先约好切换窗口。"
        submitLabel="轮换"
        onSubmit={submit}
      />

      <DialogForm
        open={dialog?.kind === "revoke"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        danger
        title={
          dialog?.kind === "revoke" ? `吊销 ${dialog.row.name}` : "吊销 Key"
        }
        description="吊销不可撤销，也不能重新启用。持有方只能走签发流程重新申请。"
        submitLabel="吊销"
        onSubmit={submit}
      />

      {/* 明文展示：没有取消/提交的语义，只有"我记下了"，所以提交按钮就是关闭。 */}
      <DialogForm
        open={reveal !== null}
        onOpenChange={(open) => {
          if (!open) setReveal(null);
        }}
        title={reveal?.rotated ? "新 Key 已生成" : "Key 已签发"}
        submitLabel="我已保存"
        cancelLabel="关闭"
        onSubmit={(e) => {
          e.preventDefault();
          setReveal(null);
        }}
      >
        <Banner
          tone="warning"
          title="这是唯一一次看到明文"
          description="关闭后无法再次查看。丢失只能轮换，不能找回。"
        />
        <Field>
          <FieldLabel htmlFor="key-secret">{reveal?.name}</FieldLabel>
          <div className="flex items-center gap-sm">
            <Input
              id="key-secret"
              readOnly
              value={reveal?.secret ?? ""}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void copySecret(reveal?.secret ?? "")}
            >
              <Icon name="copy" size="sm" />
              复制
            </Button>
          </div>
        </Field>
      </DialogForm>
    </>
  );
}
