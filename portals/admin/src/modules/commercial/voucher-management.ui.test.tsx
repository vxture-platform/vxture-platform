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
import { VoucherBatchDetailDialog } from "./VoucherBatchDetailDialog";
import {
  AssignVouchersDialog,
  CreateVoucherBatchDialog,
} from "./VoucherBatchDialogs";

// ============================================================================
// Fixtures replace I/O and visual primitives; no business controls are mocked.
// ============================================================================
const state = vi.hoisted(() => ({
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
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "zh-CN",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/exportCsv", () => ({ exportRowsToCsv: vi.fn() }));
vi.mock("@/modules/shared/table", () => ({ useTableLabels: () => ({}) }));
vi.mock("@/modules/shared/PageHeader", () => ({
  PageHeader: () => <h1>marketing</h1>,
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
    onSubmit: FormEventHandler<HTMLFormElement>;
    submitDisabled?: boolean;
    submitting: boolean;
    submitLabel: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <form onSubmit={p.onSubmit}>
      <h1>{p.title}</h1>
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
  promotionName: "Test batch",
  promotionType: "coupon",
  kind: "credit_voucher",
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
it("renders the real design-system confirmation with target and consequences", async () => {
  const design = await vi.importActual<typeof import("@vxture/design-system")>(
    "@vxture/design-system",
  );
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
