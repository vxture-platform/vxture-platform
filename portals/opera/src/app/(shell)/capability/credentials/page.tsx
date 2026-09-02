"use client";

/* Credential — 第三方系统凭证托管与代理注入（连接器调用外部系统时用）。
 *
 * 2026-08-13 从「只能录入的表单」升为真管理页。此前 runos 只交付了写入口，
 * 页面挂着一条横幅说"没有清单、不能轮换、不能吊销"——那条横幅**促成了**
 * `vxture-runos#65`，runos 随后在 `280-management-apis.md` §5b.1/§5b.2 把这
 * 三样确认为缺口（TD-010）并补齐：`GET /governance/credentials`（元数据）、
 * `POST .../rotate`、`DELETE`（吊销）、`PATCH .../applies-to`（重定范围）。
 *
 * **列表永远只有元数据。** runos 侧 `listMetadata()` 连 `secret_ciphertext`
 * 都不 select——不是"查出来再过滤"，是根本不查。所以这页回答得了"这个连接器
 * 的凭证配了没有、上次什么时候轮换的"，回答不了"密钥是什么"，后者永远无解，
 * 这是对的。
 *
 * **吊销会清空密文**（不是打标记），不可逆——所以走独立确认框，且和轮换一样
 * 挂 step-up 闸门（`product_250` v0.4：判据归 platform 目录、执行归 console）。
 *
 * mode 仍只接受 "account-scoped"：per-caller 依赖平台侧 RFC 8693 token
 * exchange（`vxture-platform#226`，未落地），runos 会直接拒。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldTier,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useLocale, useTranslations } from "next-intl";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";

const MANAGE = "capability:runos.manage";

/** 元数据视图——runos 侧不 select 密文，这里自然也没有对应字段。 */
interface CredentialBindingRecord {
  bindingId: string;
  credentialClass: string;
  providerId: string;
  mode: string;
  appliesTo: string[];
  subjectScope: string | null;
  state: string;
  createdAt: string;
  rotatedAt: string | null;
}

const STATE_TONE: Record<string, StatusBadgeTone> = {
  active: "success",
  revoked: "danger",
};

type DialogState =
  | { kind: "create" }
  | { kind: "rotate"; row: CredentialBindingRecord }
  /* 没有 `revoke` 档：吊销的确认由 DS 的 `ConfirmDestructive` 接管。 */
  | { kind: "scope"; row: CredentialBindingRecord }
  | null;

interface CredentialDraft {
  credentialClass: string;
  providerId: string;
  appliesTo: string;
  secretMaterial: string;
}

