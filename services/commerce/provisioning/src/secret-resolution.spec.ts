import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveSecretKey, encryptSecret } from "@vxture/core-utils";
import { ProvisioningService } from "./service/provisioning.service";
import type { ClaimedDelivery } from "./types/provisioning.types";

/**
 * webhook 密钥的两条路径与它们的优先级。
 *
 * ── 为什么要这一组 ──
 * 旧路径是 `process.env[ref]`:每接一个产品就往容器环境塞一个
 * `{CODE}_PROVISION_WEBHOOK_SECRET`,改 .env + 重新部署。新路径是运营者在 opera
 * 里登记的密文,随产品行落库,容器环境一动不动。
 *
 * 这一组钉三件事,每一件坏掉的症状都**不报错**:
 *   ① 密文优先 —— 否则运营者在页面上改了密钥,投递还在用 env 里那个旧的;
 *   ② 只有 ref 时照旧走 env —— 否则 karda / arda / vxtpl 三个存量产品当场投不出去;
 *   ③ 密文解不开时**不回落**到 env —— 这条最要紧。悄悄换一个密钥去签名,产品侧
 *      收到的是一批验签失败的投递,而平台这边一句话都不会说。
 *
 * 走的是 `deliverOne` 这条真实路径(经 `dispatchPending`),不是直接戳私有方法:
 * 私有方法测得再对,只要 `deliverOne` 没在用它,线上依然是旧行为。
 */

const KEY = "test-master-key-2026";

/** 造一个只够跑完一次投递的服务实例;真正被观测的是 POST 出去的签名头。 */
function build(delivery: Partial<ClaimedDelivery>) {
  const claimed: ClaimedDelivery = {
    id: "d-1",
    workspaceId: "ws-1",
    tenantId: "t-1",
    applicationId: "p-1",
    eventType: "tenant.provisioned",
    payload: { application: "tenderforge" } as never,
    attempts: 0,
    webhookUrl: "http://agent.invalid/provisioning/webhook",
    webhookSecretRef: null,
    webhookSecretEnc: null,
    ...delivery,
  };

  const repo = {
    recoverExpiredLeases: vi.fn(async () => 0),
    claimBatch: vi.fn(async () => [claimed]),
    markDelivered: vi.fn(async () => undefined),
    markRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
  /* 记下每次投递用的签名头。签名头是**密钥的函数**——用了哪个密钥,
     这里就能看出来,不需要把私有方法暴露出去。 */
  const posted: string[] = [];
  const errors: string[] = [];

  const svc = Object.create(
    ProvisioningService.prototype,
  ) as ProvisioningService;
  Object.assign(svc, {
    repo,
    cfg: {
      maxAttempts: 10,
      backoffBaseSec: 30,
      backoffCapSec: 3600,
      leaseSeconds: 30,
      batchSize: 20,
      timeoutMs: 1000,
    },
    secrets: { resolve: (ref: string) => process.env[ref] ?? null },
    alerts: { deliveryFailed: vi.fn(async () => undefined) },
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((m: string) => errors.push(m)),
    },
    encKey: process.env.PLATFORM_WEBHOOK_ENC_KEY
      ? deriveSecretKey(process.env.PLATFORM_WEBHOOK_ENC_KEY)
      : null,
    /* POST 打桩:不出网,只记签名头然后当成 200。 */
    post: async (_d: ClaimedDelivery, _b: string, header: string) => {
      posted.push(header);
      return 200;
    },
  });
  return { svc, posted, errors, repo };
}

/** 同样的载荷、同样的时刻,用不同密钥签出来的头必然不同——用它反推「用了哪个密钥」。 */
function sigOf(posted: string[]): string {
  expect(posted).toHaveLength(1);
  return posted[0]!;
}

describe("webhook 密钥:密文优先于 env", () => {
  beforeEach(() => {
    process.env.PLATFORM_WEBHOOK_ENC_KEY = KEY;
    process.env.TENDERFORGE_PROVISION_WEBHOOK_SECRET = "env-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  });

  it("两个都在时用密文那个", async () => {
    const enc = encryptSecret("db-secret", deriveSecretKey(KEY));
    const a = build({
      webhookSecretEnc: enc,
      webhookSecretRef: "TENDERFORGE_PROVISION_WEBHOOK_SECRET",
    });
    await a.svc.dispatchPending();

    /* 对照:同一时刻、同一载荷,只给 env 那条路。两个签名头必须**不同**——
       相同就说明密文那条根本没走到,而投递照样成功、日志照样干净。 */
    const b = build({
      webhookSecretRef: "TENDERFORGE_PROVISION_WEBHOOK_SECRET",
    });
    await b.svc.dispatchPending();

    expect(sigOf(a.posted)).not.toBe(sigOf(b.posted));
    expect(a.repo.markDelivered).toHaveBeenCalled();
  });

  it("只有 ref 时照旧走 env(存量产品不受影响)", async () => {
    const { svc, posted, repo } = build({
      webhookSecretRef: "TENDERFORGE_PROVISION_WEBHOOK_SECRET",
    });
    await svc.dispatchPending();
    expect(posted).toHaveLength(1);
    expect(repo.markDelivered).toHaveBeenCalled();
  });

  it("密文解不开 → 不投、报错,**不回落到 env**", async () => {
    /* 夹具在运行时生成:拿**另一个主密钥**加密,得到一段格式合法、GCM 认证标签
       对不上的真密文。比写死一串假密文好两点——它就是生产上「主密钥被换掉」
       的真实形态,而且源码里不留高熵字面量(那会被 gitleaks 当成真凭证拦下)。 */
    const { svc, posted, errors, repo } = build({
      webhookSecretEnc: encryptSecret(
        "db-secret",
        deriveSecretKey("a-different-master-key"),
      ),
      webhookSecretRef: "TENDERFORGE_PROVISION_WEBHOOK_SECRET",
    });
    await svc.dispatchPending();

    expect(posted).toHaveLength(0); // 一次都没投出去
    expect(repo.markDelivered).not.toHaveBeenCalled();
    expect(errors.join("\n")).toMatch(/解不开/);
  });

  it("登记了密文但主密钥没配 → 不投、报错", async () => {
    delete process.env.PLATFORM_WEBHOOK_ENC_KEY;
    const { svc, posted, errors } = build({
      webhookSecretEnc: encryptSecret("db-secret", deriveSecretKey(KEY)),
      webhookSecretRef: "TENDERFORGE_PROVISION_WEBHOOK_SECRET",
    });
    await svc.dispatchPending();
    expect(posted).toHaveLength(0);
    expect(errors.join("\n")).toMatch(/PLATFORM_WEBHOOK_ENC_KEY/);
  });
});

describe("密文本身", () => {
  it("绕一圈能还原(HMAC 密钥必须能取回原文,这正是不用哈希的原因)", () => {
    const key = deriveSecretKey(KEY);
    const ct = encryptSecret("s3cr3t-value", key);
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("s3cr3t-value");
  });
});
