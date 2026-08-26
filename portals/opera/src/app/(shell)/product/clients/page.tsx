"use client";

/* 接入凭据 — 产品接入平台用的 OIDC 客户端：注册、密钥轮换、启用/禁用。
 *
 * 2026-08-14 自「产品目录」拆出（B4a-1，设计文件 §3）。此前它是目录页里的一个抽屉，
 * 那个位置有两个问题：
 *   1. **频次不同**。产品登记是一次性的，凭据要轮换、要按渠道加、要临时禁用——把低频
 *      与高频塞进同一页，意味着改一次产品名要滚过一屏凭据。
 *   2. **看不到全貌**。抽屉按产品过滤，于是「哪些客户端还开着」「谁的密钥半年没轮换过」
 *      这类横向问题在任何一个抽屉里都答不出来。本页默认列**全部**产品的客户端。
 *
 * `?productId=` 深链保留：目录行的「接入凭据」跳这里并预置过滤，等价于原来的抽屉，
 * 但地址可分享、可后退。
 *
 * **realm 恒为 customer**。产品客户端不走 workforce realm——那是平台自己四个门户
 * （admin / opera / console / website）专用，上游 `GET /api/oidc-clients` 里写死了
 * `c.realm = 'customer'`，本页不提供切换，因为没有可切的东西。
 *
 * **client_secret 只在注册与轮换后明文出现一次**，之后库里只有哈希。所以这页没有
 * 「查看密钥」，只有「轮换」——丢了就只能换一把新的，这是设计不是缺陷。 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  NativeSelect,
  Pagination,
  StatusBadge,
  Switch,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { api, OperaApiError } from "@/lib/api";

const MANAGE = "platform:product.manage";

type ReleaseChannel = "stable" | "beta" | "canary";
/** product_251 B-3：字段名 `state`，最小词表 active / inactive。 */
type ClientState = "active" | "inactive";

interface OidcClientRecord {
  id: string;
  clientId: string;
  productId: string | null;
  productCode: string | null;
  releaseChannel: ReleaseChannel;
  name: string | null;
  displayName: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  pkceRequired: boolean;
  state: ClientState;
  createdAt: string;
  updatedAt: string;
}

interface ProductLite {
  id: string;
  productCode: string;
  productName: string;
}

interface ClientDraft {
  productId: string;
  clientId: string;
  releaseChannel: ReleaseChannel;
  name: string;
  displayName: string;
  redirectUris: string;
  allowedScopes: string;
  pkceRequired: boolean;
}

const DEFAULT_CLIENT_DRAFT: ClientDraft = {
  productId: "",
  clientId: "",
  releaseChannel: "stable",
  name: "",
  displayName: "",
  redirectUris: "",
  allowedScopes: "openid, profile, email, phone",
  pkceRequired: true,
};

