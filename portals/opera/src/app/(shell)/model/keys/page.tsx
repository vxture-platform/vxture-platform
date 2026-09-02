"use client";

/* API Key — 网关入方向凭证。**只剩 external 一类。**
 *
 * 2026-08-12 接真实数据（liaison #247，vxture-atlas#149 已合并）：Atlas 交付
 * `/capability/api-keys*`——网关**入方向**调用者凭证，和 provider-keys（Atlas
 * 向外的出方向凭证）是反方向，不要混。
 *
 * ── 2026-08-14 internal 退役（owner 决定；Atlas 侧 incr/08）────────────────────
 *
 * internal 本来是给兄弟产品用的，但它们**每一个**（karda / arda / varda / runos）
 * 都已经持有 OIDC 客户端，用短时 S2S 令牌调 `/v1/*`，而令牌上的 `act.sub` 就是
 * `product_endpoint_grants` 拿去鉴权的那个产品身份。所以一把 internal key 不会
 * 增加任何能力，它只会**用更弱的东西替掉更强的**：
 *
 *     OIDC S2S 令牌            internal API key
 *     300 秒有效期             长期有效
 *     静态无留存               两边各存一份共享密钥
 *     身份是签名过的           身份是"谁拿着这个密钥谁就是"
 *
 * 留着这个档位不用，等于在邀请后来人去实现上面右边那一列。所以是**删掉**，不是
 * 留着不用——这一页此前的类型下拉正是那张邀请函。
 *
 * external 保留，且**明确不接认证**。这不是"还没做"：第三方合作方不是 vxture IdP
 * 的 OIDC 客户端，key 是它唯一可能的认证方式，而把 key 绑到 product_code 之后它就
 * 也是授权表里的一个产品，两条认证路径共用同一套授权模型——设计是通的。它悬着的
 * 唯一原因是**今天没有外部合作方**：Atlas 只在 tailnet 上，atlas.vxture.com 是预留
 * 未绑定。这是商业判断，不是工程缺口，页面上要照这个说，不要再说"分阶段交付"。
 *
 * 历史上的 internal 行**保留并置为 revoked，不删**（incr/08 的判断）：revoked 就是
 * 一份不再有效的凭证的终态，而删掉会连它被签发过这件事一起抹掉——轮换历史与审计
 * 留痕都挂在这一行上。它们从来没认证过任何东西，所以置为 revoked 不会让谁不能用。
 * 因此这页仍然要**如实渲染** internal 行，只是标成已退役，不能再签、不能再启用。
 *
 * 2026-08-13 二次验证改由 opera 自己跑（`product_250` v0.4：step-up 的判据归
 * platform 目录、**执行归 console**，provider 不做这个判断——它没有 UI，跑不了
 * 仪式，且它看到的 `amr` 是会话级"登录时用过 MFA"，不是操作级"此刻本人在场"）。
 * 全部 5 个写操作包在 `runWithStepUp` 里：命中闸门 → 弹 TOTP → 换 300s 凭证 →
 * 自动重试一次。此前这里的兜底文案写着"opera 还没有 step-up 流程"，已作废。
 *
 * 范围限制（issue 原文明确要求不要在 UI 上暗示相反的事）：这批 key 现在还没
 * 接入任何认证路径——`/v1/*` 只认 S2S OIDC token，签发一个 key 不代表它今天
 * 就能用来调网关。签发/轮换的明文展示对话框里带这条说明。
 *
 * 签发与轮换是**唯一一次**能看到明文的时刻，所以它们不走"操作完弹个 toast"
 * 的路子：结果单独开一个对话框，明文只读展示 + 复制，关掉就再也拿不回来。
 * 列表里永远只有前缀（keyPrefix，Atlas 直接给的脱敏值）。 */

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
  BulkActionBar,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useToast,
  useListPagination,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { api, OperaApiError } from "@/lib/api";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmLabels } from "@/lib/destructive";
import {
  KEY_STATE_TONE,
  type KeyEffectiveState,
  type KeyState,
} from "@/lib/status";

/** 与 opera-bff atlas.router.ts 同名能力码——api-keys 复用 model:provider.manage
 * （和 provider-keys 一样是"vault"类操作，同样挂 StepUp）。 */
const MANAGE = "model:provider.manage";

/** `internal` **只作为历史值出现**，签发路径上已经没有它了（见文件头）。类型里留着
 *  是为了如实渲染那批已撤销的老行，不是为了让谁再选到它。 */
