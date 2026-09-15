"use client";

/* 接入凭据 — 全部产品的 OIDC 客户端总览（只读）。
 *
 * 2026-09-14 起写入全部回到产品页（owner：「注册客户端需要填写的信息……都整合在产品接入的
 * 新建/配置页面，除了需要单独的密钥管理可以弹出单独面板」）：添加渠道、改回调与 scopes、
 * 启用停用在「登录接入」板块，轮换密钥在「密钥管理」面板。这一页保留的是横向视角——
 * 「哪些客户端还开着」「回调都指向哪里」在任何一个产品页里都答不出来。
 *
 * 以下是拆出时（2026-08-14）的记录，其中写入部分已不适用：
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
import { useTableLabels } from "@/lib/table";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  ViewHeader,
  useListPagination,
  type StatusBadgeTone,
  TableTitleCell,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { api, OperaApiError } from "@/lib/api";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";

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
  logoUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedScopes: string[];
  pkceRequired: boolean;
  /** `client_secret_basic`(机密)或 `none`(RFC 8252 公共客户端,无密钥)。 */
  tokenEndpointAuthMethod: string;
  state: ClientState;
  createdAt: string;
  updatedAt: string;
}

interface ProductLite {
  id: string;
  productCode: string;
  productName: string;
}

const CLIENT_STATE_TONE: Record<ClientState, StatusBadgeTone> = {
  active: "success",
  inactive: "neutral",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export default function ProductClientsPage() {
  return (
    <Suspense fallback={null}>
      <ProductClients />
    </Suspense>
  );
}

function ProductClients() {
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const router = useRouter();
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

  const clientSortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<OidcClientRecord>>>
  >(
    () => ({
      clientId: (r) => r.clientId,
      product: (r) => r.productCode ?? r.productId,
      channel: (r) => r.releaseChannel,
      pkce: (r) => (r.pkceRequired ? 1 : 0),
      state: (r) => r.state,
    }),
    [],
  );
  const clientSort = useTableSort(visible, clientSortAccessors);
  const pager = useListPagination(clientSort.rows, 20);

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
        description="客户端在产品页的「登录接入」板块添加。"
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
            description="全部产品的登录客户端总览：哪些渠道开着、回调指向哪里。添加客户端、改回调、轮换密钥都在产品页——「登录接入」板块与「密钥管理」面板。"
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
            search={
              <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
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
            }
            resetLabel={tShared("filters.reset")}
            onReset={() => {
              setKeyword("");
              setChannelFilter("all");
              setStateFilter("all");
              pager.resetPage();
            }}
          >
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
            labels={tableLabels}
            columns={[
              {
                id: "clientId",
                header: "Client ID",
                sortable: true,
                cell: (c: OidcClientRecord) => (
                  <TableTitleCell
                    icon="fingerprint"
                    title={<span className="font-mono">{c.clientId}</span>}
                    {...(c.name ? { description: c.name } : {})}
                  />
                ),
              },
              {
                id: "product",
                header: tShared("columns.product"),
                sortable: true,
                width: "sm",
                cell: (c: OidcClientRecord) =>
                  c.productId ? (
                    <Link
                      href={
                        c.productCode
                          ? `/product/catalog/${encodeURIComponent(c.productCode)}#section-login`
                          : `/product/catalog?productId=${encodeURIComponent(c.productId)}`
                      }
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
                sortable: true,
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
                sortable: true,
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
                sortable: true,
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
            {...(clientSort.sort ? { sort: clientSort.sort } : {})}
            onSortChange={(next) => {
              clientSort.onSortChange(next);
              pager.resetPage();
            }}
            rowKey={(c: OidcClientRecord) => c.id}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            rowActions={(c: OidcClientRecord) =>
              c.productCode ? (
                <ActionMenu
                  label={`${c.clientId} 操作`}
                  items={[
                    {
                      id: "configure",
                      label: "去产品页配置",
                      icon: "edit",
                      onSelect: () =>
                        router.push(
                          `/product/catalog/${encodeURIComponent(c.productCode ?? "")}#section-login`,
                        ),
                    },
                  ]}
                />
              ) : null
            }
            footer={
              <ListPagination
                className="w-full"
                currentPage={pager.page}
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
    </>
  );
}
