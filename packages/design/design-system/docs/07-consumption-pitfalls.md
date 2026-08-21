# 接入陷阱：四条「看起来对、实际错」的地方

版本：1.0.0 · 立项：2026-08-21（vxture-platform#268）

本文只收一类东西：**接上去不报错、构建全绿、但结果是错的**。用法差异、API 说明在
[`01-usage.md`](./01-usage.md)，那些错了会有报错，靠读文档能避开；这里这四条不会报错，
只能靠先知道。

来源是真实接入方（vxtpl）分三轮报回的踩坑记录。他们的原话值得原样引用：

> 到目前为止接入踩到的坑，有一个共同形状：**都不报错**。

---

## 1. T2 语义层没有前缀，会和你自己的 token 撞名

DS 的 token 分两层，前缀规则**相反**：

| 层            | 命名                                     | 例                                              |
| ------------- | ---------------------------------------- | ----------------------------------------------- |
| T1 原始层     | 带 `--vx-` 前缀                          | `--vx-blue-600`、`--vx-space-4`                 |
| **T2 语义层** | **不带前缀**（Tailwind v4 主题变量约定） | `--primary`、`--border`、`--radius`、`--accent` |

T2 里有 608 个无前缀名，其中这 18 个是单段短名、撞名概率最高：

```
--accent  --ai      --background  --border  --card       --destructive
--foreground  --info  --input     --link    --muted      --popover
--primary --radius  --ring        --scrim   --success    --warning
```

**后果**：你自己的样式表若也用 `--border` / `--radius` / `--accent` 这类名字，而它加载在
DS 之后，你会**把 DS 的调色板整个覆盖掉**——每个界面都受影响，唯一的症状是「接了设计系统
但看起来没变」。没有报错，没有警告，样式表也确实生效了，只是生效的是你的值。

**做法**：私有 token 一律加自家前缀（`--myapp-*`）。这条值得在你那侧加一条会红的测试：
断言自己的样式表不定义任何 DS 已占用的名字。

**另一半**：如果你从 2.x 升上来，语义层是从 `--vx-color-primary` 这类带前缀名改过来的。
改名之后你的 `var()` **不报错、不失败，只是解析成默认色**——接入方那边 22 个门禁 token
失效了 19 个，构建全绿。升级时逐个核 `var()`，不要靠肉眼看页面。

## 2. 暗色是 `.dark` 类驱动的，不是 `prefers-color-scheme`

DS 的暗色变体定义在 `@vxture/design-tokens/styles/tailwind.css`：

```css
@custom-variant dark (&:where(.dark, .dark *));
```

整个 DS 的 CSS 图里 `prefers-color-scheme` 出现 **0 次**。

**后果**：你按常规写了媒体查询暗色块，就会得到「半黑半白」——你自己的面板翻了，DS 的
token 没翻。同样没有报错，而且要切系统主题才看得见。

**做法**：跟着 `.dark` 走。类由 `themeBootstrapScript` 在首帧前同步打到 `<html>` 上；
它是纯字符串常量，从 `@vxture/design-system/server` 取，在 server layout 的 `<head>` 里渲染。

## 3. `/server` 子集比主入口小得多，且**只有它**能进 RSC

`@vxture/design-system` 主入口首行是 `"use client"`，是完整客户端面；
`@vxture/design-system/server` 是 server-safe 子集，运行时 **27 个导出**
（伞包，含 tokens 与 `themeBootstrapScript`），底层 `@vxture/design-ui/server` 是 **19 个**。

从 6.4.0 起，`/server` 的**类型面等于运行时面**，由 `check-packed-consumability.mjs`
在发布流水线上强制。6.3.x 及更早不是：`.d.ts` 多转出了整个客户端面，于是
`import { Button } from "@vxture/design-system/server"` **tsc 零错误、构建全绿、
运行时 `Button === undefined`**——类型系统主动为错误写法背书，而且只在那条渲染路径被
走到时才炸，藏在条件分支里就可能一路到生产。若你还在 6.3.x 及更早，这条仍然活着。

**做法**：需要客户端组件就从主入口取，并在自己这侧建一个 `"use client"` 模块做具名转出，
把边界关在一个文件里。

## 4. 装完即用，不需要写任何 `@source`

从 6.4.0 起，DS 的 `styles/globals.css` 自带的 `@source` 指向**已发布的 `dist/`**，
两种安装形态（monorepo 软链、registry 安装）下都解析得到。你只需要：

```css
@import "@vxture/design-system/styles/globals.css";
@import "@vxture/design-system/styles/brands/vxture.css";
```

**6.3.x 及更早不是这样**：那几版的 `@source` 指向 `src/`，而两个包的 `files` 只发 `dist`，
装完之后两个目标都不存在。而 `@source` 解析为空**不报错**，症状与根本没写完全一致——
变量注册成功、手写 CSS 层照常抵达、组件 DOM 正确，但它们身上每一个工具类都不产出，
页面渲染成一片灰。它只在 monorepo 里通，因为工作区包是软链到完整签出的。

若你被迫留在旧版，绕法是在 Tailwind config（JS，能算路径）里解析包的真实位置，
**不要硬编码 `node_modules/@vxture/...`**——pnpm 的实际路径带内容哈希，硬编码活不过下一次
install。

---

## 为什么这份文档存在

上面四条里有三条已经在包内修掉了（2、3、4 的现状描述即修复后的行为），但**修复不能替代
这份文档**：接入方大概率不是从最新版起步的，而这类缺陷的代价全部发生在「不知道要查」的
那段时间里。

更重要的是留下判据：**凡是「接了看起来能跑、实际错了」的问题，都要落到这里，并且尽量
同时落一条会红的检查**。DS 目前的两道机器化关卡是
`check-server-entry-safety.mjs`（`/server` 在 react-server 下真的可求值）与
`check-packed-consumability.mjs`（按 registry 安装形态验 `@source` 目标、工具类产出、
`/server` 类型面）。两条都跑在发布流水线上——**发布前**，不是发布后。
