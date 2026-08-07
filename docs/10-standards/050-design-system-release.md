# Design System 版本发布规范

版本：2.1.0
日期：2026-08-02
范围：`@vxture/design-tokens`、`@vxture/design-ui`、`@vxture/design-system`、`@vxture/shared`、`publish-design-system.yml`

本文定义设计包的版本判断、发布准备、dry run、真实发布与发布后验证。发布必须走 PR、CI、merge、workflow，禁止从本地直接 `pnpm publish` 到 GitHub Packages。实现文件为 `.github/workflows/publish-design-system.yml`。

## 1. 包职责与版本边界

设计系统拆为三包，依赖方向单向：**tokens ← ui ← system**。由 `lint:boundaries` 的两条规则硬门守（`no-design-ui-to-system`、`no-design-tokens-to-upper`）。

| 包                      | 职责                                                                           | 依赖                    | 上层应用感知方式       |
| ----------------------- | ------------------------------------------------------------------------------ | ----------------------- | ---------------------- |
| `@vxture/design-tokens` | T1 原子（Tailwind v4 theme 镜像）+ T2 语义，两层 CSS；叠放次序与模式轴的 TS 面 | 无（零运行时依赖）      | 一般不直接依赖         |
| `@vxture/design-ui`     | 无状态组件层：基础组件、平台图案、图标、hook、工具                             | tokens                  | 一般不直接依赖         |
| `@vxture/design-system` | 伞包 + 运行时接线：主题 / 密度 / 字号 provider、shell、auth、品牌样式入口      | tokens + ui（精确版本） | **应用侧主依赖**       |
| `@vxture/shared`        | 跨层类型、常量、纯工具                                                         | 无                      | 默认传递依赖，按需显式 |

消费应用只依赖 `@vxture/design-system`。伞包把下面两层原样转发，拆包对上层不可见——**不要**因为"只用组件"就去直接依赖 `design-ui`，那会绕开伞包的运行时接线。

**伞包对另两包用精确版本**（`workspace:*` → 发布时替换为确切版本号，不是 caret）。理由：伞包把 tokens 与 ui 的类型原样 re-export，caret 允许消费方解析到与伞包构建时不同的次版本，在转发边界上产生类型不匹配，而这类不匹配在伞包自己的 CI 里看不见。

**design-ui 对 design-tokens 的依赖是样式依赖，不是代码依赖**：组件里没有一行 `import` 指向它，但组件用的每个工具类都由它的 CSS 注册。声明为 `dependency` 而非 `peerDependency`，是为了单独安装时也能拿到那份 CSS。

## 2. 版本号规则

四个包独立维护 SemVer，是否同时发版由实际变更决定，不做全仓库统一版本。

| 变更类型                     | tokens    | ui        | system        | shared        |
| ---------------------------- | --------- | --------- | ------------- | ------------- |
| 修 token 取值（不增删名字）  | Patch     | 不变      | Patch         | 不变          |
| 增 token 语义名 / 扩展档     | Minor     | 不变      | Minor         | 不变          |
| 删除或改名 token / 收窄色板  | **Major** | 视情况    | **Major**     | 不变          |
| 修组件样式或行为 bug         | 不变      | Patch     | Patch         | 不变          |
| 新增组件、新增 cva 变体      | 不变      | Minor     | Minor         | 不变          |
| 删除或改名组件、改组件 props | 不变      | **Major** | **Major**     | 不变          |
| 改 provider / shell / auth   | 不变      | 不变      | Patch / Minor | 不变          |
| 删除或改名任一包的公开入口   | —         | —         | **Major**     | 视情况        |
| 改 shared 类型、常量、工具   | 不变      | 不变      | 不变或 Patch  | Patch / Minor |
| 仅文档、CI、发布流程         | 不发版    | 不发版    | 不发版        | 不发版        |

**下层的 major 会向上传导**：tokens 删一个 token 名，ui 的组件可能哑火，伞包的公开行为随之改变——所以下层 major 时上层同样按 major 处理，除非能证明变更未穿透。伞包用精确版本，这一点无法靠版本范围回避。

