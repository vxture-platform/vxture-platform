/**
 * navigation.ts — Opera 导航注册表（业务配置，由产品侧组装）。
 *
 * **权威依据是 `portals/opera/docs/opera-navigation-design.md`**（owner 2026-08-14
 * 定稿）——分组、命名、路径三者都在那份文件里逐条讨论过，本文件只是它的代码形态。
 * 要改结构先改设计文件；两者冲突以设计文件为准。
 *
 * 三条命名规则（设计文件 §2），落到字段上是：
 *   规则一  `label` 中文功能名 + `subLabel` 英文原词，同项两行。英文**留在项目里**
 *           而不是降级进 `description`——`description` 侧栏根本不读（只喂 Ctrl+K
 *           搜索），写在那里等于界面上没有。保留英文是因为运营者在审计事件里看到
 *           的是 `mgmt.grant.create`，控制台与 API 分叉的词表会在两者相接的每一个
 *           点上把买到的清晰还回去。
 *   规则二  产品代号**后置且弱化**：`模型管理 · Atlas`，不是 `Atlas · 模型服务`。
 *           opera 管理 Atlas，不属于 Atlas（`opera-top-level-design.md` §11）。
 *           靠 `brandPosition: "suffix"` 告诉 DS 该染哪一段——DS 不做启发式猜测。
 *   规则三  同类对象跨域必须成对可区分：**模型**路由 / **路由**授权（Atlas 域）对
 *           **能力**注册 / **能力**授权（Runos 域）。不靠分组标题消歧,因为搜索、
 *           面包屑、收藏夹里都拿不到分组标题。
 *
 * 分组按**管理域**而非产品代号切分：将来第二家模型供给方接进来是进「模型管理」，
 * 不是并列出一个新的产品代号分组。
 *
 * 图标一律取 DS iconDictionary 语义键（类型收窄为 IconName，写错编译期报）。
 * 授权类两项共用 `list-checks`、计量类两项共用 `gauge` 是**有意的**：它们是同一
 * 类对象在两个域里的实例，规则三要的是名字可区分，不是图标必须不同。
 *
 * 类型契约来自 DS 的 ShellSidebarNav（与业务无关的通用侧栏导航壳）而非反过来
 * ——本文件只负责菜单内容，侧栏组件本身不 import 这里的任何数据。
 */

import type { ShellNavItem, ShellNavSection } from "@vxture/design-system";

export interface OperaNavItem extends ShellNavItem {
  /** 只喂 Ctrl+K 搜索与搜索结果副行，侧栏不渲染。见文件头规则一。 */
  description?: string;
}

export interface OperaNavSection extends Omit<ShellNavSection, "items"> {
  items: OperaNavItem[];
}

