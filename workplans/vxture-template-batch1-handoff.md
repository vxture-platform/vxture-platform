# vxture-template 批 1 交接说明(治理基座 + docs 骨架 + 初始化工具)

> **给谁**:在 `D:\MyWebSite\vxturestudio\vxture-template` 里新开的 Claude Code 会话(该目录必须是打开的项目,否则写护栏拒写)。
> **产出**:一个能过自整顿 runbook **批 A–D** 的产品仓骨架(治理/密钥/SCA/docs 编号),外加占位符 + 实例化脚本 + 两份 checklist。
> **不含**(留后续批):CD/环境(批 E)、业务面 DB(批 F)、平台对接三通道模块、app 源码——批 1 只搭"能自验绿的基础设施外壳"。
> **权威依据(全部只读可达,先读)**:见 §0。**执行前先读这些,不要凭本文复述臆造。**

---

## 0. 先读(权威源,只读可达)

| 用途                                   | 路径(绝对,只读)                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模板设计总纲(批次/内容/参数/checklist) | `D:\MyWebSite\vxture\docs\30-design\product_240_repo-template.md` §2.1 / §2.2 / §2.6 / §2.7 / §2.8 / §7                                                                                                                      |
| 治理规范(要求 WHAT)                    | `D:\MyWebSite\vxture\docs\10-standards\140-repo-governance-standard.md` §1–§3 / §9 / §10                                                                                                                                     |
| 自整顿 runbook(HOW + 每步机检)         | `D:\MyWebSite\vxture\docs\50-deployment\rebuild\20-self-rectify-runbook.md` §0 / §1(批 A–D) / §2                                                                                                                             |
| docs 编号规范                          | `D:\MyWebSite\vxture\docs\10-standards\070-docs-taxonomy.md`                                                                                                                                                                 |
| 分支保护 ruleset(原样复制)             | `D:\MyWebSite\vxture\docs\50-deployment\rebuild\main-ruleset.json`                                                                                                                                                           |
| 工具复制源(vxture-platform)            | `D:\MyWebSite\vxture\` 的 `scripts/guardrails/check-docs-numbering.mjs`、`.osv-scanner.toml`、`.gitleaks.toml`、`.husky/pre-commit`、`.github/workflows/secret-scan.yml`、`.github/workflows/ci.yml`(audit/quality-gate job) |
| 骨架/版式参照(vxture-arda,只读)        | `D:\MyWebSite\vxturestudio\vxture-arda\` 的 `CLAUDE.md`、`.env.example`、`.editorconfig`/`.gitattributes`/`.npmrc`、`docs/` 十段结构、`.github/`、`package.json` 脚本名                                                      |

> 复制后按本仓改路径/包名/registry;**勿照抄 vxture-platform/arda 专属值**(namespace/host/域码)。

---

## 1. 全局参数与既定裁决(照做,勿再议)

- **包管理器 = pnpm**(owner 2026-07-20,全栈一致):`pnpm-workspace.yaml` + `pnpm-lock.yaml`;CI 缓存键、osv `--lockfile=pnpm-lock.yaml`、`pnpm --recursive --if-present lint` 全按 pnpm。**不要照抄 arda 的 npm workspaces**。
- **占位符** = `__PRODUCT_CODE__`(满足 `^[a-z][a-z0-9_-]{0,31}$`);实例化脚本把它替成真实 product*code,并派生:compose 前缀 `<code>-app/-redis/-db`、镜像名 `<code>-app`、DB 名 `vxturebiz*<code>\_<env>`、角色 `<code>\_svc`、包域 `@<code>/\*`、OIDC client `<code>`/`<code>-beta`、secret 名 `<CODE>\_DB_SVC_PASSWORD` 等(全表见 product_240 §2.7)。批 1 先埋占位符,后续批用。
- **docs 编号 = org 下划线族**:模板版 `check-docs-numbering.mjs` 在 platform 版基础上**收紧**为严格 `{kind}_{domain}_{NNN}_{slug}`(kind∈data/design/ops),**不带 arda 连字符变体**(§6#23/taxonomy)。
- **required checks 五项**(main-ruleset.json 权威):`quality-gate` / `build` / `test-coverage` / `audit` / `gitleaks`——CI job 名必须精确产出这五个 context;**无单测的骨架仓也要提供恒绿 `test-coverage` job**(占住 context)。
- **`.gitattributes` 必加 `*.md text eol=lf`**(本工作线教训:缺此规则 → Windows 提交致 prettier/Format 漂移。批 1 一次修对)。

---

## 2. 批 1 文件清单(按 runbook 批 A–D 分组;标 [源])

> [源] = C(从 vxture-platform 原样复制)· C收紧(复制后收紧)· A(照 vxture-arda 版式新写)· 新(本仓新写)· [P]=含 `__PRODUCT_CODE__` 占位

### 批 A — 主干 + 分支保护(140 §1)

- `README.md`〔新/[P]〕、`CLAUDE.md`〔A/[P] 照 arda 版式的产品协作纲领,pnpm 版〕
- `.editorconfig`〔C〕、`.gitignore`〔A〕、`.npmrc`〔A;含 `@vxture:registry=https://npm.pkg.github.com`〕
- **`.gitattributes`**〔A + **加 `*.md text eol=lf`、`*.sh text eol=lf`**〕
- `docs/50-deployment/rebuild/main-ruleset.json`〔C,原样;单人仓 `required_approving_review_count=0`〕——或按本仓放置约定,ruleset apply 用它
- ruleset 的五个 required contexts 依赖批 B/C/D 的 CI job 先存在(见 §3 落地顺序)

