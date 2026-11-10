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
const activity = {
  view: "favorites",
  items: products
    .slice(0, 5)
    .map((p, i) => ({
      code: p.code,
      favorite: i < 2,
      lastUsedAt:
        i < 3 ? new Date(Date.now() - i * 86400000).toISOString() : null,
      launches30d: i < 3 ? (i + 1) * 2 : 0,
    })),
};
const inboxMessages = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    title: "订阅即将到期",
    body: "标书编写订阅将于近期到期，请查看订阅详情。",
    link: "/subscription",
    readAt: null,
    createdAt: "2026-11-06T02:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    title: "工作空间已就绪",
    body: "团队可以继续处理业务。",
    link: "/inbox",
    readAt: "2026-11-05T02:00:00.000Z",
    createdAt: "2026-11-05T01:00:00.000Z",
  },
];
const fixtures = {
  "/auth/session": { status: "active" },
  "/api/me": {
    id: "qa-user",
    name: "林悦",
    email: "qa@example.invalid",
    phone: "+8613800138000",
  },
  "/api/tenant-context": {
    id: "qa-organization",
    name: "验收组织",
    workspace: "qa-default",
    workspaceName: "default workspace",
    tenantType: "organization",
  },
  "/api/tenant-context/options": [
    { id: "qa-organization", name: "验收组织", tenantType: "organization" },
    {
      id: "qa-other",
      name: "协作组织",
      tenantType: "organization",
      identifier: "T-QA-2",
      workspaces: [
        { id: "qa-other-default", name: "default workspace", isDefault: true },
      ],
    },
  ],
  "/api/iam/workspaces/mine": [
    { id: "qa-default", name: "default workspace", isDefault: true },
    { id: "qa-contract", name: "采购合同空间", isDefault: false },
  ],
  "/api/products/catalog": products.map((product, index) => ({
    productCode: product.code,
    productName: product.nick,
    productNick: product.name,
    productType: product.type,
    description: product.description,
    releaseVersion: index === 0 ? null : "1.2.0",
    releaseStage: "beta",
    status: "active",
    maintenance: null,
  })),
  "/api/subscription/subscribed-products": products
    .slice(0, 5)
    .map((product, index) => ({
      productCode: product.code,
      status: index === 3 ? "expired" : "active",
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
  "/api/subscription/monthly-bill": { balance: "88.50", currency: "CNY" },
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
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const path = requestUrl.pathname;
  const scenario = request.headers.cookie?.match(
    /(?:^|; )workbench_qa=([a-z]+)/,
  )?.[1];
  if (path.startsWith("/api/me/app-activity")) {
    if (scenario === "activityfailure") {
      response.writeHead(503);
      response.end();
      return;
    }
    const reply = (value) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    if (request.method === "POST") {
      if (
        request.headers.origin !==
          `http://127.0.0.1:${server.address().port}` ||
        request.headers["x-workbench-request"] !== "1"
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const input = JSON.parse(body);
        const [, code, action] =
          path.match(/app-activity\/([^/]+)(?:\/(.*))?$/) ?? [];
        if (code === "view") activity.view = input.view;
        const item = activity.items.find((entry) => entry.code === code);
        if (item && action === "favorite") item.favorite = input.favorite;
        if (item && action === "launch") {
          item.lastUsedAt = new Date().toISOString();
          item.launches30d++;
        }
        reply({ ok: true });
      });
      return;
    }
    reply(
      scenario === "activityempty"
        ? { view: "favorites", items: [] }
        : activity,
    );
    return;
  }
  if (path.startsWith("/api/me/inbox")) {
    if (scenario === "inboxfailure") {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: "WORKBENCH_UNAVAILABLE" }));
      return;
    }
    if (request.method === "POST") {
      if (
        request.headers.origin !==
          `http://127.0.0.1:${server.address().port}` ||
        request.headers["x-workbench-request"] !== "1"
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      for (const item of inboxMessages) {
        if (path.endsWith("read-all") || path.endsWith(`${item.id}/read`))
          item.readAt ??= new Date().toISOString();
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    const items = scenario === "inboxempty" ? [] : inboxMessages;
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        items,
        unreadCount: items.filter((item) => !item.readAt).length,
      }),
    );
    return;
  }
  if (path === "/auth/session" && scenario === "public") {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "signed-out" }));
    return;
  }
  if (
    (path === "/api/products/catalog" && scenario === "failure") ||
    ([
      "/api/subscription/quota-usage",
      "/api/subscription/credits",
      "/api/subscription/monthly-bill",
    ].includes(path) &&
      scenario === "unavailable") ||
    (path === "/api/subscription/subscribed-products" &&
      scenario === "subfailure")
  ) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "WORKBENCH_RESOURCE_UNAVAILABLE" }));
    return;
  }
  if (
    scenario === "long" &&
    ["/api/products/catalog", "/api/tenant-context"].includes(path)
  ) {
    const value =
      path === "/api/tenant-context"
        ? {
            ...fixtures[path],
            name: "远山产业集团工程技术与咨询服务有限公司",
            workspaceName: "大型客户定制业务工作空间",
          }
        : fixtures[path].map((product, index) =>
            index === 0
              ? {
                  ...product,
                  productName: "工业设备全生命周期巡检与风险研判智能体",
                  productNick: "Industrial Equipment Inspection Agent",
                  description:
                    "连接设备传感、巡检记录、维修工单和专家知识，识别设备异常趋势并建议处置动作。支持跨团队的持续协作与专业交付。",
                }
              : product,
          );
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Work-QA": "fixture",
    });
    response.end(JSON.stringify(value));
    return;
  }
  if (
    ["single", "empty"].includes(scenario) &&
    path === "/api/subscription/subscribed-products"
  ) {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify(fixtures[path].slice(0, scenario === "empty" ? 0 : 1)),
    );
    return;
  }
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
