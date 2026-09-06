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
 * 拆的判据是**台账 vs 动作**:「申请发票」是账单行上的动作,它留在费用中心——动作要
 * 发生在对象所在的那一页,把人先送到另一页再让他找回那张账单是绕的。本页只回答
 * 「开过哪些票」与「抬头有哪些」。
 *
 * 本页由 tenant.invoice.manage 之外的人也看得见(读侧不设码,与费用中心同);
 * 无该码时台账只读——新增/编辑/删除抬头的入口不出现。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Icon, ViewHeader, ViewLayout } from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  fetchBillingAddresses,
  fetchInvoiceReceipts,
  fetchTenantVerification,
  type ConsoleBillingAddress,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useRouter } from "@/lib/i18n/navigation";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
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
  /* 认证等级挡住开票时的提示;读不到就当不挡(null),真门在 console-bff。 */
  const [invoiceBlockedBy, setInvoiceBlockedBy] = useState<
    "lite" | "none" | null
  >(null);

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

  useEffect(() => {
    let active = true;
    fetchTenantVerification()
      .then((s) => {
        if (!active) return;
        setInvoiceBlockedBy(
          s.canIssueInvoice ? null : s.level === "lite" ? "lite" : "none",
        );
      })
      .catch(() => {
        if (active) setInvoiceBlockedBy(null);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

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

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <InvoiceSections
        mode="ledger"
        receipts={receipts}
        addresses={addresses}
        loading={loading}
        readOnly={!canManageInvoices}
        applyBill={null}
        onApplyClose={() => undefined}
        onChanged={reload}
        money={money}
        invoiceBlockedBy={invoiceBlockedBy}
      />
    </ViewLayout>
  );
}
