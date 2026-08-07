/**
 * ConfirmActionDialog.tsx - 执行类工具二次确认对话框
 * @package @vxture/agent-studio-varda
 * @layer Presentation
 * @category Component
 *
 * @description
 *   当 SSE 流收到 confirm_required 事件时渲染本组件，展示操作摘要，
 *   让用户选择确认执行或取消。
 *   - 执行中：按钮禁用，显示「执行中…」
 *   - 执行成功：显示绿色成功提示，2 秒后自动关闭
 *   - 执行失败 / 网络错误：显示红色错误提示，手动关闭
 *
 * @author AI-Generated
 * @date 2026-05-02
 */

"use client";

import { Badge, Button } from "@vxture/design-system";
import { useVardaConfirm } from "../hooks/useVardaConfirm";

// ============================================================================
// 组件
// ============================================================================

export function ConfirmActionDialog() {
  const {
    pendingConfirm,
    isConfirming,
    confirmError,
    confirmResult,
    handleConfirm,
    dismiss,
  } = useVardaConfirm();

  if (!pendingConfirm) return null;

  // ---- 执行成功状态
  if (
    confirmResult &&
    confirmResult.success !== false &&
    !confirmResult.cancelled
  ) {
    return (
      <div className="vx-varda-confirm vx-varda-confirm--success">
        <div className="vx-varda-confirm__header vx-varda-confirm__header--compact">
          <span>✅</span>
          <span className="vx-varda-confirm__title">执行成功</span>
          <Badge variant="outline">{pendingConfirm.toolId}</Badge>
        </div>
        <p className="vx-varda-confirm__message">操作已完成，结果已记录。</p>
      </div>
    );
  }

  // ---- 错误状态
  if (confirmError) {
    return (
      <div className="vx-varda-confirm vx-varda-confirm--error">
        <div className="vx-varda-confirm__header">
          <span>❌</span>
          <span className="vx-varda-confirm__title">执行失败</span>
          <Badge variant="outline">{pendingConfirm.toolId}</Badge>
        </div>
        <p className="vx-varda-confirm__summary">{confirmError}</p>
        <div className="vx-varda-confirm__actions">
          <Button onClick={dismiss} variant="secondary" size="md">
            关闭
          </Button>
        </div>
      </div>
    );
  }

  // ---- 待确认状态
  return (
    <div className="vx-varda-confirm vx-varda-confirm--warning">
      <div className="vx-varda-confirm__header">
        <span>⚠️</span>
        <span className="vx-varda-confirm__title">需要确认</span>
        <Badge variant="outline">{pendingConfirm.toolId}</Badge>
      </div>
      <p className="vx-varda-confirm__summary">{pendingConfirm.summary}</p>
      <div className="vx-varda-confirm__actions">
        <Button
          onClick={() => void handleConfirm(false)}
          disabled={isConfirming}
          variant="secondary"
          size="sm"
        >
          取消
        </Button>
        <Button
          onClick={() => void handleConfirm(true)}
          disabled={isConfirming}
          size="sm"
        >
          {isConfirming ? "执行中…" : "确认执行"}
        </Button>
      </div>
    </div>
  );
}
