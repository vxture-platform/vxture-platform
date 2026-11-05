/**
 * Loopback-only browser acceptance harness; never a production data source.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import next from "next";

if (process.env.WORKBENCH_QA !== "1")
  throw new Error("Set WORKBENCH_QA=1 to run the isolated acceptance harness");
process.env.WORKBENCH_SAME_ORIGIN_BFF = "1";
process.env.WORKBENCH_SAME_ORIGIN_CATALOG = "1";

// ============================================================================
// Explicit test fixtures matching existing HTTP contracts
// ============================================================================
const products = [
  {
    code: "tender",
    name: "TenderForge",
    nick: "标书编写",
    type: "industry_agent",
    description: "从招标要求到投标正文，让每一项响应都有依据",
  },
  {
    code: "solution",
    name: "SolutionCraft",
    nick: "方案编制",
    type: "industry_agent",
    description: "汇集项目经验，让技术方案更清晰、更完整",
  },
  {
    code: "review",
    name: "ReviewFlow",
    nick: "智能审查",
    type: "industry_agent",
    description: "识别关键要求与潜在遗漏，为交付多一重把关",
  },
  {
    code: "contract",
    name: "ContractWise",
    nick: "合同助手",
    type: "industry_agent",
    description: "梳理业务条款，辅助专业判断",
  },
  {
    code: "knowledge",
    name: "KnowledgeHub",
    nick: "知识空间",
    type: "general_platform",
    description: "让团队积累成为随时可用的专业知识",
  },
  {
    code: "data",
    name: "DataSpace",
    nick: "数据空间",
    type: "general_platform",
    description: "将业务数据连接到日常工作",
  },
];
const fixtures = {
  "/auth/session": { status: "active" },
  "/api/me": { id: "qa-user", name: "林悦", email: "qa@example.invalid" },
  "/api/tenant-context": {
    id: "qa-organization",
    name: "验收组织",
    workspace: "qa-default",
    workspaceName: "default workspace",
    tenantType: "organization",
  },
  "/api/tenant-context/options": [
    { id: "qa-organization", name: "验收组织", tenantType: "organization" },
    { id: "qa-other", name: "协作组织", tenantType: "organization" },
  ],
  "/api/iam/workspaces/mine": [
    { id: "qa-default", name: "default workspace", isDefault: true },
    { id: "qa-contract", name: "采购合同空间", isDefault: false },
  ],
  "/api/products/catalog": products.map((product) => ({
    productCode: product.code,
    productName: product.name,
    productNick: product.nick,
    productType: product.type,
    description: product.description,
    releaseVersion: "1.0.0",
    releaseStage: "beta",
    status: "active",
    maintenance: null,
  })),
  "/api/subscription/subscribed-products": products
    .slice(0, 3)
    .map((product) => ({
      productCode: product.code,
      status: "active",
      tier: "团队版",
      maintenance: null,
    })),
  "/api/me/apps": products.map((product) => ({
    code: product.code,
    homeUrl: `https://${product.code}.example.invalid/`,
  })),
  "/api/subscription/quota-usage": {
    aiCredit: { used: 300, limit: 1000 },
    storage: { used: 300 * 1024 ** 2, limit: 1000 * 1024 ** 2 },
  },
  "/api/subscription/credits": { balance: "200.00", currency: "CNY" },
};

// ============================================================================
// Serve the actual production bundle with isolated, same-origin fixture routes
// ============================================================================
const app = next({
  dev: false,
  dir: fileURLToPath(new URL("../", import.meta.url)),
});
await app.prepare();
const handle = app.getRequestHandler();
const server = http.createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path in fixtures) {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Work-QA": "fixture",
    });
    response.end(JSON.stringify(fixtures[path]));
    return;
  }
  if (path.startsWith("/auth/")) {
    response.writeHead(400);
    response.end("Authentication transitions are not emulated by this harness");
    return;
  }
  void handle(request, response);
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object")
    console.log(
      JSON.stringify({
        url: `http://127.0.0.1:${address.port}`,
        mode: "fixture-acceptance",
        pid: process.pid,
      }),
    );
});
process.on("SIGINT", () => {
  server.close();
  void app.close().then(() => process.exit(0));
});
