"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionButton,
  ActionMenu,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Input,
  Label,
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  Pagination,
  StatusBadge,
  Textarea,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import {
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
  type AnnouncementWriteInput,
} from "@/api/admin-bff";
import type { AnnouncementRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDate } from "@/modules/tenants/tenant-utils";
import type { DestructiveConfirm } from "@vxture/design-system";
import { useConfirmLabels } from "@/modules/shared/destructive";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type AnnouncementTypeFilter = AnnouncementRecord["type"] | "all";
type AnnouncementStatusFilter = AnnouncementRecord["status"] | "all";
type ViewMode = "list" | "cards";
type Severity = "info" | "warning" | "critical";
type Targeting = "all" | "personal" | "organization";
type DialogMode = "create" | "edit" | null;

interface AnnouncementForm {
  announcementType: AnnouncementRecord["type"];
  severity: Severity;
  title: string;
  content: string;
  targeting: Targeting;
  // Plan-code targeting is not editable in this form; carried verbatim so an
  // edit does not silently drop a plan-scoped audience set by other means.
  targetPlans: string[];
  publishAt: string;
  expiresAt: string;
}

const PAGE_SIZE = 20;

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AnnouncementRecord["type"], string> = {
  system: "系统",
  maintenance: "维护",
  marketing: "营销",
  security: "安全",
};

const STATUS_LABELS: Record<AnnouncementRecord["status"], string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};

const SCOPE_LABELS: Record<AnnouncementRecord["targetScope"], string> = {
  all: "全部用户",
  trial: "试用用户",
  active: "付费用户",
  custom: "自定义",
};

/**
 * 状态与类型标换 `StatusBadge`：这两组原先借用了 `vx-admin-role-status-pill--*`
 * 与 `vx-platform-user-status-pill--*`——那是另外两个域的着色类，跨域借用一旦
 * 批 4 重排那两族就会跟着变。它们本身是页面自己的几档语气，归 DS 语气即可。
 */
const ANNOUNCEMENT_STATUS_TONE: Record<
  AnnouncementRecord["status"],
  StatusBadgeTone
> = {
  published: "success",
  draft: "info",
  archived: "neutral",
};

const ANNOUNCEMENT_TYPE_TONE: Record<
  AnnouncementRecord["type"],
  StatusBadgeTone
> = {
  security: "warning",
  maintenance: "info",
  system: "success",
  marketing: "neutral",
};

function announcementSearchText(item: AnnouncementRecord) {
  return [
    item.title,
    item.content,
    TYPE_LABELS[item.type],
    STATUS_LABELS[item.status],
  ]
    .join(" ")
    .toLowerCase();
}

// datetime-local input value（本地时区）。
function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoToLocalInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : toLocalInputValue(d);
}

function createDefaultForm(): AnnouncementForm {
  return {
    announcementType: "system",
    severity: "info",
    title: "",
    content: "",
    targeting: "all",
    targetPlans: [],
    publishAt: toLocalInputValue(new Date()),
    expiresAt: "",
  };
}

// 单选 targeting 无法表达多个租户类型；两者皆命中时按"全部类型"回退。
function targetingFromTenantTypes(types: string[]): Targeting {
  if (
    types.length === 1 &&
    (types[0] === "personal" || types[0] === "organization")
  ) {
    return types[0];
  }
  return "all";
}

// 编辑预填：从读模型精确还原 severity / targeting / 计划投放 / 排期时间。
function formFromRecord(item: AnnouncementRecord): AnnouncementForm {
  return {
    announcementType: item.type,
    severity: item.severity,
    title: item.title,
    content: item.content,
    targeting: targetingFromTenantTypes(item.targetTenantTypes),
    targetPlans: item.targetPlans,
    publishAt: isoToLocalInput(item.publishAt) || toLocalInputValue(new Date()),
    expiresAt: isoToLocalInput(item.expiresAt),
  };
}

