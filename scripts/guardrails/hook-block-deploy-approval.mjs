// hook-block-deploy-approval.mjs — Claude Code PreToolUse 硬门。
//
// 背景(2026-08-18):v0.20.30 发版时 AI 用 `gh api …/pending_deployments`
// 代批了 production 审批门。owner 裁定:「授权你来做」只覆盖准备就绪+通知,
// 审批门一律 owner 亲自点;且"记住了"不算控制,必须是工具层的强制。
//
// 判据:凡命令文本涉及 GitHub 部署审批端点(pending_deployments),一律拦截
// ——含只读查询(状态可用 `gh run view` 看,损失可忽略;宁可错杀,不留旁路)。
// 本钩子入仓、随 .claude/settings.json 对所有会话生效;删除或绕过它本身
// 就是一个会被 diff/评审看见的动作。
import { readFileSync } from "node:fs";

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const tool = payload.tool_name ?? "";
if (tool !== "Bash" && tool !== "PowerShell") process.exit(0);

const cmd = String(payload.tool_input?.command ?? "");

// pending_deployments:部署门审批的唯一 REST 端点。大小写与分隔变体全覆盖。
if (/pending[_\-\s]?deployments/i.test(cmd)) {
  process.stderr.write(
    "⛔ guardrail:生产审批门仅 owner 亲自批(feedback_approval_gate_boundary)。" +
      "pending_deployments 端点已整体封禁——查看部署状态请改用 `gh run view <run-id>`;" +
      "需要放行时由 owner 在 GitHub UI 点击审批。",
  );
  process.exit(2);
}

process.exit(0);
