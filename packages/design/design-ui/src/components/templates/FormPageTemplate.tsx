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
 * 表单区限宽 `max-w-content-narrow-lg`（64rem，T2 的单栏阅读宽）：输入行拉满
 * 宽屏时，label 与输入框的往返视线距离会超过可读行长；动作条同宽，提交按钮
 * 始终落在表单的右缘而不是屏幕的右缘。
 *
 * 动作条与表单区之间是虚线上边框（hairline.field）：060 的线型语义——实线开
 * 区块，虚线分行 / 分字段；动作条属于表单的收束行，不是新板块。
 *
 * `sticky` 打开时动作条粘底：长表单滚到哪里都能提交。底色补 `bg-background`
 * ——透明模式下页面唯一实色底就是它，粘底条延续页面底色而非引入新表面；
 * 不补则滚过的字段会从虚线下面透出来叠在按钮上。
 *
 * 响应式：动作条 flex-wrap，窄屏按钮多时折行；限宽列在窄屏自然吃满可用宽。
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
      <div className="flex w-full max-w-content-narrow-lg flex-col gap-xl">
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
