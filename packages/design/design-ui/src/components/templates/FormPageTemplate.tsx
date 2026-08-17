/**
 * FormPageTemplate.tsx - 整页表单骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Template
 *
 * 页头 → 表单区（children，建议每组字段一个 Section）→ 可选动作条（footer，
 * 放提交 / 取消）。字段本身是业务形状，模板一概不管——这里只保证任何表单页
 * 的行长、节奏与动作条位置长得一样。
 *
 * 表单区不限宽（2026-08-12 撤掉原先的 `max-w-content-narrow-lg`）：与
 * `ListPageTemplate`（同样套 `ViewLayout`，不设 maxWidth，宽度交给外壳）
 * 满宽一致是明确要求的——原先"限宽利于阅读"的理由没错，但代价是同一个应用
 * 里表单页和列表页在同一侧栏下露出两种内容宽度，读者会当成两套系统。字段
 * 本身该多宽由调用方通过 grid/flex 自己控制（如 `products` 表单里的
 * `grid-cols-2`），不再由模板兜底限死。
 *
 * 动作条与表单区之间是虚线上边框（hairline.field）：060 的线型语义——实线开
 * 区块，虚线分行 / 分字段；动作条属于表单的收束行，不是新板块。
 *
 * `sticky` 打开时动作条粘底：长表单滚到哪里都能提交。底色补 `bg-background`
 * ——透明模式下页面唯一实色底就是它，粘底条延续页面底色而非引入新表面；
 * 不补则滚过的字段会从虚线下面透出来叠在按钮上。
 *
 * 响应式：动作条 flex-wrap，窄屏按钮多时折行。
 */

import * as React from "react";
import { cn } from "../../utils/cn";
import { hairline } from "../../styles/recipes";
import { ViewLayout } from "../layout/ViewLayout";

export interface FormPageTemplateProps {
  /** 页头槽，通常是 ViewHeader。 */
  readonly header?: React.ReactNode;
  /** 表单区，建议每组字段一个 Section。 */
  readonly children: React.ReactNode;
  /** 动作条槽：提交 / 取消一类的按钮。 */
  readonly footer?: React.ReactNode;
  /** 动作条粘底，长表单用。 */
  readonly sticky?: boolean;
  readonly className?: string;
}

export function FormPageTemplate({
  header,
  children,
  footer,
  sticky = false,
  className,
}: FormPageTemplateProps) {
  return (
    <ViewLayout {...(className !== undefined ? { className } : {})}>
      {header}
      <div className="flex w-full flex-col gap-xl">
        {children}
        {footer ? (
          <div
            className={cn(
              "flex flex-wrap items-center justify-end gap-sm border-t pt-lg",
              hairline.field,
              sticky && "sticky bottom-0 bg-background pb-lg",
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </ViewLayout>
  );
}
