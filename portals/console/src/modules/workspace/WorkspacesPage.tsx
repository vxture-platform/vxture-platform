"use client";

/**
 * WorkspacesPage.tsx — 工作空间管理。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 路由 `/workspaces`。owner 2026-09-09 就「两层用户只展示一次」裁定：**先把工作空间
 * 做成真轴**，而不是加第二个成员列表。这一页是那条决定的可见面。
 *
 * ── 在这之前它是什么 ──
 * 一个 1:1 的隐含物：建租户时插一条 `default workspace`，之后再没有第二条，也没有
 * 任何建 / 改 / 停的入口。订阅、订单、配额池、用量都挂着 `workspace_id`，但那一列
 * 永远只有一个值。
 *
 * ── 为什么「停用」不是「删除」 ──
 * 35 张表引用 `workspace_id`。硬删会把订阅、账单、用量的归属整片打断——那些行不会
 * 跟着消失，只会变成指不到人的孤儿。所以只有 archived，且默认那个连停用都不行。
 *
 * ── 两级门 ──
 * 看是 `tenant.member.read`（我在哪些工作空间里，不是管理动作）；建 / 改 / 设默认 /
 * 停用都要 `tenant.workspace.manage`。没有后者的人看得到这张表，但一个动作也不出现——
 * 不给按不动的按钮。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useConfirmLabels } from "@/lib/destructive";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldLabel,
  Icon,
  Input,
  StatusBadge,
  TableTitleCell,
  Textarea,
  useListPagination,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  archiveWorkspace,
  createWorkspace,
  fetchWorkspaces,
  setDefaultWorkspace,
  updateWorkspace,
  type ConsoleWorkspace,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { PageSection } from "@/layout/shell";
import { ListPagination } from "@/components/pagination";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { fmtDate } from "@/modules/commerce/components/hubModel";

const STATUS_TONES: Record<ConsoleWorkspace["status"], StatusBadgeTone> = {
  active: "success",
  archived: "neutral",
};

/**
 * 后端可能给回的拒绝理由（与 console-bff 的 `WORKSPACE_ERRORS` 同一张表）。
 * 闭集：多一个码这里不认就走通用兜底，而不是把码本身显示给用户。
 */
const WORKSPACE_ERROR_CODES = [
  "not_found",
  "name_taken",
  "default_locked",
  "last_active",
  "archived",
  "not_empty",
] as const;
type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];

interface FormState {
  /** 编辑中的工作空间；null = 新建。 */
  target: ConsoleWorkspace | null;
  name: string;
  description: string;
}

const EMPTY_FORM: FormState = { target: null, name: "", description: "" };