### 批 B — 密钥四层(140 §2/§3)

- `.gitleaks.toml`〔C收紧;去掉 platform 专属 allowlist,产品自留最小〕
- `.github/workflows/secret-scan.yml`〔C,pinned gitleaks 二进制 + sha256;job 名 = `gitleaks`〕
- `.husky/pre-commit`〔C;`git config core.hooksPath .husky` 接线,缺 gitleaks 二进制 warn-and-pass〕
- secret/variable 分层出厂只留说明(实际 secret 由 owner 在 §5 GitHub bootstrap 配;org 级共享凭证不入仓)

### 批 C — SCA 硬门(140 §9)

- `.osv-scanner.toml`〔新;**空忽略基线**,不复制 platform 的记名忽略〕
- `.github/workflows/ci.yml` 的 `audit` job〔C;pinned osv-scanner 二进制 + sha256 + `OSV_SCANNER_VERSION` 变量;命令必带 `scan -L pnpm-lock.yaml --config .osv-scanner.toml`;加入 required〕

### 批 D — docs 编号 + CI 聚合 + package.json + 初始化工具(taxonomy + §2.6/§2.8)

- `scripts/guardrails/check-docs-numbering.mjs`〔C收紧;域文档正则收紧为严格下划线族〕
- `docs/` 十段骨架:`00-meta/00-index.md`(表)、`10-standards/`(薄索引指向 org 标准,不复制正文)、`20-specs/`、`30-design/`(空,域文档待产品)、`40-implementation/`、`50-deployment/`、`60-operations/`(空 `TD` 寄存器)、`70-workplan/`、`80-liaison/`、`90-memory/10-agent.md`、`30-design/decisions/`(空 `ADR` 寄存器)——**每级 `00-index.md`,全编号,day-one 过 `lint:docs-numbering --strict`**
- 各 package 一个薄 `AGENTS.md` 指向 docs(批 1 若无 package 则根级一个)
- **`package.json`(根)**〔新/pnpm〕:脚本名(机检契约,不可改名)`type-check:all`、`lint`、`lint:docs-numbering`;`pnpm-workspace.yaml`〔新〕
- `.github/workflows/ci.yml` 的 `static-checks`(git diff --check + `node scripts/guardrails/check-docs-numbering.mjs --strict`)+ `build` + `test-coverage`(**骨架期恒绿占位**,无 app 时 no-op pass)+ `quality-gate`(聚合 needs,保持 required-check 名稳定)
- `scripts/init/instantiate.mjs`〔新〕:输入 product_code,把全仓 `__PRODUCT_CODE__` 替换 + 派生名(§2.7 表),生成 `.env.example` 骨架;纯 node 零依赖
- 两份 checklist(product_240 §2.8)放 `docs/50-deployment/`:①平台侧登记(owner/平台线动作)②GitHub bootstrap(见 §5)

