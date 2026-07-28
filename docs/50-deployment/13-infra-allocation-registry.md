# 基建分配登记表(Infra Allocation Registry)

> **定位**:每产品/每主机的基建分配 **SoT**(§6#10,product_240 §2.7 登记表位)——端口、主机、stack_root、域名、镜像 namespace、tailnet 归属,一处登记、全局对账。
> **纪律**:新产品上主机**先在本表占行**(owner 拍板分配格)再动 DNS/compose/环境;两产品撞端口/撞目录 = 本表失职。运行态真值仍在 compose/nginx/workflow 文件,本表登记 + 指向;冲突时**以本表登记的分配意图为准**、修运行态。
> **来源**:2026-07-21 三路事实核验(compose/nginx/workflows/seed/140 §4–§6/product_240 §2.7);旧文档(00-overview §3 端口表、02-infrastructure)早于 `vx-platform-*` 迁名,以本表与现行 compose 为准。

## 1. 主机登记

| 主机             | 提供方/地理                  | 公网         | tailnet                 | 角色                                                                                            | registry profile                                                              |
| ---------------- | ---------------------------- | ------------ | ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **vx-worker-01** | Aliyun ECS·境内(2C2G)        | 39.103.62.17 | `100.100.197.42`        | **平台控制面**(vx-platform 栈 + vx-nginx 边缘)                                                  | 域内:ACR 内网 → 公网 ACR 兜底                                                 |
| **vx-worker-02** | 境内自有(8C24G,200G+3T RAID) | 无           | `100.76.219.48`         | 业务主机:varda 栈 + **arda 栈**(外仓 vxture-arda 部署)+ **vxtpl 栈**(外仓 vxture-template 演示) | 实况 ACR 内网→公网兜底(140 §4 非 VPC=GHCR 主源与 §5 存在标准内矛盾,实况从 §5) |
| **vx-worker-04** | Vultr·境外                   | 有(外仓管理) | **不在 tailnet,也不入** | umbra(ruyin.ai + VPN),本仓只读边界                                                              | 境外:GHCR + 公网 SSH                                                          |
| (beta 主机)      | 计划态                       | 待定         | 待定                    | 平台 beta 临时按量机,**未开通**                                                                 | —                                                                             |

> tailnet 无 MagicDNS,寻址一律 `IP:port`;worker-01 真实主机名在文档中脱敏为 `VXTURE_DEPLOY_HOST`。

## 2. 平台面(worker-01,非产品行;**L0,2026-07-24 全面重排**)

> **决策(owner 拍板,2026-07-24)**:平台自己的四大应用(website/console/admin/accounts)与
> varda 一并**纳入 L0**,和产品线(L1/L2/L3)套同一套"分层分块、块内大幅留白"逻辑重排,取代
> 此前各自随手取号、互不成序的历史状态(尚未真正对外上线、无外部用户,现在改动成本最低)。
> 重排目的两条:①**端口本身能读出层**(千位就是层号:30xx=L0/31xx=L1/32xx=L2/33xx=L3);
> ②**留足扩展空间**,不再"首尾相接、加一个新东西就得挤"。**本表是登记/意图层,运行态真值在
> `deploy/compose.platform.yml` / `deploy/nginx/`——本次先落地本表,compose/nginx 侧的同步
> 修改是后续单独任务,尚未执行,不要假设两边已经一致。**

宿主端口面 = **仅** nginx 80/443 + 少量 tailscale 接口绑定;其余服务容器内网、经 nginx 按 Docker DNS 名转发。**L0 内部端口块 = `3000-3099`**,5 个成员每人一个 20 位子块(app/bff 居中,其余大段留白):

| 面(L0)        | 域名                                          | 子块      | 容器:内口(新)                               | 宿主绑定                                              |
| ------------- | --------------------------------------------- | --------- | ------------------------------------------- | ----------------------------------------------------- |
| website       | vxture.com(www 301→apex)                      | 3000-3019 | vx-platform-website:3000 / website-bff:3001 | —                                                     |
| console       | console.vxture.com                            | 3020-3039 | vx-platform-console:3020 / console-bff:3021 | —                                                     |
| admin         | y.vxture.com                                  | 3040-3059 | vx-platform-admin:3040 / admin-bff:3043     | —(3041/3042 特意跳过,见下方"不纳入重排"S2S别名注)     |
| accounts(IdP) | accounts.vxture.com(`/oidc/*`→auth-bff)       | 3060-3079 | vx-platform-accounts:3060 / auth-bff:3061   | auth-bff `100.100.197.42:3061`(tailnet-only,原 3090)  |
| varda         | 无域名(L0 内嵌,console/admin `/varda/*` 反代) | 3080-3099 | varda-bff:3080 / varda-agent:3081           | `100.100.197.42:3080/3081`(tailnet-only,原 3121/3122) |

**本次明确不纳入重排**(排除理由各异,不是漏改):

| 项                                           | 现值                                                           | 为什么不动                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| api 边缘(`api.vxture.com`)                   | `vx-platform-gateway-bff:8000`                                 | 公网 http-alt 惯例端口,不是"多产品内部端口撞车"这个问题域要解决的对象                                                                                                                                                                                                                      |
| **S2S 内网别名**                             | 内口 `vx-platform-api:3041`,tailnet 绑定 `100.100.197.42:8080` | **已是外部产品仓的既定契约值**(karda/arda 等 `.env.example` 的 `PLATFORM_API_URL` 直接写死这个 tailnet 地址)——重排会破坏已建立的跨仓契约,和"自己家内部随便改"不是一回事;admin 子块特意让开 3041/3042 两位,避免与它在文档里显得"撞号"(运行时其实互相隔离,不会真冲突,纯粹是登记表可读性考虑) |
| model-platform(旧 `services/model/platform`) | `100.100.197.42:3100`                                          | 正在退役中(任务7,待 Atlas 侧验证通过),对一个即将删除的东西重新编号没有意义;新家(独立仓 Atlas)沿用 3100,已在 §3 产品表登记为 L1 值                                                                                                                                                          |

镜像 namespace(单一权威 = `scripts/workflows/images.mjs`,13 个):`platform_*` 11 件 + `varda_bff`/`varda_agent`;容器前缀 `vx-platform-*` / `vx-varda-*`;ACR 实例 = cn-beijing(2026-07-15 迁,org vars `ALIYUN_ACR_{REGISTRY,INTERNAL_HOST,NAMESPACE}`,标准记实际 namespace = `vx-platform`)。stack_root:deploy 包 `/srv/vxture/deploy`、运行态 env `/srv/vxture/runtime`、数据 `/srv/vxture/data`。

## 3. 产品分配表(每产品一行;**空格 = 待 owner 拍板,不得自取**)

| product         | 主机                           | 端口对(prod/beta)                                                                                                                                                                                                | 域名(prod / beta)                                      | stack_root                                                     | 容器/compose 前缀           | DB(名/角色)                                               | tailnet                               | 状态                                                                                                  |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | --------------------------- | --------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **arda**        | worker-02                      | **3230 / 3231**(历史,与新方案自然吻合,未改)                                                                                                                                                                      | arda.vxture.com / beta-arda.vxture.com                 | 外仓自持(org 约定 `/srv/md0/arda`,待 arda 线对账)              | `arda-*`(arda-app/arda-db…) | 现 `arda`(整改→`vxturebiz_arda_{beta,prod}` + `arda_svc`) | ✔(worker-01 nginx 经 tailscale 回源)  | **在产**                                                                                              |
| **varda(L0)**   | worker-02                      | **3080 / 3081**(bff/agent,无 beta;原 3121/3122,详见 §2)                                                                                                                                                          | 无域名(L0 内嵌,console/admin `/varda/*` 反代)          | `/srv/md0/varda/deploy`                                        | `vx-varda-*`                | varda-pg(栈内私有)                                        | ✔                                     | **在产**                                                                                              |
| **vxtpl**       | worker-02                      | **目标 3210 / 3211**(修订,原 3232 单口无beta;新方案含beta——校验:你给的"3210/3111"里3111与ontos beta撞车,判断为笔误,按3211登记;**vxture-template 侧尚未切换,本仓nginx暂保持指向现状3232,未随karda一起割接**)      | vxtpl.vxture.com / beta-vxtpl.vxture.com(新增)         | `/srv/md0/vxtpl`                                               | `vxtpl-*`                   | `vxturebiz_vxtpl_{env}` + `vxtpl_svc`(模板规则)           | ✔(worker-01 nginx 经 tailscale 回源)  | **在产,端口迁移待vxture-template侧就绪**(vxture-template 演示产品,2026-07-21)                         |
| **umbra**       | worker-04                      | 外仓管理                                                                                                                                                                                                         | ruyin.ai(**无 beta,刻意**)                             | 外仓                                                           | 外仓                        | 外仓                                                      | ✘(境外不入)                           | 在产(外仓)                                                                                            |
| atlas(L1)       | worker-02                      | **3100 / 3101**(现状 3100 单口无beta,新方案预留 3101 供未来 beta)                                                                                                                                                | atlas.vxture.com / 待分配                              | 待分配(建议 `/srv/md0/atlas`,随 arda 惯例;未经 owner 逐格确认) | `atlas-*`                   | `vxturebiz_atlas_{env}` + `atlas_svc`                     | 入 tailnet(类 2,`100.76.219.48:3100`) | **在产**(独立仓 `vxture-atlas` 已部署 worker-02:3100,2026-07-27 口头确认;stack_root/域名接入状态待补) |
| ontos(L1)       | 待分配                         | **3110 / 3111**(预留)                                                                                                                                                                                            | ontos.vxture.com / 待分配                              | 待分配                                                         | `ontos-*`                   | `vxturebiz_ontos_{env}` + `ontos_svc`                     | 入 tailnet                            | 未部署(env 已预留)                                                                                    |
| runa(L1)        | 待分配                         | **3120 / 3121**(预留)                                                                                                                                                                                            | runa.ai / 待分配                                       | 待分配                                                         | `runa-*`                    | `vxturebiz_runa_{env}` + `runa_svc`                       | 入 tailnet                            | 未部署(env 已预留)                                                                                    |
| karda(L2)       | worker-02(沿用现状,待正式对账) | **3240 / 3241**(修订,原 3233 单口无beta;**割接进行中,2026-07-24**——karda 仓已在切换新端口监听,本仓 nginx 配置(`deploy/nginx/sites-enabled/karda.vxture.com.conf`)已同步改指向3240,尚未reload/尚未核实新端口可达) | karda.vxture.com(已接入) / beta-karda.vxture.com(新增) | 待分配(建议 `/srv/md0/karda`,随 arda 惯例)                     | `karda-*`                   | `vxturebiz_karda_{env}` + `karda_svc`                     | 入 tailnet                            | **在产,端口割接进行中**(karda 仓已部署)                                                               |
| terra(L2)       | 待分配                         | **3250 / 3251**(预留)                                                                                                                                                                                            | terra.vxture.com(建议值)                               | 待分配                                                         | `terra-*`                   | `vxturebiz_terra_{env}` + `terra_svc`                     | 入 tailnet                            | 未接入(seed/env 均无)                                                                                 |
| raven(L3,#1)    | 待分配                         | **4010 / 4011**(预留,修订)                                                                                                                                                                                       | raven.vxture.com / 待分配                              | 待分配                                                         | `raven-*`                   | `vxturebiz_raven_{env}` + `raven_svc`                     | 入 tailnet                            | 未部署(env 已预留)                                                                                    |
| anlan(L3,#2)    | 待分配                         | **4020 / 4021**(预留,修订)                                                                                                                                                                                       | anlan.ai / 待分配                                      | 待分配                                                         | `anlan-*`                   | `vxturebiz_anlan_{env}` + `anlan_svc`                     | 入 tailnet                            | 未部署(env 已预留)                                                                                    |
| forge(L3,#3)    | 待分配                         | **4030 / 4031**(预留,修订)                                                                                                                                                                                       | forge.vxture.com / 待分配                              | 待分配                                                         | `forge-*`                   | `vxturebiz_forge_{env}` + `forge_svc`                     | 入 tailnet                            | 未部署(env 已预留)                                                                                    |
| xuanzhen(L3,#4) | 待分配                         | **4040 / 4041**(预留,修订)                                                                                                                                                                                       | xuanzhen.ai / 待分配                                   | 待分配                                                         | `xuanzhen-*`                | `vxturebiz_xuanzhen_{env}` + `xuanzhen_svc`               | 入 tailnet                            | 未部署(env 已预留)                                                                                    |
| ruyin(client)   | —(desktop 分发)                | —                                                                                                                                                                                                                | ruyin.vxture.com(web 面)                               | —                                                              | —                           | ✘(不进 entitlement 引擎)                                  | —                                     | client 已注册                                                                                         |
| hermes          | —(平台内部)                    | —                                                                                                                                                                                                                | 无                                                     | —                                                              | —                           | —                                                         | —                                     | internal                                                                                              |

> 本地 dev 端口(seed `B` map 3000–3089)是**本地回落值**,非生产绑定,不占本表端口位。

> **2026-07-24 端口号按 L0/L1/L2/L3 全面分块重排,owner 给出最终版数值（直接拍板,口头指令,
> 非本表默认"待分配,不得自取"的自取;取代当天更早的两版草稿——先是"一次性顺编、未按层区分"，
> 后是"20位子块留白版"，本版是 owner 亲自定稿的最终值,10位/产品子块）**：
>
> **两条目的**：①**层从端口读出来**——不用查表也能一眼分辨属于哪层;②**留足扩展空间**——每
> 产品一个子块,子块内 prod/beta 紧邻,块间留缓冲不首尾相接。L0 已纳入平台自己的四大应用+
> varda(详细子块见 §2 表)。
>
> **L0-L2 与 L3 用两套不同尺度**:L0-L2 成员数有限(各 3-6 个,产品矩阵已封闭),共用 `3xxx`
> 一个千位段;**L3 是行业智能体,预期规模上百**,独立拿走 `4000-5999` 两千位段,不与 L0-L2
> 共用地址空间。
>
> | 层                                                            | 端口块                        | 规模设计                                                                  | 本次分配(10位/产品子块,prod/beta 紧邻)                                                                                                                                                                                                                          |
> | ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **L0**(website/console/admin/accounts/varda)                  | `3000–3099`                   | 封闭 5 个成员                                                             | 见 §2 表                                                                                                                                                                                                                                                        |
> | **L1**(atlas/ontos/runa)                                      | `3100–3199`                   | 封闭 3 个,留身位                                                          | atlas=**3100/3101**(现状 3100 单口无beta,新预留 3101)、ontos=**3110/3111**(预留)、runa=**3120/3121**(预留);`3130-3199` 留白                                                                                                                                     |
> | **L2**(arda/karda/terra,vxtpl 附带)                           | `3200–3299`                   | 封闭,历史值就地对齐                                                       | vxtpl=**3210/3211**(修订,原3232单口无beta;新增beta,**端口迁移待执行**)、`3220-3229`留白、arda=**3230/3231**(历史,天然吻合未改)、karda=**3240/3241**(修订,原3233单口无beta;新增beta,**端口迁移待执行**)、terra=**3250/3251**(预留);`3200-3209`、`3260-3299` 留白 |
> | **L3**(行业智能体,raven/anlan/forge/xuanzhen 是当前已知头4个) | **`4000–5999`**(独立两千位段) | **开放,预期规模上百**,10位/agent 可容纳 **200** 个,余量比"上百"的要求还宽 | `4000-4009`留白(块首缓冲,呼应 L2 vxtpl 前留白的手法)、raven(#1)=**4010/4011**、anlan(#2)=**4020/4021**、forge(#3)=**4030/4031**、xuanzhen(#4)=**4040/4041**;`4050-5999` 留白,按接入顺序依次续排                                                                 |
>
> **vxtpl、karda 是真实生产端口迁移,不是纯登记**——两者现状(3232、3233)都在真实对外服务,
> 迁到新值(3210/3211、3240/3241)需要"karda/vxtpl 仓自己切新端口监听→核实可达→本仓 nginx
> 切换指向新端口并 reload→核实外部访问正常→旧端口下线"的实际割接顺序,详见任务清单(本文档
> 之外,由对应任务线执行,涉及生产变更需 owner 审批时机)。**仅端口列已定**——host、stack_root、
> tailnet 归属类别仍待 owner 逐产品拍板,未随本次一并认领。

## 4. 新产品分配规则(登记时逐格适用)

1. **域名**:`{code}.vxture.com` 缺省规则(product_100 §2 已有异 apex 例外:runa.ai/anlan.ai/xuanzhen.ai);beta = `beta-{code}.vxture.com`(arda 先例)。
2. **端口对**:按**层分块**(§2/§3 表下方"2026-07-24"注,owner 最终定稿,取代此前两版草稿)——L0`3000-3099`/L1`3100-3199`/L2`3200-3299`(三层共用 `3xxx` 一个千位段,均为封闭数量的产品矩阵)/**L3 `4000-5999`(独立两千位段,不与 L0-L2 共用,因预期规模上百)**,每新产品(L3 为每新 agent)在自己所属层的块内**另起一个 10 位子块**(prod/beta 紧邻,不接着上一个挤),块间留缓冲;L3 按接入顺序依次排号,不预先按行业细分留段。新层出现时另开独立段,不复用已占区间。分配即写入本表,不写默认值进模板;涉及**已在产**产品(如 vxtpl/karda 端口修订)的分配变更,写入本表只是登记意图,实际生效需走真实的生产割接流程,不能只改文档就当作已完成。
3. **stack_root**:org 约定 `/srv/md0/{code}`(beta `/srv/md1/{code}-beta`);`DEPLOY_DIR` 必须精确到含 compose + `.env.*` 的那一层(140 §6)。
4. **容器/DB/镜像**:`PRODUCT_CODE` 级联(product*240 §2.7)——容器 `{code}-app/{code}-redis/{code}-db`、镜像 `{code}-app`、DB `vxturebiz*{code}\_{env}`+`{code}\_svc`角色、平台侧密钥`{CODE}\_PROVISION_WEBHOOK_SECRET`/`{CODE}\_WEBHOOK_BASE_URL`。
5. **tailnet**:类 2 产品(平台 tailnet 内)一律入网,S2S 走内网、绝不公网(product_230 §1);境外/异网 = 类 1(umbra 模式)。
6. **GitHub Environment**:每部署目标一个 Environment(`DEPLOY_HOST/USER/SSH_KEY/KNOWN_HOSTS(必填)/DIR` + `ENV_FILE_BASE64` bootstrap),production/产品环境**必配 Required reviewers**(140 §6)。

## 5. 已知未知(不猜,补齐后回填)

- worker-02 云厂商名、arda 在 worker-02 的实际 stack 目录与完整容器清单(外仓,待 arda 线对账回填);
- worker-04/umbra stack_root(外仓);
- org vars `ALIYUN_ACR_*` 活值(cn-beijing 实例,控制台侧);
- karda/terra 全部分配格(未接入);beta 主机开通计划。

## 6. 关联

- `product_240` §2.7(PRODUCT_CODE 级联 + 登记表位)· `140` §4–§6(CD/环境/密钥)· `product_230` §1(传输面分级)· `00-overview.md`(主机硬件面)· `08-code-environment-map.md`(代码↔环境映射)。
