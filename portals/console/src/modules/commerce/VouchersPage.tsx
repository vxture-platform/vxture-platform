"use client";

/**
 * VouchersPage.tsx — 我的卡券(owner 2026-08-21 P0;2026-09-07 页面级走查后重做)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 租户视角的卡券台账:折扣券/抵扣金券在订单支付页参与结算,本页负责
 * 「我有什么、还能用几次、什么时候到期、押在哪张单上、用掉的去了哪」。
 *
 * ## 2026-09-07 走查改了什么
 *
 * 原页把 `usedCount/maxUses` 读回来却一个字不显示(多次券看不出还剩几次)、
 * 券码不能复制、没有搜索、可用的券没有去处、「使用中」看不出押在哪张单;
 * 一致性上还缺分页与行操作列,两个时间列各写各的,说明板块没缩进。逐条落回口径:
 *
 *   · **主辅制**:三列带副行——券码/批次名、面值/可用次数、状态/挂单号。
 *     副行永远是「支撑主行判断的那一条事实」,不是塞不下的边角料。
 *   · **对齐**:首列左,金额右(与订单/账单同口径),其余居中。
 *   · **两个时间列同一种写法**:日期为主、时间为辅。到期在 7 天内的日期转 warning 色
 *     ——紧迫性用颜色说,不另起一种「还剩 N 天」的写法把时间列写成两副面孔。
 *   · **挂单反查**:BFF 顺着核销行/支付凭据反查回订单可视码(见 promotion.router 头注),
 *     行上直接显示,操作里可跳到费用中心并展开那张单。
 *
 * DS 组合件;中文+i18n(vouchersPage);表格遵守默认结构(序号列 + 单操作列 + 分页)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  TableTitleCell,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import { fetchVouchers, type ConsoleVoucher } from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { ListPagination } from "@/components/pagination";
import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { useDateFormat } from "@/lib/use-date-format";

const STATUS_TONES: Record<ConsoleVoucher["status"], StatusBadgeTone> = {
  available: "success",
  reserved: "info",
  redeemed: "neutral",
  expired: "neutral",
  revoked: "warning",
};

const KNOWN_KINDS = new Set([
  "discount",
  "credit_voucher",
  "recharge_card",
  "redemption",
  "extension",
]);

/** 状态筛选的取值:券的五个状态,外加「全部」。默认落在「可用」。 */
type VoucherFilter = ConsoleVoucher["status"] | "all";

const VOUCHERS_PAGE_SIZE = 10;
/** 到期告急阈值:与概览卡「{n} 张将于 7 天内到期」同一条线。 */
const SOON_MS = 7 * 86_400_000;
/** 费用中心(待付订单在这;挂单反查与「去使用」都指向它)。 */
const BILLING_HREF = "/billing";