export const operaNavSections: OperaNavSection[] = [
  {
    title: "概览",
    items: [
      {
        href: "/",
        label: "总览",
        subLabel: "Overview",
        icon: "squares-four",
        description: "现在有没有需要立刻处理的事",
      },
    ],
  },
  {
    /* 上游 Atlas `/capability/*`。回答「平台能调哪些模型、经由谁、谁有权调」。 */
    title: "模型管理 · Atlas",
    brandPosition: "suffix",
    /* 分隔线切出「概览 / 四个管理域 / 两个通用面」三层（设计文件 §3）——
       没有这两条线，七个分组读起来是七个并列项。 */
    dividerBefore: true,
    items: [
      {
        /* Provider 与 Model 合并成一张两层表（2026-08-14）：它们是一对多的归属
           关系，拆成两页时「这个模型挂在哪家、这家底下有哪些模型」在任何一页上都
           看不全。 */
        href: "/model/services",
        label: "模型服务",
        subLabel: "Model Service",
        icon: "plugs-connected",
        description: "供应商与它名下的模型（两层表）",
      },
      {
        /* 叫「路由」不叫「入口」：endpoint（`chat/default`）带 primary 与 fallback，
           它本身就是一条具名路由策略。也不叫「能力入口」——「能力」二字归 Runos 域。 */
        href: "/model/routes",
        label: "模型路由",
        subLabel: "Endpoint",
        icon: "tree-structure",
        description: "具名路由策略：主用与回退",
      },
      {
        /* 与「能力授权」成对。**不是** admin 那个按租户逐模型发放的 grant：那是商业
           关系，这是工程关系，两者同名但不是一回事。 */
        href: "/model/grants",
        label: "路由授权",
        subLabel: "Product Grant",
        icon: "list-checks",
        description: "产品持有哪些模型路由",
      },
      {
        href: "/model/keys",
        label: "调用密钥",
        subLabel: "API Key",
        icon: "key",
        description: "网关调用密钥的签发与轮换",
      },
      {
        href: "/model/metering",
        label: "用量计量",
        subLabel: "Metering",
        icon: "gauge",
        description: "请求 / Token 用量事实（五根聚合轴）",
      },
    ],
  },
  {
    /* 上游 Runos `/capability/*` `/commerce/*` `/governance/*`。回答「业务 agent
     * 除模型外还能做什么」。
     *
     * 2026-08-14 三项不进导航（owner 定）。它们**都不是对等对象**，摆在顶级位会让
     * 控制台承诺这套 API 做不到的事：
     *   - Endpoint —— 嵌在 Capability 里面，runos 没有独立的端点列表接口，管理入口
     *     一直在 Capability 详情抽屉内。页面保留在 `/capability/endpoints`（有人存了
     *     书签会落到一段说明上），只是不再进导航。
     *   - Plugin —— 不是资源，是将来的一条**摄入路径**：套件到位之后 Skill 会以打包
     *     形式提交，那是提交 Capability 的另一种方式，永远不会成为它的对等物。
     *   - Quality Profile —— M3 才有对象，现在挂上去等于占一个空位。
     * 后两个的占位页已在本批删除。 */
    title: "能力管理 · Runos",
    brandPosition: "suffix",
    items: [
      {
        href: "/capability/registry",
        label: "能力注册",
        subLabel: "Capability",
        icon: "stack",
        description: "版本 · 端点 · 认证（四原语统一注册台账）",
      },
      {
        href: "/capability/credentials",
        label: "凭证托管",
        subLabel: "Credential",
        icon: "certificate",
        description: "第三方系统凭证托管",
      },
      {
        /* 与「路由授权」成对：两边主体都是产品（ADR-010），真正的区别在**授的是
           什么**，所以名字取对象名而不是主体名。 */
        href: "/capability/grants",
        label: "能力授权",
        subLabel: "Grant",
        icon: "list-checks",
        description: "产品持有哪些能力",
      },
      {
        href: "/capability/metering",
        label: "用量计量",
        subLabel: "Usage",
        icon: "gauge",
        description: "能力调用用量聚合（七根轴）",
      },
    ],
  },
  {
    /* 回答「平台上跑着哪些产品、它们怎么接进来的」。产品的**商业**封装
     * （套餐 / 定价 / 订阅）归 admin，此处只管基础设施登记与接入。 */
    title: "产品管理",
    items: [
      {
        href: "/product/catalog",
        label: "产品目录",
        subLabel: "Catalog",
        icon: "package",
        description: "同时装着草稿与正式的产品台账，含上线流程入口",
      },
      {
        href: "/product/clients",
        label: "接入凭据",
        subLabel: "OIDC Client",
        icon: "fingerprint",
        description: "OIDC 客户端注册与密钥轮换",
      },
      {
        href: "/product/entitlements",
        label: "权益配置",
        subLabel: "Entitlement",
        icon: "ticket",
        description: "按产品聚合的模型路由授权与能力授权（只读汇总）",
      },
    ],
  },
  {
    /* 回答「系统现在与最近一段时间怎么样」。调用流水属于**运行事实**，与安全审计
     * 的问责数据不同类——三个审计面按性质分而不按产品分，见设计文件 §5。 */
    title: "运行监控",
    items: [
      {
        href: "/ops/health",
        label: "服务状态",
        subLabel: "Health",
        icon: "server",
        description: "接入产品的 prod / beta 存活与就绪",
      },
      {
        href: "/ops/metrics",
        label: "运行指标",
        subLabel: "Metrics",
        icon: "chart-line-up",
        description: "自有服务与调用指标，外加基础设施平台跳转",
      },
      {
        href: "/ops/logs",
        label: "调用日志",
        subLabel: "Logs",
        icon: "terminal",
        description: "请求级检索：延迟、裁决、错误类",
      },
      {
        href: "/ops/jobs",
        label: "任务调度",
        subLabel: "Jobs",
        icon: "workflow",
        description: "后台作业心跳与 webhook 投递队列",
      },
      {
        href: "/ops/maintenance",
        label: "维护窗口",
        subLabel: "Maintenance",
        icon: "clock",
        description: "计划内停机与影响范围",
      },
    ],
  },
  {
    /* 回答「谁在什么时候改了什么」。权限本身归 admin，此处只出跳转。 */
    title: "安全审计",
    dividerBefore: true,
    items: [
      {
        href: "/audit/changes",
        label: "变更审计",
        subLabel: "Change Trail",
        icon: "clipboard",
        description: "管理面变更记录（Atlas / Runos / opera 三来源）",
      },
      {
        href: "/audit/rbac",
        label: "权限管理",
        subLabel: "RBAC",
        icon: "role",
        description: "角色与能力码——跳转 admin",
      },
    ],
  },
  {
    /* 配的是**控制台**自己，不是被管理的系统。 */
    title: "系统配置",
    items: [
      {
        href: "/settings",
        label: "系统配置",
        subLabel: "Settings",
        icon: "settings",
        description: "opera 控制台自身的配置",
      },
    ],
  },
];
