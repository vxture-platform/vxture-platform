/**
 * request-context.ts — arche-bff 请求上下文。
 * @package @vxture/bff-arche
 * @layer BFF
 *
 * 治理数据面只需要两样：**谁在操作**（审计的 actor_id、写路径的操作者校验）与
 * **他能做什么**（能力码）。本人信息由会话端点出。
 */

/** 能力码，与 admin.operator_role → operator_permission 的 perm_code 同域。 */
export type Capability = string;

/** 操作者主体：只保留数据面真正用得到的两项。 */
export interface OperatorPrincipal {
  /** admin.operator_account.id（UUID），审计 actor_id 与写路径 created_by/updated_by。 */
  id: string;
  /** 展示用，落审计日志时不使用。 */
  displayName: string | null;
  /**
   * 操作者角色的安全等级(admin.operator_role.rank;TD-017 分级模型)。RBAC 面用它
   * 做客户端可授予范围的预筛(只能授出 rank 严格低于自己的角色);后端各写口仍强制。
   */
  roleRank: number | null;
}

export interface RequestContext {
  operator?: OperatorPrincipal;
  capabilities?: Capability[];
}
