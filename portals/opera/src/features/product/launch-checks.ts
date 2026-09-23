/**
 * 产品上线检查 —— 平台侧配置就绪度 + 对方留下的调用痕迹，全部实测。
 *
 * ── 七项检查**只读平台自己的存储** ───────────────────────────────────────────
 *
 * 每一项都是读平台自己已经拥有的状态：产品行、OIDC 客户端、两个域的授权、webhook
 * 登记，以及对方接通之后在平台这边留下的两条痕迹（权益拉取的「最近一次」键、
 * 用量事件的最近一行）。**没有任何一项会向对方的端点发请求。** 这是有意的，两个理由：
 *
 * 1. `docs/70-workplan/20-opera-ia-restructure.md` B4 的依赖写着「不新造探针」。
 * 2. 那份依赖同时写着「复用已有的 webhook test-delivery」。**这句注释此前写着「该能力
 *    全仓不存在」，是错的**——`db-init` 有 `test-delivery` action
 *    （`deploy/scripts/31-test-delivery.sh`），向 `webhook_deliveries` 插一条真实的
 *    `subscription_changed`，走平台现有的签名与派发路径。
 *
 *    但它**不适合放进这里**：发一次真实回调是对**对方生产端点**的外部动作，而本模块是
 *    点一下「复验」就跑的只读检查。所以这里仍然退回到读登记——配没配得出来，通没通不
 *    知道；要验通不通，去派发那个 action。
 *
 * 前五项回答「**我方**配齐了没有」。后三项（C2 / C3 / C1 出站）此前被写成「平台从外面
 * 观测不到」，那不对：对方只要真接通了，就会调 `GET /platform/entitlements`、
 * `POST /usage/consume`、`POST /oidc/token`，三件事都落在平台自己的存储里
 * （`GET /api/products/:id/integration-signals`）。它们归「对方」那一侧——通不通由对方
 * 决定——但判定由平台做，不再靠操作员按回报勾。
 * **2026-09-17 起七项全部机器判定，检查单上一项人工勾都不剩。** 最后转过来的两项:
 * `c1_identity` 判据换成**有人真的用平台账号登进了这个产品**（登录台账），
 * `acceptance` 判据是五段台账**落在同一个工作区**。`data_plane` 不是转自动而是**退役**
 * ——它要求产品自己库里的 schema 布局，那份模板平台明确登记为「非平台标准、不是平台
 * 义务」，见 `migrations/2026-10-09-checklist-data-plane-retire.sql`。
 *
 * ── 检查结果写不写回检查单 ───────────────────────────────────────────────────
 *
 * 写，**七项全写**（`catalog_registered`、`c1_identity`、`c1_s2s`、`c2_entitlement`、
 * `c3_metering`、`acceptance`）。`product_launch_statuses.checked_by` 的 DDL 注释本来就写着
 * 「自动校验为 NULL」，这张表从一开始就预留了自动结果的位置。
 *
 * C2 / C3 的判据是「最近一次」，不是台账：C2 键 30 天过期、只存最后一笔；C3 只看最近
 * 90 天内有没有事件。它回答「接通了没有」，不回答「调了多少次」；一个上线后 90 天
 * 没动静的产品复验会变红，那正是复验该做的事。
 *
 * 两个授权检查**不写**：检查单里没有对应的 item_code，硬塞进 `acceptance` 会把
 * 「端到端跑通了」这个结论替换成「授权配了」——后者远弱于前者，而勾上之后没人分得清
 * 当时勾的是哪个意思。它们作为就绪度信息呈现——`acceptance` 自 2026-09-17 起由
 * 端到端链路痕迹机器判定，不再需要有人替它拿主意。
 *
 * `c1_identity` **2026-09-17 起也写**。旧理由是「定义里有一半是对方的 RP 实现，平台只
 * 测得到我方注册了客户端」——那个论证没错，错在**找错了判据**:平台确实看不到对方写没写
 * 回调处理，但看得到**有人真的用平台账号登进了这个产品**（`session.refresh_tokens` 里
 * 带该产品客户端的最近一行）。登录流程没接通，那一行不会出现——它与被测的事互为充要，
 * 不是「观测到一个数就当它通过」。判据仍是那一句:**全部内容被本次实测覆盖才写回**。
 *
 * 同一条判据下，`c1_s2s`（出站换票）**写**：换票发生在平台上、平台是签发方，
 * `support.audit_logs` 里那条 `oidc.token_exchange.issued` 覆盖了这一项的全部内容。
 * 入站与出站因此一个不写、一个写——差别不在通道，在平台看不看得全。
 */

