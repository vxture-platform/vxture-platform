# 基建分配登记表(Infra Allocation Registry)

> **定位**:每产品/每主机的基建分配 **SoT**(§6#10,product_240 §2.7 登记表位)——主机、stack_root、域名、镜像 namespace、tailnet 归属,一处登记、全局对账。
> **端口不在本表**:2026-08-13 起取号唯一源 = [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)(L0–L3 全部产品)。本表原有的"端口对"列已撤除——**本仓文档不再保存任何端口数值**,运行态真值在代码回退默认值与 compose/env 里。
> **纪律**:新产品上主机**先在本表占行**(owner 拍板分配格)再动 DNS/compose/环境;两产品撞目录 = 本表失职,撞端口 = 端口登记表失职。运行态真值仍在 compose/nginx/workflow 文件,本表登记 + 指向;冲突时**以本表登记的分配意图为准**、修运行态。
> **来源**:2026-07-21 三路事实核验(compose/nginx/workflows/seed/140 §4–§6/product_240 §2.7);旧文档(00-overview §3 端口表、02-infrastructure)早于 `vx-platform-*` 迁名,以本表与现行 compose 为准。

## 1. 主机登记

| 主机             | 提供方/地理                  | 公网         | tailnet                  | 角色                                                                                                             | registry profile                                                              |
| ---------------- | ---------------------------- | ------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **vx-worker-01** | Aliyun ECS·境内(2C2G)        | 39.103.62.17 | `<worker-01-tailnet-ip>` | **平台控制面**(vx-platform 栈 + vx-nginx 边缘)                                                                   | 域内:ACR 内网 → 公网 ACR 兜底                                                 |
| **vx-worker-02** | 境内自有(8C24G,200G+3T RAID) | 无           | `<worker-02-tailnet-ip>` | 业务主机:varda 栈 + **arda 栈**(外仓 vxture-arda 部署)+ **vxtpl 栈**(外仓 vxtpl,原 vxture-template,名称已归一化) | 实况 ACR 内网→公网兜底(140 §4 非 VPC=GHCR 主源与 §5 存在标准内矛盾,实况从 §5) |
| **vx-worker-04** | Vultr·境外                   | 有(外仓管理) | **不在 tailnet,也不入**  | umbra(ruyin.ai + VPN),本仓只读边界                                                                               | 境外:GHCR + 公网 SSH                                                          |
| (beta 主机)      | 计划态                       | 待定         | 待定                     | 平台 beta 临时按量机,**未开通**                                                                                  | —                                                                             |

> tailnet 无 MagicDNS,寻址一律 `IP:port`;worker-01 真实主机名在文档中脱敏为 `VXTURE_DEPLOY_HOST`。

## 2. 平台面(worker-01,非产品行;**L0,2026-07-24 全面重排**)

> **决策(owner 拍板,2026-07-24)**:平台自己的四大应用(website/console/admin/accounts)与
> varda 一并**纳入 L0**,和产品线(L1/L2/L3)套同一套"分层分块、块内大幅留白"逻辑重排,取代
> 此前各自随手取号、互不成序的历史状态(尚未真正对外上线、无外部用户,现在改动成本最低)。
> 重排目的两条:①**端口本身能读出层**(千位就是层号:30xx=L0/31xx=L1/32xx=L2/33xx=L3);
> ②**留足扩展空间**,不再"首尾相接、加一个新东西就得挤"。**本表是登记/意图层,运行态真值在
> `deploy/compose.platform.yml` / `deploy/nginx/`。**(当时那句"compose/nginx 同步修改尚未执行"
> 已于 2026-08-10 二次重排时一并落地——compose、nginx 模板、deploy env 示例、本地端口三处同批改齐;
> **但生效仍需一次真实 deploy**,在此之前生产运行态仍是旧值。)

宿主端口面 = **仅** nginx 80/443 + 少量 tailscale 接口绑定;其余服务容器内网、经 nginx 按 Docker DNS 名转发。

> **2026-08-10 二次重排(owner 拍板)**,改动三处:①**面 = 5 个**(website/console/admin/opera/accounts)——opera 此前根本没登记,却已在生产 compose 里跑,且未按分层归位;varda **不是面**(L0 内嵌副驾、无域名),单独占段;②**段内 x0=UI、x1=BFF 无例外**(具体号见端口登记表);③**tailnet 暴露口全部进边缘带**,容器内口才跟 L0 map,跨仓契约从此只认边缘带。**本地开发端口 = 生产内口**(不再有第二套本地方案)。

L0 各面的**段归属与段内取号规则**(x0=UI / x1=BFF / x2–x9 归本面)见端口登记表,本表只登记域名/容器/宿主绑定:

| 面(L0)  | 域名                     | 容器                              | 宿主绑定 |
| ------- | ------------------------ | --------------------------------- | -------- |
| website | vxture.com(www 301→apex) | vx-platform-website / website-bff | —        |

| console | console.vxture.com | vx-platform-console / console-bff | — |

| admin | y.vxture.com | vx-platform-admin / admin-bff | — |

| opera | x.vxture.com | vx-platform-opera / opera-bff | — |

| accounts(IdP) | accounts.vxture.com(`/oidc/*`→auth-bff) | vx-platform-accounts / auth-bff | auth-bff 经 tailnet 暴露(见下) |

| varda(非面,内嵌) | 无域名(console/admin `/varda/*` 反代) | varda-bff / varda-agent | worker-02 发布(UFW 仅放行 tailnet) |

**边缘带(不占应用段,两个 API 边缘 + 一个 S2S 暴露口;具体端口见端口登记表)**:

| 边缘           | 服务         | 性质                                                                        |
| -------------- | ------------ | --------------------------------------------------------------------------- |
| 公网 API 边缘  | gateway-bff  | nginx `api.vxture.com` 回源                                                 |
| S2S 内网别名   | platform-api | **跨仓契约值**——产品仓 `.env.example` 的 `PLATFORM_API_URL` 写死此地址,不变 |
| S2S token 交换 | auth-bff     | 产品仓 S2S 换票入口,见 `product_230` §2                                     |

> **为什么 tailnet 口要独立于 L0 map**:2026-07-24 那次挪了 auth-bff 的内部端口,而 `product_230`(定稿的跨仓 mesh 契约)三处仍写着旧值——契约文档与运行态整整两周对不上,产品仓看的是错的。根因是"对外契约值 = 内部端口"这个耦合。现在解耦:**内部怎么重排都不出应用块,对外只暴露边缘带**,内部再动不需要发一封跨仓通知。
>
> **不纳入本次重排**:model-platform(旧 `services/model/platform`)已于 2026-07-28 退役,新家 = 独立仓 `vxture-atlas`,登记在 §3 产品表。

镜像 namespace(单一权威 = `scripts/workflows/images.mjs`,13 个):`platform_*` 11 件 + `varda_bff`/`varda_agent`;容器前缀 `vx-platform-*` / `vx-varda-*`;ACR 实例 = cn-beijing(2026-07-15 迁,org vars `ALIYUN_ACR_{REGISTRY,INTERNAL_HOST,NAMESPACE}`,标准记实际 namespace = `vx-platform`)。stack_root:deploy 包 `/srv/vxture/deploy`、运行态 env `/srv/vxture/runtime`、数据 `/srv/vxture/data`。

## 3. 产品分配表(每产品一行;**空格 = 待 owner 拍板,不得自取**)

> **端口列已撤除**(2026-08-13)——每产品的 prod/beta 端口对见端口登记表,不在本表重复。

> **库名口径(2026-08-10 全表改齐,ADR-007)**:`vx_<product_code>_db`,**每个环境同名**——环境体现在
> 实例/栈上,不进库名(`vxturebiz_<code>_{env}` 是旧写法,已废)。改动缘由不是美观:arda 与 karda 都已在
> 产上完成改名(karda 本次随 pg16→18 割接,v0.3.0;arda 更早),而本表**两行都还写着旧名**——karda 那行是
> 收到 issue 才发现,arda 那行没人报、就一直错着。**已实测两处**:`arda.vxture.com/api/status` 与
> `karda.vxture.com/api/status` 分别报 `vx_arda_db` / `vx_karda_db`,连接角色 `arda_svc` / `karda_svc`。
> atlas 的 `.env.example` 也已是 `vx_atlas_db`。
>
> 未部署产品(ontos/terra/L3 的 raven·anlan·forge·xuanzhen)的库名一并按新口径写成**目标值**——它们的旧值不是"还没改",
> 而是"照着已经废弃的规则写的",留着就会被下一个建仓的人照抄。

> **状态格填写纪律(2026-08-10 增,由一次实错触发)**:ontos 行的状态曾写着"**在产**(v0.1.0 首次生产
> 部署端到端成功,2026-08-09;beta 预留但休眠,见 runos TD-006)"——那是**从 runos 行整段复制**
> 忘了改:那个 beta 口是 runos 的,`TD-006` 是 runos 的技术债号,而 `vxture-ontos` 仓当时
> size=0、只有一个 `Initial commit`、无 workflow、无分支保护。同一张表 §3 里它的主机还写着
> "待分配",自相矛盾却无人发现——因为**没人会去核对一个写着"在产"的格子**。
>
> 所以:**状态格只写实证过的事实**,且必须与本行其余格自洽(主机"待分配" ⇏ "在产")。抄邻行时
> 连同版本号、TD 编号一起抄,是这类错误的唯一来源;新增行宁可写"未核实"。