> ⚠️ **CI 骨架期设计点(务必处理)**:`build`/`test-coverage` 在"无 app 源码"的骨架上必须**可绿**——`build` 可为占位步骤(`echo "skeleton: no app yet"`)、`test-coverage` 恒绿(§6#8 决定)。后续批 2 接入 app 时再替为真实构建。ruleset 的五 context 靠这几个 job 名产出。

---

## 3. 落地顺序(每批一 PR,附机检验收;照 runbook §1)

**顺序铁律(空仓)**:先 `git init` → 建 `main` → **首推建立 main + 跑一次 CI 让 required checks 产生一次** → **此时**才 apply `main-ruleset.json`(先 apply 会挡首次代码导入)。

| 批      | 落地                                      | 机检验收(绿=达标)                                                                                                   |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A       | 根文件 + main + (先不 apply ruleset)      | 首推成功;`git diff --check` 干净                                                                                    |
| B       | 密钥四层                                  | `gitleaks detect --no-banner`(全史 0 命中);CI `gitleaks` 绿                                                         |
| C       | SCA                                       | `osv-scanner --config=.osv-scanner.toml --lockfile=pnpm-lock.yaml` → `No issues found`;CI `audit` 绿                |
| D       | docs 骨架 + CI 聚合 + package.json + init | `node scripts/guardrails/check-docs-numbering.mjs --strict` exit 0;`pnpm type-check:all`(占位可空过);CI 五 job 全绿 |
| A(收尾) | **apply ruleset**                         | `gh api repos/vxture/vxture-template/rulesets` 有 branch ruleset,required checks 含五项                             |

**一条龙总验收**(product_240 §7 / runbook §2):

```
gitleaks detect --no-banner \
  && osv-scanner --config=.osv-scanner.toml --lockfile=pnpm-lock.yaml \
  && node scripts/guardrails/check-docs-numbering.mjs --strict \
  && pnpm type-check:all && pnpm --recursive --if-present lint
```

CI 侧:`main` 的五 required checks 全绿 = 批 1 达标。

---

## 4. 每步纪律(G6 / 分支 / commit)

- **主干模式**:每批一短命特性分支 → PR → squash 合并 → 删分支;禁直接 push main。
- **G6**:每次 commit/push/合并单独确认;commit **英文**;注释英文;commit 尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`;PR 尾生成行。
- **确认纪律**:不绕护栏;合并是 owner 动作(或经明示授权)。
- 只提交本批应有文件,别把临时/无关文件带进。

---

## 5. GitHub bootstrap(代码外一次性,owner 动作)

- **建仓公开(开发阶段默认,owner 2026-07-20;不要求私有)** + 开 push protection(公开仓免费全量);「凭证永不入库」为绝对铁律;
- 首推 main → CI 一跑 → apply ruleset(§3 顺序);
- **本批不需要**部署 Environment/DEPLOY\_\* secrets(那是批 E);批 1 只需 CI 能跑(`NODE_AUTH_TOKEN`/`@vxture:registry` 读包权限若 ci 用到则配,否则从简)。
- ACR/tailscale/部署类 secret 一律**批 E 再配**。

---

## 6. 边界(务必守)

- 新会话**只写 vxture-template**;`D:\MyWebSite\vxture`(平台仓)与 `D:\MyWebSite\vxturestudio\vxture-arda` **只读参照**,不得写。
- **不代 arda 做整改**(arda §9 清单归 arda 线)。
- 遇本文/product_240 未覆盖的新缺口 → **先回平台仓补标准**(governance/product_240),再模板照做;不在模板里现造标准。
- 批 1 完成 = runbook 批 A–D 机检全绿 + ruleset applied;**批 2(平台对接层 + 业务面 DB 基线)另起**,届时回读 product_240 §2.3/§2.4。

---

## 7. 开场建议(新会话第一步)

1. 读本文 + product_240 §2.1/§2.2/§2.6/§2.7/§2.8/§7 + 140 §1–§3/§9/§10 + runbook §0/§1(批 A–D)。
2. `ls` vxture-arda 与 vxture-platform 的对应文件,确认复制源实体。
3. 按批 A→B→C→D 顺序执行,每批一 PR + 机检验收,再 apply ruleset。
4. 有裁决级歧义(如 CI 骨架 build/test-coverage 的占位实现方式)→ 先按本文 §2 ⚠️ 的取向做,拿不准问 owner。

---

## 8. 平台侧通知(2026-07-21)

正式回函已合 main(`2cf8d1c0`)：`docs/20-specs/220-vxtpl/10-vxtpl_301_shared-150-health-import-2607212159.md`。
涉及本仓的事项与怎么处理，由该会话自行按回函决定，此处不重复代拟执行步骤。

---

## 9. TD-001/TD-002 收口 + vxtpl_301 回收(2026-07-21)

**TD-001 关闭**:`@vxture/shared@1.5.0` 已作为真实依赖接入
`portals/app/package.json`;`entitlement/types.ts` 的 `TIERS`/
`SUBSCRIPTION_STATUSES`/`Tier`/`SubscriptionStatus` 改为直接从
`@vxture/shared` 导入(本地拷贝已删),经核对与旧本地拷贝逐字节一致(含顺序,
顺序对代表状态优先级有约束意义)。原计划的 `check-catalog-domains` 式 diff
护栏判定为**不再需要**——直接 import(而非拷贝字面量)使漂移在结构上不可能
发生,没有可比对的对象。

**TD-002 登记 + 关闭(追溯登记)**:平台核查 arda 来函时发现 vxtpl 的
health 端点实现是 `@vxture/shared` 未发包期间的自写 vendor 过渡态,与标准
025"共享助手,禁止各服务各写一份"条款偏离且**未申报**——即
`docs/20-specs/220-vxtpl/10-vxtpl_301_shared-150-health-import-2607212159.md`
(`vxtpl_301`)所指。已按 2026-07-21 新增的偏离纪律追溯登记 TD-002(条款/原因
/回收条件),回收动作(改为 `import { buildHealthIdentity } from
"@vxture/shared"`、删除 `portals/packages/shared/src/{health,version}.ts`)
随 TD-001 同一变更完成。

**回执已发**:vxture-template 侧的正式回函已合
`docs/80-liaison/30-2607211500-vxtpl_301-shared-health-recovery-reply.md`,
确认 vxtpl_301 §3 四项动作全部完成 + 验证结果,并对新偏离纪律无异议、承诺
后续遵行(条款处标注 + 同日 TD 登记 + 回报,不再静默偏离)。

**PR / commit**:`vxture-template` PR #28(`26688e9`,TD-001 + shared 接线)、
PR #29(`bb80b2b`,TD-002 登记 + 回函)。CI 五项必需检查全绿,含 `build`(证实
`NODE_AUTH_TOKEN` 在 CI 内成功拉取 `@vxture/shared`)与 `audit`(osv-scanner
对新依赖无告警)。

同批复核还补齐了 `product_240` §2.2 要求但此前缺失的 `codeql.yml` +
`.github/dependabot.yml`(PR #30,`ff75471`)——arda 超集三件现已在模板齐全。
