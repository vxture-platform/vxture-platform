/**
 * can.ts — 能力判定,与 console-bff 守卫同一套规则(@vxture/core-utils):
 * 精确匹配,或 `.manage` 蕴含同资源的 `.read`。前端不得再自己写 includes。
 */
import {
  hasAnyCapability as hasAny,
  hasCapability as has,
} from "@vxture/core-utils";
import type { Capability } from "@/entities/console";

export function hasCapability(
  capabilities: readonly Capability[],
  target?: Capability | null,
): boolean {
  return has(capabilities, target);
}

/**
 * 命中 `targets` 中任一能力即返回 true；`targets` 为空/未提供视为不限制。
 * 用于功能域级（domain）的「拥有任一即放行整域」门控。
 */
export function hasAnyCapability(
  capabilities: readonly Capability[],
  targets?: readonly Capability[] | null,
): boolean {
  return hasAny(capabilities, targets);
}
