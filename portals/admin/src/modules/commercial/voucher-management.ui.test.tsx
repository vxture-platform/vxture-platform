/**
 * voucher-management.ui.test.tsx - Render voucher controls with deterministic HTTP fixtures.
 * @package @vxture/admin
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  type ReactNode,
  type FormEventHandler,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type LabelHTMLAttributes,
  type ButtonHTMLAttributes,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NamespaceKeys, NestedKeyOf } from "next-intl";
import * as api from "@/api/admin-bff";
import type {
  VoucherBatchDetail,
  VoucherInstance,
} from "@/api/voucher-management.types";
import type {
  SessionSnapshot,
  PromotionOperationRecord,
  PromotionRedemptionRecord,
} from "@/entities/console";
import { PromotionsPage } from "./PromotionsPage";
import { PromotionRedemptionsPage } from "./PromotionRedemptionsPage";
import { exportRowsToCsv } from "@/lib/exportCsv";
import {
  useVoucherLabels,
  usePromotionStatusLabels,
  usePromotionTypeLabels,
} from "@/modules/shared/enum-labels";
import { VoucherBatchDetailDialog } from "./VoucherBatchDetailDialog";
import {
  AssignVouchersDialog,
  CreateVoucherBatchDialog,
} from "./VoucherBatchDialogs";

// ============================================================================
// Fixtures replace I/O and visual primitives; no business controls are mocked.
// ============================================================================
const state = vi.hoisted(() => ({
  locale: "zh-CN",
  session: {
    isAuthenticated: true,
    user: {
      id: "reviewer",
      name: "Reviewer",
      email: "test@example.invalid",
      roleLabel: "运营",
    },
    capabilities: ["promotion:campaign.manage", "promotion:campaign.read"],
  } as SessionSnapshot,
  run: vi.fn(async <T,>(action: () => Promise<T>): Promise<T> => action()),
}));
vi.mock("next-intl", async (original) => {
  const real = await original<typeof import("next-intl")>();
  const [{ default: chinese }, { default: english }] = await Promise.all([
    import("../../../messages/zh-CN.json"),
    import("../../../messages/en-US.json"),
  ]);
  type TestNamespace = NamespaceKeys<
    typeof chinese,
    NestedKeyOf<typeof chinese>
  >;
  const makeTranslator = (namespace?: TestNamespace) =>
    real.createTranslator({
      locale: state.locale === "en-US" ? "en-US" : "zh-CN",
      messages: state.locale === "en-US" ? english : chinese,
      ...(namespace ? { namespace } : {}),
      onError: (error) => {
        throw error;
      },
    });
  const translators = new Map<string, ReturnType<typeof makeTranslator>>();
  return {
    ...real,
    useTranslations: (namespace?: TestNamespace) => {
      const key = `${state.locale}:${namespace ?? ""}`;
      const existing = translators.get(key);
      if (existing) return existing;
      const translator = makeTranslator(namespace);
      translators.set(key, translator);
      return translator;
    },
    useLocale: () => state.locale,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/exportCsv", () => ({ exportRowsToCsv: vi.fn() }));
vi.mock("@/modules/shared/table", () => ({ useTableLabels: () => ({}) }));
vi.mock("@/modules/shared/PageHeader", () => ({
  PageHeader: (p: { title: ReactNode }) => <h1>{p.title}</h1>,
}));
vi.mock("@/modules/shared/ListPagination", () => ({
  ListPagination: (p: {
    currentPage: number;
    onPageChange: (n: number) => void;
  }) => (
    <button type="button" onClick={() => p.onPageChange(p.currentPage + 1)}>
      next-page
    </button>
  ),
}));
vi.mock("@/features/session/AdminSessionProvider", () => ({
  useAdminSession: () => ({ session: state.session }),
}));
vi.mock("@/providers/StepUpProvider", async (original) => ({
  ...(await original<typeof import("@/providers/StepUpProvider")>()),
  useStepUp: () => ({ runWithStepUp: state.run }),
}));
vi.mock("@/api/admin-bff", () => ({
  fetchPromotionPage: vi.fn(),
  fetchPromotionRedemptionRecords: vi.fn(),
  createVoucherBatch: vi.fn(),
  assignVouchers: vi.fn(),
  fetchVoucherBatch: vi.fn(),
  fetchVoucherInstances: vi.fn(),
  fetchVoucherEvents: vi.fn(),
  manageVoucherBatch: vi.fn(),
  revokeVoucher: vi.fn(),
  issueVoucherCredentials: vi.fn(),
  fetchCardFundingSources: vi.fn(),
  fetchProductPlans: vi.fn(),
  fetchPlanVersions: vi.fn(),
}));
vi.mock("@vxture/design-system", () => ({
  ListPageTemplate: (p: {
    header: ReactNode;
    summary: ReactNode;
    filters: ReactNode;
    bulkBar: ReactNode;
    table: ReactNode;
    footer: ReactNode;
  }) => (
    <>
      {p.header}
      {p.summary}
      {p.filters}
      {p.bulkBar}
      {p.table}
      {p.footer}
    </>
  ),
  FilterBar: (p: {
    search: ReactNode;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {p.search}
      {p.actions}
      {p.children}
    </>
  ),
  MetricGrid: () => null,
  BulkActionBar: () => null,
  EmptyState: (p: { title: ReactNode; description: ReactNode }) => (
    <p>
      {p.title}
      {p.description}
    </p>
  ),
  StatusBadge: (p: { children: ReactNode }) => <span>{p.children}</span>,
  Badge: (p: { children: ReactNode }) => <span>{p.children}</span>,
  Banner: (p: {
    children: ReactNode;
    description: ReactNode;
    title: ReactNode;
  }) => (
    <p>
      {p.title}
      {p.description}
      {p.children}
    </p>
  ),
  TableTitleCell: (p: { title: ReactNode; description: ReactNode }) => (
    <span>
      {p.title}
      {p.description}
    </span>
  ),
  ActionMenu: () => null,
  DataTable: <T extends { id: string }>(p: {
    rows: T[];
    columns: Array<{ id: string; cell?: (row: T) => ReactNode }>;
    empty: ReactNode;
  }) => (
    <div role="table">
      {p.rows.length
        ? p.rows.map((row) => (
            <div role="row" key={row.id}>
              {p.columns.map((column) => (
                <span key={column.id}>{column.cell?.(row)}</span>
              ))}
            </div>
          ))
        : p.empty}
    </div>
  ),
  DialogForm: (p: {
    children: ReactNode;
    title: string;
    description: ReactNode;
    onSubmit: FormEventHandler<HTMLFormElement>;
    submitDisabled?: boolean;
    submitting: boolean;
    submitLabel: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <form onSubmit={p.onSubmit}>
      <h1>{p.title}</h1>
      <p>{p.description}</p>
      {p.children}
      <button type="submit" disabled={p.submitDisabled || p.submitting}>
        {p.submitLabel}
      </button>
      <button type="button" onClick={() => p.onOpenChange(false)}>
        dismiss
      </button>
    </form>
  ),
  ConfirmDestructive: (p: {
    verb: string;
    target: string;
    consequence: string;
    onConfirm: () => Promise<void>;
    onOpenChange: (v: boolean) => void;
  }) => (
    <section role="alertdialog">
      <h2>
        {p.verb}
        {p.target}
      </h2>
      <p>{p.consequence}</p>
      <button type="button" onClick={() => void p.onConfirm()}>
        confirm
      </button>
      <button type="button" onClick={() => p.onOpenChange(false)}>
        cancel-confirm
      </button>
    </section>
  ),
  Input: (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} />,
  NativeSelect: ({
    wrapperClassName: _wrapper,
    ...p
  }: SelectHTMLAttributes<HTMLSelectElement> & {
    wrapperClassName?: string;
  }) => <select {...p} />,
  Label: (p: LabelHTMLAttributes<HTMLLabelElement>) => <label {...p} />,
  ActionButton: ({
    icon: _icon,
    variant: _variant,
    ...p
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: string;
    variant?: string;
  }) => <button {...p} />,
}));
let host: HTMLDivElement, root: Root, detail: VoucherBatchDetail;
let onClose: ReturnType<typeof vi.fn<() => void>>,
  onChanged: ReturnType<typeof vi.fn<() => void>>;
const batch: PromotionOperationRecord = {
  id: "batch",
  promotionCode: "VB-01",
  codePrefix: "VB-01",
  effect: { amount_cents: 1000 },
  promotionName: "Test batch",
  promotionType: "coupon",
  kind: "credit_voucher",
  tenantId: null,
  totalCount: 100,
  issuedCount: 1,
  status: "active",
  scopeLabel: "平台级",
  discountLabel: "10元",
  redemptionCount: 0,
  tenantCount: 0,
  startsAt: "2026-11-01T00:00:00Z",
  endsAt: "2099-12-31T00:00:00Z",
  ownerName: "Creator",
  description: "test",
  updatedAt: "2026-11-20T00:00:00Z",
};
const instance: VoucherInstance = {
  id: "voucher",
  code: "V-01",
  status: "assigned",
  tenantId: "tenant",
  workspaceId: null,
  userId: "customer",
  claimedAt: null,
  expiresAt: "2099-12-31T00:00:00Z",
  reservedOrderId: null,
  redeemedOrderId: null,
  redemptionNo: null,
  paymentId: null,
  invoiceItemId: null,
  subscriptionId: null,
  walletTransactions: ["TXN-01"],
  fundingPaymentNo: "PAY-01",
  fundingStatus: "transferred",
};
async function renderDetail(id = "batch") {
  await act(async () => {
    root.render(
      <VoucherBatchDetailDialog
        id={id}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
  });
}
async function fill(id: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(
      "#" + id,
    )!;
    const prototype =
      input.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(
      new window.Event(input.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
}
async function click(text: string) {
  await act(async () => {
    const item = button(text);
    expect(item, text).toBeDefined();
    item!.click();
  });
}
async function send() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "zh-CN";
  state.session = {
    ...state.session,
    isAuthenticated: true,
    user: {
      id: "reviewer",
      name: "Reviewer",
      email: "test@example.invalid",
      roleLabel: "运营",
    },
    capabilities: ["promotion:campaign.manage", "promotion:campaign.read"],
  };
  state.run.mockImplementation(async (action) => action());
  detail = {
    id: "batch",
    revision: "r1",
    kind: "credit_voucher",
    name: "Test batch",
    effect: { amount_cents: 1000 },
    totalCount: 100,
    codePrefix: null,
    tenantId: null,
    perUserLimit: 1,
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: "2099-12-31T00:00:00Z",
    status: "active",
    issuedCount: 0,
    claimedCount: 0,
    reservedCount: 0,
    redeemedCount: 0,
    expiredCount: 0,
    revokedCount: 0,
    createdBy: "creator",
    reviewedBy: "reviewer",
    reviewedAt: null,
    frozenAt: null,
    compensationBatch: false,
    pendingBudgetRequests: [],
  };
  vi.mocked(api.fetchPromotionPage).mockResolvedValue({
    items: [batch],
    total: 25,
    page: 1,
    pageSize: 20,
    summary: { total: 25, active: 25, redemptions: 0, tenants: 0, coupons: 25 },
  });
  vi.mocked(api.fetchPromotionRedemptionRecords).mockResolvedValue([]);
  vi.mocked(api.fetchVoucherBatch).mockImplementation(async () => ({
    ...detail,
  }));
  vi.mocked(api.fetchVoucherInstances).mockResolvedValue({
    items: [instance],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(api.fetchVoucherEvents).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(api.fetchCardFundingSources).mockResolvedValue([
    {
      id: "payment",
      paymentNo: "PAY-01",
      paidAmount: "100.00",
      availableAmount: "10.00",
    },
  ]);
  vi.mocked(api.manageVoucherBatch).mockResolvedValue({
    batchId: "batch",
    operationId: "op",
    status: "active",
  });
  vi.mocked(api.revokeVoucher).mockResolvedValue({
    voucherId: "voucher",
    status: "revoked",
  });
  vi.mocked(api.issueVoucherCredentials).mockResolvedValue({
    batchId: "batch",
    voucherIds: ["voucher"],
    codes: ["V-01"],
    credentials: [
      { voucherId: "voucher", code: "V-01", secret: "one-time-secret" },
    ],
    replayed: false,
  });
  vi.mocked(api.fetchProductPlans).mockResolvedValue([]);
  vi.mocked(api.fetchPlanVersions).mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onClose = vi.fn();
  onChanged = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// ============================================================================
// Batch lifecycle, funding, one-time credentials and dangerous confirmations
// ============================================================================
describe("voucher batch management DOM", () => {
  it.each(["zh-CN", "en-US"])(
    "renders every voucher timestamp with seconds in the platform zone for %s",
    async (locale) => {
      state.locale = locale;
      const stamp = "2026-11-20T23:59:58.123456Z";
      detail.validFrom = stamp;
      detail.validUntil = stamp;
      detail.claimUntil = stamp;
      detail.reviewedAt = stamp;
      vi.mocked(api.fetchVoucherEvents).mockResolvedValue({
        items: [
          {
            id: "event",
            eventType: "voucher_claimed",
            actorRealm: "user",
            actorId: "customer",
            actorName: "Customer",
            reason: null,
            createdAt: stamp,
            voucherId: "voucher",
            orderId: null,
            operationId: "op",
            operationType: "claim",
            metadata: {},
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      await renderDetail();
      expect(host.textContent).toContain(
        locale === "zh-CN" ? "2026/11/21" : "11/21/2026",
      );
      expect(host.textContent?.match(/07:59:58/g)).toHaveLength(5);
    },
  );
  it.each(["暂停新发放与使用", "归档停用", "撤回此券"])(
    "requires explicit confirmation before %s and step-up",
    async (label) => {
      await renderDetail();
      await fill("vbd-reason", "approved test");
      await click(label);
      expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(state.run).not.toHaveBeenCalled();
      await click("cancel-confirm");
      expect(api.manageVoucherBatch).not.toHaveBeenCalled();
      expect(api.revokeVoucher).not.toHaveBeenCalled();
      await click(label);
      await click("confirm");
      expect(state.run).toHaveBeenCalledOnce();
      expect(
        label === "撤回此券" ? api.revokeVoucher : api.manageVoucherBatch,
      ).toHaveBeenCalledOnce();
    },
  );
  it("does not load funding or expose writes for a read-only operator", async () => {
    state.session.capabilities = ["promotion:campaign.read"];
    detail.kind = "recharge_card";
    detail.effect = { face_value_cents: 1000 };
    await renderDetail();
    expect(api.fetchCardFundingSources).not.toHaveBeenCalled();
    expect(button("生成领取凭证")).toBeUndefined();
    expect(button("撤回此券")).toBeUndefined();
    expect(host.textContent).toContain("PAY-01");
    expect(host.textContent).toContain("TXN-01");
  });
  it("forbids creators from approving themselves and preserves revision binding", async () => {
    detail.status = "draft";
    state.session.user!.id = "creator";
    await renderDetail();
    expect(button("修改草稿")).toBeDefined();
    expect(button("审核启用")).toBeUndefined();
    state.session.user!.id = "reviewer";
    await renderDetail();
    await fill("vbd-reason", "review");
    await click("审核启用");
    await click("confirm");
    expect(api.manageVoucherBatch).toHaveBeenCalledWith(
      "batch",
      expect.objectContaining({
        action: "review",
        expectedRevision: "r1",
        reason: "review",
      }),
    );
  });
  it("keeps frozen configuration and compensation batches immutable", async () => {
    detail.status = "draft";
    detail.frozenAt = "2026-11-20T00:00:00Z";
    state.session.user!.id = "creator";
    await renderDetail();
    expect(button("修改草稿")).toBeUndefined();
    expect(button("审核启用")!.disabled).toBe(true);
    detail.compensationBatch = true;
    await renderDetail("other");
    expect(button("审核启用")).toBeUndefined();
    expect(button("撤回此券")).toBeUndefined();
  });
  it("requires another operator for budget approval", async () => {
    detail.pendingBudgetRequests = [
      {
        id: "request",
        requestedBy: "reviewer",
        totalCount: 200,
        reason: "increase",
      },
    ];
    await renderDetail();
    await fill("vbd-reason", "approve");
    expect(button("由其他运营批准")!.disabled).toBe(true);
    state.session.user!.id = "other";
    await renderDetail();
    await fill("vbd-reason", "approve");
    await click("由其他运营批准");
    await click("confirm");
    expect(api.manageVoucherBatch).toHaveBeenCalledWith(
      "batch",
      expect.objectContaining({
        action: "approve_budget",
        requestOperationId: "request",
      }),
    );
  });
  it("checks confirmed cash capacity and freezes the confirmed issuance parameters", async () => {
    detail.kind = "recharge_card";
    detail.effect = { face_value_cents: 1000, bonus_cents: 500 };
    await renderDetail();
    await fill("vbd-reason", "sale");
    expect(button("生成领取凭证")!.disabled).toBe(true);
    await fill("vbd-card-source", "payment");
    await fill("vbd-issue-count", "2");
    expect(button("生成领取凭证")!.disabled).toBe(true);
    await fill("vbd-issue-count", "1");
    await click("生成领取凭证");
    expect(api.issueVoucherCredentials).not.toHaveBeenCalled();
    expect(host.querySelector("fieldset")!.disabled).toBe(true);
    await click("confirm");
    expect(api.issueVoucherCredentials).toHaveBeenCalledWith(
      "batch",
      expect.objectContaining({
        count: 1,
        fundingPaymentId: "payment",
        reason: "sale",
      }),
    );
    expect(host.textContent).toContain("one-time-secret");
    await click("关闭");
    expect(host.textContent).not.toContain("one-time-secret");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it.each(["batch", "operator", "permissions"])(
    "clears displayed credentials after a %s change",
    async (change) => {
      await renderDetail();
      await fill("vbd-reason", "issue");
      await click("生成领取凭证");
      await click("confirm");
      expect(host.textContent).toContain("one-time-secret");
      if (change === "operator") state.session.user!.id = "other";
      if (change === "permissions")
        state.session.capabilities = ["promotion:campaign.read"];
      await renderDetail(change === "batch" ? "other" : "batch");
      expect(host.textContent).not.toContain("one-time-secret");
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    },
  );
  it("never redisplays credentials on a matching receipt replay", async () => {
    vi.mocked(api.issueVoucherCredentials).mockResolvedValue({
      batchId: "batch",
      voucherIds: [],
      codes: [],
      credentials: [
        {
          voucherId: "voucher",
          code: "V-01",
          secret: "unexpected-replayed-secret",
        },
      ],
      replayed: true,
    });
    await renderDetail();
    await fill("vbd-reason", "issue");
    await click("生成领取凭证");
    await click("confirm");
    expect(host.textContent).not.toContain("unexpected-replayed-secret");
    expect(host.textContent).toContain("不会重复返回");
  });
  it("does not issue for expired, archived, exhausted or compensation batches", async () => {
    detail.validUntil = "2020-01-01T00:00:00Z";
    await renderDetail();
    expect(button("生成领取凭证")).toBeUndefined();
    detail.validUntil = "2099-12-31T00:00:00Z";
    detail.status = "archived";
    await renderDetail("archived");
    expect(button("生成领取凭证")).toBeUndefined();
    detail.status = "active";
    detail.issuedCount = 100;
    await renderDetail("exhausted");
    await fill("vbd-reason", "test");
    expect(button("生成领取凭证")!.disabled).toBe(true);
    detail.compensationBatch = true;
    await renderDetail("compensation");
    expect(button("生成领取凭证")).toBeUndefined();
  });
  it("does not execute an old pending issuance after the operator changes", async () => {
    let resume!: () => void;
    const pause = new Promise<void>((resolve) => {
      resume = resolve;
    });
    state.run.mockImplementationOnce(async (action) => {
      await pause;
      return action();
    });
    await renderDetail();
    await fill("vbd-reason", "issue");
    await click("生成领取凭证");
    await click("confirm");
    state.session.user!.id = "other";
    await renderDetail();
    await act(async () => resume());
    expect(api.issueVoucherCredentials).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("one-time-secret");
  });
  it("retains the request identity after an unknown issuance result", async () => {
    vi.mocked(api.issueVoucherCredentials).mockRejectedValueOnce(
      new Error("response lost"),
    );
    await renderDetail();
    await fill("vbd-reason", "issue");
    await click("生成领取凭证");
    await click("confirm");
    await click("生成领取凭证");
    await click("confirm");
    const calls = vi.mocked(api.issueVoucherCredentials).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });
});

// ============================================================================
// Draft validation and directed assignment remain presentation-only rules.
// ============================================================================
describe("voucher draft and assignment DOM", () => {
  it("keeps browser civil dates and original timestamp precision across edits", async () => {
    const precise = (at: Date) => at.toISOString().replace(".123Z", ".123456Z");
    const validFrom = precise(new Date(2099, 10, 1, 0, 30, 45, 123));
    const validUntil = precise(new Date(2099, 10, 3, 23, 30, 45, 123));
    const claimUntil = precise(new Date(2099, 10, 2, 0, 5, 45, 123));
    const submit = vi.fn();
    await act(async () => {
      root.render(
        <CreateVoucherBatchDialog
          initial={{
            ...detail,
            kind: "credit_voucher",
            codePrefix: detail.codePrefix ?? "",
            validFrom,
            validUntil,
            claimUntil,
          }}
          busy={false}
          error={null}
          onClose={onClose}
          onSubmit={submit}
        />,
      );
    });
    expect(host.querySelector<HTMLInputElement>("#vb-from")!.value).toBe(
      "2099-11-01",
    );
    expect(host.querySelector<HTMLInputElement>("#vb-until")!.value).toBe(
      "2099-11-03",
    );
    expect(host.querySelector<HTMLInputElement>("#vb-claim")!.value).toBe(
      "2099-11-02",
    );
    await fill("vb-reason", "retain exact timestamps");
    await send();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ validFrom, validUntil, claimUntil }),
    );
    await fill("vb-until", "2099-11-04");
    await send();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        validFrom,
        validUntil: new Date("2099-11-04T23:59:59").toISOString(),
        claimUntil,
      }),
    );
  });
  it("exposes all six kinds and rejects invalid dates, money and fractional limits", async () => {
    const submit = vi.fn();
    await act(async () => {
      root.render(
        <CreateVoucherBatchDialog
          busy={false}
          error={null}
          onClose={onClose}
          onSubmit={submit}
        />,
      );
    });
    expect(host.querySelectorAll("#vb-kind option")).toHaveLength(6);
    await fill("vb-name", "Draft");
    await fill("vb-until", "2099-12-31");
    await fill("vb-reason", "test");
    await fill("vb-kind", "credit_voucher");
    await fill("vb-amount", "1.001");
    await send();
    expect(submit).not.toHaveBeenCalled();
    await fill("vb-amount", "10.00");
    await fill("vb-total", "1.5");
    await send();
    expect(submit).not.toHaveBeenCalled();
    await fill("vb-total", "2");
    await fill("vb-until", "2020-01-01");
    await send();
    expect(submit).not.toHaveBeenCalled();
    await fill("vb-until", "2099-12-31");
    await send();
    await send();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]![0]).toEqual(submit.mock.calls[1]![0]);
  });
  it("preserves original timestamps when a draft date is unchanged", async () => {
    const submit = vi.fn();
    await act(async () => {
      root.render(
        <CreateVoucherBatchDialog
          initial={{
            ...detail,
            codePrefix: "TEST",
            kind: "credit_voucher",
            validFrom: "2026-11-01T12:34:56Z",
            validUntil: "2099-12-31T18:20:30Z",
          }}
          busy={false}
          error={null}
          onClose={onClose}
          onSubmit={submit}
        />,
      );
    });
    await fill("vb-reason", "edit");
    await send();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        validFrom: "2026-11-01T12:34:56Z",
        validUntil: "2099-12-31T18:20:30Z",
      }),
    );
  });
  it("requires a tenant for platform user vouchers and integral assignment count", async () => {
    const submit = vi.fn();
    await act(async () => {
      root.render(
        <AssignVouchersDialog
          batch={batch}
          busy={false}
          error={null}
          assignedCodes={null}
          onClose={onClose}
          onSubmit={submit}
        />,
      );
    });
    await fill("va-target", "user");
    await fill("va-reason", "test");
    await send();
    expect(submit).not.toHaveBeenCalled();
    await fill("va-tenant", "tenant");
    await fill("va-count", "1.5");
    await send();
    expect(submit).not.toHaveBeenCalled();
    await fill("va-count", "1");
    await send();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetTenantId: "tenant",
        targetUserId: "user",
        count: 1,
      }),
    );
  });
  it("forbids tenant-wide invitation assignment and paid card direct assignment", async () => {
    const submit = vi.fn();
    await act(async () => {
      root.render(
        <AssignVouchersDialog
          batch={{ ...batch, kind: "invite", scopeLabel: "租户级" }}
          busy={false}
          error={null}
          assignedCodes={null}
          onClose={onClose}
          onSubmit={submit}
        />,
      );
    });
    expect(
      host.querySelector<HTMLOptionElement>('option[value="tenant"]')!.disabled,
    ).toBe(true);
    await act(async () => {
      root.render(
        <AssignVouchersDialog
          batch={{ ...batch, requiresCashFunding: true }}
          busy={false}
          error={null}
          assignedCodes={null}
          onClose={onClose}
          onSubmit={submit}
        />,
      );
    });
    await fill("va-target", "user");
    await fill("va-tenant", "tenant");
    await fill("va-reason", "test");
    await send();
    expect(submit).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Real published primitives: render the confirmation contract separately.
// ============================================================================
// Load the published package during collection, before the assertion time budget.
const design = await vi.importActual<typeof import("@vxture/design-system")>(
  "@vxture/design-system",
);

it("renders the real design-system confirmation with target and consequences", async () => {
  const confirm = vi.fn();
  await act(async () => {
    root.render(
      <design.ConfirmDestructive
        open
        verb="撤回"
        target="测试券 V-01"
        consequence="撤回后不能继续使用。"
        onOpenChange={() => undefined}
        onConfirm={confirm}
      />,
    );
  });
  expect(document.body.textContent).toContain("测试券 V-01");
  expect(document.body.textContent).toContain("撤回后不能继续使用。");
  const output = process.env.VOUCHER_UI_RENDER_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(
      join(output, "confirmation.html"),
      "<!doctype html><html lang=zh-CN><body>" +
        document.body.innerHTML +
        "</body></html>",
    );
  }
  expect(confirm).not.toHaveBeenCalled();
});

// ============================================================================
// List contracts and exports preserve server paging and noncash meaning.
// ============================================================================
describe("voucher list pages DOM", () => {
  it("sends server paging and filters, exports only returned rows, and disables read-only writes", async () => {
    state.session.capabilities = ["promotion:campaign.read"];
    await act(async () => root.render(<PromotionsPage />));
    expect(api.fetchPromotionPage).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      status: "all",
      type: "all",
      q: "",
    });
    expect(button("新建优惠")!.disabled).toBe(true);
    expect(button("发放券码")!.disabled).toBe(true);
    await click("导出本页");
    expect(vi.mocked(exportRowsToCsv).mock.calls[0]![2]).toEqual([batch]);
    await click("next-page");
    expect(api.fetchPromotionPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>(
        '[aria-label="搜索优惠"]',
      )!;
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "test");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(api.fetchPromotionPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, q: "test" }),
    );
  });
  it("renders failed list reads distinctly from an empty list", async () => {
    vi.mocked(api.fetchPromotionPage).mockRejectedValue(
      new Error("read failed"),
    );
    await act(async () => root.render(<PromotionsPage />));
    expect(host.textContent).toContain("优惠数据读取失败");
    expect(button("导出本页")!.disabled).toBe(true);
  });
  it("renders wallet benefits without inventing a bill or cash discount, including exports", async () => {
    const record: PromotionRedemptionRecord = {
      id: "redemption",
      redemptionNo: "VR-01",
      promotionCode: "V-01",
      promotionName: "Card",
      kind: "recharge_card",
      benefitLabel: "本金10元、赠额5元",
      walletTransactions: ["TXN-01"],
      subscriptionId: null,
      tenantId: "tenant",
      tenantCode: "TEN-01",
      tenantName: "Tenant",
      tenantType: "company",
      orderNo: null,
      billId: "",
      billNo: "",
      billStatus: null,
      servicePlanName: null,
      currency: "CNY",
      orderAmount: 0,
      discountAmount: 0,
      payableAmount: 0,
      operatorName: "客户自助",
      redeemedAt: "2026-11-20T00:00:00Z",
      remark: null,
    };
    vi.mocked(api.fetchPromotionRedemptionRecords).mockResolvedValue([record]);
    await act(async () => root.render(<PromotionRedemptionsPage />));
    expect(host.textContent).toContain("本金10元、赠额5元");
    expect(host.textContent).toContain("不涉及账单金额");
    expect(host.textContent).toContain("充值卡入钱包");
    const exportButton = Array.from(host.querySelectorAll("button")).find(
      (b) =>
        b.textContent?.includes("export") || b.textContent?.includes("导出"),
    );
    expect(exportButton).toBeDefined();
    await act(async () => exportButton!.click());
    const call = vi.mocked(exportRowsToCsv).mock.calls[0]!;
    for (const column of call[1])
      if (["订单金额", "优惠金额", "应付金额", "货币"].includes(column.label))
        expect(column.value(record)).toBe("");
  });
});

// ============================================================================
// Actual message catalogs cover confirmations, enums and visible export values.
// ============================================================================
describe.each(["zh-CN", "en-US"])(
  "voucher message catalog DOM (%s)",
  (locale) => {
    it("translates dangerous confirmations while retaining their consequences", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      await renderDetail();
      expect(
        button(english ? "Generate claim credentials" : "生成领取凭证"),
      ).toBeDefined();
      expect(host.textContent).toContain(
        english ? "issuance budgets" : "发行预算",
      );
      await fill("vbd-reason", "approved test");
      await click(english ? "Pause new issuance and use" : "暂停新发放与使用");
      expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
        english
          ? "Reserved orders retain their original snapshots"
          : "已占用订单保留原有快照",
      );
      expect(state.run).not.toHaveBeenCalled();
      await click("cancel-confirm");
      await click(english ? "Archive and disable" : "归档停用");
      expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
        english ? "Archiving cannot be undone" : "归档后不能恢复",
      );
      expect(api.manageVoucherBatch).not.toHaveBeenCalled();
      await click("cancel-confirm");
      await click(english ? "Generate claim credentials" : "生成领取凭证");
      expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
        english ? "Credentials are shown only once" : "凭据仅本次展示",
      );
      expect(api.issueVoucherCredentials).not.toHaveBeenCalled();
    });

    it("translates all six draft kinds and preserves the funding and term warnings", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      await act(async () => {
        root.render(
          <CreateVoucherBatchDialog
            busy={false}
            error={null}
            onClose={onClose}
            onSubmit={vi.fn()}
          />,
        );
      });
      const options = Array.from(
        host.querySelectorAll<HTMLOptionElement>("#vb-kind option"),
        (option) => option.textContent,
      );
      expect(options).toHaveLength(6);
      expect(options.join(" ")).toContain(
        english ? "separate principal and bonus" : "本金与赠额分账",
      );
      if (english) expect(options.join(" ")).not.toMatch(/[一-鿿]/);
      expect(
        host.querySelector<HTMLInputElement>("#vb-name")?.placeholder,
      ).toBe(
        english
          ? "For example: 20% off for new customers in 2026"
          : "如：2026 新客 8 折",
      );
      await fill("vb-kind", "recharge_card");
      expect(host.textContent).toContain(
        english ? "actual sales receipts" : "真实销售收款",
      );
      await fill("vb-kind", "extension");
      expect(host.textContent).toContain(
        english ? "refundable cash does not increase" : "不增加可退现金",
      );
      await fill("vb-kind", "redemption");
      expect(host.textContent).toContain(
        english ? "automatic renewal disabled" : "自动续费关闭",
      );
    });

    it("uses the same translated promotion labels in filters, rows and exports", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      await act(async () => root.render(<PromotionsPage />));
      expect(host.querySelector("h1")?.textContent).toBe(
        english ? "Promotions" : "营销优惠",
      );
      const status = host.querySelector<HTMLSelectElement>(
        `select[aria-label="${english ? "Promotion status" : "优惠状态"}"]`,
      );
      expect(status?.querySelector('option[value="draft"]')?.textContent).toBe(
        english ? "Awaiting review" : "待审核",
      );
      expect(host.querySelector('[role="table"]')?.textContent).toContain(
        english ? "Active" : "生效中",
      );
      await click(english ? "Export this page" : "导出本页");
      const columns = vi.mocked(exportRowsToCsv).mock.calls[0]![1];
      expect(
        columns
          .find((column) => column.label === (english ? "Status" : "状态"))
          ?.value(batch),
      ).toBe(english ? "Active" : "生效中");
      expect(
        columns
          .find((column) => column.label === (english ? "Type" : "类型"))
          ?.value(batch),
      ).toBe(english ? "Voucher code" : "优惠码");
    });

    it("exports visible subscription codes while hiding UUID and missing identifiers", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      const uuid = "6aa86113-341c-4074-8796-94b0bc7479de";
      const records: PromotionRedemptionRecord[] = [uuid, null, "SUB-008"].map(
        (subscriptionId, index) => ({
          id: `redemption-${index}`,
          redemptionNo: `VR-${index}`,
          promotionCode: "V-01",
          promotionName: "Card",
          kind: "recharge_card",
          benefitLabel: "Principal 10 / bonus 5",
          walletTransactions: ["TXN-01"],
          subscriptionId,
          tenantId: "tenant",
          tenantCode: "TEN-01",
          tenantName: "Tenant",
          tenantType: "company",
          orderNo: null,
          billId: "",
          billNo: "",
          billStatus: null,
          servicePlanName: null,
          currency: "CNY",
          orderAmount: 0,
          discountAmount: 0,
          payableAmount: 0,
          operatorName: "Customer",
          redeemedAt: "2026-11-20T00:00:00Z",
          remark: null,
        }),
      );
      vi.mocked(api.fetchPromotionRedemptionRecords).mockResolvedValue(records);
      await act(async () => root.render(<PromotionRedemptionsPage />));
      await click(english ? "Export all" : "导出全部");
      const columns = vi.mocked(exportRowsToCsv).mock.calls[0]![1];
      const subscription = columns.find(
        (column) =>
          column.label === (english ? "Subscription identifier" : "订阅标识"),
      );
      expect(subscription).toBeDefined();
      expect(records.map((record) => subscription!.value(record))).toEqual([
        "—",
        "—",
        "SUB-008",
      ]);
      expect(
        JSON.stringify(
          records.map((record) =>
            columns.map((column) => column.value(record)),
          ),
        ),
      ).not.toContain(uuid);
      const cashLabels = english
        ? ["Order amount", "Discount amount", "Amount due", "Currency"]
        : ["订单金额", "优惠金额", "应付金额", "货币"];
      const cashColumns = columns.filter((column) =>
        cashLabels.includes(column.label),
      );
      expect(cashColumns).toHaveLength(4);
      for (const column of cashColumns)
        expect(column.value(records[0]!)).toBe("");
      expect(
        columns
          .find(
            (column) => column.label === (english ? "Bill status" : "账单状态"),
          )
          ?.value(records[0]!),
      ).toBe(english ? "No linked bill" : "无关联账单");
      if (english)
        expect(columns.map((column) => column.label).join(" ")).not.toMatch(
          /[一-鿿]/,
        );
    });

    it("keeps unknown enum and prototype values neutral instead of showing success", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      function EnumProbe() {
        const labels = useVoucherLabels();
        const statuses = usePromotionStatusLabels();
        const types = usePromotionTypeLabels();
        return (
          <output>
            {JSON.stringify({
              kinds: [
                "discount",
                "credit_voucher",
                "invite",
                "redemption",
                "extension",
                "recharge_card",
              ].map(labels.kind),
              active: statuses.active,
              type: types.coupon,
              knownEvent: labels.event("voucher_claimed"),
              unknown: [
                "future_value",
                "toString",
                "constructor",
                "__proto__",
              ].map((value) => ({
                kind: labels.kind(value),
                batch: labels.batchStatus(value),
                status: labels.status(value),
                event: labels.event(value),
                action: labels.action(value),
                funding: labels.funding(value),
              })),
            })}
          </output>
        );
      }
      await act(async () => root.render(<EnumProbe />));
      const result = JSON.parse(host.querySelector("output")!.textContent!) as {
        kinds: string[];
        active: string;
        type: string;
        knownEvent: string;
        unknown: Array<Record<string, string>>;
      };
      expect(result.kinds).toHaveLength(6);
      expect(new Set(result.kinds).size).toBe(6);
      expect(result.active).toBe(english ? "Active" : "生效中");
      expect(result.type).toBe(english ? "Voucher code" : "优惠码");
      expect(result.knownEvent).toBe(
        english ? "Claimed by customer" : "客户领取",
      );
      for (const value of result.unknown)
        expect(value).toEqual({
          kind: english ? "Unknown voucher type" : "未知券型",
          batch: english ? "Unknown status" : "未知状态",
          status: english ? "Unknown status" : "未知状态",
          event: english ? "Unrecognized operation event" : "未识别的操作事件",
          action: english ? "Unknown operation" : "未知操作",
          funding: english ? "Unknown status" : "未知状态",
        });
    });
  },
);

// ============================================================================
// Structured list data must stay localized across every presentation surface.
// ============================================================================
const localizedBenefits = [
  {
    kind: "discount",
    effect: { discount_type: "percent", value: 20, max_off_cents: 1500 },
    en: "Discount voucher · Save 20%, capped at ¥15",
    zh: "折扣券 · 立减 20%，封顶 ¥15",
  },
  {
    kind: "credit_voucher",
    effect: { amount_cents: 1234 },
    en: "Credit voucher · Face value ¥12.34",
    zh: "代金券 · 面额 ¥12.34",
  },
  {
    kind: "invite",
    effect: { planCode: "arda-private" },
    en: "Invitation voucher · Unlock plan arda-private",
    zh: "邀请券 · 解锁套餐 arda-private",
  },
  {
    kind: "redemption",
    effect: { duration_days: 30 },
    en: "Subscription voucher · Operator grant · Redeem a new 30-day subscription",
    zh: "订阅兑换券 · 运营赠送 · 兑换 30 天新订阅",
  },
  {
    kind: "extension",
    effect: { extend_days: 7, applicable_product_codes: ["arda", "karda"] },
    en: "Extension voucher · Extend 7 days from the original expiry · Main products: arda, karda · Quotas are not reset",
    zh: "展期券 · 从原到期日延长 7 天 · 主产品：arda、karda · 不重置配额",
  },
  {
    kind: "recharge_card",
    effect: { face_value_cents: 1000, bonus_cents: 500 },
    en: "Recharge card · Recharge principal ¥10, bonus ¥5 · Principal requires actual receipts; bonus is recorded separately",
    zh: "充值卡 · 充值本金 ¥10，赠额 ¥5 · 本金须有真实收款；赠额单独入账",
  },
] satisfies Array<{
  kind: string;
  effect: Record<string, unknown>;
  en: string;
  zh: string;
}>;

describe.each(["zh-CN", "en-US"])(
  "structured voucher presentation (%s)",
  (locale) => {
    it("localizes six-kind list, scope, issuance counts and actual export values", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      const records = localizedBenefits.map((item, index) => ({
        ...batch,
        id: `kind-${index}`,
        promotionName: `用户自定中文名称 ${index}`,
        kind: item.kind,
        effect: item.effect,
        codePrefix: "VX26-",
        promotionCode: "VX26-",
        tenantId: index % 2 ? "tenant" : null,
        totalCount: 10,
        issuedCount: index + 1,
        discountLabel: "旧中文权益",
        description: "旧中文发行说明",
      }));
      vi.mocked(api.fetchPromotionPage).mockResolvedValue({
        items: records,
        total: 6,
        page: 1,
        pageSize: 20,
        summary: {
          total: 6,
          active: 6,
          redemptions: 0,
          tenants: 0,
          coupons: 2,
        },
      });
      await act(async () => root.render(<PromotionsPage />));
      const rows = host.querySelectorAll('[role="row"]');
      expect(rows).toHaveLength(6);
      for (const [index, item] of localizedBenefits.entries()) {
        const text = rows[index]!.textContent;
        expect(text).toContain(english ? item.en : item.zh);
        expect(text).toContain(
          english ? `Issued ${index + 1}/10` : `已发 ${index + 1}/10`,
        );
        expect(text).toContain(
          index % 2
            ? english
              ? "Targeted tenant"
              : "定向租户"
            : english
              ? "Platform-wide"
              : "平台级",
        );
        expect(text).toContain(`用户自定中文名称 ${index}`);
        expect(text).toContain(
          english ? "Issuance prefix: VX26-" : "发码前缀：VX26-",
        );
        expect(text).not.toContain("旧中文");
      }
      await click(english ? "Export this page" : "导出本页");
      const [, columns, exported] = vi.mocked(exportRowsToCsv).mock.calls[0]!;
      expect(exported).toEqual(records);
      expect(columns[0]!.label).toBe(english ? "Issuance prefix" : "发码前缀");
      for (const [index, record] of records.entries()) {
        expect(columns[0]!.value(record)).toBe("VX26-");
        expect(columns[4]!.value(record)).toBe(
          index % 2
            ? english
              ? "Targeted tenant"
              : "定向租户"
            : english
              ? "Platform-wide"
              : "平台级",
        );
        expect(columns[5]!.value(record)).toBe(
          english ? localizedBenefits[index]!.en : localizedBenefits[index]!.zh,
        );
      }
    });

    it("keeps six-kind detail and assignment descriptions consistent without executing actions", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      for (const item of localizedBenefits) {
        detail = { ...detail, kind: item.kind, effect: item.effect };
        await renderDetail(`detail-${item.kind}`);
        const [kindLabel, ...benefitParts] = (
          english ? item.en : item.zh
        ).split(" · ");
        expect(host.textContent).toContain(kindLabel);
        expect(host.textContent).toContain(benefitParts.join(" · "));
        await act(async () =>
          root.render(
            <AssignVouchersDialog
              batch={{ ...batch, kind: item.kind, effect: item.effect }}
              busy={false}
              error={null}
              assignedCodes={null}
              onClose={onClose}
              onSubmit={vi.fn()}
            />,
          ),
        );
        expect(host.textContent).toContain(english ? item.en : item.zh);
      }
      expect(state.run).not.toHaveBeenCalled();
      expect(api.assignVouchers).not.toHaveBeenCalled();
      expect(api.manageVoucherBatch).not.toHaveBeenCalled();
    });

    it("distinguishes prefixes from identifiers and hides missing and legacy UUID fallbacks", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      const uuid = "6aa86113-341c-4074-8796-94b0bc7479de";
      const legacy = { ...batch, id: "legacy", promotionCode: uuid };
      delete legacy.codePrefix;
      const records = [
        { ...batch, id: "absent", codePrefix: null, promotionCode: uuid },
        { ...batch, id: "empty", codePrefix: "", promotionCode: uuid },
        legacy,
        { ...batch, id: "prefix-a", codePrefix: "VX26-" },
        { ...batch, id: "prefix-b", codePrefix: "VX26-" },
      ];
      vi.mocked(api.fetchPromotionPage).mockResolvedValue({
        items: records,
        total: 5,
        page: 1,
        pageSize: 20,
        summary: {
          total: 5,
          active: 5,
          redemptions: 0,
          tenants: 0,
          coupons: 5,
        },
      });
      await act(async () => root.render(<PromotionsPage />));
      expect(host.querySelector('[role="table"]')?.textContent).not.toContain(
        uuid,
      );
      expect(host.textContent).toContain(
        english ? "Issuance prefix: —" : "发码前缀：—",
      );
      await click(english ? "Export this page" : "导出本页");
      const columns = vi.mocked(exportRowsToCsv).mock.calls[0]![1];
      expect(records.map((record) => columns[0]!.value(record))).toEqual([
        "—",
        "—",
        "—",
        "VX26-",
        "VX26-",
      ]);
    });

    it("shows neutral missing data instead of legacy prose or invented zero amounts", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      const legacy = { ...batch, id: "legacy" };
      delete legacy.effect;
      delete legacy.tenantId;
      const records = [
        legacy,
        { ...batch, id: "null", effect: null },
        {
          ...batch,
          id: "array",
          effect: [] as unknown as Record<string, unknown>,
        },
        { ...batch, id: "amount", effect: { amount_cents: null } },
        {
          ...batch,
          id: "discount",
          kind: "discount",
          effect: { discount_type: "unexpected", value: 100 },
        },
        {
          ...batch,
          id: "recharge",
          kind: "recharge_card",
          effect: { face_value_cents: "wrong", bonus_cents: 500 },
        },
      ].map((record) => ({
        ...record,
        discountLabel: "旧中文权益",
        description: "旧中文说明",
      }));
      vi.mocked(api.fetchPromotionPage).mockResolvedValue({
        items: records,
        total: records.length,
        page: 1,
        pageSize: 20,
        summary: {
          total: records.length,
          active: records.length,
          redemptions: 0,
          tenants: 0,
          coupons: 0,
        },
      });
      await act(async () => root.render(<PromotionsPage />));
      const rows = host.querySelectorAll('[role="row"]');
      for (const row of rows) {
        expect(row.textContent).toContain(
          english ? "Benefit data unavailable" : "权益数据暂不可用",
        );
        expect(row.textContent).not.toMatch(/NaN|undefined|¥0|旧中文/);
      }
      expect(rows[0]!.textContent).toContain(english ? "Unknown" : "未知");
      await click(english ? "Export this page" : "导出本页");
      const columns = vi.mocked(exportRowsToCsv).mock.calls[0]![1];
      for (const record of records)
        expect(columns[5]!.value(record)).toContain(
          english ? "Benefit data unavailable" : "权益数据暂不可用",
        );
    });

    it("preserves fixed discounts, historical amount aliases and bonus-only card meaning", async () => {
      state.locale = locale;
      const english = locale === "en-US";
      const uuid = "6aa86113-341c-4074-8796-94b0bc7479de";
      const values = [
        {
          kind: "discount",
          effect: { discount_type: "fixed", value: 1234, max_off_cents: 1000 },
          en: "Save ¥12.34, capped at ¥10",
          zh: "立减 ¥12.34，封顶 ¥10",
        },
        {
          kind: "credit_voucher",
          effect: { amountCents: 1234 },
          en: "Face value ¥12.34",
          zh: "面额 ¥12.34",
        },
        {
          kind: "credit_voucher",
          effect: { face_value_cents: 1234 },
          en: "Face value ¥12.34",
          zh: "面额 ¥12.34",
        },
        {
          kind: "recharge_card",
          effect: { face_value_cents: 0, bonus_cents: 500 },
          en: "principal ¥0, bonus ¥5",
          zh: "本金 ¥0，赠额 ¥5",
        },
        {
          kind: "invite",
          effect: { plan_version_id: uuid },
          en: "Unlock the configured plan",
          zh: "解锁已配置套餐",
        },
      ];
      const records = values.map((value, index) => ({
        ...batch,
        id: `alias-${index}`,
        kind: value.kind,
        effect: value.effect,
      }));
      vi.mocked(api.fetchPromotionPage).mockResolvedValue({
        items: records,
        total: records.length,
        page: 1,
        pageSize: 20,
        summary: {
          total: records.length,
          active: records.length,
          redemptions: 0,
          tenants: 0,
          coupons: 0,
        },
      });
      await act(async () => root.render(<PromotionsPage />));
      const rows = host.querySelectorAll('[role="row"]');
      values.forEach((value, index) =>
        expect(rows[index]!.textContent).toContain(
          english ? value.en : value.zh,
        ),
      );
      expect(host.querySelector('[role="table"]')?.textContent).not.toContain(
        uuid,
      );
      await click(english ? "Export this page" : "导出本页");
      const columns = vi.mocked(exportRowsToCsv).mock.calls[0]![1];
      records.forEach((record, index) => {
        const actual = columns[5]!.value(record);
        expect(actual).toContain(
          english ? values[index]!.en : values[index]!.zh,
        );
        expect(actual).not.toContain(uuid);
      });
    });
  },
);
