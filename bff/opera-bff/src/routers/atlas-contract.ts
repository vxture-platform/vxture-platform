/**
 * atlas-contract.ts — Atlas 各读端点的必有字段与载荷形状。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 机制在 `@vxture-platform/shared`（两个 BFF、所有上游共用），这里只有**词表**——
 * 「我方读哪些字段」是本仓的事实，「怎么查」不是。
 *
 * ## 这张表取代了什么
 *
 * `atlas-compat.ts`（已删）与门户里那一批「上游落后就换套说法」的降级分支。两者是同一个
 * 姿势：**上游少给了字段，就自己编一个能显示的世界**。代价在 2026-08-23 那轮实测里全暴露
 * 了——三处降级文案、一个恒为空的依赖计数列、一个从来没亮过的告警，全都不报错。
 *
 * ## 2026-08-23 第二次修订：补上被跳过的六个读
 *
 * 第一版只覆盖了 12 个读里的 6 个，跳过的全是**信封**——因为第一版的实现只认裸数组。
 * 这个跳过没有被记下来，于是形成了一个很难发现的洞：
 *
 * > **漂移最狠的那个面（`audit-logs`，X-3 一次改了 5 个字段名），恰恰是唯一没有守卫的。**
 *
 * 现在形状按端点声明（见 `PayloadShape`），信封与裸数组一视同仁，六个读全部补齐。
 */

import {
  makeContractAssert,
  type ContractTable,
} from "@vxture-platform/shared";

import { upstreamContractViolation } from "../errors/api-error";

/**
 * 逐字段照 atlas `model-admin.service.ts` / `observability.service.ts` /
 * `audit.service.ts` 的 `*Record`（gitSha `26795d18`，已证实 == 在跑的镜像）。
 */
export const ATLAS_CONTRACT = {
  providers: {
    shape: { kind: "list" },
    fields: [
      "id",
      "providerCode",
      "providerName",
      "providerType",
      "state",
      "health",
      /* 依赖计数：它就是挡住删除的那个数，与删除前置条件同源。缺了它，删除文案
         只能靠猜——那正是此前 `deleteDescription()` 在做的事。 */
      "modelCount",
    ],
  },
  models: {
    shape: { kind: "list" },
    fields: [
      "id",
      "modelCode",
      "modelName",
      "provider",
      "endpointUrl",
      "protocol",
      /* 由哪一层契约服务（chat/embedding/rerank/parse）。缺了它就分不出对话模型与
         向量模型，而两者走的是 atlas 上完全不同的 surface。 */
      "modelType",
      "state",
      "capabilities",
      "grantCount",
      "endpointRefCount",
      /* 实际生效的线协议描述符（atlas 2026-08-24 起直发）。进清单是因为门户的
         「线协议」抽屉整个建立在它之上——缺了它，那个抽屉会退回只显示声明层，
         而「声明了什么」与「实际跑什么」正是这个抽屉要分开的两件事。 */
      "resolvedWire",
    ],
  },
  "model-routes": {
    shape: { kind: "list" },
    fields: [
      "id",
      "code",
      "category",
      "primaryModelCode",
      "state",
      /* 意图与后果分列的那一半。缺了它，状态列只能退回显示意图——而两者不一致的
         那一刻正是唯一值得看的时刻。 */
      "resolution",
      "models",
    ],
  },
  "product-endpoint-grants": {
    shape: { kind: "list" },
    fields: ["id", "productCode", "endpointCode", "state"],
  },
  "provider-keys": {
    shape: { kind: "list" },
    fields: ["id", "providerCode", "keyAlias", "keyScope", "state"],
  },
  "api-keys": {
    shape: { kind: "list" },
    fields: [
      "id",
      "name",
      "kind",
      "keyPrefix",
      "state",
      /* 把到期折进去之后的实际态。缺了它页面就得自己拿 expiresAt 再算一遍，
         而同一个判断有两个实现迟早分叉。 */
      "effectiveState",
      "expiresAt",
    ],
  },

  /* ── 以下六个是 2026-08-23 第二次修订补的，五个是信封 ───────────────────── */

  /**
   * 变更流水。**本轮漂移最狠的一个面**：product_251 X-3 一次改了五个字段名
   * （`id`→`eventId`、`resourceType`→`objectType`、`resourceId`→`objectId`、
   * `operatorSub`→`actorId`、`actorClientId`→`actorConsole`），而它此前**没有守卫**。
   * 五个新名全部进清单——旧名再回来就是回退，同样要报。
   */
  "audit-logs": {
    shape: { kind: "page", rowsKey: "items", envelopeFields: ["nextCursor"] },
    fields: [
      "eventId",
      "objectType",
      "objectId",
      "action",
      "actorId",
      "actorConsole",
      "changedFields",
      "outcome",
      "occurredAt",
    ],
  },
  /** 请求日志。`taskId` 是与 runos 调用流水唯一的跨产品接缝（X-2）。 */
  logs: {
    shape: { kind: "page", rowsKey: "items", envelopeFields: ["nextCursor"] },
    fields: [
      "id",
      "requestId",
      "taskId",
      "status",
      "modelCode",
      "providerCode",
      "latencyMs",
      "createdAt",
    ],
  },
  /**
   * 窗口聚合。A-4 之后是信封：`window` 有服务端默认值（`24h`），所以「你拿到的是哪
   * 24 小时」必须回显，而回显只能放在信封上。
   *
   * `overall` 与 `items` 并列——它是与集合并列的另一个聚合量，不是行。
   */
  "logs-summary": {
    shape: {
      kind: "page",
      rowsKey: "items",
      envelopeFields: ["from", "to", "overall"],
    },
    fields: [
      "modelCode",
      "providerCode",
      "endpointCode",
      "requests",
      "errors",
      "errorRate",
      "totalTokens",
    ],
  },
  /**
   * 用量汇总。A-4 之后是信封：`groupBy` 服务端默认 `tenant`，所以聚合轴是解析出来的，
   * 必须回显。
   *
   * **`dimension` 从行上搬到了信封上**，这是 A-4 修的一个真实缺陷——放在行上时，
   * 空结果会让这个回显整个消失，调用方拿到 `[]` 后无从得知自己查的是哪根轴。
   *
   * `cycleMonth` 留在行上：它是纯透传过滤器，没有服务端默认值，因此不属于回显。
   */
  "usage-summaries": {
    shape: {
      kind: "page",
      rowsKey: "items",
      envelopeFields: ["dimension"],
    },
    fields: ["cycleMonth", "requests", "totalTokens", "errors"],
  },
  /** 协议词表——管理 UI 协议下拉的唯一数据源。手写一份候选列表意味着能选到 atlas 不认的值。 */
  protocols: {
    shape: { kind: "single" },
    fields: ["wireSchemaVersion", "protocols"],
  },
  /** Provider 近实时聚合。计数器是**进程启动以来的累计值**（Prometheus 语义）。 */
  "providers-performance": {
    shape: { kind: "single" },
    fields: [
      "generatedAt",
      "processStartedAt",
      "inFlightRequests",
      "providers",
    ],
  },
} as const satisfies ContractTable;

export type AtlasResource = keyof typeof ATLAS_CONTRACT;

export const assertAtlasContract = makeContractAssert(
  "Atlas",
  "ATLAS",
  ATLAS_CONTRACT,
  /* 机制不认识 HTTP：错误封套由本仓注入。理由见 shared 里那份文件头——两个 BFF 的
     封套本来就不同（这边有 `ApiError` 类，admin-bff 直抛 `BadGatewayException`）。 */
  (v) => upstreamContractViolation(v.code, v.message, v.field),
);
