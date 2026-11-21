/**
 * voucher-management.ui.test.tsx - Scoped confirmation and recovery in rendered Console UI.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 * @vitest-environment jsdom
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
import type { SessionSnapshot } from "@/entities/console";
import type {
  ConsoleVoucher,
  ConsoleVoucherClaimPreview,
  SubscriptionVoucherPreview,
  RechargeCardPreview,
  SubscriptionExtensionPreview,
  MyOrder,
  SubscribeContext,
} from "@/api/console-bff";
import { ConsoleBffError } from "@/api/console-bff";
import messages from "../../../messages/en-US.json";
import { VoucherClaimDialog } from "./VoucherClaimDialog";
import { SubscriptionRedemptionDialog } from "./SubscriptionRedemptionDialog";
import { SubscriptionExtensionDialog } from "./SubscriptionExtensionDialog";
import { RechargeCardDialog } from "./RechargeCardDialog";
import { VouchersPage } from "./VouchersPage";
import { SubscribePage } from "./SubscribePage";
import { OrderDetailPanel } from "./components/OrderDetailPanel";
import { OrdersSection } from "./components/OrdersSection";

// ============================================================================
// Native I/O and design primitives are substituted; operation logic is real.
// ============================================================================
const state = vi.hoisted(() => ({
  session: {
    isAuthenticated: true,
    user: {
      id: "user",
      name: "User",
      email: "u@example.invalid",
      roleLabel: "owner",
    },
    tenant: {
      id: "tenant",
      name: "Platform tenant",
      mode: "tenant",
      workspace: "workspace",
    },
    capabilities: ["tenant.billing.manage", "tenant.billing.read"],
  } as SessionSnapshot,
  push: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  query: new URLSearchParams("product=product&intent=subscribe&cycle=month"),
}));
const mocks = vi.hoisted(() => ({
  claimPreview: vi.fn(),
  claim: vi.fn(),
  claimResult: vi.fn(),
  redeemPreview: vi.fn(),
  redeem: vi.fn(),
  redeemResult: vi.fn(),
  extendPreview: vi.fn(),
  extend: vi.fn(),
  extendResult: vi.fn(),
  rechargePreview: vi.fn(),
  recharge: vi.fn(),
  rechargeResult: vi.fn(),
  page: vi.fn(),
  context: vi.fn(),
  order: vi.fn(),
  quote: vi.fn(),
  orders: vi.fn(),
}));
vi.mock("@/api/console-bff", async (original) => ({
  ...(await original<typeof import("@/api/console-bff")>()),
  previewVoucherClaim: mocks.claimPreview,
  claimVoucher: mocks.claim,
  fetchVoucherClaimResult: mocks.claimResult,
  previewSubscriptionRedemption: mocks.redeemPreview,
  redeemSubscriptionVoucher: mocks.redeem,
  fetchSubscriptionRedemptionResult: mocks.redeemResult,
  previewSubscriptionExtension: mocks.extendPreview,
  extendSubscriptionVoucher: mocks.extend,
  fetchSubscriptionExtensionResult: mocks.extendResult,
  previewRechargeCard: mocks.rechargePreview,
  redeemRechargeCard: mocks.recharge,
  fetchRechargeCardResult: mocks.rechargeResult,
  fetchVoucherPage: mocks.page,
  fetchSubscribeContext: mocks.context,
  createSubscriptionOrder: mocks.order,
  fetchUpgradeQuote: mocks.quote,
  fetchMyOrders: mocks.orders,
}));
vi.mock("@/features/session/ConsoleSessionProvider", () => ({
  useConsoleSession: () => ({ session: state.session }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.query }));
vi.mock("@/lib/i18n/navigation", () => ({
  useRouter: () => state.router,
  Link: (p: { children: ReactNode; href: string }) => (
    <a href={p.href}>{p.children}</a>
  ),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace = "") => {
    const translate = (key: string, values: Record<string, unknown> = {}) => {
      let value: unknown = messages;
      for (const piece of (namespace ? namespace + "." + key : key).split("."))
        value =
          value && typeof value === "object"
            ? (value as Record<string, unknown>)[piece]
            : undefined;
      if (typeof value !== "string") return key;
      return value.replace(/\{(\w+)\}/g, (_match, name: string) =>
        String(values[name] ?? "{" + name + "}"),
      );
    };
    return Object.assign(translate, { raw: (key: string) => translate(key) });
  },
}));
vi.mock("@/lib/use-date-format", () => ({
  useDateFormat: () => ({
    fmtDateTime: (v: unknown) => String(v ?? "—"),
    fmtDate: (v: unknown) => String(v ?? "—"),
    fmtTime: (v: unknown) => String(v ?? "—"),
  }),
}));
vi.mock("@/lib/table", () => ({ useTableLabels: () => ({}) }));
vi.mock("@/components/load/LoadFailed", () => ({
  LoadFailedBanner: () => <p>read-failed</p>,
  LoadFailedEmpty: () => <p>read-failed</p>,
}));
vi.mock("@/layout/shell", () => ({
  PageSection: (p: { children: ReactNode; footer?: ReactNode }) => (
    <section>
      {p.children}
      {p.footer}
    </section>
  ),
  SectionBody: (p: { children: ReactNode }) => <div>{p.children}</div>,
  SignalList: () => null,
}));
vi.mock("@/components/pagination", () => ({
  ListPagination: (p: { page: number; onPageChange: (n: number) => void }) => (
    <button type="button" onClick={() => p.onPageChange(p.page + 1)}>
      next-page
    </button>
  ),
}));
vi.mock("./components/WorkspacePicker", () => ({
  WorkspacePicker: () => null,
}));
vi.mock("./components/PlanSummaryCard", () => ({
  PlanSummaryCard: () => null,
}));
vi.mock("./components/CyclePicker", () => ({ CyclePicker: () => null }));
vi.mock("./components/OrderFlowStrip", () => ({ OrderFlowStrip: () => null }));
vi.mock("@/components/principal-no", () => ({
  PrincipalNo: () => <span>number</span>,
}));
vi.mock("@vxture/design-system", () => {
  const Wrap = (p: { children?: ReactNode }) => <div>{p.children}</div>;
  return {
    DialogForm: (p: {
      children: ReactNode;
      title: ReactNode;
      description: ReactNode;
      onSubmit: FormEventHandler<HTMLFormElement>;
      submitDisabled?: boolean;
      submitting: boolean;
      submitLabel: ReactNode;
      onOpenChange: (v: boolean) => void;
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
    Input: (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} />,
    NativeSelect: ({
      wrapperClassName: _wrapper,
      ...p
    }: SelectHTMLAttributes<HTMLSelectElement> & {
      wrapperClassName?: string;
    }) => <select {...p} />,
    Label: (p: LabelHTMLAttributes<HTMLLabelElement>) => <label {...p} />,
    Button: ({
      variant: _v,
      size: _s,
      ...p
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string;
      size?: string;
    }) => <button {...p} />,
    ActionMenu: (p: {
      items: Array<{
        id: string;
        label: ReactNode;
        disabled?: boolean;
        onSelect?: () => void;
      }>;
    }) => (
      <>
        {p.items.map((x) => (
          <button
            type="button"
            key={x.id}
            disabled={x.disabled}
            onClick={x.onSelect}
          >
            {x.label}
          </button>
        ))}
      </>
    ),
    DataTable: <T,>(p: {
      rows: T[];
      rowKey: (v: T) => string;
      columns: Array<{ id: string; cell?: (v: T) => ReactNode }>;
      rowActions?: (v: T) => ReactNode;
      empty?: ReactNode;
      footer?: ReactNode;
      onSortChange?: (sort: { columnId: string; direction: "desc" }) => void;
    }) => (
      <div role="table">
        {p.onSortChange ? (
          <button
            type="button"
            onClick={() =>
              p.onSortChange!({ columnId: "expires", direction: "desc" })
            }
          >
            sort-expiry
          </button>
        ) : null}
        {p.rows.length
          ? p.rows.map((row) => (
              <div role="row" key={p.rowKey(row)}>
                {p.columns.map((column) => (
                  <span key={column.id}>{column.cell?.(row)}</span>
                ))}
                {p.rowActions?.(row)}
              </div>
            ))
          : p.empty}
        {p.footer}
      </div>
    ),
    FilterBar: (p: { children: ReactNode; search: ReactNode }) => (
      <>
        {p.search}
        {p.children}
      </>
    ),
    ViewLayout: Wrap,
    ViewHeader: (p: { title: ReactNode }) => <h1>{p.title}</h1>,
    TableTitleCell: (p: { title: ReactNode; description: ReactNode }) => (
      <span>
        {p.title}
        {p.description}
      </span>
    ),
    StatusBadge: Wrap,
    Badge: Wrap,
    Card: Wrap,
    CardContent: Wrap,
    CardDescription: Wrap,
    CardFooter: Wrap,
    CardHeader: Wrap,
    EmptyState: (p: { title: ReactNode; description: ReactNode }) => (
      <p>
        {p.title}
        {p.description}
      </p>
    ),
    MetricGrid: () => null,
    Banner: (p: { title: ReactNode; description: ReactNode }) => (
      <p>
        {p.title}
        {p.description}
      </p>
    ),
    Icon: () => null,
    Tooltip: Wrap,
    TooltipContent: Wrap,
    TooltipTrigger: Wrap,
    Switch: (p: {
      checked: boolean;
      onCheckedChange: (v: boolean) => void;
    }) => (
      <input
        type="checkbox"
        checked={p.checked}
        onChange={(e) => p.onCheckedChange(e.target.checked)}
      />
    ),
    cn: (...parts: unknown[]) =>
      parts.filter((x) => typeof x === "string").join(" "),
  };
});
let host: HTMLDivElement, root: Root;
const close = vi.fn(),
  changed = vi.fn();
const voucher: ConsoleVoucher = {
  id: "voucher",
  code: "V-01",
  batchName: "Test batch",
  kind: "recharge_card",
  status: "available",
  availabilityStatus: "available",
  usedCount: 0,
  maxUses: 1,
  expiresAt: "2099-12-31T00:00:00Z",
  redeemedAt: null,
  redemptionNo: null,
  orderNo: null,
  amount: "10.00",
  bonusAmount: "5.00",
  holderScope: "user",
  holderLabel: "My voucher",
};
const claimPreview: ConsoleVoucherClaimPreview = {
  code: "V-01",
  batchName: "Batch",
  kind: "recharge_card",
  effect: {},
  recharge: { principal: "10.00", bonus: "5.00" },
  expiresAt: "2099-12-31T00:00:00Z",
  claimUntil: "2099-12-31T00:00:00Z",
  useValidDays: 30,
  returnPolicy: "none",
  tenantName: "Platform tenant",
  workspaceName: "Workspace",
};
const redeemPreview: SubscriptionVoucherPreview = {
  code: "V-01",
  productName: "Product",
  planName: "Private plan",
  versionNo: 2,
  durationDays: 30,
  tenantName: "Platform tenant",
  workspaceName: "Workspace",
  fundingSource: "operator_grant",
  autoRenew: false,
  grants: [],
};
const extensionPreview: SubscriptionExtensionPreview = {
  code: "V-01",
  tenantName: "Platform tenant",
  workspaceName: "Workspace",
  extendDays: 30,
  targets: [
    {
      subscriptionId: "subscription",
      planVersionId: "version",
      productName: "Product",
      planName: "Plan",
      versionNo: 1,
      previousEndAt: "2026-12-01T00:00:00Z",
      endAt: "2026-12-31T00:00:00Z",
    },
    {
      subscriptionId: "other-subscription",
      planVersionId: "other-version",
      productName: "Other",
      planName: "Other plan",
      versionNo: 2,
      previousEndAt: "2027-01-01T00:00:00Z",
      endAt: "2027-01-31T00:00:00Z",
    },
  ],
};
const rechargePreview: RechargeCardPreview = {
  code: "V-01",
  confirmation: "confirmed-terms",
  tenantName: "Platform tenant",
  workspaceName: "Workspace",
  principal: "10.00",
  bonus: "5.00",
  bonusExpiresInDays: 30,
  currency: "CNY",
  balance: "0.00",
};
const receipts = {
  claim: {
    voucherId: "voucher",
    code: "V-01",
    expiresAt: "2099-12-31T00:00:00Z",
  },
  redeem: {
    subscriptionId: "subscription",
    redemptionNo: "VR-01",
    startAt: "2026-11-20T00:00:00Z",
    endAt: "2026-12-20T00:00:00Z",
    code: "V-01",
    productName: "Product",
    planName: "Plan",
    versionNo: 2,
    durationDays: 30,
  },
  extend: {
    ...extensionPreview.targets[0],
    code: "V-01",
    redemptionNo: "VR-01",
    extendDays: 30,
  },
  recharge: {
    code: "V-01",
    redemptionNo: "VR-01",
    principal: "10.00",
    bonus: "5.00",
    bonusExpiresAt: "2026-12-20T00:00:00Z",
    balance: "15.00",
    currency: "CNY",
    transactions: ["TXN-principal", "TXN-bonus"],
  },
};
const context: SubscribeContext = {
  intent: "subscribe",
  product: { code: "product", name: "Product", maintenance: null },
  targetTier: "pro",
  metric: null,
  current: null,
  pendingOrder: null,
  plans: [
    {
      planId: "plan",
      planCode: "private-pro",
      planVersionId: "version",
      planName: "Private plan",
      tier: "pro",
      prices: [
        { cycleUnit: "month", cycleCount: 1, price: "99.00", currency: "CNY" },
      ],
      features: [],
      inviteOnly: true,
    },
  ],
  versionChange: null,
  currentPlanRetired: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}
async function render(node: ReactNode) {
  await act(async () => root.render(node));
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
async function submit(times = 1) {
  await act(async () => {
    const form = host.querySelector("form")!;
    for (let i = 0; i < times; i++)
      form.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}
const cases = ["claim", "redeem", "extend", "recharge"] as const;
type Kind = (typeof cases)[number];
function node(kind: Kind) {
  return kind === "claim" ? (
    <VoucherClaimDialog onClose={close} onClaimed={changed} />
  ) : kind === "redeem" ? (
    <SubscriptionRedemptionDialog
      voucherId="voucher"
      onClose={close}
      onRedeemed={changed}
    />
  ) : kind === "extend" ? (
    <SubscriptionExtensionDialog
      voucherId="voucher"
      onClose={close}
      onExtended={changed}
    />
  ) : (
    <RechargeCardDialog
      voucherId="voucher"
      onClose={close}
      onRedeemed={changed}
    />
  );
}
async function preview(kind: Kind) {
  await render(node(kind));
  if (kind === "claim") {
    await fill("voucher-claim-secret", "Sensitive-Claim");
    await submit();
  }
}
function recover(kind: Kind) {
  return mocks[`${kind}Result`];
}
async function clockPage() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 230));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
  state.session = {
    ...state.session,
    isAuthenticated: true,
    user: {
      id: "user",
      name: "User",
      email: "u@example.invalid",
      roleLabel: "owner",
    },
    tenant: {
      id: "tenant",
      name: "Platform tenant",
      mode: "tenant",
      workspace: "workspace",
    },
    capabilities: ["tenant.billing.manage", "tenant.billing.read"],
  };
  state.router.push = state.push;
  state.query = new URLSearchParams(
    "product=product&intent=subscribe&cycle=month",
  );
  mocks.claimPreview.mockResolvedValue(claimPreview);
  mocks.redeemPreview.mockResolvedValue(redeemPreview);
  mocks.extendPreview.mockResolvedValue(extensionPreview);
  mocks.rechargePreview.mockResolvedValue(rechargePreview);
  for (const kind of cases) {
    mocks[kind].mockResolvedValue(receipts[kind]);
    recover(kind).mockResolvedValue(null);
  }
  mocks.page.mockResolvedValue({
    items: [voucher],
    total: 25,
    page: 1,
    pageSize: 10,
    summary: { total: 25, available: 25, redeemed: 0, expiringSoon: 0 },
  });
  mocks.context.mockImplementation(async () => structuredClone(context));
  mocks.order.mockResolvedValue({
    orderId: "order",
    status: "pending_payment",
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Real network forbidden");
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// ============================================================================
// All four flows must preserve the same cancellation and immutable-retry rules.
// ============================================================================
describe.each(cases)("%s confirmation DOM", (kind) => {
  it("previews explicitly without committing, then consumes at most once", async () => {
    await preview(kind);
    expect(mocks[kind]).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Platform tenant");
    const pending = deferred<unknown>();
    mocks[kind].mockReturnValueOnce(pending.promise);
    await submit(2);
    expect(mocks[kind]).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(receipts[kind]));
    expect(changed).toHaveBeenCalledOnce();
    await submit();
    expect(mocks[kind]).toHaveBeenCalledOnce();
  });
  it("recovers a committed lost reply without resending", async () => {
    mocks[kind].mockRejectedValueOnce(new Error("response lost"));
    recover(kind).mockResolvedValueOnce(receipts[kind]);
    await preview(kind);
    await submit();
    expect(mocks[kind]).toHaveBeenCalledOnce();
    expect(recover(kind)).toHaveBeenCalledWith(expect.any(String));
    expect(changed).toHaveBeenCalledOnce();
    if (kind === "claim") expect(host.querySelector("input")).toBeNull();
  });
  it("keeps the full command unchanged and checks the receipt before explicit retry", async () => {
    mocks[kind].mockRejectedValueOnce(new Error("response lost"));
    await preview(kind);
    await submit();
    expect(changed).not.toHaveBeenCalled();
    if (kind === "claim")
      expect(
        host.querySelector<HTMLInputElement>("#voucher-claim-secret")!.disabled,
      ).toBe(true);
    if (kind === "extend")
      expect(
        host.querySelector<HTMLSelectElement>("#extension-target")!.disabled,
      ).toBe(true);
    await submit();
    expect(mocks[kind]).toHaveBeenCalledTimes(2);
    expect(mocks[kind].mock.calls[0]).toEqual(mocks[kind].mock.calls[1]);
    expect(recover(kind)).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledOnce();
  });
  it("does not resend when receipt lookup itself remains unavailable", async () => {
    mocks[kind].mockRejectedValueOnce(new Error("response lost"));
    recover(kind).mockRejectedValue(new Error("lookup failed"));
    await preview(kind);
    await submit();
    await submit();
    expect(mocks[kind]).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });
  it.each(["user", "tenant", "workspace", "permissions"])(
    "ignores a late commit after %s changes",
    async (change) => {
      const pending = deferred<unknown>();
      mocks[kind].mockReturnValueOnce(pending.promise);
      await preview(kind);
      await submit();
      if (change === "user") state.session.user!.id = "other";
      if (change === "tenant") state.session.tenant!.id = "other";
      if (change === "workspace") state.session.tenant!.workspace = "other";
      if (change === "permissions")
        state.session.capabilities = ["tenant.billing.read"];
      await render(node(kind));
      await act(async () => pending.resolve(receipts[kind]));
      expect(changed).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain("VR-01");
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      if (kind === "claim")
        expect(
          host.querySelector<HTMLInputElement>("#voucher-claim-secret")!.value,
        ).toBe("");
      else if (change === "permissions")
        expect(host.querySelector("form")).toBeNull();
    },
  );
  it("ignores preview responses received after unmount", async () => {
    const pending = deferred<unknown>();
    mocks[`${kind}Preview`].mockReturnValueOnce(pending.promise);
    await render(node(kind));
    if (kind === "claim") {
      await fill("voucher-claim-secret", "Sensitive-Claim");
      await submit();
    }
    await render(null);
    await act(async () =>
      pending.resolve(
        kind === "claim"
          ? claimPreview
          : kind === "redeem"
            ? redeemPreview
            : kind === "extend"
              ? extensionPreview
              : rechargePreview,
      ),
    );
    expect(mocks[kind]).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Effect-specific confirmation, permissions, pages and durable order identity.
// ============================================================================
it("binds an extension to the displayed original subscription and expiry", async () => {
  await preview("extend");
  await fill("extension-target", "other-subscription");
  await submit();
  expect(mocks.extend).toHaveBeenCalledWith(
    expect.objectContaining({
      voucherId: "voucher",
      subscriptionId: "other-subscription",
      expectedPlanVersionId: "other-version",
      expectedEndAt: "2027-01-01T00:00:00Z",
    }),
  );
});
it("requires a fresh preview after a confirmed stale target with no committed receipt", async () => {
  mocks.extend.mockRejectedValueOnce(new ConsoleBffError("invalid", 409));
  await preview("extend");
  await submit();
  expect(changed).not.toHaveBeenCalled();
  expect(host.querySelector("#extension-target")).toBeNull();
  await submit();
  expect(mocks.extendPreview).toHaveBeenCalledTimes(2);
  expect(mocks.extend).toHaveBeenCalledOnce();
});
it("recovers before discarding a conflicting request identity", async () => {
  mocks.recharge.mockRejectedValueOnce(new ConsoleBffError("invalid", 409));
  mocks.rechargeResult.mockResolvedValueOnce(receipts.recharge);
  await preview("recharge");
  await submit();
  expect(changed).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("TXN-principal");
  expect(host.textContent).toContain("TXN-bonus");
});
it("clears the claim credential on dismiss and forbids unauthenticated operation previews", async () => {
  await preview("claim");
  await act(async () => host.querySelectorAll("button")[1]!.click());
  expect(close).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
  state.session.isAuthenticated = false;
  await render(node("recharge"));
  expect(mocks.rechargePreview).not.toHaveBeenCalled();
  expect(host.querySelector("form")).toBeNull();
});
it("renders the six kinds and holder labels, with billing permission required for effectful actions", async () => {
  state.session.capabilities = ["tenant.billing.read"];
  mocks.page.mockResolvedValue({
    items: [
      "discount",
      "credit_voucher",
      "invite",
      "redemption",
      "extension",
      "recharge_card",
    ].map((kind) => ({ ...voucher, id: kind, kind })),
    total: 6,
    page: 1,
    pageSize: 10,
    summary: { total: 6, available: 6, redeemed: 0, expiringSoon: 0 },
  });
  await render(<VouchersPage />);
  await clockPage();
  expect(host.querySelectorAll('[role="row"]')).toHaveLength(6);
  expect(host.textContent).toContain("My voucher");
  const labels = [
    messages.vouchersPage.redeem.action,
    messages.vouchersPage.extend.action,
    messages.vouchersPage.recharge.action,
  ];
  for (const label of labels)
    expect(
      Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent === label,
      )!.disabled,
    ).toBe(true);
});
it("passes paging/sorting to the server and distinguishes failed reads", async () => {
  await render(<VouchersPage />);
  await clockPage();
  expect(mocks.page).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10, status: "available" }),
  );
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "next-page")!
      .click(),
  );
  await clockPage();
  expect(mocks.page).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }),
  );
  mocks.page.mockRejectedValueOnce(new Error("read failed"));
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "sort-expiry")!
      .click(),
  );
  await clockPage();
  expect(host.textContent).toContain("read-failed");
});
it("keeps noncash reversal distinct from an actual cash refund in the order timeline", async () => {
  const order = {
    orderId: "order",
    orderNo: "ORD-01",
    planName: "Plan",
    productName: "Product",
    currency: "CNY",
    amount: "0",
    listPrice: "99",
    voucherOff: "99",
    orderStatus: "cancelled",
    noncashReversed: true,
    createdAt: "2026-11-01T00:00:00Z",
    confirmedAt: "2026-11-01T00:00:00Z",
    activatedAt: "2026-11-01T00:00:00Z",
  } as MyOrder;
  await render(
    <OrderDetailPanel order={order} countdown={null} fmtLocale="en-US" />,
  );
  expect(host.textContent).toContain(
    messages.subscriptionHub.detail.step.noncashReversed,
  );
  expect(host.textContent).not.toContain(
    messages.subscriptionHub.detail.step.refunded,
  );
});
it("retries invitation order creation with the same key after an uncertain response", async () => {
  mocks.order.mockRejectedValueOnce(new Error("response lost"));
  await render(<SubscribePage />);
  const button = () =>
    Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(messages.subscribePage.confirm.submit),
    );
  expect(button()).toBeDefined();
  await act(async () => button()!.click());
  await act(async () => button()!.click());
  expect(mocks.order).toHaveBeenCalledTimes(2);
  expect(mocks.order.mock.calls[0]).toEqual(mocks.order.mock.calls[1]);
  expect(mocks.context).toHaveBeenCalledTimes(2);
  expect(state.push).toHaveBeenCalledWith("/subscribe/pay/order");
});
const purchaseButton = () =>
  Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(messages.subscribePage.confirm.submit),
  )!;
it("forbids a billing reader from creating an invitation order", async () => {
  state.session.capabilities = ["tenant.billing.read"];
  await render(<SubscribePage />);
  expect(purchaseButton().disabled).toBe(true);
  await act(async () => purchaseButton().click());
  expect(mocks.order).not.toHaveBeenCalled();
});
it("locks concurrent order submits while refreshing invitation eligibility", async () => {
  await render(<SubscribePage />);
  const pending = deferred<SubscribeContext>();
  mocks.context.mockReturnValueOnce(pending.promise);
  await act(async () => {
    purchaseButton().click();
    purchaseButton().click();
  });
  expect(mocks.context).toHaveBeenCalledTimes(2);
  expect(mocks.order).not.toHaveBeenCalled();
  await act(async () => pending.resolve(structuredClone(context)));
  expect(mocks.order).toHaveBeenCalledOnce();
  expect(state.push).toHaveBeenCalledOnce();
});
it("does not create an order after its eligibility response crosses a workspace switch", async () => {
  await render(<SubscribePage />);
  const pending = deferred<SubscribeContext>();
  mocks.context.mockReturnValueOnce(pending.promise);
  await act(async () => purchaseButton().click());
  state.session.tenant!.workspace = "other-workspace";
  await render(<SubscribePage />);
  await act(async () => pending.resolve(structuredClone(context)));
  expect(mocks.order).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
});
it("ignores a late order receipt after tenant permissions change", async () => {
  const pending = deferred<{ orderId: string; status: string }>();
  mocks.order.mockReturnValueOnce(pending.promise);
  await render(<SubscribePage />);
  await act(async () => purchaseButton().click());
  expect(mocks.order).toHaveBeenCalledOnce();
  state.session.capabilities = ["tenant.billing.read"];
  await render(<SubscribePage />);
  await act(async () =>
    pending.resolve({ orderId: "old-order", status: "pending_payment" }),
  );
  expect(state.push).not.toHaveBeenCalled();
  expect(purchaseButton().disabled).toBe(true);
});
it("preserves zero-value settlement history and shows noncash reversal in the orders list", async () => {
  mocks.orders.mockResolvedValue([
    {
      orderId: "order",
      orderNo: "ORD-01",
      planName: "Plan",
      productName: "Product",
      currency: "CNY",
      amount: "0",
      listPrice: "99",
      voucherOff: "99",
      orderStatus: "cancelled",
      subscriptionStatus: "cancelled",
      noncashReversed: true,
      createdAt: "2026-11-01T00:00:00Z",
    },
  ]);
  await render(<OrdersSection />);
  expect(host.textContent).toContain(
    messages.subscriptionHub.payAxis.settledZero,
  );
  expect(host.textContent).toContain(messages.subscriptionHub.noncashReversed);
  expect(host.textContent).toContain(
    messages.subscriptionHub.svcAxis.terminated,
  );
  expect(host.textContent).not.toContain(
    messages.subscriptionHub.payAxis.refunded,
  );
});

// ============================================================================
// Render the business preview again with installed design-system primitives.
// ============================================================================
it("renders a real design-system recharge preview with principal, bonus and wallet destination", async () => {
  vi.doUnmock("@vxture/design-system");
  vi.resetModules();
  const { RechargeCardDialog: RealDialog } =
    await import("./RechargeCardDialog");
  await render(
    <RealDialog voucherId="voucher" onClose={close} onRedeemed={changed} />,
  );
  expect(document.body.textContent).toContain("Platform tenant");
  expect(document.body.textContent).toContain("10.00");
  expect(document.body.textContent).toContain("5.00");
  expect(mocks.recharge).not.toHaveBeenCalled();
  const output = process.env.VOUCHER_UI_RENDER_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(
      join(output, "recharge-preview.html"),
      "<!doctype html><html lang=en><body>" +
        document.body.innerHTML +
        "</body></html>",
    );
  }
}, 60000);