import { isEnabled } from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";
import { formatDateTime } from "@vxture-platform/shared";

export type CheckStatus = "pass" | "fail" | "skipped";

/** 谁能让这一项通过。「对方」的项本页测不了，只会出现在检查单上。 */
export type CheckSide = "ours" | "theirs";

/**
 * 这一条在回答哪个问题。**一次实测，两屏各取各的。**
 *
 *   launch  上线门：还差哪几件才能上线 —— 结论是「通过 / 未通过」
 *   health  运行健康：跑起来之后最近还正常吗 —— 结论是三态，**没有「未通过」**
 *
 * 分开不是为了排版。混在一屏时，一个刚上线、还没有客户的产品会看到一排红色的
 * 「未通过」——而那些红的其实只是「还没有人用过」。**把「没人用」画成「坏了」，
 * 运营的第一反应是去修一个根本没坏的东西。**
 */
export type CheckScope = "launch" | "health";

export interface CheckResult {
  id: string;
  label: string;
  /** 缺省按 `launch`：新加的检查默认卡上线门，与加这根轴之前一致。 */
  scope?: CheckScope;
  /** 这一项在测什么，一句话。 */
  what: string;
  side: CheckSide;
  status: CheckStatus;
  /** 通过时的事实、失败时的原因——都要具体，不要「检查失败」。 */
  detail: string;
  /** 失败时该做什么；通过时为 null。 */
  remedy: string | null;
  /** 对应的接入检查项，有则把结果写回去。 */
  itemCode?: string;
  /**
   * 只报事实，**不参与「全部通过」的判定**。
   *
   * 给本期新加的次要约定用（开通回执）:在产产品一个都还没实现它，让它参与判定
   * 等于用一次平台升级把所有产品的上线按钮推回「带理由跳过」那条路——而那正是
   * 2026-09-17 刚放宽掉的东西。加一项检查却让它一票否决，是这类新增最容易造的坑。
   */
  advisory?: boolean;
  /**
   * 去哪儿修。
   *
   * 以 `#` 开头的是**产品页内**的去处（`#section-basic` / `#section-login` /
   * `#section-edge` 是板块，`#secrets` 是密钥面板）：检查结果在产品页的抽屉里显示，
   * 点它是就地滚过去或打开面板，不跳转——跳转会丢掉页面上没保存的改动。
   * 其它值是别的页面，抽屉里以新标签页打开。
   */
  href?: string;
}

interface ProductLike {
  id: string;
  productCode: string;
  origin: string;
  originProvider: string | null;
}

interface OidcClientLite {
  clientId: string;
  state: string;
  redirectUris: string[];
}

interface AtlasGrantLite {
  endpointCode: string;
  state: string;
  expiresAt: string | null;
}

interface RunosGrantLite {
  capabilityId: string;
  state: string;
}

interface WebhookLite {
  webhookUrl: string | null;
  webhookSecretRef: string | null;
  /** 加密落库的签名密钥在不在。密钥本体永不回传。 */
  hasWebhookSecret?: boolean;
}

/**
 * 通则 §C3 下发 规定的回调路径。所有产品同一个，变的只有域名。
 *
 * **这里重写一遍字面量是有意的。** 登记侧（`product-catalog.router.ts` 的
 * `assertStandardWebhookPath`）从今往后当场拒收非标准路径，所以新登记的行不可能违规；
 * 这一项要判的恰恰是**闸门补上之前**已经进库的那些行，它们绕过了那个函数。
 * 让这里去 import 登记侧的常量，只会让两边一起改、一起错——而这一项存在的理由
 * 就是替那些没经过登记侧校验的值兜底。
 */
const STANDARD_WEBHOOK_PATH = "/api/webhooks/vxture";

/** 取 URL 的 path；取不出来（空值、不是绝对 URL）返回 null，由调用处当作不合格。 */
function pathOf(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (raw === "") return null;
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}