export function VouchersPage() {
  const { fmtDate, fmtTime } = useDateFormat();

  const t = useTranslations("vouchersPage");
  const tableLabels = useTableLabels();
  const locale = useLocale();
  const router = useRouter();
  const { session } = useConsoleSession();

  const [vouchers, setVouchers] = useState<ConsoleVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VoucherFilter>("available");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(VOUCHERS_PAGE_SIZE);
  /** 刚复制过的那张券(2 秒后回落),让菜单项自己报「已复制」。 */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /* 读失败显影(批 0b):strict 读,失败置 loadFailed——指标画「—」、表格画「读取
   * 失败」,不再把回落的 [] 画成「没有卡券」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchVouchers()
      .then((rows) => {
        if (active) setVouchers(rows);
      })
      .catch(() => {
        if (!active) return;
        setVouchers([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const kindLabel = (kind: string): string =>
    KNOWN_KINDS.has(kind) ? t(`kind.${kind}`) : kind;

  /** 面值表达:折扣 = 9折/立减 ¥X(上限 ¥Y);金额券 = ¥X。 */
  const faceValue = (v: ConsoleVoucher): string => {
    if (v.kind === "discount") {
      if (v.discountType === "percent" && v.discountValue !== undefined) {
        const cap = v.maxOff
          ? t("face.maxOff", {
              amount: formatCurrency(
                Number.parseFloat(v.maxOff),
                locale as Locale,
                "CNY",
              ),
            })
          : "";
        return `${t("face.percentOff", { percent: v.discountValue })}${cap}`;
      }
      if (v.discountType === "fixed" && v.discountValue !== undefined) {
        return t("face.fixedOff", {
          amount: formatCurrency(v.discountValue, locale as Locale, "CNY"),
        });
      }
    }
    if (v.amount) {
      return formatCurrency(
        Number.parseFloat(v.amount),
        locale as Locale,
        "CNY",
      );
    }
    return "—";
  };

  const resetFilters = useCallback(() => {
    setFilter("available");
    setQuery("");
    setPage(1);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vouchers.filter((v) => {
      if (filter !== "all" && v.status !== filter) return false;
      if (!q) return true;
      // 搜索面:券码、批次名、挂单号——客服对单时手上就这三样。
      return [v.code, v.batchName, v.orderNo ?? ""].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [vouchers, filter, query]);

  /* 排序在**分页之前**：只排当前页等于只排看得见的那 10 条。取值器给的是可比较的
   * 原始值（时间戳、券码串），不是渲染结果——按渲染结果排会得到字典序。
   * 「面值」不排：它是混合值（折扣券是「9折」这类文字），排不出有意义的顺序。 */
  const sortAccessors = useMemo(
    () => ({
      code: (v: ConsoleVoucher) => v.code,
      expires: (v: ConsoleVoucher) => new Date(v.expiresAt).getTime(),
      usedAt: (v: ConsoleVoucher) =>
        v.redeemedAt ? new Date(v.redeemedAt).getTime() : null,
    }),
    [],
  );
  const {
    sort,
    onSortChange,
    rows: sortedVouchers,
  } = useTableSort(visible, sortAccessors);

  /* 筛掉之后当前页可能落空——夹回最后一页。 */
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  useEffect(() => {
    setPage((p) =>
      Math.min(p, Math.max(1, Math.ceil(visible.length / pageSize))),
    );
  }, [visible.length, pageSize]);
  const pagedVouchers = useMemo(
    () => sortedVouchers.slice((page - 1) * pageSize, page * pageSize),
    [sortedVouchers, page, pageSize],
  );

  const metrics = useMemo<MetricGridItem[]>(() => {
    const available = vouchers.filter((v) => v.status === "available");
    const soon = available.filter(
      (v) => new Date(v.expiresAt).getTime() - Date.now() < SOON_MS,
    ).length;
    const used = vouchers.filter((v) => v.status === "redeemed").length;
    // 没读到就是「—」:读失败时的 0 不是没有券,是没有数据。
    const count = (n: number) => (loadFailed ? "—" : String(n));
    return [
      {
        id: "available",
        icon: "ticket",
        label: t("metrics.available"),
        value: count(available.length),
        trend: loadFailed
          ? ""
          : soon > 0
            ? t("metrics.expiringSoon", { count: soon })
            : t("metrics.noExpiring"),
        ...(soon > 0 ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "used",
        icon: "seal-check",
        label: t("metrics.used"),
        value: count(used),
        trend: loadFailed ? "" : t("metrics.usedHint"),
      },
      {
        id: "total",
        icon: "stack",
        label: t("metrics.total"),
        value: count(vouchers.length),
        trend: loadFailed ? "" : t("metrics.totalHint"),
      },
    ];
  }, [vouchers, t, loadFailed]);

  /** 两个时间列共用的写法:日期为主、时间为辅;`urgent` 时主行转告急色。 */
  const timeCell = (iso: string | null, urgent = false) =>
    iso ? (
      <span className="flex flex-col tabular-nums">
        <span className={urgent ? "text-warning-text" : "text-foreground"}>
          {fmtDate(iso)}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {fmtTime(iso)}
        </span>
      </span>
    ) : (
      "—"
    );

  const columns: DataTableColumn<ConsoleVoucher>[] = [
    {
      id: "code",
      sortable: true,
      header: t("table.colCode"),
      cell: (v) => (
        <TableTitleCell
          title={<span className="font-mono">{v.code}</span>}
          description={v.batchName}
        />
      ),
    },
    {
      id: "kind",
      header: t("table.colKind"),
      align: "center",
      cell: (v) => <Badge variant="outline">{kindLabel(v.kind)}</Badge>,
    },
    {
      id: "face",
      header: t("table.colFace"),
      // 不走 money 档：本列是**混合值**——折扣券的面值是「9折（最高减 ¥100）」这类
      // 文字，只有代金券才是纯金额。把文字塞进右对齐的定宽金额块不成立，走默认居中。
      cell: (v) => (
        <span className="flex flex-col items-center tabular-nums">
          <span className="font-medium text-foreground">{faceValue(v)}</span>
          {/* 可用次数只在多次券上出现:单次券每行都写「1/1」是噪音。 */}
          {v.maxUses > 1 ? (
            <span className="text-body-sm text-muted-foreground">
              {t("table.usesLeft", {
                left: Math.max(0, v.maxUses - v.usedCount),
                total: v.maxUses,
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "status",
      header: t("table.colStatus"),
      align: "center",
      cell: (v) => (
        <span className="flex flex-col items-center gap-xs">
          <StatusBadge tone={STATUS_TONES[v.status]}>
            {t(`status.${v.status}`)}
          </StatusBadge>
          {/* 挂单号 = 这个状态的原因:押在哪张单上 / 用到了哪张单上。 */}
          {v.orderNo ? (
            <span className="font-mono text-body-sm text-muted-foreground">
              {v.orderNo}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "expires",
      sortable: true,
      header: t("table.colExpires"),
      align: "center",
      cell: (v) =>
        timeCell(
          v.expiresAt,
          v.status === "available" &&
            new Date(v.expiresAt).getTime() - Date.now() < SOON_MS,
        ),
    },
    {
      id: "usedAt",
      sortable: true,
      header: t("table.colUsedAt"),
      align: "center",
      cell: (v) => (
        <span className="flex flex-col items-center">
          {timeCell(v.redeemedAt)}
          {v.redemptionNo ? (
            <span className="font-mono text-body-sm text-muted-foreground">
              {v.redemptionNo}
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  async function copyCode(v: ConsoleVoucher) {
    try {
      await navigator.clipboard.writeText(v.code);
      setCopiedId(v.id);
    } catch {
      // 剪贴板被浏览器拒了(非安全上下文/无权限):券码本就在行上摆着,不再弹错打断。
    }
  }

  function voucherMenuItems(v: ConsoleVoucher): ActionMenuItem[] {
    return [
      {
        id: "copy",
        label: copiedId === v.id ? t("actions.copied") : t("actions.copy"),
        icon: copiedId === v.id ? "check" : "copy",
        onSelect: () => void copyCode(v),
      },
      /* 挂单反查的落点:带上单号跳费用中心,那边按 order_no 展开对应的单。
         查不到单号就摆着禁用态并说明为什么——不隐藏,免得以为漏了功能。 */
      {
        id: "order",
        label: t("actions.viewOrder"),
        icon: "receipt",
        disabled: !v.orderNo,
        ...(v.orderNo ? {} : { hint: t("actions.viewOrderHint") }),
        onSelect: () =>
          router.push(
            `${BILLING_HREF}?order=${encodeURIComponent(v.orderNo ?? "")}`,
          ),
      },
      /* 可用券的去处:券在订单支付页参与结算,这里只负责把人送到有待付单的地方。 */
      {
        id: "use",
        label: t("actions.use"),
        icon: "credit-card",
        disabled: v.status !== "available",
        ...(v.status === "available" ? {} : { hint: t("actions.useHint") }),
        onSelect: () => router.push(BILLING_HREF),
      },
    ];
  }

  return (
    <ViewLayout>
      <ViewHeader
        icon="ticket"
        title={t("title")}
        description={t("description")}
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      <PageSection
        icon="ticket"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
      >
        <div className="flex flex-col gap-sm">
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={t("filters.listOnly")}
            count={t("filters.count", { count: visible.length })}
            aria-label={t("filters.groupLabel")}
            onReset={resetFilters}
            search={
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t("filters.searchPlaceholder")}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={t("filters.searchAriaLabel")}
              />
            }
          >
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as VoucherFilter);
                setPage(1);
              }}
              aria-label={t("filters.statusAriaLabel")}
            >
              <option value="available">{t("status.available")}</option>
              <option value="reserved">{t("status.reserved")}</option>
              <option value="redeemed">{t("status.redeemed")}</option>
              <option value="expired">{t("status.expired")}</option>
              <option value="revoked">{t("status.revoked")}</option>
              <option value="all">{t("filters.statusAll")}</option>
            </NativeSelect>
          </FilterBar>

          <DataTable<ConsoleVoucher>
            labels={tableLabels}
            columns={columns}
            rows={pagedVouchers}
            rowKey={(v) => v.id}
            {...(sort ? { sort } : {})}
            onSortChange={onSortChange}
            /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
               与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
            leadingSpacer
            loading={loading}
            indexStart={(page - 1) * pageSize + 1}
            rowActions={(v) => (
              // 单操作列:券没有主操作(动作都在结算侧),菜单独占,操作列 min 64。
              <span className="inline-flex items-center justify-center">
                <ActionMenu
                  items={voucherMenuItems(v)}
                  label={t("actions.menuLabel")}
                />
              </span>
            )}
            empty={
              loadFailed ? (
                <LoadFailedEmpty />
              ) : (
                <EmptyState
                  title={t("table.empty")}
                  {...(query || filter !== "available"
                    ? {}
                    : { description: t("table.emptyHint") })}
                  {...(query || filter !== "available"
                    ? {
                        action: (
                          <Button
                            variant="outline"
                            size="md"
                            onClick={resetFilters}
                          >
                            <Icon name="x" size="xs" fallback="placeholder" />
                            <span>{t("filters.reset")}</span>
                          </Button>
                        ),
                      }
                    : {})}
                />
              )
            }
            footer={
              <ListPagination
                page={page}
                pageCount={pageCount}
                total={loadFailed ? 0 : visible.length}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                onPageChange={setPage}
              />
            }
          />
        </div>
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
          <SignalList
            items={[
              { title: t("notes.useTitle"), description: t("notes.useBody") },
              {
                title: t("notes.sourceTitle"),
                description: t("notes.sourceBody"),
              },
              {
                title: t("notes.holdTitle"),
                description: t("notes.holdBody"),
              },
            ]}
          />
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