const EMPTY_DRAFT: CredentialDraft = {
  credentialClass: "",
  providerId: "",
  appliesTo: "",
  secretMaterial: "",
};

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/8/18`，英文 `8/18/2026`。 */
function formatTime(iso: string | null, locale: string): string {
  if (!iso) return "从未";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(locale, { hour12: false });
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export default function RunosCredentialsPage() {
  const locale = useLocale();
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  /* 凭证类操作全部托管密钥材料，走 step-up 闸门。 */
  const { runWithStepUp } = useStepUp();
  const canManage = can(MANAGE);

  const [rows, setRows] = useState<CredentialBindingRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  const [secretInput, setSecretInput] = useState("");
  const [scopeInput, setScopeInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<CredentialBindingRecord[]>(
        "/api/runos/credentials",
      );
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取凭证清单失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw === ""
      ? rows
      : rows.filter(
          (r) =>
            r.credentialClass.toLowerCase().includes(kw) ||
            r.providerId.toLowerCase().includes(kw) ||
            r.appliesTo.some((c) => c.toLowerCase().includes(kw)),
        );
  }, [rows, keyword]);

  const pager = useListPagination(filtered, 20);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setDialog({ kind: "create" });
  }

  function openRotate(row: CredentialBindingRecord) {
    setSecretInput("");
    setDialog({ kind: "rotate", row });
  }

  function openScope(row: CredentialBindingRecord) {
    setScopeInput(row.appliesTo.join(", "));
    setDialog({ kind: "scope", row });
  }

  /**
   * 吊销一条凭证绑定。落锤，由菜单项的 `confirm.onConfirm` 调用。
   *
   * 两处与共享 `submit` 不同的地方：
   *
   * 1. **失败一律重新抛出**——DS 的确认件按 Promise 是否 rejected 决定关不关框，
   *    吞掉异常会让一次失败的吊销看起来成功了。
   * 2. **取消二次验证不出 Toast，但仍然抛**：用户是从第二道门退回来的，该落回
   *    第一道门（确认框保持打开），而不是被告知"操作失败"。
   */
  async function revokeBinding(row: CredentialBindingRecord) {
    try {
      await runWithStepUp(() =>
        api.delete(`/api/runos/credentials/${row.bindingId}`),
      );
      toast({
        tone: "warning",
        title: `「${row.credentialClass}」已吊销`,
        description:
          "密文已清空，不可恢复；需要重新录入一条新绑定。凭证由网关每次调用直读、不走快照，所以这一步是立刻生效的——撤授权 / 禁端点 / 撤版本都不是。",
      });
      await reload();
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({ tone: "danger", title: "吊销失败", ...describeError(error) });
      }
      throw error;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    setSubmitting(true);
    try {
      if (dialog.kind === "create") {
        await runWithStepUp(() =>
          api.post("/api/runos/credentials", {
            credentialClass: draft.credentialClass.trim(),
            providerId: draft.providerId.trim(),
            mode: "account-scoped",
            appliesTo: parseList(draft.appliesTo),
            secretMaterial: draft.secretMaterial,
          }),
        );
        toast({
          tone: "success",
          title: `凭证「${draft.credentialClass.trim()}」已入库`,
          description: "明文已加密落库，此后任何读接口都不会再回显。",
        });
        setDraft(EMPTY_DRAFT);
      } else if (dialog.kind === "rotate") {
        await runWithStepUp(() =>
          api.post(`/api/runos/credentials/${dialog.row.bindingId}/rotate`, {
            secretMaterial: secretInput,
          }),
        );
        toast({
          tone: "success",
          title: `「${dialog.row.credentialClass}」已轮换`,
          description: "旧密文已被替换，不保留、不可找回。",
        });
      } else {
        const appliesTo = parseList(scopeInput);
        await runWithStepUp(() =>
          api.patch(
            `/api/runos/credentials/${dialog.row.bindingId}/applies-to`,
            { appliesTo },
          ),
        );
        toast({
          tone: "success",
          title: `「${dialog.row.credentialClass}」适用范围已更新`,
          description: `现覆盖 ${appliesTo.length} 个能力。`,
        });
      }
      setDialog(null);
      await reload();
    } catch (error) {
      /* 取消验证不是错误，静默——对话框保持打开，内容还在。 */
      if (!isStepUpCancelled(error)) {
        toast({ tone: "danger", title: "操作失败", ...describeError(error) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const createValid =
    draft.credentialClass.trim() !== "" &&
    draft.providerId.trim() !== "" &&
    parseList(draft.appliesTo).length > 0 &&
    draft.secretMaterial.trim() !== "";

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取凭证绑定。"
      />
    ) : load.kind === "error" ? (
      <EmptyState
        title={tShared("common.loadFailed")}
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {tShared("common.retry")}
          </Button>
        }
      />
    ) : filtered.length !== rows.length ? (
      <EmptyState
        title="没有匹配的凭证"
        description={tShared("common.noMatchKeywordHint")}
      />
    ) : (
      <EmptyState title="暂无凭证绑定" description="点击「录入凭证」开始。" />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="key"
            title="凭证托管"
            description="第三方系统凭证托管与代理注入；列表只含元数据，密钥材料永不回显。"
            action={
              canManage ? (
                <Button onClick={openCreate} disabled={submitting}>
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  录入凭证
                </Button>
              ) : null
            }
          />
        }
        summary={
          <Banner
            tone="info"
            title="控制台零持有明文"
            description="密钥只在录入与轮换时经过一次，落库前 AES-256-GCM 加密；此后任何读接口——包括这个页面——都拿不到它。忘了只能轮换，不能查看。注入由网关在出站时完成，调用方全程看不到凭证。"
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
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
                placeholder="搜索类别 / Provider / 适用能力…"
                aria-label="搜索凭证"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
          </FilterBar>
        }
        table={
          <DataTable
            columns={[
              {
                id: "class",
                header: "凭证类别",
                cell: (r: CredentialBindingRecord) => (
                  <TableTitleCell
                    icon="key"
                    title={
                      <span className="font-mono">{r.credentialClass}</span>
                    }
                    description={`Provider ${r.providerId}`}
                  />
                ),
              },
              {
                id: "appliesTo",
                header: "适用能力",
                cell: (r: CredentialBindingRecord) => (
                  <span className="text-body-sm text-muted-foreground">
                    {r.appliesTo.length === 0
                      ? "—"
                      : r.appliesTo.length <= 2
                        ? r.appliesTo.join("、")
                        : `${r.appliesTo.slice(0, 2).join("、")} 等 ${r.appliesTo.length} 个`}
                  </span>
                ),
              },
              {
                id: "rotated",
                header: "上次轮换",
                width: "sm",
                cell: (r: CredentialBindingRecord) =>
                  formatTime(r.rotatedAt, locale),
              },
              {
                id: "mode",
                header: "模式",
                align: "center",
                width: "xs",
                cell: (r: CredentialBindingRecord) => (
                  <Badge variant="secondary">{r.mode}</Badge>
                ),
              },
              {
                id: "state",
                header: tShared("columns.state"),
                align: "center",
                width: "xs",
                cell: (r: CredentialBindingRecord) => (
                  <StatusBadge tone={STATE_TONE[r.state] ?? "neutral"} dot>
                    {r.state}
                  </StatusBadge>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r) => r.bindingId}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            {...(canManage
              ? {
                  rowActions: (r: CredentialBindingRecord) => (
                    <ActionMenu
                      label={`${r.credentialClass} 操作`}
                      disabled={submitting}
                      items={[
                        {
                          id: "rotate",
                          label: "轮换",
                          icon: "refresh",
                          disabled: r.state === "revoked",
                          onSelect: () => openRotate(r),
                        },
                        {
                          id: "scope",
                          label: "调整适用范围",
                          icon: "edit",
                          disabled: r.state === "revoked",
                          onSelect: () => openScope(r),
                        },
                        {
                          id: "revoke",
                          label: "吊销",
                          icon: "prohibit",
                          danger: true,
                          separatorBefore: true,
                          disabled: r.state === "revoked",
                          confirm: withLabels({
                            verb: "吊销",
                            target: `「${r.credentialClass}」的凭证绑定`,
                            /* 凭证是这套管理面里**唯一即时生效**的撤销：网关每次
                               调用都直读凭证库，不经快照。撤授权 / 禁端点 / 撤版本
                               三个都受快照约束、会再放行一轮——真要立刻断掉一条外部
                               调用，动的是这里。这一句必须留在后果里。 */
                            consequence:
                              "密文会被直接清空（不是打个标记），不可恢复，需要重新录入一条新绑定。凭证由网关每次调用直读、不走快照，所以这一步立刻生效——依赖它的能力调用会马上开始失败。",
                            onConfirm: () => revokeBinding(r),
                          }),
                        },
                      ]}
                    />
                  ),
                }
              : {})}
            footer={
              <ListPagination
                className="w-full"
                currentPage={pager.page}
                pageCount={pager.pageCount}
                total={rows.length}
                filteredTotal={filtered.length}
                pageSize={pager.pageSize}
                onPageSizeChange={pager.onPageSizeChange}
                onPageChange={pager.onPageChange}
              />
            }
            empty={emptyState}
          />
        }
      />

      {/* ── 录入 ─────────────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "create"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="录入凭证"
        description="明文只在这一次经过；提交后立即加密落库，之后只能轮换、不能查看。"
        submitLabel="录入"
        submitting={submitting}
        submitDisabled={!createValid}
        onSubmit={submit}
      >
        <FieldGroup>
          {/* 两档（DS `FieldTier`）。**没有高级档**：四项都必填，凑一个空档只是把
              规则抄一遍。 */}
          <FieldTier
            tier="identity"
            hint="类别须与目标能力 credentialRequirements[].credentialClass 对上，对不上则这条凭证永远不会被取用。"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="cred-class">凭证类别</FieldLabel>
                <Input
                  id="cred-class"
                  value={draft.credentialClass}
                  onChange={(e) =>
                    setDraft({ ...draft, credentialClass: e.target.value })
                  }
                  placeholder="github-oauth"
                  className="font-mono"
                />
                <FieldDescription>
                  须与目标能力的 credentialRequirements[].credentialClass 对应。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="cred-provider">Provider</FieldLabel>
                <Input
                  id="cred-provider"
                  value={draft.providerId}
                  onChange={(e) =>
                    setDraft({ ...draft, providerId: e.target.value })
                  }
                  placeholder="github"
                />
              </Field>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="details"
            title="适用范围与明文"
            hint="明文只在这一次提交时经过控制台，之后任何页面都读不回来。"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="cred-applies">
                  适用的 Capability（逗号分隔）
                </FieldLabel>
                <Input
                  id="cred-applies"
                  value={draft.appliesTo}
                  onChange={(e) =>
                    setDraft({ ...draft, appliesTo: e.target.value })
                  }
                  placeholder="arda.github-connector, arda.gitlab-connector"
                />
                <FieldDescription>至少一个。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="cred-secret">凭证明文</FieldLabel>
                <Input
                  id="cred-secret"
                  type="password"
                  value={draft.secretMaterial}
                  onChange={(e) =>
                    setDraft({ ...draft, secretMaterial: e.target.value })
                  }
                  placeholder="ghp_…"
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
            </FieldGroup>
          </FieldTier>
        </FieldGroup>
      </DialogForm>

      {/* ── 轮换 ─────────────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "rotate"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        title={
          dialog?.kind === "rotate"
            ? `轮换「${dialog.row.credentialClass}」`
            : "轮换凭证"
        }
        description="新值替换旧密文，旧值不保留、不可找回。上游侧请先确认新密钥已生效，再在这里替换。"
        submitLabel="轮换"
        submitting={submitting}
        submitDisabled={secretInput.trim() === ""}
        onSubmit={submit}
      >
        <Field>
          <FieldLabel htmlFor="rotate-secret">新的凭证明文</FieldLabel>
          <Input
            id="rotate-secret"
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
      </DialogForm>

      {/* ── 调整适用范围 ─────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "scope"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        title={
          dialog?.kind === "scope"
            ? `适用范围 · ${dialog.row.credentialClass}`
            : "调整适用范围"
        }
        description="不需要重新提供密钥。清空等于退役——runos 会拒绝空数组，要退役请用「吊销」。"
        submitLabel={tShared("common.save")}
        submitting={submitting}
        submitDisabled={parseList(scopeInput).length === 0}
        onSubmit={submit}
      >
        <Field>
          <FieldLabel htmlFor="scope-list">
            适用的 Capability（逗号分隔）
          </FieldLabel>
          <Input
            id="scope-list"
            value={scopeInput}
            onChange={(e) => setScopeInput(e.target.value)}
            className="font-mono"
          />
          <FieldDescription>
            这条凭证会被注入到列出的每一个能力的出站调用里，改动即刻生效。
          </FieldDescription>
        </Field>
      </DialogForm>
    </>
  );
}
