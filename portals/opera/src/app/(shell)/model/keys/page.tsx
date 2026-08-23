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
  Pagination,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useToast,
  useListPagination,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { api, OperaApiError } from "@/lib/api";
import {
  KEY_STATE_META,
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
  | { kind: "revoke"; row: GatewayApiKeyRecord }
  | { kind: "delete"; row: GatewayApiKeyRecord }
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

function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false });
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export default function KeysPage() {
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
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取 Key 失败",
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
    toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
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
        title: `${targets.length} 把 Key 已${state === "active" ? "启用" : "停用"}`,
        description: "已撤销的、以及已退役的 Internal Key 不受批量操作影响。",
      });
      await reload();
    } catch (error) {
      reportFailure(error, state === "active" ? "启用" : "停用");
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
        title: `${row.name} ${KEY_STATE_META[state].label}`,
        description:
          state === "revoked"
            ? "撤销是终态，回不去了，持有方需要重新申请。"
            : "已留痕进 Audit。",
      });
      await reload();
    } catch (error) {
      reportFailure(error, KEY_STATE_META[state].label);
    } finally {
      setSubmitting(false);
    }
  }

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

  /** 硬删除。Atlas 交付这条路由之前会 404——如实说明是"这个部署还没有"，不是失败。 */
  async function deleteKey(row: GatewayApiKeyRecord) {
    setSubmitting(true);
    try {
      await runWithStepUp(() => api.delete(`/api/atlas/api-keys/${row.id}`));
      toast({
        tone: "success",
        title: `${row.name} 已删除`,
        description: "这一行没了；它被签发、轮换、撤销的留痕仍在 Audit 里。",
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
          title: "当前 Atlas 部署还没有删除接口",
          description:
            "已撤销的 key 不会再放行任何调用，功能上不受影响；等 Atlas 交付 DELETE /capability/api-keys/:id 之后这里会自动可用。",
        });
        return;
      }
      toast({ tone: "danger", title: "删除失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.kind === "revoke") {
      setDialog(null);
      await setState(dialog.row, "revoked");
      return;
    }

    if (dialog.kind === "delete") {
      const row = dialog.row;
      setDialog(null);
      await deleteKey(row);
      return;
    }

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
      reportFailure(error, dialog.kind === "issue" ? "签发" : "轮换");
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
        label={`${r.name} 操作`}
        disabled={submitting}
        items={[
          {
            id: "rotate",
            label: "轮换",
            icon: "refresh",
            disabled: retired || r.state !== "active",
            onSelect: () => setDialog({ kind: "rotate", row: r }),
          },
          r.state === "inactive" && !retired
            ? {
                id: "enable",
                label: "启用",
                icon: "play" as const,
                onSelect: () => void setState(r, "active"),
              }
            : {
                id: "disable",
                label: "停用",
                icon: "pause" as const,
                disabled: r.state !== "active",
                onSelect: () => void setState(r, "inactive"),
              },
          {
            id: "revoke",
            label: "撤销",
            icon: "prohibit",
            danger: true,
            separatorBefore: true,
            disabled: r.state === "revoked",
            onSelect: () => setDialog({ kind: "revoke", row: r }),
          },
          {
            /* 只有**已撤销**的行能删。这是 Atlas 全域那条「任何东西都不会从正在服务
             一步变成没了」的规则：先撤销 → 确认没有调用方在骂 → 再清理。一步到位的
             删除会让一次误点同时完成"断掉对方"和"抹掉这行曾经存在"两件事。 */
            id: "delete",
            label: "删除",
            icon: "trash",
            danger: true,
            /* Atlas 只要求"不是 active"，这里刻意更严：只有**已撤销**的能删。停用是
               可逆的暂停，把它和终态一起开放删除，等于让一次误点跨过那道可逆性。 */
            disabled: r.state !== "revoked",
            onSelect: () => setDialog({ kind: "delete", row: r }),
          },
        ]}
      />
    );
  };

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

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState title="读取中…" description="正在读取 API Key 清单。" />
    ) : load.kind === "error" ? (
      <EmptyState
        title="读取失败"
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            重试
          </Button>
        }
      />
    ) : filtered.length !== rows.length ? (
      <EmptyState title="没有匹配的 Key" description="换个关键词或类型再看。" />
    ) : (
      <EmptyState title="暂无 API Key" description="点击「签发 Key」开始。" />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="key"
            title="调用密钥"
            description="外部合作方调用 Atlas 的入方向凭证。内部产品不走这里——它们持有 OIDC 客户端，用短时 S2S 令牌调 /v1/*。轮换与撤销全部留痕进 Audit。"
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
                  签发 Key
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
              title="External key 尚未接入任何认证路径——因为今天没有外部合作方"
              description="Atlas 网关的 /v1/* 只认 S2S OIDC token，所以签发出来的 key 现在调不动网关（TD-029）。这不是工程缺口：第三方合作方不是 vxture IdP 的 OIDC 客户端，key 是它唯一可能的认证方式，而 key 绑定 product_code 之后授权模型是现成的。它悬着的唯一原因是 Atlas 只在 tailnet 上、atlas.vxture.com 预留未绑定——等的是合作方，不是工期。"
            />
            {retiredCount > 0 ? (
              <Banner
                tone="neutral"
                title={`${retiredCount} 把已退役的 Internal Key（全部已撤销）`}
                description="internal 档位已删除：兄弟产品用 OIDC S2S 令牌，给它们发长期共享密钥是拿更弱的换更强的。这些老行保留而不删除——撤销是一份失效凭证的终态，删掉会连同轮换历史和审计留痕一起抹掉它被签发过这件事。它们从未认证过任何东西。"
              />
            ) : null}
          </div>
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason="卡片视图已下线，改用列表"
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
                aria-label="类型筛选"
              >
                <option value="all">全部类型</option>
                <option value="external">External</option>
                <option value="internal">Internal（已退役）</option>
              </NativeSelect>
            ) : null}
          </FilterBar>
        }
        bulkBar={
          canManage ? (
            <BulkActionBar
              count={selectedKeys.length}
              noun="把"
              onClear={() => setSelectedKeys([])}
              actions={[
                {
                  id: "enable",
                  label: "启用",
                  icon: "play",
                  onSelect: () => void setStateBulk("active"),
                },
                {
                  id: "disable",
                  label: "停用",
                  icon: "pause",
                  danger: true,
                  onSelect: () => void setStateBulk("inactive"),
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
                header: "名称",
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
                header: "前缀",
                width: "sm",
                cell: (r: GatewayApiKeyRecord) => <Kbd>{r.keyPrefix}</Kbd>,
              },
              {
                id: "lastUsed",
                header: "最近使用",
                width: "sm",
                cell: (r: GatewayApiKeyRecord) => formatTime(r.lastUsedAt),
              },
              {
                id: "createdAt",
                header: "签发于",
                width: "sm",
                cell: (r: GatewayApiKeyRecord) => formatTime(r.createdAt),
              },
              {
                /* internal 标成「已退役」而不是原样显示：一个和 External 并排、
                   看起来平起平坐的 Internal 标，读起来就像还能再签一把。 */
                id: "kind",
                header: "类型",
                align: "center",
                width: "xs",
                cell: (r: GatewayApiKeyRecord) => (
                  <Badge
                    variant={r.kind === "internal" ? "secondary" : "outline"}
                  >
                    {r.kind === "internal" ? "Internal · 已退役" : "External"}
                  </Badge>
                ),
              },
              {
                id: "expiresAt",
                header: "到期",
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
                    <span className="text-muted-foreground">不限</span>
                  ),
              },
              {
                id: "state",
                header: "状态",
                align: "center",
                width: "xs",
                cell: (r: GatewayApiKeyRecord) => (
                  /* 读 `effectiveState` 而不是 `state`：后者是运营设成什么，前者是
                     现在实际是什么。两者只在到期那一刻分叉——而那正是必须说出口的时刻，
                     显示 active 等于告诉运营"还在生效"，那是假的。到期判断由 Atlas
                     统一做，这里不再复制一份。 */
                  <StatusBadge
                    tone={KEY_STATE_META[r.effectiveState].tone}
                    dot
                    {...(r.effectiveState === "expired"
                      ? {
                          title: `设为「${KEY_STATE_META[r.state].label}」，但已到期`,
                        }
                      : {})}
                  >
                    {KEY_STATE_META[r.effectiveState].label}
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
        title="签发 API Key（External）"
        description="明文只在签发完成的那一次展示，此后只能轮换。"
        submitLabel="签发"
        submitting={submitting}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        {/* 这里没有类型下拉，是刻意的——而且要说清楚为什么没有。只是悄悄拿掉，
            下一个人只会当成漏做又给加回来。 */}
        <Banner
          tone="info"
          title="只签 External：内部产品不用 key"
          description="兄弟产品（karda / arda / varda / runos）都持有 OIDC 客户端，用 300 秒的 S2S 令牌调 /v1/*，令牌上的 act.sub 就是授权表认的产品身份。给它们发一把长期有效、两边各存一份、谁拿着谁就是的共享密钥，不会多出任何能力，只会把已经更强的东西换成更弱的。所以 internal 是删掉而不是留着不用。"
        />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="key-name">名称</FieldLabel>
            <Input
              id="key-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="acme-partner"
            />
            <FieldDescription>调用方在日志与计量里按它归集。</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="key-owner">归属</FieldLabel>
            <Input
              id="key-owner"
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              placeholder="外部合作方名称"
            />
            <FieldDescription>
              key 绑到哪个
              product_code，它就是授权表里的一个产品——两条认证路径共用
              同一套授权模型。
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="key-expires">到期</FieldLabel>
            <Input
              id="key-expires"
              type="date"
              value={draft.expiresAt}
              onChange={(e) =>
                setDraft({ ...draft, expiresAt: e.target.value })
              }
            />
            <FieldDescription>
              留空 =
              不限期，跑到被撤销为止。设了之后**没有任何东西会去改这一行**
              ——到期是读时判定的，状态列会显示「已过期」，但行上仍写着生效中。要
              真正收回，仍然得有人来禁用或撤销。
            </FieldDescription>
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
        submitting={submitting}
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
          dialog?.kind === "revoke" ? `撤销 ${dialog.row.name}` : "撤销 Key"
        }
        description="撤销是终态：不能再启用、不能再轮换，也没有「取消撤销」这回事。持有方只能走签发流程重新申请一把新的。只是想临时断开就用「禁用」——那个可逆。"
        submitLabel="撤销"
        submitting={submitting}
        onSubmit={submit}
      />

      <DialogForm
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        danger
        title={
          dialog?.kind === "delete" ? `删除 ${dialog.row.name}` : "删除 Key"
        }
        /* 如实讲清楚删掉的到底是什么。网关 key 与 provider key 不一样：后者挂着
           key_rotation_logs（FK ON DELETE CASCADE），删一把连轮换史一起没；网关 key
           没有那张附表，它的历史全在 audit.change_records 里，而那张表与 key 行没有
           外键、服务角色也没有 DELETE 权限——所以删行动不到留痕。 */
        description="只删这一行：名称、归属、前缀、最近使用时间都会消失，列表里不再有它。它被签发 / 轮换 / 撤销的操作留痕不受影响——那些在 Audit 的追加表里，与这一行没有外键关系。已经撤销的 key 本来就不放行任何调用，所以删除不改变任何调用方的处境，只是清理台账。"
        submitLabel="删除"
        submitting={submitting}
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
          description="关闭后无法再次查看。丢失只能轮换，不能找回。这个 key 目前还调不动 Atlas 网关——/v1/* 只认 S2S OIDC token，接入在等外部合作方（见上方说明），不要按「马上就能用」交付给对方。"
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
