/**
 * request-context.ts — opera-bff 请求上下文。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 刻意比 admin-bff 的 `ConsoleUser` 小得多。admin 那个类型带着 roleLabel /
 * roleI18nKey / emailVerified / phone 一共十几个字段，是给 admin 自己的"当前用户"
 * 接口用的；opera 的数据面只需要两样：**谁在操作**（审计的 actor_id、写路径的
 * 操作者校验）与**他能做什么**（能力码）。照抄大类型会顺带把 admin 的展示需求
 * 拖进来，而 opera 的用户信息由它自己的会话端点出。
 */

/** 能力码，与 admin.operator_role → operator_permission 的 perm_code 同域。 */
export type Capability = string;

/** 操作者主体：只保留数据面真正用得到的两项。 */
export interface OperatorPrincipal {
  /** admin.operator_account.id（UUID），审计 actor_id 与写路径 created_by/updated_by。 */
  id: string;
  /** 展示用，落审计日志时不使用。 */
  displayName: string | null;
}

export interface RequestContext {
  operator?: OperatorPrincipal;
  capabilities?: Capability[];
  /**
   * 当前 RP 会话的 access token（未做任何本地校验，只作为 operator-OBO 换票的
   * subject_token）。AtlasRouter 一类需要代操作者向 provider 管理面亮明身份的
   * 路由用它换 aud=atlas 的短时令牌——同 admin-bff `ConsoleUser.operatorAccessToken`
   * 的用法，字段名保持一致，但两边类型各自独立定义，不共享导入。
   */
  operatorAccessToken?: string;
}
