/**
 * services.mjs - Dev Panel 的服务清单（唯一事实来源）。
 *
 * 从 server.mjs 拆出来，因为原先同一份 id 列表被抄了三遍——`SERVICES`、
 * `CARD_ORDER`、`START_ORDER`。三份手抄清单加一个服务要改三处，漏改哪一处都
 * **不报错**：漏在 START_ORDER 里的服务永远不会被全量启动拉起，漏在 CARD_ORDER
 * 里的不会出现在面板上，而两种情况看起来都像"这个服务坏了"。现在展示顺序与
 * 启动顺序都从本数组推导（数组顺序 + tier），加服务只改一处。
 *
 * ── 端口分配（2026-08-10 重排，本地=生产同一套数）────────────────────────────
 * 权威 = docs/40-implementation/ai/10-port-allocation.md +
 * docs/50-deployment/13-infra-allocation-registry.md §2。**5 个面**各占一段，
 * 段内 x0=UI、x1=BFF，段内余位归本面所有：
 *
 *   3000  website                 3001  website-bff     （3000-3019，留白给行业门户）
 *   3020  console                 3021  console-bff     （3020-3029）
 *   3030  admin                   3031  admin-bff       （3030-3039）
 *   3040  opera                   3041  opera-bff       （3040-3049）
 *   3080  accounts（登录 UI）      3081  auth-bff（IdP 后端，同一张脸的两半）
 *   3050-3079  留白（未来新面）
 *   3090  varda-bff               3091  varda-server    3092  varda-studio（仅本地）
 *   3100  atlas（外部仓库，本面板不启；L1 段 3100-3199）
 *
 * 边缘带 80xx（不占应用段）：8000 gateway-bff（公网边缘）、8080 platform-api
 * （S2S tailnet 边缘）。auth-bff 的 tailnet 暴露口也在这带（生产 8081 → 容器 3081）。
 *
 * 本地端口 = 代码内默认端口 = 生产容器内口，三者从此是同一套数；下面的 `env`
 * 仍显式写出，是为了让面板启的进程不依赖 .env.local 是否正确。
 *
 * ── 门户 → BFF 的本地同源代理 ───────────────────────────────────────────────
 * 每个门户用**自己的**变量名（`<PORTAL>_BFF_DEV_URL`），不共用一个。
 * 曾经 console / website / admin 共用 `LOCAL_BFF_PROXY_URL`，而它写在仓库根的
 * .env.local 里、值是 console-bff(3021)、并由本面板注入每个子进程；Next 的优先级
 * 是「进程环境变量 > 门户目录下的 .env.local」，所以 admin 想在自己目录里覆盖
 * 同名变量是覆盖不掉的。结果 admin 的 OIDC 登录被静默转发到 console-bff，拿回
 * 一个 `client_id=console` 的 authorize URL——登录永远走不通，且任何一层都不报错
 * （2026-08-04 实测，排查花了很久）。同名共享变量在这里就是个陷阱。
 */

/**
 * @typedef {{label:string,kind?:'http'|'tcp',url?:string,port?:number,okStatuses?:number[]}} HealthCheck
 * @typedef {{id:string,name:string,port:number,url:string,command:string,priority:number,env?:Record<string,string>,healthChecks:HealthCheck[]}} Service
 */

/**
 * 本地 RP 会话 cookie 必须走**裸名**（`vx_rp_session`），不能用生产的
 * `__Host-vx_rp_session`。
 *
 * `__Host-` 前缀的 cookie 只被安全来源接受；本地是明文 http，浏览器会直接把它
 * 丢掉。表现极具迷惑性：**服务端登录是成功的**——换票完成、redis 里建了会话、
 * `admin.operator_account.last_login_at` 也更新了——但浏览器一个 cookie 都没存下，
 * 于是下一个请求仍是未登录，用户被弹回登录页，再登再弹。
 * （2026-08-04 实测：superadmin 连登 5 次，redis 里攒了 5 个 admin RP 会话，
 * 而浏览器 `/auth/session` 始终 401。）
 *
 * 四个 RP BFF 的 oidc-rp.module.ts 都是 `cookieSecure: RP_COOKIE_INSECURE !== "true"`，
 * 代码注释也写明了本地该用裸名——只是这个开关此前没人在本地设过。
 */
const RP_LOCAL_COOKIE = { RP_COOKIE_INSECURE: "true" };

/** auth-bff（IdP）自己的中心会话 cookie 同款开关，见 authn/cookie.ts。 */
const IDP_LOCAL_COOKIE = { IDP_COOKIE_INSECURE: "true" };

