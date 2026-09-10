/**
 * provisioning.service.ts - provisioning enqueue + webhook dispatch (P4)
 * @package @vxture/service-provisioning
 *
 * `enqueue` is called by the commerce subscription lifecycle; `dispatchPending`
 * is the loop body run on an interval by the host (admin-bff @nestjs/schedule).
 * Delivery is at-least-once with a DB lease; idempotency/ordering are the app's
 * responsibility (delivery_id + seq). See identity-platform-rp-integration.md §4–§6.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { decryptSecret, deriveSecretKey } from "@vxture/core-utils";
import { PgProvisioningRepository } from "../repository/pg-provisioning.repository";
import { backoffSeconds } from "../backoff";
import { signWebhook } from "../signer";
import { PROVISIONING_ALERT_SINK, WEBHOOK_SECRET_RESOLVER } from "../tokens";
import type {
  ClaimedDelivery,
  DispatchConfig,
  DispatchResult,
  EnqueueEventInput,
  EnqueueProvisioningInput,
  ProvisioningAlertSink,
  WebhookSecretResolver,
} from "../types/provisioning.types";

export const PROVISIONING_DISPATCH_CONFIG = "PROVISIONING_DISPATCH_CONFIG";

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  // Explicit token: bff bundles (esbuild) emit no decorator metadata, so an
  // implicit constructor type silently injects undefined (repo-wide pattern).
  constructor(
    @Inject(PgProvisioningRepository)
    private readonly repo: PgProvisioningRepository,
    @Inject(PROVISIONING_DISPATCH_CONFIG)
    private readonly cfg: DispatchConfig,
    @Inject(WEBHOOK_SECRET_RESOLVER)
    private readonly secrets: WebhookSecretResolver,
    @Inject(PROVISIONING_ALERT_SINK)
    private readonly alerts: ProvisioningAlertSink,
  ) {}

  /**
   * webhook 密钥密文的主密钥,派生一次。
   *
   * **只有一个,永不随产品增长**——这正是与旧做法(每产品一个
   * `{CODE}_PROVISION_WEBHOOK_SECRET`)的区别:接一个智能体不用改 .env、不用重新部署。
   *
   * 未配置时为 null,行为等同「没有新路径」:登记了密文的产品投不出去并报错,
   * 只用旧 ref 的产品照常。不在构造时抛——那会让整个 admin-bff 起不来,
   * 而这条新路径此刻可能一个产品都还没用上。
   */
  private readonly encKey: Buffer | null = process.env.PLATFORM_WEBHOOK_ENC_KEY
    ? deriveSecretKey(process.env.PLATFORM_WEBHOOK_ENC_KEY)
    : null;

  /** Enqueue a provisioning event (bumps state/version + queues a delivery). */
  async enqueue(
    input: EnqueueProvisioningInput,
  ): Promise<{ deliveryId: string; seq: number }> {
    return this.repo.enqueue(input);
  }

  /**
   * Enqueue a version-less notification event (subscription_changed /
   * grant.invalidated) on the same queue. Idempotent on the caller-derived
   * key; returns null when the product has no webhook registration or the
   * event was already enqueued.
   */
  async enqueueEvent(input: EnqueueEventInput): Promise<string | null> {
    return this.repo.enqueueEvent(input);
  }

  /** Convenience: a (workspace, product) subscription became active/trial. */
  async onSubscriptionActivated(args: {
    workspaceId: string;
    tenantId: string;
    applicationId: string;
    appCode: string;
    planId?: string | null;
    plan?: string | null;
  }): Promise<{ deliveryId: string; seq: number }> {
    return this.enqueue({ ...args, event: "tenant.provisioned" });
  }

  /** Convenience: a (workspace, product) entitlement lapsed (grace ended). */
  async onSubscriptionDeactivated(args: {
    workspaceId: string;
    tenantId: string;
    applicationId: string;
    appCode: string;
  }): Promise<{ deliveryId: string; seq: number }> {
    return this.enqueue({ ...args, event: "tenant.deprovisioned" });
  }

  /**
   * One dispatch pass: recover expired leases, claim a batch, deliver each.
   * Safe to run concurrently across instances (DB lease + SKIP LOCKED).
   */
  async dispatchPending(): Promise<DispatchResult> {
    const recovered = await this.repo.recoverExpiredLeases();
    const claimed = await this.repo.claimBatch(
      this.cfg.leaseSeconds,
      this.cfg.batchSize,
    );
    let delivered = 0;
    let retried = 0;
    let failed = 0;
    for (const d of claimed) {
      const outcome = await this.deliverOne(d);
      if (outcome === "delivered") delivered++;
      else if (outcome === "failed") failed++;
      else retried++;
    }
    if (claimed.length > 0) {
      this.logger.log(
        `dispatch: recovered=${recovered} claimed=${claimed.length} ` +
          `delivered=${delivered} retried=${retried} failed=${failed}`,
      );
    }
    return { recovered, claimed: claimed.length, delivered, retried, failed };
  }

  /**
   * 取这次投递要用的 HMAC 密钥。两条路径,**新的优先**:
   *
   *   ① `webhookSecretEnc` —— 运营者在 opera 产品目录里登记的密文,随产品行一起
   *      落库。接一个新产品不需要动容器环境,这是「零代码上线产品」的最后一环。
   *   ② `webhookSecretRef` —— 旧路径,引用名 → `process.env[ref]`。存量产品
   *      (karda / arda / vxtpl)还在用,保留到它们迁完为止。
   *
   * 解密失败**不静默回落到 ②**:密文存在却解不开,只有两种可能——主密钥换了、
   * 或者这一行被改坏了。这两种都是要人去看的事故;悄悄改用另一个密钥去签名,
   * 产品侧会收到一批验签失败的投递,而平台这边一句话都没有。
   */
  private resolveSecret(d: ClaimedDelivery): string | null {
    if (d.webhookSecretEnc) {
      const raw = this.encKey;
      if (!raw) {
        this.logger.error(
          `delivery ${d.id}: 已登记密文但 PLATFORM_WEBHOOK_ENC_KEY 未配置——无法签名`,
        );
        return null;
      }
      try {
        return decryptSecret(d.webhookSecretEnc, raw);
      } catch {
        this.logger.error(
          `delivery ${d.id}: webhook 密钥密文解不开(主密钥不符或该行被改坏)——不回落到 env`,
        );
        return null;
      }
    }
    return d.webhookSecretRef ? this.secrets.resolve(d.webhookSecretRef) : null;
  }

  private async deliverOne(
    d: ClaimedDelivery,
  ): Promise<"delivered" | "retried" | "failed"> {
    const attempts = d.attempts + 1;
    const secret = this.resolveSecret(d);

    let responseCode: number | null = null;
    let ok = false;
    if (d.webhookUrl && secret) {
      const rawBody = JSON.stringify(d.payload);
      const ts = Math.floor(Date.now() / 1000);
      const sig = signWebhook(secret, rawBody, ts);
      try {
        responseCode = await this.post(d, rawBody, sig.header);
        ok = responseCode >= 200 && responseCode < 300;
      } catch (err) {
        this.logger.warn(`delivery ${d.id} POST error: ${String(err)}`);
      }
    } else {
      // Misconfigured app (no url/secret): retry then fail, so it surfaces.
      this.logger.error(
        `delivery ${d.id}: app ${d.payload.application} missing webhook_url/secret`,
      );
    }

    if (ok) {
      await this.repo.markDelivered(d.id, responseCode);
      return "delivered";
    }
    if (attempts >= this.cfg.maxAttempts) {
      await this.repo.markFailed(d.id, attempts, responseCode);
      await this.alerts.deliveryFailed({
        deliveryId: d.id,
        tenantId: d.tenantId,
        appCode: d.payload.application,
        eventType: d.eventType,
        attempts,
        lastResponseCode: responseCode,
      });
      return "failed";
    }
    const delaySec = backoffSeconds(
      attempts,
      this.cfg.backoffBaseSec,
      this.cfg.backoffCapSec,
    );
    const nextRetryAt = new Date(Date.now() + delaySec * 1000);
    await this.repo.markRetry(d.id, attempts, nextRetryAt, responseCode);
    return "retried";
  }

  /** POST the signed payload to the app webhook; returns the HTTP status. */
  private async post(
    d: ClaimedDelivery,
    rawBody: string,
    signatureHeader: string,
  ): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(d.webhookUrl as string, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vxture-event": d.eventType,
          "x-vxture-delivery": d.id,
          "x-vxture-signature": signatureHeader,
        },
        body: rawBody,
        signal: controller.signal,
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  }
}
