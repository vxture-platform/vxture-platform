"use client";

/**
 * BillingPage.tsx — 费用中心（product_331 重构；2026-09-06 归集订单、更名）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 订阅制口径的简单实现（owner 2026-08-20：产品以订阅付费为主，预付费/扣费
 * 暂少，从简）：账单随订阅订单生成、线下对公收款人工核销、0 元订单同样出账。
 * 严格 DS 组合件拼装（同产品订阅页整改口径）：MetricGrid（columns 按本页
 * 指标数=3 铺满）+ PageSection 原生 icon prop + DataTable + SignalList，
 * 无自造样式层。中文为基准，zh/en 双份 i18n（billingPage 命名空间）。
 * 全页无 UUID：账单号 = bill_no 可视码。
 *
 * **2026-09-06 owner 裁定**:订单从「产品订阅」迁进来,页面随之更名「账单管理」→
 * 「费用中心」——装了订单+账单+发票之后,「账单」只是其中一块,名字太窄。钱这条链
 * 现在完整地落在一页:下单(OrdersSection)→ 出账(账单记录)→ 付款 → 开票。
 * 发票记录与开票抬头是**台账**,降为二级页 `/billing/invoices`;「申请发票」是账单行
 * 上的**动作**,留在本页(动作要发生在对象所在的那一页)。
 *
 * **2026-09-29 owner 裁定「发票整体灰掉,规划中」**:「申请发票」不再是一个可用动作。
 * 菜单项留在原位但常灰、hint 讲清为什么(凭空消失会被读成「功能坏了」),申请弹窗与
 * 勾选列一并撤掉——后者唯一的下游是「合并开票」的候选集。发票列照旧画真实状态:
 * 运营线下开出的票、以及客户此前提交还停在那里的申请,都必须看得见。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useRouter } from "@/lib/i18n/navigation";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  fetchBillingSummary,
  fetchBills,
  fetchCredits,
  fetchInvoiceReceipts,
  type ConsoleBill,
  type ConsoleBillingSummary,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PlannedBadge } from "@/components/planned";
import { buildTicketComposeHref } from "@/lib/ticket-compose";

import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { AddonPacksSection } from "./components/AddonPacksSection";
import { ADDON_SECTION_ID } from "./addon-routes";
import { useDateFormat } from "@/lib/use-date-format";
import { buildWebsiteContactUrl } from "@/lib/website-entry";
import { OrdersSection } from "./components/OrdersSection";

const BILLS_PAGE_SIZE = 10;

/** bill_status 六值域（52_billing.sql CHECK）→ 徽章语气。 */
const BILL_STATUS_TONES: Record<string, StatusBadgeTone> = {
  unpaid: "warning",
  paying: "info",
  partial: "info",
  paid: "success",
  overdue: "warning",
  cancelled: "neutral",
};

/** bill_type 值域（normal|one_off|adjustment|prepaid_statement）。 */
const KNOWN_BILL_TYPES = new Set([
  "normal",
  "one_off",
  "adjustment",
  "prepaid_statement",
]);

/**
 * 发票列的三态（owner 2026-09-07）。库里 `invoice_status` 有六值，但客户在账单表上
 * 要回答的只有一个问题:这张账单的票办到哪一步了。
 *
 * 为什么不压成两值:「已开票」是对税务凭证的事实陈述,票还没开出来就写「已开票」
 * 是假的。`applying` / `approved` 归中间那一档。
 * `rejected` / `voided` 不在这张表里——它们已被 `receiptByBill` 滤掉,账单因此回到
 * 「未开票」。
 *
 * 2026-09-29「灰掉」之后中间那一档的文案从「开票中」改成「已申请」:没有人在开这张
 * 票,写「开票中」会和同一屏的「规划中」横幅正面矛盾。改的是这条**派生态**的词,不是
 * `status.*` 那六个库值的词——后者说的是记录自己的状态,运营侧用同一套词。
 */