const AUTH_BFF = "http://localhost:3081";
const ATLAS_API = "http://localhost:3100";
const PLATFORM_API = "http://localhost:8080";

/** GET /healthz 存活探针（standards 020 + 025），所有 Nest BFF 都有。 */
const healthz = (port) => ({
  label: "healthz",
  url: `http://localhost:${port}/healthz`,
  okStatuses: [200],
});

/** 未登录时应当 401 —— 证明路由挂上了且鉴权中间件在跑，而不只是端口开着。 */
const unauthorized = (label, url) => ({ label, url, okStatuses: [401] });

/** 门户是 Next，没有统一健康端点，只探端口。 */
const listening = (port) => ({ label: "port", kind: "tcp", port });

/**
 * tier 决定启动批次：0 = 后端服务，1 = 网关（依赖 0），2 = 门户（依赖 0/1）。
 * 同一 tier 内按数组顺序启动。
 */
export const SERVICES = [
  // ── tier 0：后端 ──────────────────────────────────────────────────────────
  {
    id: "auth-bff",
    name: "Auth BFF",
    port: 3081,
    priority: 0,
    url: AUTH_BFF,
    command: "pnpm --filter @vxture/bff-auth dev",
    env: { AUTH_BFF_PORT: "3081", ...IDP_LOCAL_COOKIE },
    healthChecks: [healthz(3081)],
  },
  {
    id: "platform-api",
    name: "Platform API",
    port: 8080,
    priority: 0,
    url: PLATFORM_API,
    command: "pnpm --filter @vxture/bff-platform-api dev",
    // 承接 product_310 D13 拆分出来的商务后台作业（开通派发、共享/试用到期扫描），
    // 并向 console-bff 提供权益解析。缺它时 console 的配额会 fail-closed 降级。
    env: { PLATFORM_API_PORT: "8080" },
    healthChecks: [healthz(8080)],
  },
  {
    id: "website-bff",
    name: "Website BFF",
    port: 3001,
    priority: 0,
    url: "http://localhost:3001",
    command: "pnpm --filter @vxture/bff-website dev",
    env: { WEBSITE_BFF_PORT: "3001", AUTH_BFF_URL: AUTH_BFF, ...RP_LOCAL_COOKIE },
    healthChecks: [
      healthz(3001),
      unauthorized("api.me", "http://localhost:3001/api/me"),
    ],
  },
  {
    id: "console-bff",
    name: "Console BFF",
    port: 3021,
    priority: 0,
    url: "http://localhost:3021",
    command: "pnpm --filter @vxture/bff-console dev",
    env: {
      ...RP_LOCAL_COOKIE,
      CONSOLE_BFF_PORT: "3021",
      AUTH_BFF_URL: AUTH_BFF,
      ATLAS_API_URL: ATLAS_API,
      PLATFORM_API_URL: PLATFORM_API,
    },
    healthChecks: [
      healthz(3021),
      unauthorized("auth.session", "http://localhost:3021/api/auth/session"),
    ],
  },
  {
    id: "admin-bff",
    name: "Admin BFF",
    port: 3031,
    priority: 0,
    url: "http://localhost:3031",
    command: "pnpm --filter @vxture/bff-admin dev",
    env: {
      ...RP_LOCAL_COOKIE,
      ADMIN_BFF_PORT: "3031",
      AUTH_BFF_URL: AUTH_BFF,
      ATLAS_API_URL: ATLAS_API,
    },
    healthChecks: [
      healthz(3031),
      unauthorized("auth.session", "http://localhost:3031/api/auth/session"),
      unauthorized(
        "model-platform",
        "http://localhost:3031/api/model-platform/models",
      ),
    ],
  },
  {
    id: "opera-bff",
    name: "Opera BFF",
    port: 3041,
    priority: 0,
    url: "http://localhost:3041",
    command: "pnpm --filter @vxture/bff-opera dev",
    env: {
      ...RP_LOCAL_COOKIE,
      OPERA_BFF_PORT: "3041",
      AUTH_BFF_URL: AUTH_BFF,
      ATLAS_API_URL: ATLAS_API,
    },
    healthChecks: [
      healthz(3041),
      unauthorized("auth.session", "http://localhost:3041/auth/session"),
    ],
  },
  {
    id: "varda-server",
    name: "Varda Server",
    port: 3091,
    priority: 0,
    url: "http://localhost:3091",
    command: "pnpm --filter @vxture/agent-server-varda dev",
    env: {
      VARDA_SERVER_PORT: "3091",
      ATLAS_API_URL: ATLAS_API,
      VARDA_PLATFORM_LLM_TENANT_ID: "82cf3e39-f7f0-4597-bb55-b1303ca19d46",
      VARDA_DEFAULT_MODEL_CODE: "doubao-seed-2-0-lite-260215",
    },
    healthChecks: [listening(3091)],
  },
  {
    id: "varda-bff",
    name: "Varda BFF",
    port: 3090,
    priority: 0,
    url: "http://localhost:3090",
    command: "pnpm --filter @vxture/bff-varda dev",
    env: {
      VARDA_BFF_PORT: "3090",
      VARDA_SERVER_INTERNAL_URL: "http://localhost:3091",
    },
    healthChecks: [
      { label: "health", url: "http://localhost:3090/health", okStatuses: [200] },
    ],
  },

  // ── tier 1：网关 ──────────────────────────────────────────────────────────
  {
    id: "gateway",
    name: "Gateway BFF",
    port: 8000,
    priority: 1,
    url: "http://localhost:8000",
    command: "pnpm dev:gateway",
    env: {
      GATEWAY_PORT: "8000",
      WEBSITE_BFF_ORIGIN: "http://localhost:3001",
      CONSOLE_BFF_ORIGIN: "http://localhost:3021",
      ADMIN_BFF_ORIGIN: "http://localhost:3031",
      AUTH_BFF_ORIGIN: AUTH_BFF,
    },
    healthChecks: [
      healthz(8000),
      unauthorized("website-api", "http://localhost:8000/website-api/api/me"),
      unauthorized(
        "console-api",
        "http://localhost:8000/console-api/api/auth/session",
      ),
      unauthorized(
        "admin-api",
        "http://localhost:8000/admin-api/api/auth/session",
      ),
      {
        label: "auth-api",
        url: "http://localhost:8000/auth-api/healthz",
        okStatuses: [200],
      },
    ],
  },

  // ── tier 2：门户 ──────────────────────────────────────────────────────────
  {
    /* accounts 排在门户第一位：它是 IdP 的登录 UI，其余四个门户的登录都会跳到
     * 它这里。缺它时表现为登录页 ERR_CONNECTION_REFUSED，而报错发生在别的门户
     * 的地址栏上，很难联想到是这个服务没起。 */
    id: "accounts",
    name: "Accounts",
    port: 3080,
    priority: 2,
    url: "http://localhost:3080",
    command: "pnpm --filter @vxture/accounts dev",
    env: {
      NEXT_PUBLIC_OIDC_API_BASE: AUTH_BFF,
      NEXT_PUBLIC_WEBSITE_URL: "http://localhost:3000",
    },
    healthChecks: [listening(3080)],
  },
  {
    id: "website",
    name: "Website",
    port: 3000,
    priority: 2,
    url: "http://localhost:3000",
    command: "pnpm --filter @vxture/website dev",
    env: { WEBSITE_BFF_DEV_URL: "http://localhost:3001" },
    healthChecks: [listening(3000)],
  },
  {
    id: "console",
    name: "Console",
    port: 3020,
    priority: 2,
    url: "http://localhost:3020",
    command: "pnpm --filter @vxture/console dev",
    env: { CONSOLE_BFF_DEV_URL: "http://localhost:3021" },
    healthChecks: [listening(3020)],
  },
  {
    id: "admin",
    name: "Admin",
    port: 3030,
    priority: 2,
    url: "http://localhost:3030",
    command: "pnpm --filter @vxture/admin dev",
    env: { ADMIN_BFF_DEV_URL: "http://localhost:3031" },
    healthChecks: [listening(3030)],
  },
  {
    id: "opera",
    name: "Opera",
    port: 3040,
    priority: 2,
    url: "http://localhost:3040",
    command: "pnpm --filter @vxture/opera dev",
    env: { OPERA_BFF_DEV_URL: "http://localhost:3041" },
    healthChecks: [listening(3040)],
  },
  {
    id: "varda-studio",
    name: "Varda Studio",
    port: 3092,
    priority: 2,
    url: "http://localhost:3092",
    command: "pnpm --filter @vxture/agent-studio-varda dev",
    healthChecks: [listening(3092)],
  },
];

/** 展示顺序 = 声明顺序。加服务只改上面的数组。 */
export const CARD_ORDER = SERVICES.map((s) => s.id);

/** 启动顺序 = 先按 tier 分批，批内按声明顺序。 */
export const START_ORDER = [...SERVICES]
  .map((s, i) => ({ s, i }))
  .sort((a, b) => a.s.priority - b.s.priority || a.i - b.i)
  .map(({ s }) => s.id);
