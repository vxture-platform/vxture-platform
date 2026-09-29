/**
 * visibility.ts —— 工单流水「给谁看」的值域在**工单域这一侧**的门面。
 *
 * ── 这里为什么只是转出，定义在 `@vxture-platform/shared` ──
 * 契约要求「可见类型只有一份、客户面每一处读取都 import 它」。那就要求这份值域
 * 必须被 BFF import 得到。本包（`@vxture/service-ticket`）**import 不到**：
 *
 *   · 它是登记在册的孤儿包，零 BFF 在 `package.json` 里依赖它
 *     （名单见 scripts/guardrails/check-orphan-service-packages.mjs）。
 *   · `tsconfig.base.json` 有 `paths` 映射，所以 `tsc --noEmit` 会**通过**，
 *     esbuild 也会（打包时带 `--tsconfig`）。**但 vitest 不读 tsconfig paths**：
 *     2026-09-29 在 admin-bff 实测，
 *     `Cannot find package '@vxture/service-ticket' imported from …`。
 *   · 补一条依赖就得动 `package.json` 与 lockfile，那是另一次裁定（TD-049），
 *     不是这一批该顺手做的。
 *
 * 「类型检查绿、打包绿、跑起来红」正是最难发现的那一档。所以定义放在两个 BFF
 * 与五个门户**今天都已经依赖**的 `@vxture-platform/shared`，而且它本来就是工单
 * 另外两个值域（`TICKET_STATUSES` / `TICKET_PRIORITIES`）的家——工单的第三个
 * 值域放在它们旁边，而不是另起一处。
 *
 * 这个文件留着，是为了**按契约来找的人在工单域里找得到**，且找到的是同一份值
 * （转出，不是抄一遍）。真要读，从 `@vxture-platform/shared` 读更近。
 *
 * ⚠️ 别在这里改成字面量数组：那就是契约里禁掉的「第二份清单」，
 * `lint:ticket-visibility` 会当场报红。
 */
export {
  CUSTOMER_VISIBLE_TICKET_EVENT_TYPES,
  TICKET_EVENT_INTERNAL_NOTE,
  TICKET_EVENT_REPLY,
} from "@vxture-platform/shared";
export type { CustomerVisibleTicketEventType } from "@vxture-platform/shared";
