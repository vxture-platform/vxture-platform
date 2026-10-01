/**
 * read-scope.types.ts — 共用仓储的读取作用域（A1：把「忘了传租户」变成类型错误）。
 * @package @vxture-platform/shared
 *
 * ── 补的是哪个盲区 ──
 * 共用列表仓储（账单 / 工单 / 评价 / 支付 …）被**客户面与运营面共用**，于是租户过滤
 * 写成了可选参数：
 *
 *     if (params.tenantId) { conditions.push(`tenant_id = $${idx++}`); }
 *
 * 运营面不传是对的（三平面按设计跨租户）；客户面忘了传，返回的就是**所有租户的行**，
 * 而且没有任何东西会响——SQL 合法、类型通过、测试通过、界面照常渲染，只是多了别人的数据。
 * 2026-10-01 实测：今天所有调用方都传对了，所以这是**潜在隐患不是现行缺陷**；这一层
 * 要做的就是让它永远不会变成缺陷。
 *
 * ── 为什么是类型而不是守卫 ──
 * 守卫只能在 lint 期报「这条 SQL 没谓词」，而谓词是运行时按参数拼的——静态扫不出
 * 「调用方有没有传」。把作用域变成**必填的判别联合**，漏了就编译不过，这是唯一不依赖
 * 「每次都记得检查」的办法。配套的守卫（check-read-scope.mjs）管另一半：还没迁的那些
 * 可选作用域方法，不许被客户面接上。
 *
 * ── 三档，以及为什么必须有第三档 ──
 * 归属轴**不只租户一根**：
 *   · `tenant`    —— 按租户过滤（客户面的常态）；
 *   · `workspace` —— 按工作空间过滤（用量、配额这类挂 workspace 的表）；
 *   · `platform`  —— 不加归属谓词。运营三平面、后台巡检作业、平台级通告都需要它。
 *
 * 第三档是**逃生口，而不是豁免**：抄门不抄逃生口，门就会变成墙（本仓教训）。它要求
 * 写一句 `why`，而且 `scopeCondition` 对空 `why` 抛错——空理由等于没声明。
 *
 * 注意：`platform` 不是「更高权限」，它只是「这次查询按设计不按归属过滤」。谁能发起
 * 这种查询由各自的门管（运营面的能力码、作业的进程边界），不由这个类型管。
 */

/** 这次读取代表谁。客户面必须是 tenant 或 workspace；platform 要写理由。 */
export type ReadScope =
  | { readonly kind: "tenant"; readonly tenantId: string }
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | {
      readonly kind: "platform";
      /** 为什么这次查询按设计不按归属过滤。空字符串会被 `scopeCondition` 拒绝。 */
      readonly why: string;
    };

/** `ReadScope` 的档位名，给守卫与日志用。 */
export type ReadScopeKind = ReadScope["kind"];
