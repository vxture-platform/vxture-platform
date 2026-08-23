/**
 * index.ts - Upstream contract assertion exports
 * @package @vxture-platform/shared
 * @description 上游响应契约断言的机制。词表留在各消费方仓内——那是"我方读哪些字段"，
 * 属于消费方的事实；只有**怎么查**是共用的。
 */

export { makeContractAssert } from "./upstream-contract";
export type {
  ContractTable,
  ContractViolation,
  PayloadShape,
  ResourceContract,
  ViolationFactory,
} from "./upstream-contract";