| product                     | 主机                           | 域名(prod / beta)                                      | stack_root                                                     | 容器/compose 前缀           | DB(名/角色)                                                                        | tailnet                              | 状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **arda**                    | worker-02                      | arda.vxture.com / beta-arda.vxture.com                 | 外仓自持(org 约定 `/srv/md0/arda`,待 arda 线对账)              | `arda-*`(arda-app/arda-db…) | **`vx_arda_db`** + `arda_svc`(ADR-007,已在产实测)                                  | ✔(worker-01 nginx 经 tailscale 回源) | **在产**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **varda(L0)**               | worker-02                      | 无域名(L0 内嵌,console/admin `/varda/*` 反代)          | `/srv/md0/varda/deploy`                                        | `vx-varda-*`                | varda-pg(栈内私有)                                                                 | ✔                                    | **在产**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **vxtpl / template**(L3,#0) | worker-02                      | vxtpl.vxture.com / beta-vxtpl.vxture.com(新增)         | `/srv/md0/vxtpl`                                               | `vxtpl-*`                   | `vx_vxtpl_db` + `vxtpl_svc`(ADR-007 目标值;vxture-template 侧待切)                 | ✔(worker-01 nginx 经 tailscale 回源) | **在产,已完全产品化 + 端口已割接**(owner 2026-08-13:①vxtpl 与 agent-template **是同一个业务**——开发样本 / 测试智能体,智能体级,因此从 L2 移出、与 template 合并,占 L3 块首子块;割接目标值随之从原 L2 号改为 L3 块首,**目标值第二次变更**,②**完全产品化**——此前平台目录里完全不存在(PRODUCTS/B map/OIDC client 一样都没有),本次补齐产品行 + OIDC client + product_webhooks,`product_240` §7 批3 的平台侧义务就此销号;③vxtpl 确认新监听已起,nginx 5 处 proxy_pass 已翻到新端口,**生效在下次 deploy/reload**) |
| **umbra**                   | worker-04                      | ruyin.ai(**无 beta,刻意**)                             | 外仓                                                           | 外仓                        | 外仓                                                                               | ✘(境外不入)                          | 在产(外仓)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| atlas(L1)                   | worker-02                      | atlas.vxture.com / 待分配                              | 待分配(建议 `/srv/md0/atlas`,随 arda 惯例;未经 owner 逐格确认) | `atlas-*`                   | **`vx_atlas_db`** + `atlas_svc`(ADR-007,atlas `.env.example` 已按新名)             | 入 tailnet(类 2)                     | **在产**(独立仓 `vxture-atlas` 已部署 worker-02,2026-07-27 口头确认;stack_root/域名接入状态待补)                                                                                                                                                                                                                                                                                                                                                                                                          |
| ontos(**L2**)               | 待分配                         | ontos.vxture.com / 待分配                              | 待分配                                                         | `ontos-*`                   | `vx_ontos_db` + `ontos_svc`(ADR-007 目标值)                                        | 入 tailnet(类 2)                     | **未建仓/未设计构建**(owner 2026-08-13:**由 L1 迁入 L2**,接手 vxtpl 腾出的 L2 子块——ontos 未部署,零迁移成本,`product_100_matrix` §待办 3 就此销号;2026-08-10 核实:`vxture-ontos` 仓 size=0、只有一个 `Initial commit`、无任何 workflow、无分支保护;端口/域名/库名均为**预留**,不代表已部署)                                                                                                                                                                                                               |
| runos(L1)                   | worker-02                      | runos.vxture.com / 待分配                              | 待分配(建议 `/srv/md0/runos`,随 arda 惯例)                     | `runos-*`                   | `vx_runos_db` + `runos_svc`(容器 `vx-runos-postgres-db-<env>`)                     | 入 tailnet(类 2)                     | **在产**(v0.1.0 首次生产部署端到端成功,2026-08-09;beta 预留但休眠,见 runos TD-006)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| karda(L2)                   | worker-02(沿用现状,待正式对账) | karda.vxture.com(已接入) / beta-karda.vxture.com(新增) | 待分配(建议 `/srv/md0/karda`,随 arda 惯例)                     | `karda-*`                   | **`vx_karda_db`** + `karda_svc`(ADR-007;pg16→18 割接 2026-08-10 完成,karda v0.3.0) | 入 tailnet                           | **在产,端口割接进行中**(karda 仓已部署)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| terra(L2)                   | 待分配                         | terra.vxture.com(建议值)                               | 待分配                                                         | `terra-*`                   | `vx_terra_db` + `terra_svc`(ADR-007 目标值)                                        | 入 tailnet                           | 未接入(seed/env 均无)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| raven(L3,#1)                | 待分配                         | raven.vxture.com / 待分配                              | 待分配                                                         | `raven-*`                   | `vx_raven_db` + `raven_svc`(ADR-007 目标值)                                        | 入 tailnet                           | 未部署(env 已预留)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| anlan(L3,#2)                | 待分配                         | anlan.ai / 待分配                                      | 待分配                                                         | `anlan-*`                   | `vx_anlan_db` + `anlan_svc`(ADR-007 目标值)                                        | 入 tailnet                           | 未部署(env 已预留)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| forge(L3,#3)                | 待分配                         | forge.vxture.com / 待分配                              | 待分配                                                         | `forge-*`                   | `vx_forge_db` + `forge_svc`(ADR-007 目标值)                                        | 入 tailnet                           | 未部署(env 已预留)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| xuanzhen(L3,#4)             | 待分配                         | xuanzhen.ai / 待分配                                   | 待分配                                                         | `xuanzhen-*`                | `vx_xuanzhen_db` + `xuanzhen_svc`(ADR-007 目标值)                                  | 入 tailnet                           | 未部署(env 已预留)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ruyin(client)               | —(desktop 分发)                | ruyin.vxture.com(web 面)                               | —                                                              | —                           | ✘(不进 entitlement 引擎)                                                           | —                                    | client 已注册                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| hermes                      | —(平台内部)                    | 无                                                     | —                                                              | —                           | —                                                                                  | —                                    | internal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

> seed 的 `B` map 是**本地回落值**,非生产绑定。

> **端口分块方案(千位即层号,10 位/产品子块)已迁出本表**,
> 连同当时的分配定稿一并见端口登记表。此处保留一条**未完成事项**:vxtpl 与 karda 是**真实生产端口迁移**,
> 不是纯登记——现状端口都在真实对外服务,迁到新值需要走完整割接(产品仓切新端口监听 → 核实可达 →
> 本仓 nginx 切换指向并 reload → 核实外部访问正常 → 旧端口下线)。karda 已走完,vxtpl 未完成。
> **仅端口已定**——host、stack_root、tailnet 归属类别仍待 owner 逐产品拍板。

## 4. 新产品分配规则(登记时逐格适用)

1. **域名**:`{code}.vxture.com` 缺省规则(product_100 §2 已有异 apex 例外:anlan.ai/xuanzhen.ai);beta = `beta-{code}.vxture.com`(arda 先例);runos 原属异 apex(runos.ai),2026-08-09 迁回缺省规则 `runos.vxture.com`(ADR-004)。
2. **端口对**:见端口登记表(分层分块 + 10 位/产品子块 + 取号顺序)。层归属(owner 2026-08-13 重定):**L1** = atlas / runos;**L2** = ontos / arda / karda / terra;**L3** = N × agent(含 vxtpl/template);**L9** = 边缘服务。分配即写入那张表,不写默认值进模板;涉及**已在产**产品的端口变更,登记只是意图,实际生效需走真实的生产割接流程,不能只改文档就当作已完成。
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
