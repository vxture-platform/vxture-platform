"use client";

/**
 * InvoiceSections.tsx — 发票台账(二级页组合件,owner 2026-08-21 归集裁定)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 两块台账,都在二级页 `/billing/invoices`:
 *   ① 发票记录:申请号/账单/抬头/金额/六态状态/文件下载与寄送信息;
 *   ② 开票抬头:抬头簿 CRUD + 设默认(专票强制税号+开户信息)。
 *
 * **2026-09-29 owner 裁定「发票整体灰掉,规划中」**:在线申请那一半从本件整体撤掉
 * ——申请弹窗、它的认证提示、以及 `mode` 开关一并去掉,本件只剩台账。撤的理由不是
 * 「还没做完」而是「接不下去」:客户提交后落 `applying` 的那一行,库里没有写者能把它
 * 推进(approved / rejected 两值全仓零写者;运营真开票时是另插一行),所以这个入口
 * 收的是答不了的请求。撤掉的只是**入口**,不是读路径——已提交的申请与运营线下开出的
 * 发票照旧在这两张表里可读可下载:把停住的请求藏起来等于把它弄丢。
 *
 * 抬头簿保持可编辑:它是客户自己的数据,增删改都真落库,不是空跑的控件。
 * DS 组合件,无自造样式。
 */

import { RowActionsPlaceholder } from "@/components/table/RowActionsPlaceholder";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldLabel,
  Input,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  createBillingAddress,
  deleteBillingAddress,
  setDefaultBillingAddress,
  updateBillingAddress,
  type ConsoleBillingAddress,
  type ConsoleBillingAddressInput,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { PageSection } from "@/layout/shell";
import { useConfirmLabels } from "@/lib/destructive";
import { useDateFormat } from "@/lib/use-date-format";

/** invoice_status 六值域(52_billing.sql CHECK)→ 徽章语气。 */
export const RECEIPT_STATUS_TONES: Record<string, StatusBadgeTone> = {
  applying: "info",
  approved: "info",
  issued: "success",
  sent: "success",
  rejected: "warning",
  voided: "neutral",
};

const KNOWN_RECEIPT_STATUSES = new Set([
  "applying",
  "approved",
  "issued",
  "sent",
  "rejected",
  "voided",
]);
const KNOWN_INVOICE_TYPES = new Set([
  "electronic_general",
  "electronic_special",
  "paper_special",
]);

type AddressFormState = ConsoleBillingAddressInput & { id: string | null };

const EMPTY_ADDRESS_FORM: AddressFormState = {
  id: null,
  invoiceTaxType: "general",
  title: "",
  taxNo: "",
  phone: "",
  address: "",
  bankName: "",
  bankAccount: "",
};

