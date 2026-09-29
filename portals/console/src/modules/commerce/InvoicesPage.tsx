"use client";

/**
 * InvoicesPage.tsx — 发票与抬头(费用中心的二级页)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 路由 `/billing/invoices`。owner 2026-09-06:费用中心归集了订单 + 账单 + 发票之后
 * 一页太长,发票记录与开票抬头这两块**台账**降为二级页。
 *
 * 拆的判据是**台账 vs 动作**:动作那一半在费用中心的账单行上。本页只回答
 * 「开过哪些票」与「抬头有哪些」。
 *
 * 本页由 tenant.invoice.manage 之外的人也看得见(读侧不设码,与费用中心同);
 * 无该码时台账只读——新增/编辑/删除抬头的入口不出现。
 *
 * **2026-09-29 owner 裁定「发票整体灰掉,规划中」**:页头挂 `PlannedBadge`(与本门户
 * 其它规划中的面同一套词汇,不另造第二种说法),下面一条横幅说清「现在不能在线申请、
 * 需要发票找谁」。两张台账**照旧读真数据**:停在「申请中」的旧申请与运营线下开出的
 * 发票都必须留在这里看得见——把停住的请求藏起来,就把它从「等着」变成了「丢了」。
 * 抬头簿保持可编辑:那是客户自己的数据,增删改都真落库。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Icon,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  fetchBillingAddresses,
  fetchInvoiceReceipts,
  type ConsoleBillingAddress,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useRouter } from "@/lib/i18n/navigation";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { PlannedBadge } from "@/components/planned";
import { buildWebsiteContactUrl } from "@/lib/website-entry";
import { InvoiceSections } from "./components/InvoiceSections";

export function InvoicesPage() {
  const t = useTranslations("billingPage");
  const locale = useLocale();
  const appLocale = locale as Locale;
  const router = useRouter();
  const { session } = useConsoleSession();
  const canManageInvoices = hasCapability(
    session.capabilities,
    "tenant.invoice.manage",
  );

  const [receipts, setReceipts] = useState<ConsoleInvoiceReceipt[]>([]);
  const [addresses, setAddresses] = useState<ConsoleBillingAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(async () => {
    const [receiptRows, addressRows] = await Promise.all([
      fetchInvoiceReceipts(),
      fetchBillingAddresses(),
    ]);
    setReceipts(receiptRows);
    setAddresses(addressRows);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    reload()
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload, session.tenant?.id, reloadKey]);

  const money = useCallback(
    (v: string, currency: string) =>
      formatCurrency(Number.parseFloat(v || "0"), appLocale, currency),
    [appLocale],
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="file-text"
        title={t("invoicesPage.title")}
        description={t("invoicesPage.description")}
        secondary={<PlannedBadge />}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={() => router.push("/billing")}
          >
            <Icon name="arrow-left" size="xs" fallback="placeholder" />
            <span>{t("invoicesPage.backToBilling")}</span>
          </Button>
        }
      />

      {/* 规划中的说明紧跟页头(与本门户其它规划中的面同一位置)。文案不解释状态机,
          只说两件事:现在不能在线申请、需要发票找客服(按钮指到官网 /contact 那一
          真页,联系方式不在 console 里写死);同时点明下面两张表里的旧申请与已开
          发票照旧可查可下载。 */}
      <Banner
        tone="info"
        title={t("invoicing.planned.notice")}
        description={t("invoicing.planned.noticeLedger")}
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

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <InvoiceSections
        receipts={receipts}
        addresses={addresses}
        loading={loading}
        readOnly={!canManageInvoices}
        onChanged={reload}
        money={money}
      />
    </ViewLayout>
  );
}
