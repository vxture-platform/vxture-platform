/**
 * platform-provisioning.router.spec.ts — 开通回执的四条纪律。
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category test
 *
 * 这四件错了都**不会有外在症状**——回执照样返 200，产品那边什么都看不出来：
 *
 *  1. **产品只能为自己回执。** 丢了这一条，任一产品都能替别人声明「空间建好了」，
 *     而那正是 opera 将来要拿来判开通是否真成的信号。
 *  2. **工作区取 token 的，不取请求体的。** 调用方自报身份等于没有鉴权
 *     （通则被调方纪律第 8 条）。请求体声明的那个必须被**丢弃**，不是「校验后采纳」。
 *  3. **没有开通行 → 404，不是 200。** 平台从没对这个 (workspace, product) 下过令，
 *     却收下一条回执并回成功，等于凭空造出一条谁都对不上的记录。
 *  4. **status 只认 ready / failed。** 猜一个默认值会把产品报上来的失败悄悄记成成功。
 *
 * @author AI-Generated
 * @date 2026-09-17
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import type { PlatformProvisioningService } from "../platform/platform-provisioning.service";
import {
  parseAckBody,
  PlatformProvisioningRouter,
} from "./platform-provisioning.router";

const WS_DECLARED = "00000000-0000-4000-8000-0000000000d1";
const WS_TOKEN = "00000000-0000-4000-8000-0000000000a1";
const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-0000000000aa";
const DELIVERY = "9c1f0000-0000-4000-8000-00000000000d";

/** `recordAck` 的真实返回是可空的——平台从没下过开通令时回 null。 */
type AckResult = { ackedAt: string; replayed: boolean } | null;
type RecordAckMock = Mock<(input: unknown) => Promise<AckResult>>;
type ResolveProductMock = Mock<(code: string) => Promise<string | null>>;

function makeRouter(
  recordAck: RecordAckMock = vi.fn(
    async (): Promise<AckResult> => ({
      ackedAt: "2026-09-17T00:00:00.000Z",
      replayed: false,
    }),
  ),
  resolveProductId: ResolveProductMock = vi.fn(
    async (): Promise<string | null> => PRODUCT_ID,
  ),
) {
  const router = new PlatformProvisioningRouter({
    resolveProductId,
    recordAck,
  } as unknown as PlatformProvisioningService);
  return { router, recordAck, resolveProductId };
}

const s2s = (productCode: string) => ({
  productCode,
  mode: "service" as const,
  orgId: null,
  workspaceId: WS_TOKEN,
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("预期被拒，但成功了");
}

describe("POST /provisioning/ack", () => {
  it("工作区取 token 的，请求体声明的那个被丢弃", async () => {
    const { router, recordAck } = makeRouter();
    const res = await router.ack(
      { workspace_id: WS_DECLARED, product: "karda", status: "ready" },
      s2s("karda"),
    );
    expect(recordAck).toHaveBeenCalledTimes(1);
    expect(recordAck.mock.calls[0]![0]).toMatchObject({
      workspaceId: WS_TOKEN,
      applicationId: PRODUCT_ID,
      status: "ready",
    });
    /* 回给产品的也必须是 token 那个——回显请求体会让对方以为平台采纳了它的声明。 */
    expect(res.workspace_id).toBe(WS_TOKEN);
  });

  it("替别的产品回执：403，且一个字都不写", async () => {
    const { router, recordAck } = makeRouter();
    const error = await rejection(
      router.ack(
        { workspace_id: WS_TOKEN, product: "karda", status: "ready" },
        s2s("arda"),
      ),
    );
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(403);
    expect(recordAck).not.toHaveBeenCalled();
  });

  it("平台从没对它下过开通令：404，不是 200", async () => {
    const { router } = makeRouter(vi.fn(async (): Promise<AckResult> => null));
    const error = await rejection(
      router.ack(
        { workspace_id: WS_TOKEN, product: "karda", status: "ready" },
        s2s("karda"),
      ),
    );
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(404);
  });

  it("同一条投递重放：replayed 为 true，时间是**原来那一次**", async () => {
    const { router } = makeRouter(
      vi.fn(
        async (): Promise<AckResult> => ({
          ackedAt: "2026-09-16T08:00:00.000Z",
          replayed: true,
        }),
      ),
    );
    const res = await router.ack(
      {
        workspace_id: WS_TOKEN,
        product: "karda",
        status: "ready",
        delivery_id: DELIVERY,
      },
      s2s("karda"),
    );
    expect(res.replayed).toBe(true);
    expect(res.acked_at).toBe("2026-09-16T08:00:00.000Z");
  });

  it("未知产品码：400，不落库", async () => {
    const { router, recordAck } = makeRouter(
      undefined,
      vi.fn(async (): Promise<string | null> => null),
    );
    const error = await rejection(
      router.ack(
        { workspace_id: WS_TOKEN, product: "nope", status: "ready" },
        s2s("nope"),
      ),
    );
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(400);
    expect(recordAck).not.toHaveBeenCalled();
  });
});

describe("parseAckBody —— 读不出来就抛，不给默认值", () => {
  it("status 缺失或不在词表里都抛", () => {
    expect(() =>
      parseAckBody({ workspace_id: WS_TOKEN, product: "karda" }),
    ).toThrow(/status/);
    expect(() =>
      parseAckBody({
        workspace_id: WS_TOKEN,
        product: "karda",
        status: "done",
      }),
    ).toThrow(/status/);
  });

  it("failed 是合法回执——回执也要能说坏消息", () => {
    expect(
      parseAckBody({
        workspace_id: WS_TOKEN,
        product: "karda",
        status: "failed",
      }).status,
    ).toBe("failed");
  });

  it("投递 id 可以缺省（定期对账补发的回执没有对应投递）", () => {
    expect(
      parseAckBody({
        workspace_id: WS_TOKEN,
        product: "karda",
        status: "ready",
      }).deliveryId,
    ).toBeNull();
  });

  it("空白串不算填了", () => {
    expect(() =>
      parseAckBody({ workspace_id: "   ", product: "karda", status: "ready" }),
    ).toThrow(/workspace_id/);
  });

  it("detail 不是对象时忽略，不抛——它是可选的产品侧上下文，不是契约字段", () => {
    expect(
      parseAckBody({
        workspace_id: WS_TOKEN,
        product: "karda",
        status: "ready",
        detail: "not-an-object",
      }).detail,
    ).toBeUndefined();
  });
});