const CLIENT_STATE_TONE: Record<ClientState, StatusBadgeTone> = {
  active: "success",
  inactive: "neutral",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

export default function ProductClientsPage() {
  return (
    <Suspense fallback={null}>
      <ProductClients />
    </Suspense>
  );
}

function ProductClients() {
  const tShared = useTranslations();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);
  const initialProductId = useSearchParams().get("productId") ?? "all";

  const [rows, setRows] = useState<OidcClientRecord[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [productFilter, setProductFilter] = useState(initialProductId);
  const [channelFilter, setChannelFilter] = useState<"all" | ReleaseChannel>(
    "all",
  );
  const [stateFilter, setStateFilter] = useState<"all" | ClientState>("all");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<ClientDraft>(DEFAULT_CLIENT_DRAFT);
  const [revealSecret, setRevealSecret] = useState<{
    clientId: string;
    secret: string;
    rotated: boolean;
  } | null>(null);

  /* 两份都要：客户端列表自己带 productCode，但**新建**时要选产品，而产品名只有
     目录接口有。一次取回，之后不再打。 */
  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [clients, prods] = await Promise.all([
        api.get<OidcClientRecord[]>("/api/oidc-clients"),
        api.get<ProductLite[]>("/api/products"),
      ]);
      setRows(clients);
      setProducts(prods);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取接入凭据失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const productName = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.productName]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [products]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (c) =>
        (productFilter === "all" || c.productId === productFilter) &&
        (channelFilter === "all" || c.releaseChannel === channelFilter) &&
        (stateFilter === "all" || c.state === stateFilter) &&
        (kw === "" ||
          c.clientId.toLowerCase().includes(kw) ||
          (c.productCode ?? "").toLowerCase().includes(kw) ||
          (c.name ?? "").toLowerCase().includes(kw) ||
          c.redirectUris.some((u) => u.toLowerCase().includes(kw))),
    );
  }, [rows, keyword, productFilter, channelFilter, stateFilter]);

  const pager = useListPagination(visible, 20);

  function openCreate() {
    const preset = productFilter !== "all" ? productFilter : "";
    const p = products.find((x) => x.id === preset);
    setDraft({
      ...DEFAULT_CLIENT_DRAFT,
      productId: preset,
      /* 预填产品码：绝大多数客户端就叫产品码本身，多渠道时再手工加后缀。 */
      clientId: p?.productCode ?? "",
      name: p?.productName ?? "",
    });
    setCreateOpen(true);
  }

  /** 选产品时同步预填 clientId / name——只在两者还是上一个产品的预填值时覆盖，
   *  已经手改过的不动。 */
  function pickProduct(productId: string) {
    const prev = products.find((x) => x.id === draft.productId);
    const next = products.find((x) => x.id === productId);
    setDraft({
      ...draft,
      productId,
      clientId:
        draft.clientId === "" || draft.clientId === prev?.productCode
          ? (next?.productCode ?? "")
          : draft.clientId,
      name:
        draft.name === "" || draft.name === prev?.productName
          ? (next?.productName ?? "")
          : draft.name,
    });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const redirectUris = draft.redirectUris
      .split(/[\n,]/)
      .map((u) => u.trim())
      .filter(Boolean);
    const allowedScopes = draft.allowedScopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const created = await api.post<
        OidcClientRecord & { clientSecret: string }
      >("/api/oidc-clients", {
        productId: draft.productId,
        clientId: draft.clientId.trim(),
        releaseChannel: draft.releaseChannel,
        name: draft.name.trim(),
        displayName: draft.displayName.trim() || null,
        redirectUris,
        allowedScopes,
        pkceRequired: draft.pkceRequired,
      });
      setCreateOpen(false);
      setRevealSecret({
        clientId: created.clientId,
        secret: created.clientSecret,
        rotated: false,
      });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "注册失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function rotateSecret(clientId: string) {
    setSubmitting(true);
    try {
      const result = await api.post<{ clientId: string; clientSecret: string }>(
        `/api/oidc-clients/${encodeURIComponent(clientId)}/rotate-secret`,
      );
      setRevealSecret({
        clientId: result.clientId,
        secret: result.clientSecret,
        rotated: true,
      });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "轮换失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  /* 二元开关走动作端点（product_251 B-3）：`activate` / `deactivate`，
     不再 PATCH 一个目标值进去。 */
  async function setClientState(clientId: string, next: ClientState) {
    setSubmitting(true);
    try {
      const verb = next === "active" ? "activate" : "deactivate";
      await api.post(
        `/api/oidc-clients/${encodeURIComponent(clientId)}/${verb}`,
      );
      toast({
        tone: "success",
        title: `${clientId} 已${next === "active" ? "启用" : "停用"}`,
      });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret(secret: string) {
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
  }

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取接入凭据。"
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
    ) : rows.length === 0 ? (
      <EmptyState
        icon="fingerprint"
        title="还没有任何接入凭据"
        description="产品要接入平台，第一步是注册一个 OIDC 客户端（接入检查单里的 C1 身份接入）。"
      />
    ) : (
      <EmptyState
        title="没有匹配的客户端"
        description="换个产品、渠道或关键词再看。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="fingerprint"
            title="接入凭据"
            description="产品接入平台用的 OIDC 客户端。一个产品可以按渠道各有一个（stable / beta / canary）。client_secret 只在注册与轮换后明文出现一次，之后库里只有哈希——所以没有「查看」，只有「轮换」。"
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  注册客户端
                </Button>
              ) : undefined
            }
          />
        }
        summary={
          <Banner
            tone="info"
            title="realm 恒为 customer"
            description="产品客户端不走 workforce realm——那是平台自己四个门户（admin / opera / console / website）专用，本页读到的一律是 customer realm，没有可切换的东西。"
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              visible.length === rows.length
                ? rows.length
                : `${visible.length} / ${rows.length}`
            }
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索 client_id / 产品 / 回调地址…"
                aria-label="搜索接入凭据"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={productFilter}
              onChange={(e) => {
                setProductFilter(e.target.value);
                pager.resetPage();
              }}
              aria-label="产品筛选"
            >
              <option value="all">全部产品</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value as "all" | ReleaseChannel);
                pager.resetPage();
              }}
              aria-label="渠道筛选"
            >
              <option value="all">全部渠道</option>
              <option value="stable">stable</option>
              <option value="beta">beta</option>
              <option value="canary">canary</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={stateFilter}
              onChange={(e) => {
                setStateFilter(e.target.value as "all" | ClientState);
                pager.resetPage();
              }}
              aria-label={tShared("filters.stateLabel")}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="active">{tShared("actions.enable")}</option>
              <option value="inactive">{tShared("actions.disable")}</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            columns={[
              {
                id: "clientId",
                header: "Client ID",
                cell: (c: OidcClientRecord) => (
                  <span className="flex flex-col gap-2xs">
                    <span className="font-mono text-code-sm text-foreground">
                      {c.clientId}
                    </span>
                    {c.name ? (
                      <span className="text-body-sm text-muted-foreground">
                        {c.name}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: "product",
                header: tShared("columns.product"),
                width: "sm",
                cell: (c: OidcClientRecord) =>
                  c.productId ? (
                    <Link
                      href={`/product/catalog?productId=${encodeURIComponent(c.productId)}`}
                      className="flex flex-col gap-2xs hover:text-primary-text"
                    >
                      <span className="text-label-md">
                        {productName(c.productId) ?? c.productCode ?? "—"}
                      </span>
                      <span className="font-mono text-code-sm text-muted-foreground">
                        {c.productCode ?? "—"}
                      </span>
                    </Link>
                  ) : (
                    /* product_id 可空：早于产品目录建立的客户端会是孤儿行。不隐藏
                       它们——看不见的凭据仍然能换票。 */
                    <Badge variant="outline">未挂产品</Badge>
                  ),
              },
              {
                id: "channel",
                header: "渠道",
                align: "center",
                width: "xs",
                cell: (c: OidcClientRecord) => (
                  <Badge variant="outline">{c.releaseChannel}</Badge>
                ),
              },
              {
                id: "redirect",
                header: "回调地址",
                cell: (c: OidcClientRecord) => (
                  <span className="flex flex-col gap-2xs">
                    {c.redirectUris.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      c.redirectUris.slice(0, 2).map((u) => (
                        <span
                          key={u}
                          className="font-mono text-code-sm text-muted-foreground"
                        >
                          {u}
                        </span>
                      ))
                    )}
                    {c.redirectUris.length > 2 ? (
                      <span className="text-body-sm text-muted-foreground">
                        +{c.redirectUris.length - 2} 个
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: "pkce",
                header: "PKCE",
                align: "center",
                width: "xs",
                cell: (c: OidcClientRecord) =>
                  c.pkceRequired ? (
                    <Icon
                      name="check"
                      size="sm"
                      aria-label="强制 PKCE"
                      className="text-success-text"
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                id: "state",
                header: tShared("columns.state"),
                align: "center",
                width: "xs",
                cell: (c: OidcClientRecord) => (
                  <StatusBadge tone={CLIENT_STATE_TONE[c.state]} dot>
                    {c.state === "active"
                      ? tShared("actions.enable")
                      : tShared("actions.disable")}
                  </StatusBadge>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(c: OidcClientRecord) => c.id}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            rowActions={(c: OidcClientRecord) => (
              <ActionMenu
                label={`${c.clientId} 操作`}
                disabled={!canManage || submitting}
                items={[
                  {
                    id: "rotate",
                    label: "轮换密钥",
                    icon: "refresh",
                    onSelect: () => void rotateSecret(c.clientId),
                  },
                  c.state === "active"
                    ? {
                        id: "deactivate",
                        label: tShared("actions.disable"),
                        icon: "pause" as const,
                        danger: true,
                        separatorBefore: true,
                        /* 单条、可逆、且不改任何凭据：停用只是把这个 client 置为
                           不可用，随时可以再启用，密钥与授权原样保留。按 owner
                           2026-08-25 定的线——单条可逆动作写明理由豁免，批量一律拦。 */
                        confirmExempt:
                          "停用可随时再启用，client 的密钥与授权原样保留，不构成不可逆操作",
                        onSelect: () =>
                          void setClientState(c.clientId, "inactive"),
                      }
                    : {
                        id: "activate",
                        label: tShared("actions.enable"),
                        icon: "play" as const,
                        separatorBefore: true,
                        onSelect: () =>
                          void setClientState(c.clientId, "active"),
                      },
                ]}
              />
            )}
            footer={
              <Pagination
                className="w-full"
                page={pager.page}
                pageCount={pager.pageCount}
                total={rows.length}
                filteredTotal={visible.length}
                pageSize={pager.pageSize}
                onPageSizeChange={pager.onPageSizeChange}
                onPageChange={pager.onPageChange}
              />
            }
            empty={emptyState}
          />
        }
      />

      <DialogForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="注册客户端"
        description="client secret 只在提交成功后展示一次，关闭前先复制。"
        submitLabel="注册"
        submitting={submitting}
        submitDisabled={
          draft.productId === "" ||
          draft.clientId.trim() === "" ||
          draft.redirectUris.trim() === ""
        }
        onSubmit={submitCreate}
      >
        {/* 三档（DS `FieldTier`）：身份 = 这个客户端属于谁、走哪条渠道；常规 = 回调与
            展示；高级 = 两项有缺省值的安全开关。 */}
        <FieldTier
          tier="identity"
          hint="产品码是它换票时的身份（`act.sub`）；Client ID 全局唯一，注册后不可改。"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="client-product">
                {tShared("columns.product")}
              </FieldLabel>
              <NativeSelect
                id="client-product"
                value={draft.productId}
                onChange={(e) => pickProduct(e.target.value)}
              >
                <option value="">选择产品…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productName}（{p.productCode}）
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                客户端必须挂在某个产品下——产品码是它换票时的身份（`act.sub`）。
              </FieldDescription>
            </Field>

            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="client-id">Client ID</FieldLabel>
                <Input
                  id="client-id"
                  value={draft.clientId}
                  onChange={(e) =>
                    setDraft({ ...draft, clientId: e.target.value })
                  }
                  placeholder="acme-agent"
                  className="font-mono"
                />
                <FieldDescription>
                  全局唯一，小写 kebab；同产品多渠道常见 acme-agent-beta。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="client-channel">渠道</FieldLabel>
                <NativeSelect
                  id="client-channel"
                  value={draft.releaseChannel}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      releaseChannel: e.target.value as ReleaseChannel,
                    })
                  }
                >
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                  <option value="canary">canary</option>
                </NativeSelect>
              </Field>
            </div>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="details"
          hint="Redirect URI 至少一个，否则授权码流走不通。"
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="client-name">Name</FieldLabel>
                <Input
                  id="client-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="client-display-name">
                  展示名（授权页用）
                </FieldLabel>
                <Input
                  id="client-display-name"
                  value={draft.displayName}
                  onChange={(e) =>
                    setDraft({ ...draft, displayName: e.target.value })
                  }
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="client-redirects">Redirect URIs</FieldLabel>
              <Textarea
                id="client-redirects"
                value={draft.redirectUris}
                onChange={(e) =>
                  setDraft({ ...draft, redirectUris: e.target.value })
                }
                rows={3}
                placeholder={"https://agent.acme.com/auth/callback"}
                className="font-mono text-code-sm"
              />
              <FieldDescription>
                一行一个，或逗号分隔；至少一个。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="advanced"
          title="安全参数"
          hint="两项都有缺省值；PKCE 默认强制，除非对方是拿不到 code_verifier 的老客户端，否则不要关。"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="client-scopes">Allowed Scopes</FieldLabel>
              <Input
                id="client-scopes"
                value={draft.allowedScopes}
                onChange={(e) =>
                  setDraft({ ...draft, allowedScopes: e.target.value })
                }
                className="font-mono"
              />
              <FieldDescription>逗号分隔。</FieldDescription>
            </Field>

            <div className="flex items-center justify-between rounded-md border border-border p-sm">
              <FieldLabel htmlFor="client-pkce">强制 PKCE</FieldLabel>
              <Switch
                id="client-pkce"
                checked={draft.pkceRequired}
                onCheckedChange={(v) => setDraft({ ...draft, pkceRequired: v })}
              />
            </div>
          </FieldGroup>
        </FieldTier>
      </DialogForm>

      {/* ── 明文展示：只有这一次 ─────────────────────────────────────────── */}
      <DialogForm
        open={revealSecret !== null}
        onOpenChange={(open) => {
          if (!open) setRevealSecret(null);
        }}
        title={revealSecret?.rotated ? "新密钥已生成" : "客户端已注册"}
        submitLabel="我已保存"
        cancelLabel="关闭"
        onSubmit={(e) => {
          e.preventDefault();
          setRevealSecret(null);
        }}
      >
        <Banner
          tone="warning"
          title="这是唯一一次看到明文"
          description="关闭后无法再次查看，只能轮换。请立即复制并交给对方妥善保存。"
        />
        <Field>
          <FieldLabel htmlFor="client-secret-reveal">
            {revealSecret?.clientId} · client_secret
          </FieldLabel>
          <div className="flex items-center gap-sm">
            <Input
              id="client-secret-reveal"
              readOnly
              value={revealSecret?.secret ?? ""}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void copySecret(revealSecret?.secret ?? "")}
            >
              <Icon name="copy" size="sm" aria-hidden="true" />
              复制
            </Button>
          </div>
        </Field>
      </DialogForm>
    </>
  );
}
