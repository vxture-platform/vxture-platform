/**
 * boot-splash.tsx - 服务端直出的启动占位。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Theme
 *
 * 补的是 **HTML 到达 → React 画出第一屏** 之间那段空窗。四个门户的外壳全部是
 * 客户端渲染（2026-08-05 实测：服务端 HTML 里没有任何 header / 侧栏标记），所以
 * 刷新时这段空窗直接暴露给用户，就是"白屏再加载"。
 *
 * `ShellBootScreen` 补不了这一段——它自己是 React 组件，同样要等挂载。本件是
 * **静态标记**，随 layout 一起由服务端发出，在第一个字节就存在。
 *
 * 显隐由 CSS 控制（见 globals-base.css）：React 根挂载后在 html 上打
 * `data-app-ready`，占位随即隐藏。整个过程只有一次属性赋值，不依赖任何计时器。
 *
 * 与 ShellBootScreen 的分工：
 *   本件          —— 挂载**之前**（框架还没跑）
 *   ShellBootScreen —— 挂载**之后**、会话状态未定之前
 * 两者视觉一致（居中转圈 + 同一底色），衔接处看不出交接。
 */

/**
 * 放在 `<body>` 里、React 根之外。React 根之内会被水合接管，一旦被接管它就跟
 * 其余组件一样要等 JS——那就失去了存在的意义。
 */
export function BootSplash() {
  return (
    <div className="vx-boot-splash" aria-hidden="true">
      <div className="vx-boot-splash__spinner" />
    </div>
  );
}

/**
 * 应用挂载后调用一次，让占位让位。
 *
 * 挂在 html 而不是 body：`data-app-ready` 与主题启动脚本写的 `.dark` 同处一个
 * 元素，"首帧就该定下来的东西"集中在一处，不用两边找。
 */
export function markAppReady(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-app-ready", "");
}