/** `GET /api/products/:id/integration-signals` 的形状（opera-bff 定义）。 */
interface IntegrationSignalsLite {
  /**
   * 登录：`acceptance` 链的首段。台账在 `session.refresh_tokens`（每次成功的 OIDC
   * 登录无条件落一行、带 client_id），按 product_id 聚合客户端反查。
   * 形状与 opera-bff 的 `LoginSignal` 一致——两边不互相引类型，靠单测钉住。
   */
  login: { lastLoginAt: string; clientId: string } | null;
  entitlement: {
    lastSeenAt: string;
    via: string;
    workspaceId: string | null;
  } | null;
  consume: { lastEventAt: string; metricKey: string } | null;
  /** C1 出站。形状与 opera-bff 的 `S2sSignal` 一致——两边不互相引类型，靠单测钉住。 */
  s2s: { lastSeenAt: string; target: string; mode: string } | null;
  /**
   * 开通：`status='provisioned'` 的最近一行。
   *
   * **它回答的是「平台已下令」，不是「产品已就绪」**——`enqueue` 的 upsert 入队当场
   * 就把 status 写成 provisioned，DDL 上那个 `pending` 默认值在代码里从来不经过。
   * 产品那边到底建没建起空间，看下面的 `provisionAck`。
   */
  provision: { lastProvisionedAt: string; workspaceId: string } | null;
  /** 开通回执：产品经 `POST /provisioning/ack` 自己报回来的「我建好了」。 */
  provisionAck: {
    ackedAt: string;
    status: string;
    workspaceId: string;
  } | null;
  /** 回调投递：`status='delivered'` 的最近一行（判据是 status，不是空着没人写的 delivered_at）。 */
  delivery: {
    eventType: string;
    workspaceId: string;
    responseCode: number | null;
    lastAttemptAt: string | null;
  } | null;
}

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError ? error.message : fallback;
}

/** 时间戳上屏：与页面上「最近一次」的格式一致，不给人看 ISO 串。 */
function formatAt(iso: string, locale: string | undefined): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : formatDateTime(at, locale);
}

/** 凭据的人话。`via` 来自 platform-api，词表就两个；其它值原样带出以免藏错。 */
function describeVia(via: string): string {
  if (via === "s2s") return "S2S 令牌";
  if (via === "internal-auth") return "内部共享令牌";
  return via;
}

/**
 * 跑一遍上线检查。
 *
 * 五次读取**并发**发出：它们互不依赖，串行只是把来回排成一队。任何一项自身抛错
 * （上游 500、鉴权失败）都记成 `fail` 并把原文带出来——**不记成通过**。读不到不等于
 * 没问题，这一点与目录页上线门槛的失败方向一致。
 *
 * @param product - 目录行
 * @param opts.locale - 时间戳上屏用的区域；不给则随浏览器
 */
