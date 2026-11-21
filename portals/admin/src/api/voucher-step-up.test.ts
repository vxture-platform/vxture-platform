/**
 * voucher-step-up.test.ts - Preserve action context and stable retry payloads.
 * @package @vxture/admin
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminBffError,
  createVoucherBatch,
  assignVouchers,
  manageVoucherBatch,
  issueVoucherCredentials,
  revokeVoucher,
  submitOperatorStepUpTotp,
  isStepUpRequiredError,
} from "./admin-bff";

// ===========================================================================
// Native network is replaced; these flows never contact a configured BFF.
// ===========================================================================
afterEach(() => vi.unstubAllGlobals());
describe("per-action voucher ceremony client", () => {
  const action = {
    requestHash: "a".repeat(64),
    action: "创建卡券批次",
    target: "新批次",
  };
  const command = {
    kind: "credit_voucher",
    name: "test",
    effect: { amount_cents: 1000 },
    totalCount: 1,
    validFrom: "2026-11-20T00:00:00Z",
    validUntil: "2026-11-30T00:00:00Z",
    reason: "approved",
    idempotencyKey: "stable-request",
  } as const;
  it("retains the server intent, verifies it, then repeats the exact original command", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { message: "step_up_required", stepUpAction: action },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, expiresIn: 300 }))
      .mockResolvedValueOnce(Response.json({ batchId: "created" }));
    vi.stubGlobal("fetch", fetcher);
    const error: unknown = await createVoucherBatch(command).catch(
      (e: unknown) => e,
    );
    expect(isStepUpRequiredError(error)).toBe(true);
    expect((error as AdminBffError).stepUpAction).toEqual(action);
    await submitOperatorStepUpTotp(
      "123456",
      (error as AdminBffError).stepUpAction,
    );
    expect(await createVoucherBatch(command)).toEqual({ batchId: "created" });
    expect(fetcher.mock.calls[0]![1]!.body).toBe(
      fetcher.mock.calls[2]![1]!.body,
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({
      code: "123456",
      action,
    });
  });
  it("does not retry an unknown network result automatically", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("response lost"));
    vi.stubGlobal("fetch", fetcher);
    await expect(createVoucherBatch(command)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("drops malformed server intent instead of reflecting arbitrary fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            message: "step_up_required",
            stepUpAction: { ...action, requestHash: "invalid" },
          },
          { status: 403 },
        ),
      ),
    );
    const error: unknown = await createVoucherBatch(command).catch(
      (e: unknown) => e,
    );
    expect((error as AdminBffError).stepUpAction).toBeUndefined();
    expect(isStepUpRequiredError(error)).toBe(false);
    expect((error as AdminBffError).status).toBe(502);
  });
  it.each([
    ["create", () => createVoucherBatch(command)],
    [
      "assign",
      () =>
        assignVouchers({
          batchId: "batch",
          count: 1,
          targetTenantId: "tenant",
          targetUserId: "user",
          reason: "test",
          idempotencyKey: "key",
        }),
    ],
    [
      "manage",
      () =>
        manageVoucherBatch("batch", {
          action: "pause",
          reason: "test",
          idempotencyKey: "key",
        }),
    ],
    [
      "issue",
      () =>
        issueVoucherCredentials("batch", {
          count: 1,
          fundingPaymentId: "payment",
          reason: "test",
          idempotencyKey: "key",
        }),
    ],
    [
      "revoke",
      () => revokeVoucher("voucher", { reason: "test", idempotencyKey: "key" }),
    ],
  ] as const)(
    "keeps full body and bound context for %s",
    async (_name, invoke) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              message: "step_up_required",
              stepUpAction: { ...action, ignored: "untrusted" },
            },
            { status: 403 },
          ),
        )
        .mockResolvedValueOnce(Response.json({ ok: true }))
        .mockResolvedValueOnce(Response.json({ ok: true }));
      vi.stubGlobal("fetch", fetcher);
      const error: unknown = await invoke().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AdminBffError);
      expect((error as AdminBffError).stepUpAction).toEqual(action);
      await submitOperatorStepUpTotp(
        "123456",
        (error as AdminBffError).stepUpAction,
      );
      await invoke();
      expect(fetcher.mock.calls[0]![1]!.body).toBe(
        fetcher.mock.calls[2]![1]!.body,
      );
      expect(fetcher.mock.calls[0]![1]).toMatchObject({
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    },
  );
  it.each([
    null,
    {},
    { ...action, action: " " },
    { ...action, target: "" },
    { ...action, target: "x".repeat(129) },
    { ...action, requestHash: "A".repeat(64) },
  ])("fails closed for malformed voucher binding %j", async (intent) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { message: "step_up_required", stepUpAction: intent },
            { status: 403 },
          ),
        ),
    );
    await expect(createVoucherBatch(command)).rejects.toMatchObject({
      status: 502,
    });
  });
  it.each([1, 900])("propagates bounded server wait %i", async (retryAfter) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: "limited", retryAfter }, { status: 429 }),
        ),
    );
    await expect(
      submitOperatorStepUpTotp("123456", action),
    ).rejects.toMatchObject({ status: 429, retryAfter });
  });
  it.each([0, 901, -1, 1.5, "60", null])(
    "discards unsafe wait %j",
    async (retryAfter) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            Response.json({ message: "limited", retryAfter }, { status: 429 }),
          ),
      );
      const error: unknown = await submitOperatorStepUpTotp(
        "123456",
        action,
      ).catch((e: unknown) => e);
      expect((error as AdminBffError).retryAfter).toBeUndefined();
    },
  );
});
