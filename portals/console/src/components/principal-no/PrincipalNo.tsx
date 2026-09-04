"use client";

/**
 * PrincipalNo — 主体可视码的统一呈现:`ID: U-1799729056`。
 * @package @vxture/console
 * @layer Application
 * @category Component
 *
 * 三个主体码(用户 / 租户 / 工作空间)在界面上长一个样(owner 2026-09-05):
 * **标签恒为 `ID:`(中英一致)**,类别由号自己的字母前缀区分——U- 用户、
 * T- 租户、W- 工作空间(主体码 v4「三号解耦」,data_identity_200_schema §11)。
 *
 * 标签与前缀分工:标签告诉页面上的人「这是个标识」,前缀跟着号被复制进工单 /
 * 搜索框、离开页面后仍自明。所以两者都要,不互相替代。
 *
 * 号本身走等宽字体(数字对齐、易逐位核对);标签跟随上下文颜色。
 */

import { useTranslations } from "next-intl";
import { formatPrincipalNo, type PrincipalKind } from "@/lib/principal-no";

export function PrincipalNo({
  no,
  kind,
  fallback,
  className,
}: {
  readonly no: string | number | null | undefined;
  readonly kind: PrincipalKind;
  /** 无号时整块的替代文本;不给则整块不渲染。 */
  readonly fallback?: string;
  readonly className?: string;
}) {
  const tShared = useTranslations();
  const formatted = formatPrincipalNo(no, kind);

  if (!formatted) {
    return fallback ? <span className={className}>{fallback}</span> : null;
  }

  return (
    <span className={`inline-flex items-center gap-2xs ${className ?? ""}`}>
      <span>{tShared("principalNo.label")}</span>
      <span className="font-mono">{formatted}</span>
    </span>
  );
}