function buildPayload(form: AnnouncementForm): AnnouncementWriteInput {
  return {
    announcementType: form.announcementType,
    severity: form.severity,
    title: form.title.trim(),
    content: form.content.trim(),
    targetPlans: form.targetPlans,
    targetTenantTypes: form.targeting === "all" ? [] : [form.targeting],
    publishAt: new Date(form.publishAt).toISOString(),
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  };
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function formIsValid(form: AnnouncementForm) {
  return (
    form.title.trim().length > 0 &&
    form.content.trim().length > 0 &&
    form.publishAt.trim().length > 0
  );
}

// ─── 子组件：汇总卡片 ──────────────────────────────────────────────────────────

function AnnouncementSummary({ items }: { items: AnnouncementRecord[] }) {
  const published = items.filter((i) => i.status === "published").length;
  const drafts = items.filter((i) => i.status === "draft").length;
  const now = new Date();
  const thisMonth = items.filter((i) => {
    if (!i.publishedAt) return false;
    const d = new Date(i.publishedAt);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  }).length;

  return (
    <MetricGrid
      aria-label="公告统计"
      columns={3}
      items={[
        {
          id: "published",
          help: "状态为已发布的公告，含历史发布。",
          icon: "bell",
          label: "已发布公告",
          value: String(published),
        },
        {
          id: "drafts",
          help: "尚未发布的草稿。",
          icon: "edit",
          label: "草稿中",
          value: String(drafts),
        },
        {
          id: "month",
          help: "发布时间落在本自然月内的公告。",
          icon: "calendar",
          label: "本月已发送",
          value: String(thisMonth),
        },
      ]}
    />
  );
}

// ─── 子组件：工具栏 ────────────────────────────────────────────────────────────

function AnnouncementToolbar({
  search,
  typeFilter,
  statusFilter,
  viewMode,
  total,
  onSearchChange,
  onTypeFilterChange,
  onStatusFilterChange,
  onViewModeChange,
  onCreate,
}: {
  search: string;
  typeFilter: AnnouncementTypeFilter;
  statusFilter: AnnouncementStatusFilter;
  viewMode: ViewMode;
  total: number;
  onSearchChange: (v: string) => void;
  onTypeFilterChange: (v: AnnouncementTypeFilter) => void;
  onStatusFilterChange: (v: AnnouncementStatusFilter) => void;
  onViewModeChange: (v: ViewMode) => void;
  onCreate: () => void;
}) {
  const tShared = useTranslations();
  return (
    <FilterBar
      view={viewMode}
      onViewChange={onViewModeChange}
      cardsDisabledReason={tShared("common.cardsRetired")}
      count={`${total} 条`}
      aria-label="公告筛选"
      search={
        <Input
          className="grow basis-media-3xl max-w-panel-sm"
          type="search"
          placeholder="搜索标题、内容…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      }
      onReset={() => {
        onSearchChange("");
        onTypeFilterChange("all");
        onStatusFilterChange("all");
      }}
      actions={
        <ActionButton icon="plus" onClick={onCreate}>
          新建公告
        </ActionButton>
      }
    >
      <NativeSelect
        wrapperClassName="w-fit basis-media-xl"
        value={typeFilter}
        onChange={(e) =>
          onTypeFilterChange(e.target.value as AnnouncementTypeFilter)
        }
        aria-label="公告类型"
      >
        <option value="all">{tShared("filters.allKinds")}</option>
        <option value="system">系统</option>
        <option value="maintenance">维护</option>
        <option value="marketing">营销</option>
        <option value="security">安全</option>
      </NativeSelect>
      <NativeSelect
        wrapperClassName="w-fit basis-media-xl"
        value={statusFilter}
        onChange={(e) =>
          onStatusFilterChange(e.target.value as AnnouncementStatusFilter)
        }
        aria-label="公告状态"
      >
        <option value="all">{tShared("filters.allStates")}</option>
        <option value="draft">{tShared("status.generic.draft")}</option>
        <option value="published">已发布</option>
        <option value="archived">已归档</option>
      </NativeSelect>
    </FilterBar>
  );
}

// ─── 列表列定义 ───────────────────────────────────────────────────────────────

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function announcementColumns(
  locale: string,
): readonly DataTableColumn<AnnouncementRecord>[] {
  return [
    { id: "title", header: "标题", cell: (item) => item.title },
    {
      id: "type",
      header: "类型",
      align: "center",
      cell: (item) => (
        <StatusBadge tone={ANNOUNCEMENT_TYPE_TONE[item.type]}>
          {TYPE_LABELS[item.type]}
        </StatusBadge>
      ),
    },
    {
      id: "scope",
      header: "对象范围",
      cell: (item) => SCOPE_LABELS[item.targetScope],
    },
    {
      id: "status",
      header: "状态",
      align: "center",
      cell: (item) => (
        <StatusBadge tone={ANNOUNCEMENT_STATUS_TONE[item.status]}>
          {STATUS_LABELS[item.status]}
        </StatusBadge>
      ),
    },
    {
      id: "published",
      header: "发布时间",
      cell: (item) =>
        item.publishedAt ? formatDate(item.publishedAt, locale) : "-",
    },
    {
      id: "expires",
      header: "到期时间",
      cell: (item) =>
        item.expiresAt ? formatDate(item.expiresAt, locale) : "-",
    },
  ];
}

function announcementActions(
  item: AnnouncementRecord,
  busy: boolean,
  /* 这是个普通函数不是组件，调不了 hook——所以 `withLabels` 从调用点传进来。
     把它塞进 `handlers` 也能跑，但那袋子装的是"做什么"，不是"怎么说"。 */
  withLabels: (confirm: DestructiveConfirm) => DestructiveConfirm,
  handlers: {
    onEdit: (item: AnnouncementRecord) => void;
    onPublish: (item: AnnouncementRecord) => void;
    onArchive: (item: AnnouncementRecord) => void;
    /** 落锤。返回 Promise：确认由菜单项承担，成功才关框由这个结局判。 */
    onDelete: (item: AnnouncementRecord) => Promise<void>;
  },
) {
  return (
    <ActionMenu
      label={`${item.title} 操作`}
      disabled={busy}
      items={[
        {
          id: "edit",
          label: "编辑",
          icon: "edit",
          disabled: busy,
          onSelect: () => handlers.onEdit(item),
        },
        {
          id: "publish",
          label: "发布",
          icon: "check",
          disabled: busy || item.status !== "draft",
          onSelect: () => handlers.onPublish(item),
        },
        {
          id: "archive",
          label: "归档",
          icon: "stop",
          disabled: busy || item.status !== "published",
          onSelect: () => handlers.onArchive(item),
        },
        {
          id: "delete",
          label: "删除",
          icon: "trash",
          danger: true,
          disabled: busy,
          separatorBefore: true,
          confirm: withLabels({
            verb: "删除",
            target: `公告「${item.title}」`,
            consequence:
              "公告与它的触达记录一并从列表消失，不可撤销。已经推送出去的通知不会被收回——收件人那边看到的还在。",
            onConfirm: () => handlers.onDelete(item),
          }),
        },
      ]}
    />
  );
}

// ─── 子组件：卡片视图 ──────────────────────────────────────────────────────────

function AnnouncementCards({ items }: { items: AnnouncementRecord[] }) {
  const locale = useLocale();
  return (
    <ListCardGrid>
      {items.map((item) => (
        <MetricListCard
          key={item.id}
          icon="megaphone"
          title={item.title}
          tone={ANNOUNCEMENT_STATUS_TONE[item.status]}
          badges={
            <>
              <StatusBadge tone={ANNOUNCEMENT_TYPE_TONE[item.type]}>
                {TYPE_LABELS[item.type]}
              </StatusBadge>
              <StatusBadge tone={ANNOUNCEMENT_STATUS_TONE[item.status]}>
                {STATUS_LABELS[item.status]}
              </StatusBadge>
            </>
          }
          note={
            <p className="m-0 line-clamp-2 text-body-md text-muted-foreground">
              {item.content}
            </p>
          }
          metrics={[
            {
              key: "scope",
              value: SCOPE_LABELS[item.targetScope],
              label: "发布范围",
            },
            {
              key: "publishedAt",
              value: item.publishedAt
                ? formatDate(item.publishedAt, locale)
                : "未发布",
              label: "发布时间",
            },
          ]}
        />
      ))}
    </ListCardGrid>
  );
}

// ─── 子组件：新建/编辑对话框 ───────────────────────────────────────────────────

function AnnouncementFormDialog({
  mode,
  form,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: Exclude<DialogMode, null>;
  form: AnnouncementForm;
  submitting: boolean;
  onChange: (patch: Partial<AnnouncementForm>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const tShared = useTranslations();
  return (
    <DialogForm
      open
      title={mode === "create" ? "新建公告" : "编辑公告"}
      description="草稿保存后可在列表中发布或归档。"
      submitLabel={mode === "create" ? "创建草稿" : "保存修改"}
      submitting={submitting}
      submitDisabled={!formIsValid(form)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={onSubmit}
    >
      <div>
        <Label>
          {tShared("columns.kind")}
          <NativeSelect
            value={form.announcementType}
            onChange={(e) =>
              onChange({
                announcementType: e.target.value as AnnouncementRecord["type"],
              })
            }
          >
            <option value="system">系统</option>
            <option value="maintenance">维护</option>
            <option value="marketing">营销</option>
            <option value="security">安全</option>
          </NativeSelect>
        </Label>
        <Label>
          严重度
          <NativeSelect
            value={form.severity}
            onChange={(e) => onChange({ severity: e.target.value as Severity })}
          >
            <option value="info">一般</option>
            <option value="warning">警告</option>
            <option value="critical">严重</option>
          </NativeSelect>
        </Label>
      </div>
      <Label>
        标题
        <Input
          value={form.title}
          maxLength={256}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="公告标题"
          required
        />
      </Label>
      <Label>
        正文
        <Textarea
          value={form.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="公告正文内容"
          rows={5}
          required
        />
      </Label>
      <div>
        <Label>
          投放对象
          <NativeSelect
            value={form.targeting}
            onChange={(e) =>
              onChange({ targeting: e.target.value as Targeting })
            }
          >
            <option value="all">全部用户</option>
            <option value="personal">仅个人用户</option>
            <option value="organization">仅组织用户</option>
          </NativeSelect>
        </Label>
        <Label>
          发布时间
          <Input
            type="datetime-local"
            value={form.publishAt}
            onChange={(e) => onChange({ publishAt: e.target.value })}
            required
          />
        </Label>
      </div>
      <Label>
        到期时间（可选）
        <Input
          type="datetime-local"
          value={form.expiresAt}
          onChange={(e) => onChange({ expiresAt: e.target.value })}
        />
      </Label>
    </DialogForm>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function AnnouncementsPage() {
  const locale = useLocale();
  /* 钉在 locale 上：工厂每次调用都新建数组，而这套列此前是模块常量、
     身份稳定。不 memo 等于每次渲染换一套列。 */
  const tableColumns = useMemo(() => announcementColumns(locale), [locale]);
  const tShared = useTranslations();
  const { toast } = useToast();
  const withLabels = useConfirmLabels();
  const [items, setItems] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AnnouncementTypeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<AnnouncementStatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [page, setPage] = useState(1);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AnnouncementForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchAnnouncements()
      .then(setItems)
      .catch((error) => {
        setItems([]);
        setLoadError(error instanceof Error ? error.message : "公告读取失败");
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (typeFilter !== "all")
      result = result.filter((i) => i.type === typeFilter);
    if (statusFilter !== "all")
      result = result.filter((i) => i.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) => announcementSearchText(i).includes(q));
    }
    return result;
  }, [items, search, typeFilter, statusFilter]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const handleTypeFilter = (v: AnnouncementTypeFilter) => {
    setTypeFilter(v);
    setPage(1);
  };
  const handleStatusFilter = (v: AnnouncementStatusFilter) => {
    setStatusFilter(v);
    setPage(1);
  };

  async function reload() {
    const records = await fetchAnnouncements();
    setItems(records);
  }

  function openCreate() {
    setEditingId(null);
    setForm(createDefaultForm());
    setDialogMode("create");
  }

  function openEdit(item: AnnouncementRecord) {
    setEditingId(item.id);
    setForm(formFromRecord(item));
    setDialogMode("edit");
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingId(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formIsValid(form)) return;
    setSubmitting(true);
    try {
      const payload = buildPayload(form);
      if (dialogMode === "edit" && editingId) {
        await updateAnnouncement(editingId, payload);
        toast({ tone: "success", title: "公告已更新" });
      } else {
        await createAnnouncement(payload);
        toast({ tone: "success", title: "草稿已创建" });
      }
      await reload();
      closeDialog();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(label: string, action: () => Promise<unknown>) {
    setSubmitting(true);
    try {
      await action();
      await reload();
      toast({ tone: "success", title: label });
    } catch (error) {
      toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  function handlePublish(item: AnnouncementRecord) {
    void runAction("公告已发布", () => publishAnnouncement(item.id));
  }

  function handleArchive(item: AnnouncementRecord) {
    void runAction("公告已归档", () => archiveAnnouncement(item.id));
  }

  /* 收参数而不是读 `pendingDelete`：确认由菜单项承担，那一项知道自己作用在哪
     一行——再绕一圈全局待删态，是给同一个事实造第二个来源。 */
  async function confirmDelete(target: AnnouncementRecord) {
    await runAction("公告已删除", () => deleteAnnouncement(target.id));
  }

  return (
    <>
      <ListPageTemplate
        header={
          <PageHeader
            icon="bell"
            title="消息公告"
            description="发布平台公告和定向通知，查询通知触达与历史记录。"
          />
        }
        summary={<AnnouncementSummary items={items} />}
        filters={
          <AnnouncementToolbar
            search={search}
            typeFilter={typeFilter}
            statusFilter={statusFilter}
            viewMode={viewMode}
            total={filtered.length}
            onSearchChange={handleSearch}
            onTypeFilterChange={handleTypeFilter}
            onStatusFilterChange={handleStatusFilter}
            onViewModeChange={setViewMode}
            onCreate={openCreate}
          />
        }
        table={
          /* 读取失败是第三态，DataTable 只认加载/空/有数据，故留在外层。 */
          loadError ? (
            <EmptyState title="公告读取失败" description={loadError} />
          ) : viewMode === "list" ? (
            <DataTable
              columns={tableColumns}
              rows={pageItems}
              rowKey={(item) => item.id}
              loading={loading}
              indexStart={(page - 1) * PAGE_SIZE + 1}
              rowActions={(item) =>
                announcementActions(item, submitting, withLabels, {
                  onEdit: openEdit,
                  onPublish: handlePublish,
                  onArchive: handleArchive,
                  onDelete: confirmDelete,
                })
              }
              empty={
                <EmptyState
                  title="暂无公告"
                  description={
                    search || typeFilter !== "all" || statusFilter !== "all"
                      ? tShared("common.adjustFiltersHint")
                      : "点击「新建公告」发布第一条平台通知"
                  }
                />
              }
              footer={
                pageCount > 1 ? (
                  <Pagination
                    page={page}
                    pageCount={pageCount}
                    total={filtered.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                  />
                ) : null
              }
            />
          ) : loading ? (
            <EmptyState title="加载中…" />
          ) : pageItems.length ? (
            <>
              <AnnouncementCards items={pageItems} />
              {pageCount > 1 ? (
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              title="暂无公告"
              description={
                search || typeFilter !== "all" || statusFilter !== "all"
                  ? tShared("common.adjustFiltersHint")
                  : "点击「新建公告」发布第一条平台通知"
              }
            />
          )
        }
      />

      {dialogMode ? (
        <AnnouncementFormDialog
          mode={dialogMode}
          form={form}
          submitting={submitting}
          onChange={(patch) => setForm((old) => ({ ...old, ...patch }))}
          onClose={closeDialog}
          onSubmit={(event) => void submitForm(event)}
        />
      ) : null}
    </>
  );
}