token 层的破坏性判据与 CSS 不同于代码：**删掉一个 CSS 变量不会报错，只会静默失效**。故 token 的删改一律按 major，不做"应该没人用"的推定。

### 2.1 预发布

破坏性变更分批落地、消费端尚未迁移时，走预发布版：`<next-major>.0.0-<id>.<n>`，标识符按成熟度取 `alpha` / `beta` / `rc`。同一批次内继续迭代只递增末位（`-alpha.0` → `-alpha.1`），major 号在整批收口前不重复决策。

预发布的**通道即标识符**：`2.0.0-alpha.0` 发到 dist-tag `alpha`，不发到 `latest`。这条由流水线从版本号自动推出，不需要手填——`npm publish` / `pnpm publish` 不带 `--tag` 时一律打 `latest`，**预发布版也不例外**，漏了这一步就等于把未完成的 major 推给了所有按默认范围安装的消费方。

预发布期间消费方须显式钉版本（`"@vxture/design-system": "5.0.0-alpha.0"`），不用 caret：caret 在预发布区间的匹配规则容易误判，且这个阶段本就不该自动跟进。整批收口后发正式 major，正式版才回到 `latest`。

## 3. 发布顺序

**顺序是硬约束**，不是习惯：

```
@vxture/shared → @vxture/design-tokens → @vxture/design-ui → @vxture/design-system
```

pnpm 打包时把 `workspace:` 协议替换成真实版本号，所以 `design-ui` 发出去会声明 `"@vxture/design-tokens": "^x.y.z"`。若那一版还没进 registry，**消费方 install 直接失败，而流水线自己是绿的**——`pnpm publish` 不校验依赖可解析。

流水线按此顺序逐包处理，每包各自判断该版本是否已存在，已存在即跳过。整条流水线因此幂等：同一个 tag 重跑不会失败，只发新版本的那些包。

## 4. 发布准备

发布准备必须从最新 `main` 创建短期分支，提交后通过 PR 合并回 `main`。

1. 确认变更已合并到 `main`，且 `main` CI 通过。
2. 根据第 2 节判断需要 bump 的包。
3. 修改对应 `package.json` 的 `version`。
4. 如 lockfile 发生变化，一并提交 `pnpm-lock.yaml`。
5. 本地至少运行：

```bash
# 仓库级守卫：token 生成物同步、组件类名真能产出、包依赖方向
pnpm lint:design-tokens
pnpm lint:design
pnpm lint:design-classes
pnpm lint:boundaries

# 按依赖方向逐包构建。design-system 的类型依赖 design-ui 的产物，
# 用 --parallel 会随机失败。
pnpm --filter @vxture/shared build
for p in design-tokens design-ui design-system; do
  pnpm --filter "@vxture/$p" type-check
  pnpm --filter "@vxture/$p" lint
  pnpm --filter "@vxture/$p" build
done
```

6. 创建 PR，等待 `Type Check · Lint · Boundaries` 等 required checks 通过。
7. 通过 squash merge 合并到 `main`。

提交信息建议：

```text
chore(ds): release design-tokens 1.1.0
chore(ds): release design-tokens 1.1.0, design-ui 1.1.0 and design-system 3.1.0
chore(shared): release shared 1.2.3
```

同时发多个包时按依赖顺序列出，读的人一眼能看出传导关系。

## 5. Dry Run

真实发布前必须先运行 dry run。

1. 进入 GitHub Actions。
2. 选择现有 `publish-design-system` workflow。
3. `Run workflow` 选择 `main`。
4. `dry_run` 默认就是 `true`，保持默认值。
5. 等待 workflow 成功。

dry run 会执行：

- 安装依赖，build `@vxture/shared`
- 三包按依赖方向逐个 type-check / lint / build
- 仓库级守卫：`lint:design-tokens`、`lint:design`、`lint:design-classes`、`lint:boundaries`
- 公开入口快照校验（`check-design-system-exports.mjs --strict`）
- 四个包各自 `pnpm pack --dry-run`
- 查询 GitHub Packages 中每个包的当前版本是否已存在，并在 job summary 里列出
  "待发布 / 已存在，跳过"

