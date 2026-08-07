/**
 * ToolCallCard.tsx - 工具调用结果展示卡片
 * @package @vxture/agent-studio-varda
 * @layer Presentation
 * @category Component
 *
 * @author AI-Generated
 * @date 2026-04-30
 */

import type { VardaToolMessage } from "../types/varda.types";
import { DataTable } from "@vxture/design-system";

// ============================================================================
// 子渲染：按 displayHint 选择展示形式
// ============================================================================

function renderData(data: unknown, hint?: string) {
  if (data === null || data === undefined) {
    // 工具正在运行
    return <span className="vx-varda-tool__disabled">运行中…</span>;
  }

  if (hint === "table" && Array.isArray(data)) {
    const rows = data as Record<string, unknown>[];
    if (!rows.length)
      return <span className="vx-varda-tool__muted">暂无数据</span>;
    const keys = Object.keys(rows[0]!);
    return (
      <DataTable
        className="vx-varda-tool__table-wrap"
        columns={keys.map((key) => ({
          id: key,
          header: key,
          cell: (row: Record<string, unknown>) => String(row[key] ?? ""),
        }))}
        rows={rows}
        rowKey={(_row, index) => String(index)}
      />
    );
  }

  if (hint === "list" && Array.isArray(data)) {
    return (
      <ul className="vx-varda-tool__list">
        {(data as unknown[]).map((item, i) => (
          <li key={i}>
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (hint === "text" && typeof data === "string") {
    return <p className="vx-varda-tool__text">{data}</p>;
  }

  // 默认：JSON 原始输出
  return (
    <pre className="vx-varda-tool__pre">{JSON.stringify(data, null, 2)}</pre>
  );
}

// ============================================================================
// 组件
// ============================================================================

interface Props {
  message: VardaToolMessage;
}

export function ToolCallCard({ message }: Props) {
  return (
    <div className="vx-varda-tool">
      <div className="vx-varda-tool__header">
        <span className="vx-varda-tool__label">工具</span>
        <code className="vx-varda-tool__code">{message.toolId}</code>
      </div>
      {renderData(message.data, message.displayHint)}
    </div>
  );
}
