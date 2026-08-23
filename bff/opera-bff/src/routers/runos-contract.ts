/**
 * runos-contract.ts — Runos 各读端点的必有字段与载荷形状。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 机制在 `@vxture-platform/shared`，这里只有**词表**。
 *
 * ## 为什么这一侧也要有
 *
 * `atlas-contract.ts` 先建、runos 空了一轮，而 runos 恰恰贡献了两条漂移
 * （`latencyMs` 不存在、`droppedAlias` 是复数），**两条都是手工逐字段对源码才发现的**。
 * 只守一半等于把「漂移会响一声」这个保证做成了一半，而一半的保证最容易被当成全部。
 *
 * ## 与 atlas 表的形状差异已经不存在了
 *
 * 分页信封的行键曾经是 atlas `items` / runos `rows`。`product_251` A-4 判定那是
 * 「历史造成的」并把两边收敛到 `items`，收敛条件写成了
 * `upstream-contract.spec.ts` 里的验收测试（两张表的 `rowsKey` 必须只有一个值）。
 *
 * 清单逐字段照 `vxture-runos` 的 prisma schema 与四个 controller（gitSha `4996d56d`，
 * 已证实 == 在跑的镜像：其后两个 commit 只动 docs/CLAUDE.md）。
 */

import {
  makeContractAssert,
  type ContractTable,
} from "@vxture-platform/shared";

import { upstreamContractViolation } from "../errors/api-error";

export const RUNOS_CONTRACT = {
  capabilities: {
    shape: { kind: "list" },
    fields: [
      "capabilityId",
      "primitiveType",
      "providerId",
      "ownerRef",
      "title",
      /* 准入档：能力注册页据它决定「置为 official」「提交认证」能不能点——
         对 official 跑认证会降级，那个判断全靠这个字段。 */
      "admissionTier",
      /* v0.5.0 起注册必填（15 选 1）。目录页按它分组与筛选。 */
      "category",
    ],
  },
  /** 详情读比列表多三组关联。 */
  "capability-detail": {
    shape: { kind: "single" },
    fields: ["capabilityId", "versions", "aliases", "endpoints"],
  },
  credentials: {
    shape: { kind: "list" },
    fields: [
      "bindingId",
      "credentialClass",
      "providerId",
      "mode",
      /* 晋升前的凭证检查逐字照抄 runos 的 `findActive`：state + credentialClass +
         appliesTo 三个一起判。少任何一个，那个检查就从"提前把话说了"变成"瞎猜"。 */
      "appliesTo",
      "state",
    ],
  },
  "audit-calls": {
    shape: { kind: "page", rowsKey: "items", envelopeFields: ["nextCursor"] },
    fields: [
      /* 主键。`callId` 是**非唯一**索引（配 sequenceNo/retryOf），行标识必须用这个。 */
      "eventId",
      "callId",
      "occurredAt",
      /* 与 atlas 请求日志共用的跨产品关联键（product_251 X-2）。 */
      "taskId",
      "capabilityId",
      "outcome",
      "decision",
      /* 这一条就是本文件存在的理由之一：门户曾经读 `latencyMs`，上游从来没有过。 */
      "latencyTotalMs",
      /* 计量与配额维度（2026-08-24 接出）。上游列全是 NOT NULL 带默认值，所以
         「缺了」只可能是上游改了形状，不可能是这一行恰好没有。
         `costUnit` 与 `costAmount` 一起进清单是有意的：只有量没有单位，等于让人
         把 token 和页数加在一起（product_251 X-3 的 `SUM()` 例子）。 */
      "costAmount",
      "costUnit",
      "quotaCounterBefore",
      "quotaLimit",
      "bytesIn",
      "bytesOut",
      "matchedPolicyIds",
      "degradedMode",
    ],
  },
  "audit-mgmt-events": {
    shape: { kind: "page", rowsKey: "items", envelopeFields: ["nextCursor"] },
    fields: [
      "eventId",
      "action",
      /* v0.8.0 新增：「谁试图做但被拒了」由它答得出。 */
      "outcome",
      "occurredAt",
      "actorId",
      "actorConsole",
      "objectType",
      "objectId",
    ],
  },
  "audit-outcomes": {
    shape: { kind: "page", rowsKey: "items", envelopeFields: ["nextCursor"] },
    fields: [
      "eventId",
      "taskId",
      "occurredAt",
      "outcome",
      "agentId",
      "workspaceId",
    ],
  },
  /** 有界窗口上的聚合，**刻意没有游标**——行数是轴的基数，不是流的长度。 */
  "usage-summaries": {
    /* `dimension`/`from`/`to` 是**信封上**的服务端解析结果（轴默认 workspace，
       窗口默认当月 UTC），不是行上的——A-4 明确禁止把回显复制到每一行，因为空结果时
       它会整个消失。此前这张表把 `dimension` 列成行字段，是照着旧形状抄错了：
       那条读一旦真有数据就会误报，而 metering 页当时没被走到，所以实测也没暴露它。 */
    shape: {
      kind: "page",
      rowsKey: "items",
      envelopeFields: ["dimension", "from", "to"],
    },
    fields: [
      /* 不属于聚合轴的身份字段一律为 null，所以只有这四个度量是无论哪根轴都必有的。 */
      "calls",
      "allowedCalls",
      "successCalls",
      "costAmount",
    ],
  },
  grants: {
    shape: { kind: "list" },
    fields: [
      "grantId",
      "subjectType",
      "subjectRef",
      "capabilityId",
      /* direct / derived。派生行不能单独撤、不能改条款，整页的行操作都按它开关。 */
      "grantType",
      "riskScope",
      "state",
      "quotaLimit",
    ],
  },
  /**
   * 配额消费量。**与 `quota/reset` 的响应形状不同**——后者只回
   * `{grantId, used, updatedAt}`，把它当消费量存进缓存会让 `enforced` 变 undefined，
   * 于是一条有上限的授权被渲染成「未强制」。这份清单就是那条边界的守卫。
   */
  "grant-quota": {
    shape: { kind: "single" },
    fields: ["grantId", "used", "quotaLimit", "enforced", "remaining"],
  },
} as const satisfies ContractTable;

export type RunosResource = keyof typeof RUNOS_CONTRACT;

export const assertRunosContract = makeContractAssert(
  "Runos",
  "RUNOS",
  RUNOS_CONTRACT,
  /* 见 `atlas-contract.ts` 同一处。 */
  (v) => upstreamContractViolation(v.code, v.message, v.field),
);
