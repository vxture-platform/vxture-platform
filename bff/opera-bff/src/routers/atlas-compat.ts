/**
 * atlas-compat.ts — 把 atlas 的两代形状归一到一种（product_251 B-3 / X-3）。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * ## 为什么需要，以及为什么放在这一层
 *
 * atlas 的 M-B3（`isActive` 布尔 → `state` 枚举，[atlas#216](https://github.com/vxture/vxture-atlas/issues/216)）
 * 与 X-3（审计字段更名，#215）**已于 2026-08-17 部署完毕**，实测出站记录只带 `state`。
 *
 * 所以本层现在只剩**一个方向**：由 `state` 补出 `isActive`，供尚未完成语义迁移的页面读。
 * 它放在适配层的单一出口（`AtlasRouter.request()`），而不是让九个页面各写一遍
 * `r.state !== "inactive"`——页面只见一种形状，删除兼容时只删这一个文件。
 *
 * ## 删除条件（写在这里，不然它会永远留着）
 *
 * **第一步已完成（2026-08-17）**：「补 `state`」分支与 `normalizeAtlasAuditRow` 已删——
 * 实测 atlas 出站记录只有 `state`，审计查询侧还**拒收**旧参数名。
 *
 * **剩下这一步**：页面完成 `isActive` → `state` 的语义迁移后，「补 `isActive`」才能删。
 * 这一步不是改名——要逐处判断 `deprecated` 该算「在服务」还是「已停用」，见下。
 * 机械替换成 `state === "active"` 会让**已弃用但仍在服务的模型显示成「停用」**。
 */

/**
 * 下探的最大**对象**层数。atlas 的响应最深是 `{items:[{ models:[{…}] }]}` = 三层对象。
 *
 * **数组不计一层**——它是容器不是嵌套层级。最初把它算进去，`models[]` 里的行正好越界
 * 没被归一（单测抓到的）：那种漏归一在页面上表现为「这一列全是停用」，不报错。
 */
const MAX_DEPTH = 3;

/**
 * 由 `state` 就地补出 `isActive`，**只补不覆盖**。
 *
 * 映射按 atlas 自己的优先级（`deleted_at` > `is_active` > `deprecated_at`）：
 * 只有 `inactive` 才是「运营把它关了」，**`deprecated` 仍算开着**——它仍可解析、
 * 只是不再推荐，`is_active` 是 true。
 *
 * 所以 `isActive` 与 `state === "active"` **不等价**，这也正是页面迁移不能机械替换的
 * 原因：把 30 多处 `isActive` 换成 `state === "active"`，会让已弃用但仍在服务的模型
 * 显示成「停用」——一次静默的语义错，正是规范整组 B 要防的那类。
 */
export function normalizeAtlasState<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) normalizeAtlasState(item, depth);
    return value;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record["state"] === "string" &&
    typeof record["isActive"] !== "boolean"
  ) {
    // 补 isActive。`deprecated` 仍是「运营意图开着」，只有 inactive 才是关。
    record["isActive"] = record["state"] !== "inactive";
  }

  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child !== null && typeof child === "object") {
      normalizeAtlasState(child, depth + 1);
    }
  }
  return value;
}

/* `normalizeAtlasAuditRow` 已删（2026-08-17，atlas #215 部署后）。
   它做的是 `id`→`eventId`、`operatorSub`→`actorId`、`actorClientId`→`actorConsole`、
   `resourceType`→`objectType`、`resourceId`→`objectId` 的单向补名。实测部署后的 atlas
   直接发新名，且**查询侧已拒收旧名**（送 `operatorSub` 会被 400 并在 message 里点名），
   所以这一层已无输入可归一——留着只会让人以为旧名还在被支持。 */
