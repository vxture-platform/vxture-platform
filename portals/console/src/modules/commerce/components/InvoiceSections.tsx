"use client";

/**
 * InvoiceSections.tsx — 发票管理(账单管理页组合件,owner 2026-08-21 归集裁定)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 两个区块(位置:账单表下方、收款与计费口径上方)+ 两个弹窗:
 *   ① 发票记录:申请号/账单/抬头/金额/六态状态/文件下载与寄送信息;
 *   ② 开票抬头:抬头簿 CRUD + 设默认(专票强制税号+开户信息);
 *   申请弹窗:从账单表「申请发票」进入(资格 = 已结清,普票/专票随抬头类型)。
 * 开票两个来源(直接订阅付款 + 预付款扣费对账单)同为已结清账单,不按类型分流。
 * 申请后运营在 admin 发票台账开具/寄送,状态回流本区。DS 组合件,无自造样式。
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  applyInvoiceReceipt,
  createBillingAddress,
  deleteBillingAddress,
  setDefaultBillingAddress,
  updateBillingAddress,
  type ConsoleBill,
  type ConsoleBillingAddress,
  type ConsoleBillingAddressInput,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { PageSection } from "@/layout/shell";
import { useConfirmLabels } from "@/lib/destructive";
import { fmtDate, fmtTime } from "./hubModel";

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
  applyBill,
  onApplyClose,
  onChanged,
  money,
}: {
  receipts: ConsoleInvoiceReceipt[];
  addresses: ConsoleBillingAddress[];
  loading: boolean;
  /** 账单表「申请发票」选中的账单;null = 弹窗关闭 */
  applyBill: ConsoleBill | null;
  onApplyClose: () => void;
  /** 任一写操作成功后,父页重取发票/抬头数据 */
  onChanged: () => Promise<void>;
  money: (v: string, currency: string) => string;
}) {
  const t = useTranslations("billingPage.invoicing");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormState | null>(null);
  const [applyAddressId, setApplyAddressId] = useState<string>("");
  const [applyType, setApplyType] = useState<string>("");
  const withLabels = useConfirmLabels();

  const statusLabel = (s: string): string =>
    KNOWN_RECEIPT_STATUSES.has(s) ? t(`status.${s}`) : s;
  const typeLabel = (v: string): string =>
    KNOWN_INVOICE_TYPES.has(v) ? t(`type.${v}`) : v;

  // ── 申请弹窗派生态:默认抬头预选 + 类型随抬头约束 ─────────────────────────
  const applyAddress = useMemo(
    () =>
      addresses.find((a) => a.id === applyAddressId) ??
      addresses.find((a) => a.isDefault) ??
      addresses[0] ??
      null,
    [addresses, applyAddressId],
  );
  const applyTypeOptions = useMemo(() => {
    if (!applyAddress) return [];
    return applyAddress.invoiceTaxType === "special"
      ? ["electronic_special", "paper_special"]
      : ["electronic_general"];
  }, [applyAddress]);
  const effectiveApplyType = applyTypeOptions.includes(applyType)
    ? applyType
    : (applyTypeOptions[0] ?? "");

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

  const handleApply = async () => {
    if (!applyBill || !applyAddress || !effectiveApplyType) return;
    const ok = await runWrite(() =>
      applyInvoiceReceipt({
        billId: applyBill.id,
        addressId: applyAddress.id,
        invoiceType: effectiveApplyType,
      }),
    );
    if (ok) onApplyClose();
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
  const receiptColumns: DataTableColumn<ConsoleInvoiceReceipt>[] = [
    {
      id: "invoiceNo",
      header: t("records.colNo"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-mono text-label-md text-foreground">
            {r.invoiceNo}
          </span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {fmtDate(r.createdAt)} {fmtTime(r.createdAt)}
          </span>
        </span>
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
      header: t("records.colAmount"),
      align: "right",
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
      {/* ② 发票记录 */}
      <PageSection
        icon="file-text"
        level={2}
        title={t("records.title")}
        description={t("records.description")}
      >
        {error ? <Banner tone="danger" title={error} /> : null}
        <DataTable<ConsoleInvoiceReceipt>
          columns={receiptColumns}
          rows={receipts}
          rowKey={(r) => r.id}
          loading={loading}
          indexStart={1}
          empty={<EmptyState title={t("records.empty")} />}
        />
      </PageSection>

      {/* ③ 开票抬头 */}
      <PageSection
        icon="buildings"
        level={2}
        title={t("addresses.title")}
        description={t("addresses.description")}
        action={
          <Button
            size="md"
            variant="outline"
            onClick={() => setAddressForm({ ...EMPTY_ADDRESS_FORM })}
          >
            {t("addresses.add")}
          </Button>
        }
      >
        <DataTable<ConsoleBillingAddress>
          columns={addressColumns}
          rows={addresses}
          rowKey={(a) => a.id}
          loading={loading}
          indexStart={1}
          rowActions={(a) => (
            <ActionMenu
              label={t("addresses.rowMenu")}
              items={addressActions(a)}
            />
          )}
          empty={<EmptyState title={t("addresses.empty")} />}
        />
      </PageSection>

      {/* 申请发票弹窗 */}
      <Dialog
        open={applyBill !== null}
        onOpenChange={(open) => {
          if (!open) onApplyClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apply.title")}</DialogTitle>
            <DialogDescription>
              {applyBill
                ? t("apply.description", {
                    billNo: applyBill.billNo,
                    amount: money(applyBill.payableAmount, applyBill.currency),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>

          {addresses.length === 0 ? (
            <Banner tone="info" title={t("apply.noAddress")} />
          ) : (
            <div className="flex flex-col gap-sm">
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="receipt-address">
                  {t("apply.address")}
                </FieldLabel>
                <NativeSelect
                  id="receipt-address"
                  value={applyAddress?.id ?? ""}
                  onChange={(e) => setApplyAddressId(e.target.value)}
                >
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                      {a.isDefault ? ` (${t("addresses.default")})` : ""} ·{" "}
                      {t(`taxType.${a.invoiceTaxType}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-xs">
                <FieldLabel htmlFor="receipt-type">
                  {t("apply.type")}
                </FieldLabel>
                <NativeSelect
                  id="receipt-type"
                  value={effectiveApplyType}
                  onChange={(e) => setApplyType(e.target.value)}
                >
                  {applyTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {typeLabel(v)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onApplyClose} disabled={busy}>
              {t("apply.cancel")}
            </Button>
            {addresses.length === 0 ? (
              <Button
                onClick={() => {
                  onApplyClose();
                  setAddressForm({ ...EMPTY_ADDRESS_FORM });
                }}
              >
                {t("apply.createAddress")}
              </Button>
            ) : (
              <Button
                onClick={() => void handleApply()}
                disabled={busy || !applyAddress || !effectiveApplyType}
              >
                {t("apply.submit")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 抬头新增/编辑弹窗 */}
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
                    setAddressForm({ ...addressForm, address: e.target.value })
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
              {t("apply.cancel")}
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