export function InvoiceSections({
  receipts,
  addresses,
  loading,
  readOnly = false,
  onChanged,
  money,
}: {
  receipts: ConsoleInvoiceReceipt[];
  addresses: ConsoleBillingAddress[];
  loading: boolean;
  /** 无 tenant.invoice.manage:只看发票记录与抬头,不出现新增/编辑/删除入口。 */
  readOnly?: boolean;
  /** 任一写操作成功后,父页重取发票/抬头数据 */
  onChanged: () => Promise<void>;
  money: (v: string, currency: string) => string;
}) {
  const { fmtDateTime } = useDateFormat();

  const t = useTranslations("billingPage.invoicing");
  const tableLabels = useTableLabels();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormState | null>(null);
  const withLabels = useConfirmLabels();

  const statusLabel = (s: string): string =>
    KNOWN_RECEIPT_STATUSES.has(s) ? t(`status.${s}`) : s;
  const typeLabel = (v: string): string =>
    KNOWN_INVOICE_TYPES.has(v) ? t(`type.${v}`) : v;

  const runWrite = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("writeFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAddress = async () => {
    if (!addressForm) return;
    const input: ConsoleBillingAddressInput = {
      invoiceTaxType: addressForm.invoiceTaxType,
      title: addressForm.title,
      ...(addressForm.taxNo ? { taxNo: addressForm.taxNo } : {}),
      ...(addressForm.phone ? { phone: addressForm.phone } : {}),
      ...(addressForm.address ? { address: addressForm.address } : {}),
      ...(addressForm.bankName ? { bankName: addressForm.bankName } : {}),
      ...(addressForm.bankAccount
        ? { bankAccount: addressForm.bankAccount }
        : {}),
    };
    const ok = await runWrite(() =>
      addressForm.id
        ? updateBillingAddress(addressForm.id, input)
        : createBillingAddress(input),
    );
    if (ok) setAddressForm(null);
  };

  // ── ① 发票记录 ────────────────────────────────────────────────────────────
  const receiptSort = useMemo(
    () => ({
      invoiceNo: (r: ConsoleInvoiceReceipt) => r.invoiceNo,
      amount: (r: ConsoleInvoiceReceipt) =>
        Number.parseFloat(r.invoiceAmount || "0"),
    }),
    [],
  );
  const {
    sort: receiptSortState,
    onSortChange: onReceiptSortChange,
    rows: sortedReceipts,
  } = useTableSort(receipts, receiptSort);

  const receiptColumns: DataTableColumn<ConsoleInvoiceReceipt>[] = [
    {
      id: "invoiceNo",
      sortable: true,
      header: t("records.colNo"),
      cell: (r) => (
        <TableTitleCell
          title={<span className="font-mono">{r.invoiceNo}</span>}
          description={
            <span className="tabular-nums">{fmtDateTime(r.createdAt)}</span>
          }
        />
      ),
    },
    {
      id: "bill",
      header: t("records.colBill"),
      cell: (r) =>
        r.billNo ? (
          <span className="font-mono text-body-sm">{r.billNo}</span>
        ) : (
          "—"
        ),
    },
    {
      id: "title",
      header: t("records.colTitle"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="text-foreground">{r.invoiceTitle}</span>
          <span className="text-body-sm text-muted-foreground">
            {typeLabel(r.invoiceType)}
          </span>
        </span>
      ),
    },
    {
      id: "amount",
      sortable: true,
      header: t("records.colAmount"),
      align: "money",
      cell: (r) => (
        <span className="tabular-nums font-medium text-foreground">
          {money(r.invoiceAmount, r.currency)}
        </span>
      ),
    },
    {
      id: "status",
      header: t("records.colStatus"),
      align: "center",
      cell: (r) => (
        <StatusBadge tone={RECEIPT_STATUS_TONES[r.invoiceStatus] ?? "neutral"}>
          {statusLabel(r.invoiceStatus)}
        </StatusBadge>
      ),
    },
    {
      id: "delivery",
      header: t("records.colDelivery"),
      cell: (r) => {
        if (r.invoiceFileUrl) {
          return (
            <Button asChild variant="ghost" size="sm">
              <a href={r.invoiceFileUrl} target="_blank" rel="noreferrer">
                {t("records.download")}
              </a>
            </Button>
          );
        }
        if (r.expressNo) {
          return (
            <span className="text-body-sm text-muted-foreground tabular-nums">
              {r.expressCompany ?? ""} {r.expressNo}
            </span>
          );
        }
        if (r.invoiceStatus === "rejected" && r.statusRemark) {
          return (
            <span className="text-body-sm text-warning-text">
              {r.statusRemark}
            </span>
          );
        }
        return "—";
      },
    },
  ];

  // ── ② 开票抬头 ────────────────────────────────────────────────────────────
  const addressActions = (a: ConsoleBillingAddress): ActionMenuItem[] => [
    {
      id: "edit",
      label: t("addresses.edit"),
      onSelect: () =>
        setAddressForm({
          id: a.id,
          invoiceTaxType: a.invoiceTaxType,
          title: a.title,
          taxNo: a.taxNo ?? "",
          phone: a.phone ?? "",
          address: a.address ?? "",
          bankName: a.bankName ?? "",
          bankAccount: a.bankAccount ?? "",
        }),
    },
    {
      id: "default",
      label: t("addresses.setDefault"),
      disabled: a.isDefault,
      onSelect: () => void runWrite(() => setDefaultBillingAddress(a.id)),
    },
    {
      id: "delete",
      label: t("addresses.delete"),
      danger: true,
      confirm: withLabels({
        verb: t("addresses.deleteVerb"),
        target: a.title,
        consequence: t("addresses.deleteConsequence"),
        onConfirm: async () => {
          /* `runWrite` 把异常吞成 boolean，所以这里把"没成功"再翻译回一个
             rejected——否则 DS 会把一次失败的删除当成成功、把框关掉。 */
          const ok = await runWrite(() => deleteBillingAddress(a.id));
          if (!ok) throw new Error(t("writeFailed"));
        },
      }),
    },
  ];

  const addressColumns: DataTableColumn<ConsoleBillingAddress>[] = [
    {
      id: "title",
      header: t("addresses.colTitle"),
      cell: (a) => (
        <span className="flex items-center gap-sm">
          <span className="text-foreground">{a.title}</span>
          {a.isDefault ? (
            <StatusBadge tone="info">{t("addresses.default")}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: "taxType",
      header: t("addresses.colTaxType"),
      align: "center",
      cell: (a) => t(`taxType.${a.invoiceTaxType}`),
    },
    {
      id: "taxNo",
      header: t("addresses.colTaxNo"),
      cell: (a) =>
        a.taxNo ? (
          <span className="font-mono text-body-sm">{a.taxNo}</span>
        ) : (
          "—"
        ),
    },
  ];

  const specialForm = addressForm?.invoiceTaxType === "special";

  return (
    <>
      {/* ① 发票记录 */}
      <PageSection
        icon="file-text"
        level={2}
        title={t("records.title")}
        description={t("records.description")}
      >
        {error ? <Banner tone="danger" title={error} /> : null}
        <DataTable<ConsoleInvoiceReceipt>
          labels={tableLabels}
          columns={receiptColumns}
          rows={sortedReceipts}
          {...(receiptSortState ? { sort: receiptSortState } : {})}
          onSortChange={onReceiptSortChange}
          rowKey={(r) => r.id}
          /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
             与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
          leadingSpacer
          /* 操作列占位：本表当前没有行动作，补一格禁用的汇聚按钮——列的位置
             先占住，右缘与同页其它表对齐；将来加动作时改的是这一格的内容，
             不是整张表的列结构（owner 2026-09-07）。 */
          rowActions={() => <RowActionsPlaceholder />}
          loading={loading}
          indexStart={1}
          empty={<EmptyState title={t("records.empty")} />}
        />
      </PageSection>

      {/* ② 开票抬头 */}
      <PageSection
        icon="buildings"
        level={2}
        title={t("addresses.title")}
        description={t("addresses.description")}
        action={
          readOnly ? undefined : (
            <Button
              size="md"
              variant="outline"
              onClick={() => setAddressForm({ ...EMPTY_ADDRESS_FORM })}
            >
              {t("addresses.add")}
            </Button>
          )
        }
      >
        <DataTable<ConsoleBillingAddress>
          labels={tableLabels}
          columns={addressColumns}
          rows={addresses}
          rowKey={(a) => a.id}
          /* 首格占位：这张表既没有多选也没有展开，补一格空位让首个业务列
             与同页其它表的首列落在同一条 x 上（规范：首格 64px 常态占据）。 */
          leadingSpacer
          loading={loading}
          indexStart={1}
          {...(readOnly
            ? {}
            : {
                rowActions: (a: ConsoleBillingAddress) => (
                  <ActionMenu
                    label={t("addresses.rowMenu")}
                    items={addressActions(a)}
                  />
                ),
              })}
          empty={<EmptyState title={t("addresses.empty")} />}
        />
      </PageSection>

      {/* ③ 抬头新增/编辑弹窗 */}
      <Dialog
        open={addressForm !== null}
        onOpenChange={(open) => {
          if (!open) setAddressForm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addressForm?.id
                ? t("addresses.editTitle")
                : t("addresses.addTitle")}
            </DialogTitle>
            <DialogDescription>{t("addresses.formHint")}</DialogDescription>
          </DialogHeader>

          {addressForm ? (
            <div className="flex flex-col gap-sm">
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="addr-tax-type">
                  {t("addresses.colTaxType")}
                </FieldLabel>
                <NativeSelect
                  id="addr-tax-type"
                  value={addressForm.invoiceTaxType}
                  onChange={(e) =>
                    setAddressForm({
                      ...addressForm,
                      invoiceTaxType: e.target.value as "general" | "special",
                    })
                  }
                >
                  <option value="general">{t("taxType.general")}</option>
                  <option value="special">{t("taxType.special")}</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="addr-title">
                  {t("addresses.fieldTitle")}
                </FieldLabel>
                <Input
                  id="addr-title"
                  value={addressForm.title}
                  onChange={(e) =>
                    setAddressForm({ ...addressForm, title: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="addr-tax-no">
                  {t("addresses.fieldTaxNo")}
                  {specialForm ? " *" : ""}
                </FieldLabel>
                <Input
                  id="addr-tax-no"
                  value={addressForm.taxNo ?? ""}
                  onChange={(e) =>
                    setAddressForm({ ...addressForm, taxNo: e.target.value })
                  }
                />
              </div>
              {specialForm ? (
                <>
                  <div className="flex flex-col gap-xs">
                    <FieldLabel htmlFor="addr-bank-name">
                      {t("addresses.fieldBankName")} *
                    </FieldLabel>
                    <Input
                      id="addr-bank-name"
                      value={addressForm.bankName ?? ""}
                      onChange={(e) =>
                        setAddressForm({
                          ...addressForm,
                          bankName: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <FieldLabel htmlFor="addr-bank-account">
                      {t("addresses.fieldBankAccount")} *
                    </FieldLabel>
                    <Input
                      id="addr-bank-account"
                      value={addressForm.bankAccount ?? ""}
                      onChange={(e) =>
                        setAddressForm({
                          ...addressForm,
                          bankAccount: e.target.value,
                        })
                      }
                    />
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="addr-phone">
                  {t("addresses.fieldPhone")}
                </FieldLabel>
                <Input
                  id="addr-phone"
                  value={addressForm.phone ?? ""}
                  onChange={(e) =>
                    setAddressForm({ ...addressForm, phone: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="addr-address">
                  {t("addresses.fieldAddress")}
                </FieldLabel>
                <Input
                  id="addr-address"
                  value={addressForm.address ?? ""}
                  onChange={(e) =>
                    setAddressForm({
                      ...addressForm,
                      address: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddressForm(null)}
              disabled={busy}
            >
              {t("addresses.cancel")}
            </Button>
            <Button onClick={() => void handleSaveAddress()} disabled={busy}>
              {t("addresses.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