export async function runLaunchChecks(
  product: ProductLike,
  opts: { locale?: string } = {},
): Promise<CheckResult[]> {
  const [clients, atlasGrants, runosGrants, webhook, signals] =
    await Promise.all([
      api
        .get<
          OidcClientLite[]
        >(`/api/oidc-clients?productId=${encodeURIComponent(product.id)}`)
        .catch((e: unknown) => e as Error),
      api
        .get<
          AtlasGrantLite[]
        >(`/api/atlas/product-grants?includeInactive=true&productCode=${encodeURIComponent(product.productCode)}`)
        .catch((e: unknown) => e as Error),
      api
        .get<
          RunosGrantLite[]
        >(`/api/runos/grants/product/${encodeURIComponent(product.productCode)}`)
        .catch((e: unknown) => e as Error),
      api
        .get<WebhookLite | null>(`/api/products/${product.id}/webhook`)
        .catch((e: unknown) => e as Error),
      api
        .get<IntegrationSignalsLite>(
          `/api/products/${product.id}/integration-signals`,
        )
        .catch((e: unknown) => e as Error),
    ]);

  const results: CheckResult[] = [];

  /* ① 产品登记 —— 纯本地判定，不打任何接口。third_party 缺 originProvider 时
        DB CHECK 其实会挡住写入，但目录里可能有更早写进去的历史行。 */
  const registrationOk =
    product.origin !== "third_party" || !!product.originProvider?.trim();
  results.push({
    id: "catalog",
    label: "产品登记",
    what: "产品码已存在，来源信息完整——它是后面每一项的前提（授权按产品码配，令牌的 act.sub 就是它）。",
    side: "ours",
    status: registrationOk ? "pass" : "fail",
    detail: registrationOk
      ? `产品码 ${product.productCode}`
      : "来源标为第三方接入，但没填接入方名称。",
    remedy: registrationOk ? null : "在「基本信息」补上供应方。",
    itemCode: "catalog_registered",
    href: "#section-basic",
  });

  /* 登录台账要在 ② 用到，先安全取出来:`signals` 读取失败时它是 Error，
     那时 loggedIn 为 null，② 会落 fail——读不到不等于通过。 */
  const loggedIn = signals instanceof Error ? null : signals.login;

  /* ② 身份接入 —— 两半都测:我方 client 注册了、启用着、有回调地址;
   **并且真的有人用平台账号登进去过**（后半句蕴含对方的 RP 实现完成）。 */
  if (clients instanceof Error) {
    results.push({
      id: "client",
      label: "登录接入",
      what: "产品有一个启用中的 OIDC 客户端，且配了回调地址。",
      side: "ours",
      status: "fail",
      detail: reason(clients, "读取 OIDC 客户端失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
      href: "#section-login",
    });
  } else {
    const active = clients.filter((c) => c.state === "active");
    const withRedirect = active.filter((c) => c.redirectUris.length > 0);
    const ok = withRedirect.length > 0;
    results.push({
      id: "client",
      label: "登录接入",
      what: "产品有一个启用中的 OIDC 客户端、配了回调地址，并且真的有人用平台账号登进去过。要害是后半句：登录台账里有行，才说明对方的登录、回调与会话确实实现了——客户端配好而没人登得进来，这一项不算通过。",
      side: "theirs",
      status: ok && loggedIn ? "pass" : "fail",
      detail: !ok
        ? active.length === 0
          ? clients.length === 0
            ? "这个产品下没有任何 OIDC 客户端。"
            : `有 ${clients.length} 个客户端但全部处于禁用状态。`
          : "客户端启用着，但没有配任何回调地址——换票流程走不完。"
        : loggedIn
          ? `${withRedirect.length} 个启用中的客户端；最近一次登录 ${formatAt(loggedIn.lastLoginAt, opts.locale)}，经 ${loggedIn.clientId}`
          : `${withRedirect.length} 个启用中的客户端已就绪，但从来没有人登进去过：对方的登录、回调与会话还没接通，或者还没人试过。`,
      remedy:
        ok && loggedIn
          ? null
          : !ok
            ? "在「登录接入」添加或启用一个客户端，并补上登录回调地址。"
            : "把 client_id 与回调地址交给对方；对方实现登录后，用平台账号真登一次，再重跑。",
      /* 写回 `c1_identity`（2026-09-17 起）。那一项的定义是「OIDC 客户端已注册 **且对方
         已实现登录/回调/会话**」——两半现在都测得到:前半句读客户端登记，后半句读登录
         台账。**一行登录记录蕴含了后半句**，登录没接通它不会存在，所以这不是替对方声明
         完成，是实测到了完成的结果。侧仍归「对方」:红着的时候该去找对方，不是改平台配置。 */
      itemCode: "c1_identity",
      href: "#section-login",
    });
  }

  /* ③ 模型授权 —— 到期在**读时**判定，所以"启用中但已过期"要算失败：
        state 说它有效，网关那边不会放行。 */
  if (atlasGrants instanceof Error) {
    results.push({
      id: "atlas-grants",
      label: "模型授权",
      what: "产品至少持有一条生效中的模型路由。",
      side: "ours",
      status: "fail",
      detail: reason(atlasGrants, "读取模型授权失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
      href: `/model/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  } else {
    const now = Date.now();
    const live = atlasGrants.filter(
      (g) =>
        isEnabled(g.state) &&
        (!g.expiresAt || new Date(g.expiresAt).getTime() > now),
    );
    const expired = atlasGrants.filter(
      (g) =>
        isEnabled(g.state) &&
        g.expiresAt &&
        new Date(g.expiresAt).getTime() <= now,
    );
    results.push({
      id: "atlas-grants",
      label: "模型授权",
      what: "产品至少持有一条生效中的模型路由。过期的不算——到期在读时判定，网关不会因为 state 还写着 active 就放行。",
      side: "ours",
      status: live.length > 0 ? "pass" : "fail",
      detail:
        live.length > 0
          ? `${live.length} 条生效中${expired.length > 0 ? `（另有 ${expired.length} 条标着启用但已过期）` : ""}：${live
              .slice(0, 5)
              .map((g) => g.endpointCode)
              .join("、")}${live.length > 5 ? " 等" : ""}`
          : expired.length > 0
            ? `${expired.length} 条授权都标着启用但已经过期。`
            : "这个产品调不到任何模型路由。",
      remedy:
        live.length > 0
          ? null
          : expired.length > 0
            ? "去「模型授权」续期或重新发一条。"
            : "去「模型授权」为这个产品发一条。",
      href: `/model/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  }

  /* ④ 能力授权 —— derived 行也算持有（ADR-005 闭包推导的结果与 direct 等效）。 */
  if (runosGrants instanceof Error) {
    results.push({
      id: "runos-grants",
      label: "能力授权",
      what: "产品至少持有一条 active 的能力授权。",
      side: "ours",
      status: "fail",
      detail: reason(runosGrants, "读取能力授权失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
      href: `/capability/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  } else {
    const active = runosGrants.filter((g) => g.state === "active");
    results.push({
      id: "runos-grants",
      label: "能力授权",
      what: "产品至少持有一条 active 的能力授权（derived 行同样算——它是闭包推导的结果，与 direct 等效）。",
      side: "ours",
      status: active.length > 0 ? "pass" : "fail",
      detail:
        active.length > 0
          ? `${active.length} 条：${active
              .slice(0, 5)
              .map((g) => g.capabilityId)
              .join("、")}${active.length > 5 ? " 等" : ""}`
          : "这个产品调不到任何能力。",
      remedy: active.length > 0 ? null : "去「能力授权」为这个产品发一条。",
      href: `/capability/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  }

  /* ⑤ Webhook 登记 —— **只看登记，不发投递**。理由见文件头。 */
  if (webhook instanceof Error) {
    results.push({
      id: "webhook",
      label: "Webhook 登记",
      what: "平台侧登记了回调地址与签名密钥。",
      side: "ours",
      status: "fail",
      detail: reason(webhook, "读取 webhook 登记失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
    });
  } else {
    const hasUrl = !!webhook?.webhookUrl?.trim();
    /* 签名密钥有两条路径，任一条配了都算：新路径是加密落库的密钥（`hasWebhookSecret`），
       旧路径是引用名 → 平台容器环境变量（`webhookSecretRef`，存量产品在用）。此前这里
       只认引用——于是按 runbook 走新路径的产品，这一项永远是红的。 */
    const hasSecret =
      !!webhook?.hasWebhookSecret || !!webhook?.webhookSecretRef?.trim();
    /* 「填了」不等于「填对了」。这一项此前只看两个字段非空，于是通则规定的
       `/api/webhooks/vxture` 在全组织零实现而这一格全绿——路径不匹配最常见的表现
       不是 404，是落到对方前端的 SPA catch-all 拿回 index.html 和 HTTP 200，
       投递被判为送达而产品什么都没收到。登记侧 2026-09-13 起当场拒收非标准路径，
       这里对**闸门补上之前就已存在的登记行**再判一次。 */
    const path = pathOf(webhook?.webhookUrl);
    const pathOk = path === STANDARD_WEBHOOK_PATH;
    const ok = hasUrl && hasSecret && pathOk;
    results.push({
      id: "webhook",
      label: "Webhook 登记",
      what: `平台侧登记了回调地址与签名密钥，且回调路径是通则规定的 ${STANDARD_WEBHOOK_PATH}（所有产品同一个，变的只有域名）。不发测试投递——那是对对方生产端点的真实请求，本页不做；投递能不能成功要看运行监控里的投递队列。`,
      side: "ours",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `回调 ${webhook!.webhookUrl}，${webhook!.hasWebhookSecret ? "签名密钥已登记" : `密钥引用 ${webhook!.webhookSecretRef}`}`
        : !webhook
          ? "这个产品没有 webhook 登记行。"
          : !hasUrl
            ? "登记行存在，但没有回调地址。"
            : !pathOk
              ? `回调地址的路径是 ${path ?? "(解析不出)"}，通则规定的是 ${STANDARD_WEBHOOK_PATH}。这是闸门补上之前留下的登记值。`
              : "登记了回调地址，但没有签名密钥——对方无法验签。",
      remedy: ok
        ? null
        : !hasUrl
          ? "在「边缘路由与回调」填回调地址，在「密钥管理」登记签名密钥。"
          : !pathOk
            ? `按 X-4 三步迁移：① 产品侧先同时能收新旧两个路径并上线；② 回这里把地址改成 ${STANDARD_WEBHOOK_PATH}；③ 产品侧再撤掉旧路由。顺序反过来会有一段投递落空的窗口。`
            : "在「密钥管理」登记签名密钥。",
      /* 原来指 `/ops/logs`（投递日志）——那是看结果的地方，不是配置的地方。
         2026-09-14 起配置都在产品页：地址在「边缘路由与回调」，签名密钥在密钥面板。 */
      href: hasUrl && pathOk && !hasSecret ? "#secrets" : "#section-edge",
    });
  }

  /* ⑥⑦ 对方留下的痕迹 —— 归「对方」侧（通不通由对方决定），但判定由平台做。
        两项都写回检查单：判据（「最近一次」）已把这一项的全部内容覆盖了——检查单上
        `c2_entitlement` / `c3_metering` 问的就是「接没接通」。读取失败时两项一起记
        fail 并带原文，与前面几项的失败方向一致。 */
  const entitlementsHref = `/product/entitlements?productCode=${encodeURIComponent(product.productCode)}`;
  if (signals instanceof Error) {
    const detail = reason(signals, "读取接入信号失败");
    results.push(
      {
        id: "c2-entitlement",
        label: "C2 权益拉取",
        what: "对方调过 GET /platform/entitlements——平台记下最近一次。",
        side: "theirs",
        status: "fail",
        detail,
        remedy: "读不到不等于没接。先解决读取失败，再重跑。",
        itemCode: "c2_entitlement",
      },
      {
        id: "c3-metering",
        label: "C3 用量上报",
        what: "对方调过 POST /usage/consume——平台落了用量事件。",
        side: "theirs",
        status: "fail",
        detail,
        remedy: "读不到不等于没接。先解决读取失败，再重跑。",
        itemCode: "c3_metering",
      },
      {
        id: "c1-s2s",
        label: "C1 出站换票",
        what: "对方换过 S2S 令牌去调 Atlas / Runos / Karda——平台是签发方，审计里记着。",
        side: "theirs",
        status: "fail",
        detail,
        remedy: "读不到不等于没接。先解决读取失败，再重跑。",
        itemCode: "c1_s2s",
      },
    );
  } else {
    const {
      login,
      entitlement,
      consume,
      s2s,
      provision,
      provisionAck,
      delivery,
    } = signals;
    /* 端到端链路 —— **呈现型，不写回检查单**（没有 itemCode）。
     *
     * `acceptance` 的判据是 `login → provision → gate → consume → invalidate` 五段。
     * 五段平台都有台账（2026-09-17）：登录、开通、C2（gate）、C3（consume）、回调投递
     * （invalidate）。`login` 段此前被当成「没台账」，那句话错了两半：auth-bff 登录
     * 确实不写审计，但每一次成功的 OIDC 登录都往 `session.refresh_tokens` 落一行、
     * 带 `client_id`——台账一直在写，只是没人读。（`oidc_consents` 确实是空的，
     * 但它从来不是这一段的台账。）
     *
     * **2026-09-17 起这一项写回检查单**（`itemCode: "acceptance"`）。此前只呈现不落库，
     * 理由是五段台账不全;登录段（v0.26.200）与开通回执（v0.26.203）补齐之后，
     * 判据「五段落在同一个工作区」已经覆盖了 `acceptance` 定义里的全部内容——
     * 「整条链实际跑通过一次」。判据仍来自 `@vxture/core-utils` 的 `launch-checklist.ts`。
     *
     * 「同一个工作区」是这一项的要害：几件事各自发生过，不等于一条链走通了。
     * C2 的 workspaceId 只在共享内部令牌路径上有值，所以它缺席时只降级说明，不算失败。
     *
     * **登录段不进同工作区判定**：`session.refresh_tokens` 没有 `workspace_id` 列（登录
     * 发生在选定工作区之前）。硬凑一个进去只会把一条本来成立的链判成失败。 */
    const chainWorkspaces = [
      provision?.workspaceId,
      delivery?.workspaceId,
      entitlement?.workspaceId ?? undefined,
    ].filter((w): w is string => typeof w === "string" && w !== "");
    const sameWorkspace =
      chainWorkspaces.length >= 2 &&
      chainWorkspaces.every((w) => w === chainWorkspaces[0]);
    const chainDone = Boolean(
      login && provision && delivery && entitlement && consume,
    );
    results.push({
      id: "acceptance-chain",
      label: "端到端链路痕迹",
      what: "登录 → 开通 → 权益 → 用量 → 回调投递，五段在平台侧各自留下的痕迹。仍然只给判断依据、不替人勾「端到端验收」：五段各自发生过，不等于同一个客户把一条链走完了。",
      side: "theirs",
      status: chainDone && sameWorkspace ? "pass" : "fail",
      detail: !chainDone
        ? `五段缺 ${[
            login ? null : "登录",
            provision ? null : "开通",
            entitlement ? null : "权益拉取",
            consume ? null : "用量上报",
            delivery ? null : "回调投递",
          ]
            .filter(Boolean)
            .join("、")}。`
        : sameWorkspace
          ? `五段齐全，且落在同一个工作区；最近一次登录 ${formatAt(login!.lastLoginAt, opts.locale)}，最近一次开通 ${formatAt(provision!.lastProvisionedAt, opts.locale)}，末次投递 ${delivery!.eventType}${
              delivery!.responseCode === null
                ? ""
                : `（HTTP ${delivery!.responseCode}）`
            }`
          : "五段齐全，但开通 / 投递 / 权益 分散在不同工作区——这是几件各自发生过的事，不是一条走通的链。（登录不进这个判定：它发生在选定工作区之前。）",
      remedy:
        chainDone && sameWorkspace
          ? null
          : "用同一个工作区把整条链走一遍：开通产品 → 拉一次权益 → 报一次用量 → 收到平台回调。",
      /* **没有 itemCode**：`acceptance` 已于 2026-11-03 退出检查单（那条检查照跑，
         退的是它在那张表上的席位）。还留着 itemCode 的话，复验会去 PATCH 一个不存在
         的项，拿回 404 —— 而那个 404 会被当成「复验失败」，把一次正常的复验报成故障。 */
      scope: "health",
      href: entitlementsHref,
    });
    /* 开通回执 —— **advisory**:只报事实，不参与「全部通过」。
     *
     * 它与上面「开通」那一段是**两件事**:`provision` 是平台下令的时间，这一个才是
     * 产品确认的时间。此前只有前者，而接入检查把它当「开通成功」在读，于是那一格在
     * 平台按下开通的瞬间就绿了，与对方建没建起空间无关。
     *
     * 为什么不算进判定:回执是 2026-09-17 新加的**次要约定**（通则自己的规矩——一条
     * 没有指明「谁在哪一步会拒绝它」的 MUST 还没写完），在产的五个产品一个都还没实现。
     * 让它算数就是拿一次平台升级把它们全判成不合规。等产品侧铺开再谈升格。
     */
    results.push({
      id: "provision-ack",
      scope: "health",
      label: "开通回执",
      what: "对方收到开通事件后，经 POST /provisioning/ack 报回「这个工作区的空间我建好了」。这一项只报事实，不挡上线——回执目前是次要约定，在产产品还没实现它。",
      side: "theirs",
      status: provisionAck && provisionAck.status === "ready" ? "pass" : "fail",
      advisory: true,
      detail: !provisionAck
        ? "最近一次开通没有收到回执。这不是失败——平台此前从没要求过回执，对方也无从实现。"
        : provisionAck.status === "ready"
          ? `对方于 ${formatAt(provisionAck.ackedAt, opts.locale)} 回执:空间已就绪`
          : `对方于 ${formatAt(provisionAck.ackedAt, opts.locale)} 回执:${provisionAck.status}——它说自己没建起来，去问对方为什么`,
      remedy:
        provisionAck && provisionAck.status === "ready"
          ? null
          : "把《产品接入通则》的开通回执一节发给对方;它收到 tenant.provisioned 并建好空间后，用同一张 S2S 票调一次 POST /provisioning/ack。不接也能上线。",
      href: entitlementsHref,
    });
    results.push({
      id: "c2-entitlement",
      label: "C2 权益拉取",
      what: "对方调过 GET /platform/entitlements。平台只记「最近一次」（30 天过期），不是台账——回答的是接没接通，不是调了多少次。",
      side: "theirs",
      status: entitlement ? "pass" : "fail",
      detail: entitlement
        ? `最近一次 ${formatAt(entitlement.lastSeenAt, opts.locale)}，经 ${describeVia(entitlement.via)}`
        : "最近 30 天内没有以这个产品码拉过权益。",
      remedy: entitlement
        ? null
        : "把交接信息（产品码、client_id）发给对方；对方以 S2S 令牌调一次权益接口后重跑。这一项不要求先有客户、订阅或套餐——没有活跃订阅时接口落 free 兜底，照样算一次成功读取。",
      itemCode: "c2_entitlement",
      href: entitlementsHref,
    });
    results.push({
      id: "c3-metering",
      label: "C3 用量上报",
      what: "对方调过 POST /usage/consume。只看最近 90 天内最后一笔事件——超过 90 天没动静的产品复验会变红，那是复验该做的事。",
      side: "theirs",
      status: consume ? "pass" : "fail",
      detail: consume
        ? `最近一次 ${formatAt(consume.lastEventAt, opts.locale)}，指标 ${consume.metricKey}`
        : "最近 90 天内没有这个产品的用量事件。",
      remedy: consume
        ? null
        : "对方接通消费上报（POST /usage/consume）调一次后重跑。不要求真扣到额度——没有配额池时走零扣减分支，用量事件照样落库（引擎只记录、不裁决），所以也不必先有客户、订阅或套餐。",
      itemCode: "c3_metering",
      href: entitlementsHref,
    });
    /* 出站换票。写回检查单的判据同 C2/C3——这一项问的就是「换没换过票」，
       而换票发生在平台上、平台是签发方，实测覆盖了它的全部内容。
       与 `c1_identity` 的区别正在这里：那一项有一半是对方的 RP 实现，测不到。 */
    results.push({
      id: "c1-s2s",
      label: "C1 出站换票",
      what: "对方用 POST /oidc/token 换过面向 Atlas / Runos / Karda 的短时凭证。只看最近 90 天内最后一次。",
      side: "theirs",
      status: s2s ? "pass" : "fail",
      detail: s2s
        ? `最近一次 ${formatAt(s2s.lastSeenAt, opts.locale)}，调 ${s2s.target}（${s2s.mode}）`
        : "最近 90 天内没有以这个产品码换过票。",
      remedy: s2s
        ? null
        : "凡是要用模型/能力/知识的智能体都要接这一步。把交接信息发给对方，对方按《产品接入通则》C1 出站实现换票后重跑。产品还是草稿也能换——目标是平台受众时恒可解析，审计按调用方归因。",
      itemCode: "c1_s2s",
    });
  }

  return results;
}

/**
 * 「全部通过」——**只数参与判定的那些**。
 *
 * `advisory` 项被排除在外:它们报的是事实，不是准入条件。把一条谁都还没实现的新约定
 * 算进来，会让每一个产品的上线都掉进「带理由跳过」，而按钮上看不出是被哪一条挡的。
 */
export function allPassed(results: readonly CheckResult[]): boolean {
  const counted = results.filter(
    (r) => !r.advisory && (r.scope ?? "launch") === "launch",
  );
  return counted.length > 0 && counted.every((r) => r.status === "pass");
}

/** 运行健康三态。**没有「未通过」这一档**——那是上线门的说法。 */
export type HealthVerdict = "healthy" | "degraded" | "unknown";

/**
 * 运行健康的结论。
 *
 * ── `unknown` 是正常态，不是失败 ──
 * 一个刚上线、还没有客户的产品，链路当然是空的。旧的检查单把它画成红色「未通过」，
 * 等于把「没人用」说成了「坏了」。三态里 `unknown` 就是为这种情况准备的：
 * **我们此刻什么都不知道**，而那和「知道它坏了」是两件事。
 *
 * ── 为什么不数 advisory ──
 * 开通回执是次要约定，在产产品一个都还没实现它。让它参与判定等于拿一次平台升级
 * 把所有产品判成劣化。
 */
export function healthVerdict(results: readonly CheckResult[]): HealthVerdict {
  const counted = results.filter((r) => r.scope === "health" && !r.advisory);
  if (counted.length === 0) return "unknown";
  if (counted.every((r) => r.status === "pass")) return "healthy";
  /* 一条都没有痕迹 = 没人用过（unknown）；有一些有、有一些没有 = 链断在中间（degraded）。
     两者的下一步完全不同：前者是「等客户来」，后者是「去查哪一段断了」。 */
  return counted.every((r) => r.status !== "pass") ? "unknown" : "degraded";
}