dry run 的 summary 就是发布清单——真实发布前对着它确认一遍，尤其确认没有漏掉
下层包（见第 2 节"下层的 major 会向上传导"）。

dry run 失败时禁止真实发布，必须新建修复分支，通过 PR 合并后重新 dry run。

## 6. 真实发布

真实发布只能在 dry run 成功后执行。当前 workflow 支持两种入口：

| 入口     | 触发方式                                      | 使用场景              |
| -------- | --------------------------------------------- | --------------------- |
| 手动发布 | `workflow_dispatch`，显式设置 `dry_run=false` | 常规 DS 包发布        |
| tag 发布 | 推送 `ds-v*.*.*` tag                          | 需要以 tag 固化发布点 |

常规优先使用手动发布。tag 发布前也必须先在同一 `main` 提交上完成 dry run。

workflow 按第 3 节的顺序逐包处理：查询该版本是否已存在 → 不存在则发布 → 已存在则跳过。

相同版本已存在时跳过，因此整条流水线幂等，同一个 tag 重跑安全。**禁止删除远端 package 后复用同一个版本号**——消费方的 lockfile 会指向一个内容已变的版本，且没有任何提示。

长期规划：DS 发布不再作为游离的模块级发布能力扩张，而是作为 `publish-*` 包发布体系中的一个清晰入口。未来如果引入统一包发布调度层，应通过输入参数或 job matrix 表达发布对象，例如 `package_group=design-system`，并保持本规范中的 dry run、版本检查、发布顺序和发布后验证规则不变。

## 7. 发布后验证

发布完成后必须验证 GitHub Packages 可读：

```bash
npm view @vxture/shared@<version> version --registry=https://npm.pkg.github.com
npm view @vxture/design-system@<version> version --registry=https://npm.pkg.github.com
```

如只发布 DS 且 shared 未变，可只验证 DS。随后选择一个消费仓库执行：

```bash
pnpm install --frozen-lockfile
pnpm type-check
pnpm lint
pnpm build
```

若消费仓库安装失败，优先检查 `.npmrc`、GitHub Packages token 权限、package access 和 lockfile 中的版本解析。

## 8. 回滚与补丁

GitHub Packages 版本发布后不可覆盖。出现问题时按补丁版本处理：

1. 新建 `fix/*` 分支修复。
2. bump patch 版本。
3. PR 合并到 `main`。
4. 重新 dry run。
5. 发布新的 patch 版本。

消费端回滚优先通过 lockfile 回退到上一可用版本，不删除已发布包。

## 9. 禁止事项

- 禁止本地直接 `pnpm publish`。
- 禁止绕过 PR、CI 或 required checks 修改版本。
- 禁止真实发布未经过 dry run 的 `main` 提交。
- 禁止复用已经发布过的版本号。
- 禁止把 GitHub Packages token 写入仓库、PR 描述、日志或截图。
- 禁止为了单个消费端临时改 DS 公共入口；必须按 SemVer 和 guardrail 更新。
- 禁止跳过发布顺序，或用 `--parallel` 并行发布三包——上游未进 registry 时下游会
  发出一个装不上的版本，而流水线自己是绿的。
- 禁止应用直接依赖 `@vxture/design-ui` 或 `@vxture/design-tokens`：它们是伞包的
  实现细节，绕过去就拿不到运行时接线，且版本约束不再由伞包保证。
- 禁止把预发布版发到 `latest` dist-tag（见 2.1）。

## 10. 关联文档

- `packages/design/design-system/docs/` —— 对外使用规范（随包发布）
- `docs/10-standards/060-design-system.md` —— DS 内部工程规范
- `docs/10-standards/065-design-token-pipeline.md` —— token 生成与守卫
- `docs/10-standards/040-design-system-package-convergence.md` —— 包结构
- `.github/workflows/publish-design-system.yml` —— 实现
