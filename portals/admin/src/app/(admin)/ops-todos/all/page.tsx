import { OpsTodosPage } from "@/modules/ops/OpsTodosPage";

/**
 * 全部任务（二级页，owner 2026-09-20：「全部任务做二级页面展示」）。
 *
 * 与 /ops-todos 同一个件，只换作用域：这一页四类齐全，风险复核只在这里出现。
 */
export default function AdminOpsTodosAllRoute() {
  return <OpsTodosPage scope="all" />;
}