type KeyKind = "internal" | "external";

/**
 * 2026-08-23 对齐 Atlas 现行形状（`gateway-api-key.types.ts`）。三处改动，**每一处
 * 此前都是静默错的**：
 *
 *   `status` → `state`        字段整个改了名。旧名读回来是 `undefined`，于是
 *                             `KEY_STATUS_META[r.status].tone` 直接抛异常——这一页的
 *                             表格在当前 Atlas 上根本渲染不出来。
 *   `disabled` → `inactive`   中间那档的词换了（M-B3 最小词表）。启停按钮据旧值判断，
 *                             结果是"禁用"永远可点、"启用"永远不出现。
 *   `expiresAt` 真的有了       此前注释写着"Atlas 还没有这一列"，恒为 undefined。现在
 *                             create/rotate 都收这个入参，列里也回真值。
 *
 * 外加一个新字段 `effectiveState`：把到期折进去之后**现在实际是什么**。页面读它而不是
 * 自己拿 `expiresAt` 和当前时间算——同一个判断有两个实现迟早会分叉，而它决定的是
 * "这把钥匙现在还开不开门"。本页原来那个 `isExpired()` 就是那第二个实现，已删。
 */
interface GatewayApiKeyRecord {
  id: string;
  name: string;
  kind: KeyKind;
  owner: string | null;
  keyPrefix: string;
  /** 运营**设成**什么。与 `effectiveState` 只在到期那一刻分叉。 */
  state: KeyState;
  /** 现在**实际**是什么（读时折进到期，多一档 `expired`）。 */
  effectiveState: KeyEffectiveState;
  /** null = 不限期，跑到被撤销为止。 */
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GatewayApiKeyWithSecret extends GatewayApiKeyRecord {
  secret: string;
}

type DialogState =
  | { kind: "issue" }
  | { kind: "rotate"; row: GatewayApiKeyRecord }
  /* 没有 `revoke` / `delete` 档：两者的确认都由 DS 的 `ConfirmDestructive` 接管
     （菜单项的 `confirm`），落锤直接走 `setState` / `deleteKey`。 */
  | null;

/** 明文只在内存里活到用户关掉对话框为止，不进列表、不进 state 之外的任何地方。 */
interface RevealState {
  name: string;
  secret: string;
  rotated: boolean;
}

/** 没有 kind：新签发的 key 一律是 external，这不是一个选项。 */
interface KeyDraft {
  name: string;
  owner: string;
  /** `YYYY-MM-DD`（date input 的原生格式）。留空 = 不限期。 */
  expiresAt: string;
}

const EMPTY_DRAFT: KeyDraft = { name: "", owner: "", expiresAt: "" };

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

/* 收 `locale` 与 `never` 而不是自己写死：原来这里是 `toLocaleString("zh-CN")`，
   也就是说界面即使切到英文，时间仍按中文格式排。日期格式属于语言。 */
function formatTime(iso: string | null, locale: string, never: string): string {
  if (!iso) return never;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(locale, { hour12: false });
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string | null }
  | { kind: "ready" };

export default function KeysPage() {
  const withLabels = useConfirmLabels();
  const t = useTranslations("modelKeysPage");
  const tCommon = useTranslations("common");
  /* 状态词表单独一个命名空间：`KEY_STATE_TONE` 只留语气，文案在这里取。
     两者判据同源（同一个 state 值），但一个是产品判断、一个是翻译。 */
  const tState = useTranslations("status.keyState");
  const locale = useLocale();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  /* 全部 key 写操作都在 step-up 闸门后（product_250 v0.4）。 */
  const { runWithStepUp } = useStepUp();
  const canManage = can(MANAGE);
  const [rows, setRows] = useState<GatewayApiKeyRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [kindFilter, setKindFilter] = useState<KeyKind | "all">("all");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<KeyDraft>(EMPTY_DRAFT);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<GatewayApiKeyRecord[]>("/api/atlas/api-keys");
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      /* 存原始错误，不存译文。两个理由：`reload` 是 `useCallback([], …)` 且被
         `useEffect([reload])` 依赖着，把 `t` 加进依赖会让它每次渲染换身份、
         effect 因此无限重跑；而且存进 state 的译文在切语言时不会跟着变——
         托底文案属于渲染，不属于状态。 */
      setLoad({
        kind: "error",
        message: error instanceof OperaApiError ? error.message : null,
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (kindFilter === "all" || r.kind === kindFilter) &&
        (kw === "" ||
          r.name.toLowerCase().includes(kw) ||
          r.keyPrefix.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, kindFilter]);

  const pager = useListPagination(filtered, 20);

  /** 历史遗留的 internal 行。为 0 时，类型这个维度在这页上已经不存在了——那就
   *  连筛选器带说明横幅一起不出现，而不是留一个只有一个取值的下拉。 */
  const retiredCount = useMemo(
    () => rows.filter((r) => r.kind === "internal").length,
    [rows],
  );

  /** 操作者取消验证不是错误，静默收场；其余照常报错。 */
  function reportFailure(error: unknown, label: string) {
    if (isStepUpCancelled(error)) return;
    toast({
      tone: "danger",
      title: t("bulk.failed", { action: label }),
      ...describeError(error),
    });
  }

  /** 批量只做可逆动作（禁用/启用）；撤销是终态、不可回头，必须逐个走确认框。 */
  async function setStateBulk(state: "active" | "inactive") {
    /* 已退役档位一并排除：它们现在都是 revoked，本就被下一个条件挡住，但批量
       操作是最容易悄悄把一批东西改活的地方，这里写死不依赖状态。 */
    const targets = rows.filter(
      (r) =>
        selectedKeys.includes(r.id) &&
        r.state !== "revoked" &&
        r.kind !== "internal",
    );
    setSelectedKeys([]);
    setSubmitting(true);
    try {
      /* 整批包一次仪式：验证一次覆盖这批，不是每把 key 弹一次框。 */
      await runWithStepUp(() =>
        Promise.all(
          targets.map((r) =>
            api.post(
              `/api/atlas/api-keys/${r.id}/${state === "active" ? "activate" : "deactivate"}`,
              {},
            ),
          ),
        ),
      );
      toast({
        tone: state === "active" ? "success" : "warning",
        title: t("bulk.doneTitle", {
          count: targets.length,
          state: t(state === "active" ? "bulk.enable" : "bulk.disable"),
        }),
        description: t("bulk.doneDescription"),
      });
      await reload();
    } catch (error) {
      reportFailure(
        error,
        t(state === "active" ? "bulk.enable" : "bulk.disable"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function setState(row: GatewayApiKeyRecord, state: KeyState) {
    setSubmitting(true);
    try {
      await runWithStepUp(() =>
        api.post(
          `/api/atlas/api-keys/${row.id}/${state === "active" ? "activate" : state === "inactive" ? "deactivate" : "revoke"}`,
          {},
        ),
      );
      toast({
        tone: state === "active" ? "success" : "warning",
        title: `${row.name} ${tState(state)}`,
        description: t(
          state === "revoked" ? "revoke.doneDescription" : "revoke.audited",
        ),
      });
      await reload();
    } catch (error) {
      reportFailure(error, tState(state));
    } finally {
      setSubmitting(false);
    }
  }

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast({ tone: "success", title: tCommon("copied") });
    } catch {
      toast({
        tone: "danger",
        title: tCommon("copyFailed"),
        description: tCommon("copyDenied"),
      });
    }
  };

  /** 硬删除。Atlas 交付这条路由之前会 404——如实说明是"这个部署还没有"，不是失败。 */
  async function deleteKey(row: GatewayApiKeyRecord) {
    setSubmitting(true);
    try {
      await runWithStepUp(() => api.delete(`/api/atlas/api-keys/${row.id}`));
      toast({
        tone: "success",
        title: t("delete.doneTitle", { name: row.name }),
        description: t("delete.doneDescription"),
      });
      await reload();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      /* 上游没这条路由（Express 默认 404，不带 Atlas 的结构化 code）。 */
      if (
        error instanceof OperaApiError &&
        error.status === 404 &&
        error.code === undefined
      ) {
        toast({
          tone: "warning",
          title: t("delete.unsupportedTitle"),
          description: t("delete.unsupportedDescription"),
        });
        return;
      }
      toast({
        tone: "danger",
        title: t("delete.failed"),
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    setSubmitting(true);
    try {
      if (dialog.kind === "issue") {
        const created = await runWithStepUp(() =>
          /* 显式送 external：Atlas 缺省也是 external，但把它写出来才让"这里只签
             external"成为代码里读得到的事实，而不是依赖上游默认值不变。 */
          api.post<GatewayApiKeyWithSecret>("/api/atlas/api-keys", {
            name: draft.name.trim(),
            kind: "external",
            owner: draft.owner.trim() || null,
            /* 键不出现 = 不限期（Atlas 对缺席的 `expiresAt` 就是这个意思）。
               送 null 也一样，但不出现更贴合"这次没设term"。 */
            ...(draft.expiresAt
              ? { expiresAt: `${draft.expiresAt}T23:59:59.999Z` }
              : {}),
          }),
        );
        setReveal({
          name: created.name,
          secret: created.secret,
          rotated: false,
        });
      } else {
        const rotated = await runWithStepUp(() =>
          api.post<GatewayApiKeyWithSecret>(
            `/api/atlas/api-keys/${dialog.row.id}/rotate`,
          ),
        );
        setReveal({
          name: rotated.name,
          secret: rotated.secret,
          rotated: true,
        });
      }
      setDialog(null);
      await reload();
    } catch (error) {
      reportFailure(
        error,
        t(dialog.kind === "issue" ? "actions.issue" : "actions.rotate"),
      );
      /* 取消验证时对话框保持打开，操作者可以重试或自己关掉——不替他决定。 */
    } finally {
      setSubmitting(false);
    }
  }

  const draftValid = draft.name.trim() !== "";

  const rowMenu = (r: GatewayApiKeyRecord) => {
    /* 已退役的档位不能被任何操作复活。这些行现在全是 revoked（Atlas 侧 incr/08
       统一置的），下面的状态判断本就挡得住；这一条是防住"将来有人手工改回
       disabled"那种情况——退役的意思是不能再用，不是碰巧现在用不了。 */
    const retired = r.kind === "internal";
    return (
      <ActionMenu
        label={t("actions.menuLabel", { name: r.name })}
        disabled={submitting}
        items={[
          {
            id: "rotate",
            label: t("actions.rotate"),
            icon: "refresh",
            disabled: retired || r.state !== "active",
            onSelect: () => setDialog({ kind: "rotate", row: r }),
          },
          r.state === "inactive" && !retired
            ? {
                id: "enable",
                label: t("actions.enable"),
                icon: "play" as const,
                onSelect: () => void setState(r, "active"),
              }
            : {
                id: "disable",
                label: t("actions.disable"),
                icon: "pause" as const,
                disabled: r.state !== "active",
                onSelect: () => void setState(r, "inactive"),
              },
          {
            id: "revoke",
            label: t("actions.revoke"),
            icon: "prohibit",
            danger: true,
            separatorBefore: true,
            disabled: r.state === "revoked",
            confirm: withLabels({
              verb: t("actions.revoke"),
              target: t("revoke.target", { name: r.name }),
              consequence: t("revoke.consequence"),
              onConfirm: () => setState(r, "revoked"),
            }),
          },
          {
            /* 只有**已撤销**的行能删。这是 Atlas 全域那条「任何东西都不会从正在服务
             一步变成没了」的规则：先撤销 → 确认没有调用方在骂 → 再清理。一步到位的
             删除会让一次误点同时完成"断掉对方"和"抹掉这行曾经存在"两件事。 */
            id: "delete",
            label: t("actions.delete"),
            icon: "trash",
            danger: true,
            /* Atlas 只要求"不是 active"，这里刻意更严：只有**已撤销**的能删。停用是
               可逆的暂停，把它和终态一起开放删除，等于让一次误点跨过那道可逆性。 */
            disabled: r.state !== "revoked",
            confirm: withLabels({
              verb: t("actions.delete"),
              target: t("delete.target", { name: r.name }),
              consequence: t("delete.consequence"),
              /* 菜单项已按 `disabled` 挡了一道，这里再写一次不是重复：`disabled`
                 让人点不开，`met` 让人在框里看见**为什么**。两者判据同源。 */
              preconditions: [
                {
                  label: t("delete.precondition"),
                  met: r.state === "revoked",
                },
              ],
              onConfirm: () => deleteKey(r),
            }),
          },
        ]}
      />
    );
  };

  const pagination = (
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
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={t("load.loadingTitle")}
        description={t("load.loadingDescription")}
      />
    ) : load.kind === "error" ? (
      <EmptyState
        title={t("load.errorTitle")}
        description={load.message ?? t("load.errorFallback")}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {tCommon("retry")}
          </Button>
        }
      />
    ) : filtered.length !== rows.length ? (
      <EmptyState
        title={t("empty.noMatchTitle")}
        description={t("empty.noMatchDescription")}
      />
    ) : (
      <EmptyState
        title={t("empty.emptyTitle")}
        description={t("empty.emptyDescription")}
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="key"
            title={t("header.title")}
            description={t("header.description")}
            action={
              canManage ? (
                <Button
                  disabled={submitting}
                  onClick={() => {
                    setDraft(EMPTY_DRAFT);
                    setDialog({ kind: "issue" });
                  }}
                >
                  <Icon name="plus" size="sm" />
                  {t("issue.cta")}
                </Button>
              ) : null
            }
          />
        }
        summary={
          <div className="flex flex-col gap-sm">
            {/* 理由从"还没做"改成"没有消费者"。这两句话在页面上长得像，但指向完全
                不同的动作：前者会让人去催工期，后者告诉人这里在等一件商业上的事
                发生。悬着的是接入，不是设计——设计是通的。 */}
            <Banner
              tone="info"
              title={t("notice.externalUnwiredTitle")}
              description={t("notice.externalUnwiredDescription")}
            />
            {retiredCount > 0 ? (
              <Banner
                tone="neutral"
                title={t("notice.retiredTitle", { count: retiredCount })}
                description={t("notice.retiredDescription")}
              />
            ) : null}
          </div>
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.cardsDisabledReason")}
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
                placeholder={t("filters.searchPlaceholder")}
                aria-label={t("filters.searchAriaLabel")}
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            {/* 只在还有历史 internal 行时才给类型筛选：全是 external 的话，这个
                下拉筛不出任何区别，只会暗示这里有两类可选。 */}
            {retiredCount > 0 ? (
              <NativeSelect
                wrapperClassName="w-fit"
                value={kindFilter}
                onChange={(e) => {
                  setKindFilter(e.target.value as KeyKind | "all");
                  pager.resetPage();
                }}
                aria-label={t("filters.kindLabel")}
              >
                <option value="all">{t("filters.allKinds")}</option>
                {/* `External` 是上游原样回来的类型值，不译——见 lib/status.ts
                    里同一条判据：这个词在 API 响应里就是这么写的。 */}
                <option value="external">External</option>
                <option value="internal">{t("filters.internalRetired")}</option>
              </NativeSelect>
            ) : null}
          </FilterBar>
        }
        bulkBar={
          canManage ? (
            <BulkActionBar
              count={selectedKeys.length}
              noun={t("bulk.unit")}
              onClear={() => setSelectedKeys([])}
              actions={[
                {
                  id: "enable",
                  label: t("bulk.enable"),
                  icon: "play",
                  onSelect: () => void setStateBulk("active"),
                },
                {
                  id: "disable",
                  label: t("bulk.disable"),
                  icon: "pause",
                  danger: true,
                  /* 停用可逆，但这是**批量**：停用期间持有这些 key 的调用方全部被
                     拒。可撤销的是状态，不是那段时间里失败的调用。 */
                  confirm: withLabels({
                    verb: t("bulk.disable"),
                    target: t("bulk.selectedKeys", {
                      count: selectedKeys.length,
                    }),
                    consequence: t("bulk.disableConsequence"),
                    /* `setStateBulk` 内部还包着一次 step-up 仪式——确认框停在
                       「处理中」态，二次验证压在它上面。两层模态叠加。 */
                    onConfirm: () => setStateBulk("inactive"),
                  }),
                },
              ]}
            />
          ) : null
        }
        table={
          <DataTable
            columns={[
              {
                id: "name",
                header: t("columns.name"),
                cell: (r: GatewayApiKeyRecord) => (
                  <TableTitleCell
                    icon="key"
                    title={r.name}
                    description={r.owner ?? "—"}
                  />
                ),
              },
              {
                id: "prefix",
                header: t("columns.prefix"),
                width: "sm",
                cell: (r: GatewayApiKeyRecord) => <Kbd>{r.keyPrefix}</Kbd>,
              },
              {
                id: "lastUsed",
                header: t("columns.lastUsed"),
                width: "sm",
                cell: (r: GatewayApiKeyRecord) =>
                  formatTime(r.lastUsedAt, locale, tCommon("never")),
              },
              {
                id: "createdAt",
                header: t("columns.issuedAt"),
                width: "sm",
                cell: (r: GatewayApiKeyRecord) =>
                  formatTime(r.createdAt, locale, tCommon("never")),
              },
              {
                /* internal 标成「已退役」而不是原样显示：一个和 External 并排、
                   看起来平起平坐的 Internal 标，读起来就像还能再签一把。 */
                id: "kind",
                header: t("columns.kind"),
                align: "center",
                width: "xs",
                cell: (r: GatewayApiKeyRecord) => (
                  <Badge
                    variant={r.kind === "internal" ? "secondary" : "outline"}
                  >
                    {r.kind === "internal"
                      ? t("table.internalRetired")
                      : "External"}
                  </Badge>
                ),
              },
              {
                id: "expiresAt",
                header: t("columns.expiresAt"),
                align: "center",
                width: "xs",
                cell: (r: GatewayApiKeyRecord) =>
                  /* null = 不限期。到期与否不在这里判——那是 `effectiveState` 的事，
                     这一列只说日期，染色跟着它走。 */
                  r.expiresAt ? (
                    <span
                      className={
                        r.effectiveState === "expired"
                          ? "text-warning-foreground"
                          : ""
                      }
                    >
                      {r.expiresAt.slice(0, 10)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {tCommon("unlimited")}
                    </span>
                  ),
              },
              {
                id: "state",
                header: t("columns.state"),
                align: "center",
                width: "xs",
                cell: (r: GatewayApiKeyRecord) => (
                  /* 读 `effectiveState` 而不是 `state`：后者是运营设成什么，前者是
                     现在实际是什么。两者只在到期那一刻分叉——而那正是必须说出口的时刻，
                     显示 active 等于告诉运营"还在生效"，那是假的。到期判断由 Atlas
                     统一做，这里不再复制一份。 */
                  <StatusBadge
                    tone={KEY_STATE_TONE[r.effectiveState]}
                    dot
                    {...(r.effectiveState === "expired"
                      ? {
                          title: t("table.setButExpired", {
                            label: tState(r.state),
                          }),
                        }
                      : {})}
                  >
                    {tState(r.effectiveState)}
                  </StatusBadge>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r) => r.id}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            indexStart={pager.indexStart}
            {...(canManage ? { rowActions: rowMenu } : {})}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      <DialogForm
        open={dialog?.kind === "issue"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={t("issue.title")}
        description={t("issue.description")}
        submitLabel={t("issue.submit")}
        submitting={submitting}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        {/* 这里没有类型下拉，是刻意的——而且要说清楚为什么没有。只是悄悄拿掉，
            下一个人只会当成漏做又给加回来。 */}
        <Banner
          tone="info"
          title={t("issue.externalOnlyTitle")}
          description={t("issue.externalOnlyDescription")}
        />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="key-name">{t("issue.nameLabel")}</FieldLabel>
            <Input
              id="key-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="acme-partner"
            />
            <FieldDescription>{t("issue.nameDescription")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="key-owner">{t("issue.ownerLabel")}</FieldLabel>
            <Input
              id="key-owner"
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              placeholder={t("issue.ownerPlaceholder")}
            />
            <FieldDescription>{t("issue.ownerDescription")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="key-expires">
              {t("issue.expiresLabel")}
            </FieldLabel>
            <Input
              id="key-expires"
              type="date"
              value={draft.expiresAt}
              onChange={(e) =>
                setDraft({ ...draft, expiresAt: e.target.value })
              }
            />
            <FieldDescription>{t("issue.expiresDescription")}</FieldDescription>
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
          dialog?.kind === "rotate"
            ? t("rotate.title", { name: dialog.row.name })
            : t("rotate.titleFallback")
        }
        description={t("rotate.description")}
        submitLabel={t("rotate.submit")}
        submitting={submitting}
        onSubmit={submit}
      />

      {/* 明文展示：没有取消/提交的语义，只有"我记下了"，所以提交按钮就是关闭。 */}
      <DialogForm
        open={reveal !== null}
        onOpenChange={(open) => {
          if (!open) setReveal(null);
        }}
        title={t(
          reveal?.rotated ? "reveal.rotatedTitle" : "reveal.issuedTitle",
        )}
        submitLabel={t("reveal.saved")}
        cancelLabel={tCommon("close")}
        onSubmit={(e) => {
          e.preventDefault();
          setReveal(null);
        }}
      >
        <Banner
          tone="warning"
          title={t("reveal.onlyChanceTitle")}
          description={t("reveal.onlyChanceDescription")}
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
              {tCommon("copy")}
            </Button>
          </div>
        </Field>
      </DialogForm>
    </>
  );
}