type InvoicePhase = "none" | "processing" | "issued";

const INVOICE_PHASE_BY_STATUS: Record<string, InvoicePhase> = {
  applying: "processing",
  approved: "processing",
  issued: "issued",
  sent: "issued",
};

const INVOICE_PHASE_TONES: Record<InvoicePhase, StatusBadgeTone> = {
  none: "neutral",
  processing: "info",
  issued: "success",
};

export function BillingPage() {
  const { fmtDate, fmtTime, fmtDateTime } = useDateFormat();

  const t = useTranslations("billingPage");
  /* 求助入口的词在 `tickets.jump.*`(订单 / 账单 / 订阅三处同一族)。 */
  const tJump = useTranslations("tickets.jump");
  const tableLabels = useTableLabels();
  const router = useRouter();
  const locale = useLocale();
  const appLocale = locale as Locale;
  const { session } = useConsoleSession();
  const canManageInvoices = hasCapability(
    session.capabilities,
    "tenant.invoice.manage",
  );
  /* 加油包购买是**付款**权限,不是发票权限——板块从配额页迁来时要把它原样带过来。
     初稿我在这里图省事复用了 canManageInvoices,那等于悄悄换掉一道权限门:
     能开票的人未必该能下单花钱。 */
  const canPurchaseAddons = hasCapability(
    session.capabilities,
    "tenant.payment.manage",
  );

  const [summary, setSummary] = useState<ConsoleBillingSummary | null>(null);
  const [bills, setBills] = useState<ConsoleBill[]>([]);
  const [credits, setCredits] = useState<{
    balance: string;
    currency: string;
  } | null>(null);
  const [receipts, setReceipts] = useState<ConsoleInvoiceReceipt[]>([]);
  const [billsTotal, setBillsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [billsLoading, setBillsLoading] = useState(true);
  /* 读失败显影(批 0b):四路读全是 strict,任一失败置 loadFailed——指标画「—」、
   * 账单表画「读取失败」,不再把回落的 null / [] 画成「0 张待付、¥0 累计实收」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);

  /* 发票记录:本页只有两个读者——发票列的三态与行菜单的「下载发票」。抬头簿不在
     本页读了,它只服务已经撤掉的申请弹窗,留在二级页。认证等级那一路读也随之撤:
     它只为申请弹窗的提前告知而存在。 */
  const reloadReceipts = useCallback(async () => {
    setReceipts(await fetchInvoiceReceipts());
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setPage(1);
    Promise.all([fetchBillingSummary(), fetchCredits(), reloadReceipts()])
      .then(([sum, creditRecord]) => {
        if (!active) return;
        setSummary(sum);
        setCredits(creditRecord);
      })
      .catch(() => {
        if (!active) return;
        setSummary(null);
        setCredits(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadReceipts, reloadKey]);

  /* 账单表服务端分页(批 3):翻页只取那一页,total 由库数——此前一次拉 100 条在
   * 页面里翻,第 101 张账单起看不到也没人说。 */
  useEffect(() => {
    let active = true;
    setBillsLoading(true);
    fetchBills(page, BILLS_PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        setBills(result.items);
        setBillsTotal(result.total);
      })
      .catch(() => {
        if (!active) return;
        setBills([]);
        setBillsTotal(0);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setBillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey, page]);

  // 账单 → 活跃开票申请(rejected/voided 之外均占位,防重复申请)
  const receiptByBill = useMemo(() => {
    const map = new Map<string, ConsoleInvoiceReceipt>();
    for (const r of receipts) {
      if (r.invoiceStatus === "rejected" || r.invoiceStatus === "voided")
        continue;
      if (!map.has(r.billId)) map.set(r.billId, r);
    }
    return map;
  }, [receipts]);

  /** 账单 → 发票三态。未开票 = 没有活跃申请（驳回/作废已在上面滤掉）。 */
  const invoicePhase = useCallback(
    (b: ConsoleBill): InvoicePhase => {
      const receipt = receiptByBill.get(b.id);
      if (!receipt) return "none";
      return INVOICE_PHASE_BY_STATUS[receipt.invoiceStatus] ?? "processing";
    },
    [receiptByBill],
  );

  const money = useCallback(
    (v: string, currency: string) =>
      formatCurrency(Number.parseFloat(v || "0"), appLocale, currency),
    [appLocale],
  );

  // ── 概览指标（本页业务 3 个指标 → columns=3 铺满，列数随业务不写死）──────
  const metrics = useMemo<MetricGridItem[]>(() => {
    const currency = summary?.currency ?? "CNY";
    const unpaid = summary?.unpaid ?? 0;
    const overdue = summary?.overdue ?? 0;
    // 没读到就是「—」:读失败时的 0 不是没有账单,是没有数据。
    return [
      {
        id: "unpaid",
        icon: "receipt",
        label: t("metrics.unpaid"),
        value: summary ? String(unpaid) : "—",
        ...(unpaid > 0 ? { tone: "warning" as const } : {}),
        trend: !summary
          ? ""
          : overdue > 0
            ? t("metrics.unpaidOverdue", { count: overdue })
            : t("metrics.unpaidNone"),
        ...(overdue > 0 ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "paid-total",
        icon: "seal-check",
        label: t("metrics.paidTotal"),
        value: summary ? money(summary.paidTotal, currency) : "—",
        trend: summary
          ? t("metrics.paidTotalHint", { count: summary.paid })
          : "",
      },
      {
        id: "credits",
        icon: "wallet",
        label: t("metrics.credits"),
        value: credits ? money(credits.balance, credits.currency) : "—",
        trend: credits ? t("metrics.creditsHint") : "",
      },
    ];
  }, [summary, credits, t, money]);

  // ── 账单表(服务端分页) ───────────────────────────────────────────────────
  const pageCount = Math.max(1, Math.ceil(billsTotal / BILLS_PAGE_SIZE));

  /*
   * 列对齐 = 全站表格规范（owner 2026-09-07，规范全文在 DS 的 `DataTable` 文件头）。
   * DS 11.0.0 起这条规范由件**结构性**保证:默认值随位置——首列 `left`、其余
   * `center`，新表不必逐列写。下面几处 `align:"center"` 与默认同值、留着不碍事;
   * 真正偏离默认的只有金额列的 `numeric`。
   */
  const billColumns: DataTableColumn<ConsoleBill>[] = [
    {
      id: "billNo",
      header: t("table.colBillNo"),
      // 首列（标题列）局左 = DS 默认,不显式标 align。两行主副走 DS 的
      // TableTitleCell,不再手写 flex-col——字号/行高/截断由件统一给。
      cell: (b) => (
        <TableTitleCell
          title={<span className="font-mono">{b.billNo}</span>}
          description={fmtDateTime(b.createdAt)}
        />
      ),
    },
    {
      id: "cycle",
      header: t("table.colCycle"),
      align: "center",
      cell: (b) =>
        b.cycleStartDate && b.cycleEndDate ? (
          <span className="tabular-nums">
            {fmtDate(b.cycleStartDate)} ~ {fmtDate(b.cycleEndDate)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "type",
      header: t("table.colType"),
      align: "center",
      width: "sm",
      cell: (b) =>
        b.billType && KNOWN_BILL_TYPES.has(b.billType)
          ? t(`type.${b.billType}`)
          : t("type.normal"),
    },
    {
      // 金额列走 DS 的 numeric 档:右对齐 + 右内边距 + tabular-nums,由件统一给。
      id: "amount",
      header: t("table.colAmount"),
      align: "money",
      cell: (b) => (
        <span className="flex flex-col">
          <span className="font-semibold text-foreground">
            {money(b.payableAmount, b.currency)}
          </span>
          {Number.parseFloat(b.discountAmount) > 0 ? (
            <span className="text-body-sm text-muted-foreground">
              {t("table.discountOff", {
                amount: money(b.discountAmount, b.currency),
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
      cell: (b) => (
        <StatusBadge tone={BILL_STATUS_TONES[b.billStatus] ?? "neutral"}>
          {t(`status.${b.billStatus}`)}
        </StatusBadge>
      ),
    },
    {
      id: "paidAt",
      header: t("table.colPaidAt"),
      align: "center",
      cell: (b) =>
        b.paidAt ? (
          <span className="flex flex-col items-center tabular-nums">
            <span className="text-foreground">{fmtDate(b.paidAt)}</span>
            <span className="text-body-sm text-muted-foreground">
              {fmtTime(b.paidAt)}
            </span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "invoice",
      header: t("table.colInvoice"),
      align: "center",
      cell: (b) => {
        /*
         * 状态列只表状态;申请动作按表格规范归操作列(rowActions)。
         * 三态而非二态:见 INVOICE_PHASE_BY_STATUS 的注释——票没开出来不写「已开票」。
         * 库里那六个状态的细分（申请中 / 已受理 / 已寄送…）在 /billing/invoices 台账里
         * 逐条可查,本列不复述。
         */
        const phase = invoicePhase(b);
        return (
          <StatusBadge tone={INVOICE_PHASE_TONES[phase]}>
            {t(`invoicing.phase.${phase}`)}
          </StatusBadge>
        );
      },
    },
  ];

  // ── 账单行操作(表格规范:操作归 rowActions 单列)──────────────────────────
  const billActions = (b: ConsoleBill): ActionMenuItem[] => {
    const receipt = receiptByBill.get(b.id);
    return [
      {
        /* 常灰(2026-09-29「发票整体灰掉」)。留在原位而不是删掉:入口凭空消失会被
           读成「功能坏了」。理由挂在 hint 上——DS 的 hint 就是为「讲清这一项为什么
           灰着」准备的;同一句话在本节顶部的横幅里也看得见,不必悬停才知道。
           不再按结清/金额/是否已申请分支:那些判据现在一条都改变不了结果,留着
           只会让人以为某个条件满足了就点得动。 */
        id: "apply-invoice",
        label: t("invoicing.applyAction"),
        disabled: true,
        hint: t("invoicing.applyHintPlanned"),
      },
      {
        /* 下载照旧可用:运营线下开出的发票是客户已经拿到的凭证,灰掉入口不该
           顺手把它藏了。 */
        id: "download-invoice",
        label: t("invoicing.records.download"),
        disabled: !receipt?.invoiceFileUrl,
        onSelect: () => {
          if (receipt?.invoiceFileUrl)
            window.open(receipt.invoiceFileUrl, "_blank", "noreferrer");
        },
      },
      /* 「就这张账单求助」(owner 2026-09-29 第 5 条裁决):**只跳转**。带上账单
         可视码去 /tickets,提单表单全 console 只有那一个。 */
      {
        id: "help",
        label: tJump("bill"),
        onSelect: () =>
          router.push(buildTicketComposeHref({ type: "bill", code: b.billNo })),
      },
    ];
  };

  return (
    <ViewLayout>
      <ViewHeader
        icon="receipt"
        title={t("title")}
        description={t("description")}
        action={
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/billing/invoices")}
            >
              <Icon name="file-text" size="xs" fallback="placeholder" />
              <span>{t("viewInvoices")}</span>
            </Button>
            {/* 对账单导出无端点；保持意图可见、禁用不装样。 */}
            <span className="flex items-center gap-sm">
              <Button size="md" variant="outline" disabled>
                <Icon name="arrow-down" size="xs" fallback="placeholder" />
                <span>{t("exportStatement")}</span>
              </Button>
              <PlannedBadge />
            </span>
          </>
        }
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

      {/* ① 我的订单(owner 2026-09-06:订单是钱这条链的第一环,从产品订阅迁来) */}
      <OrdersSection />

      {/* ② 账单记录 */}
      <PageSection
        icon="receipt"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
        action={
          /* 合并开票:一张发票覆盖多张账单。库里还表达不了——invoice_receipts.bill_id
           * 是 NOT NULL 单值外键,一票一单;要做得先加关联表并改 admin 的审核/开具侧。
           * 按本页 exportStatement 的既有做法:意图可见、禁用不装样。
           * 勾选列随申请入口一起撤了,所以标题不再带条数——没有可勾的东西。
           * 没有开票权限的角色不出这个动作。 */
          canManageInvoices ? (
            <span className="flex items-center gap-sm">
              <Button size="md" variant="outline" disabled>
                <Icon name="receipt" size="xs" fallback="placeholder" />
                <span>{t("invoicing.mergeAction")}</span>
              </Button>
              <PlannedBadge />
            </span>
          ) : undefined
        }
      >
        {/* 灰掉要说得出口。行菜单的 hint 只在悬停时出现,所以这一节需要一条
            看得见的说明;它落在这里而不是页头,因为本页灰掉的只是发票这一块。
            文案只讲客户要知道的两件事:现在不能在线申请、需要发票怎么办;「怎么办」
            配一个真出口——官网 /contact 是真页(有电话与邮箱),联系方式不在这里
            写死,改的时候只改官网那一处。 */}
        <Banner
          tone="info"
          title={t("invoicing.planned.notice")}
          description={t("invoicing.planned.noticeBills")}
          action={
            <Button asChild size="sm" variant="outline">
              <a
                href={buildWebsiteContactUrl(locale)}
                target="_blank"
                rel="noreferrer"
              >
                {t("invoicing.planned.contactCta")}
              </a>
            </Button>
          }
        />
        <DataTable<ConsoleBill>
          labels={tableLabels}
          columns={billColumns}
          rows={bills}
          rowKey={(b) => b.id}
          loading={loading || billsLoading}
          indexStart={(page - 1) * BILLS_PAGE_SIZE + 1}
          /* 勾选列撤掉(2026-09-29):它唯一的下游是「合并开票」的候选集,而开票入口
             已经灰掉——勾得上却什么都做不了的复选框就是个死控件。 */
          rowActions={(b) => (
            <ActionMenu label={t("invoicing.rowMenu")} items={billActions(b)} />
          )}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("table.empty")} />
            )
          }
          footer={
            <div className="flex w-full items-center justify-between gap-md text-body-sm text-muted-foreground">
              <span className="tabular-nums">
                {loadFailed ? "—" : t("table.total", { count: billsTotal })}
              </span>
              {pageCount > 1 ? (
                <span className="flex items-center gap-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1 || billsLoading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("table.prevPage")}
                  </Button>
                  <span className="tabular-nums">
                    {page} / {pageCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= pageCount || billsLoading}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    {t("table.nextPage")}
                  </Button>
                </span>
              ) : null}
            </div>
          }
        />
      </PageSection>

      {/* ③ 加油包与扩展包(自助购买闭环;2026-09-08 从配额页迁来)。
          放在两张台账之后:来费用中心的人多半是来看账的,买的入口不该把账挤下去。
          加油包真实的发现路径是**配额页发现额度告急 → 去加购**,那边留了直达锚点
          的入口,所以这里靠后不影响找得到。 */}
      <AddonPacksSection
        id={ADDON_SECTION_ID}
        onSettledRefresh={() => setReloadKey((k) => k + 1)}
        formatMoney={money}
        canPurchase={canPurchaseAddons}
      />

      {/* ④ 收款与计费口径 */}
      <PageSection
        icon="seal-check"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
          <SignalList
            items={[
              {
                title: t("notes.paymentTitle"),
                description: t("notes.paymentBody"),
              },
              {
                title: t("notes.billingTitle"),
                description: t("notes.billingBody"),
              },
            ]}
          />
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
