/**
 * certification-stale.ts —— 把一个产品当前那条有效认证标成「待复认证」。
 *
 * @package @vxture/bff-opera
 *
 * ── 什么该让认证失效，什么不该 ──
 *
 * 认证证的是一句有时间的话：「**在 T 时刻**，这条链在沙箱里跑通过一次」。所以只有
 * **让那句话不再成立的契约变更**才该让它失效——不是「现在跑不跑得动」，后者归运行健康。
 *
 * 会失效（本文件负责）：
 *   webhook_changed        回调地址变了 ⇒ 当初证过的末段投递现在去别处了
 *   secret_rotated         签名密钥轮换 ⇒ 对方的验签能不能跟上，没证过
 *   redirect_uri_changed   回调 URI 变了 ⇒ 当初证过的登录段现在指向别处
 *
 * 不失效，**有意的**：
 *   上游授权被撤（Atlas 模型 / Runos 能力）——它发生在兄弟仓那边，平台观测不到那个
 *     事件；更要紧的是它**不是契约变更**：认证那句有时间的话仍然成立，断的是运行时。
 *     这种断裂该由运行健康报 degraded，而不是把一张历史证书涂掉。
 *     `stale_reason` 的值域里因此**没有** upstream_grant_revoked——留一个没有写入方的
 *     值，就是这一批刚花力气清掉的那种东西（`operator_grant` 曾经就是）。
 *   契约版本升版——没有「事件」可挂：它是代码里的一个常量，改它是一次提交。
 *     所以那一条在**读的时候**判（`contract_version <> 当前值` 即视作失效），
 *     不在这里写。见 `@vxture-platform/shared` 的 INTEGRATION_CONTRACT_VERSION。
 *   套餐组件改过——由发布门的指纹比对现算，同样不需要一个事件。
 *
 * ── 为什么是「标记」不是「删除」 ──
 * 台账要留得住：「这个产品曾经在什么时候、对哪个契约版本认过」是事后要答的问题。
 * stale 只挡「再发布新版本」，**不把在跑的产品拉下线**。
 */
import type { Pool, PoolClient } from "pg";

/** 值域与 `product.certification_runs` 的 CHECK 逐字一致；改一处要改两处。 */
export type CertificationStaleReason =
  | "webhook_changed"
  | "secret_rotated"
  | "redirect_uri_changed"
  | "contract_version_bumped"
  | "components_changed";

/**
 * 把该产品当前那条有效认证标成待复认证。没有有效认证时是 no-op——**不抛**：
 * 调用方是「改回调地址」这类正常运营动作，不能因为「这个产品还没认证过」就失败。
 *
 * 只动**当前有效**的那一条（certified 且未 stale）：历史台账是历史，不该被后来的
 * 配置变更追溯改写。
 *
 * @returns 标掉了几条（0 或 1）。调用方拿它决定要不要在响应里提醒运营「认证已失效」。
 */
export async function markCertificationStale(
  db: Pool | PoolClient,
  productId: string,
  reason: CertificationStaleReason,
): Promise<number> {
  const res = await db.query(
    `UPDATE product.certification_runs
        SET stale_reason = $2, stale_at = now(), updated_at = now()
      WHERE id = (
        SELECT id FROM product.certification_runs
         WHERE product_id = $1
           AND verdict = 'certified'
           AND stale_reason IS NULL
         ORDER BY certified_at DESC
         LIMIT 1
      )`,
    [productId, reason],
  );
  return res.rowCount ?? 0;
}

/**
 * 回调地址算不算「变了」。
 *
 * ── 「保存了一次」不等于「改了」 ──
 * 运营在回调登记那张表单上按保存的次数，远多于真的换地址（改主页链接、改边缘域名、
 * 甚至只是点进去看一眼再保存）。每次都把认证标失效，等于让它随手作废——而作废一次就
 * 要拉着对方重跑一遍链路。所以判据是**值真的变了**，不是「这个端点被调用了」。
 *
 * 从无到有（`prev === null`）**不算变更**：当初就没有一条链是按旧地址证过的。
 *
 * 判据只此一份、并由单测直接钉住：抄一份到调用点去写，测的就不是真的那一份了。
 */
export function isWebhookUrlChanged(
  prev: string | null,
  next: string | null,
): boolean {
  return prev !== null && prev !== next;
}