export function WorkspacesPage() {
  const t = useTranslations("workspacesPage");
  const { session } = useConsoleSession();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();

  const canManage = hasCapability(
    session.capabilities,
    "tenant.workspace.manage",
  );

  const [rows, setRows] = useState<ConsoleWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* 一次只处理一件：两个写动作同时在飞，失败提示会互相盖掉。 */
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchWorkspaces()
      .then((list) => {
        if (active) setRows(list);
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
  }, [session.tenant?.id, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const errorText = useCallback(
    (caught: unknown) => {
      const code =
        caught instanceof ConsoleBffError &&
        (WORKSPACE_ERROR_CODES as readonly string[]).includes(caught.message)
          ? (caught.message as WorkspaceErrorCode)
          : null;
      return code ? t(`errors.${code}`) : t("errors.generic");
    },
    [t],
  );

  /** 所有写动作走同一条收尾：清提示 → 做 → 重取 → 报结果。 */
  const run = useCallback(
    async (action: () => Promise<unknown>, successKey: string) => {
      if (busy) return false;
      setBusy(true);
      setMessage(null);
      setError(null);
      try {
        await action();
        reload();
        setMessage(t(successKey));
        return true;
      } catch (caught) {
        setError(errorText(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, errorText, reload, t],
  );

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError(t("errors.nameRequired"));
      return;
    }
    /* 说明为空串时提交 null 而不是 ""：库里那一列可空，空串与「没填」是同一件事，
       存两种表示会让下次读出来的判空条件到处不一致。 */
    const description = form.description.trim() || null;
    const ok = await run(
      () =>
        form.target
          ? updateWorkspace(form.target.id, { name, description })
          : createWorkspace({ name, description }),
      form.target ? "feedback.updated" : "feedback.created",
    );
    if (ok) setForm(null);
  }

  /* 排序在分页之前——`useListPagination` 拿到的必须是已排好的全集。 */
  const sortAccessors = useMemo(
    () => ({
      name: (w: ConsoleWorkspace) => w.name,
      memberCount: (w: ConsoleWorkspace) => w.memberCount,
      createdAt: (w: ConsoleWorkspace) => new Date(w.createdAt).getTime(),
    }),
    [],
  );
  const {
    sort,
    onSortChange,
    rows: sortedRows,
  } = useTableSort(rows, sortAccessors);
  const pager = useListPagination(sortedRows, 20);

  const menuItems = (w: ConsoleWorkspace): ActionMenuItem[] => [
    {
      id: "edit",
      label: t("actions.edit"),
      icon: "edit",
      disabled: busy,
      onSelect: () =>
        setForm({
          target: w,
          name: w.name,
          description: w.description ?? "",
        }),
    },
    {
      id: "default",
      label: t("actions.setDefault"),
      icon: "star",
      /* 已是默认、或已停用的，这一项按不动。给出原因而不是让人点了没反应。 */
      disabled: busy || w.isDefault || w.status !== "active",
      ...(w.isDefault
        ? { hint: t("actions.alreadyDefault") }
        : w.status !== "active"
          ? { hint: t("actions.archivedHint") }
          : {}),
      onSelect: () => {
        void run(() => setDefaultWorkspace(w.id), "feedback.defaultSet");
      },
    },
    {
      id: "archive",
      label: t("actions.archive"),
      icon: "x",
      danger: true,
      disabled: busy || w.isDefault || w.status !== "active",
      ...(w.isDefault
        ? { hint: t("actions.defaultLockedHint") }
        : w.status !== "active"
          ? { hint: t("actions.alreadyArchived") }
          : {}),
      confirm: withLabels({
        verb: t("actions.archiveVerb"),
        target: w.name,
        /* 说清楚它**不是删除**：里面的订阅与账单不会消失，只是这个空间不再能进。 */
        consequence: t("actions.archiveConsequence"),
        cancelLabel: t("actions.archiveKeep"),
        onConfirm: async () => {
          await run(() => archiveWorkspace(w.id), "feedback.archived");
        },
      }),
    },
  ];

  const columns: DataTableColumn<ConsoleWorkspace>[] = [
    {
      id: "name",
      sortable: true,
      header: t("table.colName"),
      cell: (w) => (
        <TableTitleCell
          title={w.name}
          /* 副行给可视码而不是说明：说明可能为空，而号永远在，且它是这一行在
             工单、日志、跨页跳转里的身份（§11 v4：界面只出现可视码）。 */
          description={w.workspaceNo}
        />
      ),
    },
    {
      id: "status",
      header: t("table.colStatus"),
      align: "center",
      cell: (w) => (
        <span className="inline-flex items-center gap-xs">
          <StatusBadge tone={STATUS_TONES[w.status]}>
            {t(`status.${w.status}`)}
          </StatusBadge>
          {w.isDefault ? (
            <StatusBadge tone="info">{t("table.default")}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: "memberCount",
      sortable: true,
      header: t("table.colMembers"),
      align: "center",
      cell: (w) => <span className="tabular-nums">{w.memberCount}</span>,
    },
    {
      id: "description",
      header: t("table.colDescription"),
      align: "center",
      cell: (w) => (
        <span className="text-body-sm text-muted-foreground">
          {w.description ?? "—"}
        </span>
      ),
    },
    {
      id: "createdAt",
      sortable: true,
      header: t("table.colCreatedAt"),
      align: "center",
      cell: (w) => (
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {fmtDate(w.createdAt)}
        </span>
      ),
    },
  ];

  const activeCount = useMemo(
    () => rows.filter((w) => w.status === "active").length,
    [rows],
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="stack"
        title={t("title")}
        description={t("description")}
        action={
          canManage ? (
            <Button
              size="md"
              disabled={busy}
              onClick={() => setForm({ ...EMPTY_FORM })}
            >
              <Icon name="plus" size="xs" fallback="placeholder" />
              <span>{t("actions.create")}</span>
            </Button>
          ) : undefined
        }
      />

      <PageSection
        icon="stack"
        level={2}
        title={t("table.title")}
        description={t("table.description", { count: activeCount })}
      >
        <div className="flex flex-col gap-md">
          {loadFailed ? (
            <LoadFailedBanner onRetry={reload} retrying={loading} />
          ) : null}
          {message ? <Banner tone="success" title={message} /> : null}
          {error ? <Banner tone="danger" title={error} /> : null}

          <DataTable<ConsoleWorkspace>
            labels={tableLabels}
            columns={columns}
            rows={pager.pageRows}
            {...(sort ? { sort } : {})}
            onSortChange={onSortChange}
            rowKey={(w) => w.id}
            /* 首格占位：这张表没有多选也没有展开，补一格让首个业务列与同域其它表
               的首列落在同一条 x 上。 */
            leadingSpacer
            loading={loading}
            indexStart={pager.indexStart}
            /* 没有管理权限的人这一列整个不出现——不给按不动的菜单。 */
            {...(canManage
              ? {
                  rowActions: (w: ConsoleWorkspace) => (
                    <ActionMenu label={t("rowMenu")} items={menuItems(w)} />
                  ),
                }
              : {})}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState
                  icon="stack"
                  title={t("table.empty")}
                  description={t("table.emptyHint")}
                />
              )
            }
            footer={
              <ListPagination
                page={pager.page}
                pageCount={pager.pageCount}
                total={rows.length}
                pageSize={pager.pageSize}
                onPageSizeChange={pager.onPageSizeChange}
                onPageChange={pager.onPageChange}
              />
            }
          />
        </div>
      </PageSection>

      {form ? (
        <DialogForm
          open
          title={form.target ? t("dialog.editTitle") : t("dialog.createTitle")}
          description={
            form.target ? t("dialog.editHint") : t("dialog.createHint")
          }
          submitLabel={t("dialog.save")}
          cancelLabel={t("dialog.cancel")}
          submitting={busy}
          onOpenChange={(open) => {
            if (!open) setForm(null);
          }}
          onSubmit={(event) => void submitForm(event)}
        >
          {/* 标签在上、控件在下（DS Field）；控件塞进横排 Label 会把中文标题挤到逐字换行 */}
          <Field>
            <FieldLabel htmlFor="workspace-name">{t("dialog.name")}</FieldLabel>
            <Input
              id="workspace-name"
              value={form.name}
              onChange={(event) =>
                setForm((cur) =>
                  cur ? { ...cur, name: event.target.value } : cur,
                )
              }
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-description">
              {t("dialog.descriptionLabel")}
            </FieldLabel>
            <Textarea
              id="workspace-description"
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((cur) =>
                  cur ? { ...cur, description: event.target.value } : cur,
                )
              }
            />
          </Field>
        </DialogForm>
      ) : null}
    </ViewLayout>
  );
}
