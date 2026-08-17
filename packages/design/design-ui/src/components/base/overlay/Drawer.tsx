"use client";

/**
 * Drawer.tsx - 侧滑抽屉（shadcn Sheet 结构 + Radix Dialog）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Overlay
 *
 * 对应 shadcn 的 **Sheet**（侧滑面板），不是 shadcn 的 Drawer——后者走 vaul，
 * 面向移动端的下拉抽屉，本仓没有那个场景，也不为此引一个新依赖。
 *
 * 两处相对上游的定制：
 * 1. **保留受控便捷式 API**（open / onClose / title / footer），不改成上游的
 *    Sheet + SheetTrigger + SheetContent 组合式。抽屉的页眉页脚结构是固定的，
 *    开成组合式等于让每个产品各写一遍 header/footer 的 markup，正是要防的分叉。
 *    组合能力仍在——`children` 就是内容区。
 * 2. side 只开左右两侧。上下侧滑在工作台里没有出现过，等有实据再加。
 *
 * 原实现是手写的 div + scrim button，自己 addEventListener 处理 Esc、自己改
 * document.body.style.overflow，且无焦点陷阱。换到 Radix Dialog 后这些全部由
 * primitive 承担：Portal、焦点陷阱与归还、滚动锁、aria-modal、Esc 与点击遮罩关闭。
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";
import { Icon } from "../../../icons";

/** 抽屉宽度挡位，走 `panel` 梯——见 `width` 的注释，别接 overlay 梯。 */
export type DrawerWidth = "sm" | "md" | "lg";

/** ⚠ 必须是完整字面量：Tailwind 扫源码文本，拼接产不出工具类且不报错。 */
const DRAWER_WIDTH_CLASS: Record<DrawerWidth, string> = {
  sm: "w-panel-sm",
  md: "w-panel-md",
  lg: "w-panel-lg",
};

export interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly side?: "right" | "left";
  /**
   * 面板宽度。**优先给挡位**（`panel` 梯：sm 448 / md 512 / lg 672），数字只留给
   * 确有理由的例外。
   *
   * 原注写着「运行时数据，不属于设计刻度」——那句话是错的，实测后果就是四个抽屉两个
   * 520 两个 560，没有任何理由，只是各写各的。面板多宽是设计决定。
   *
   * ⚠ **不要接 `OverlayWidth`**（我第一版接错了）：那道梯是给下拉与气泡的，最宽一档
   * `xl` 只有 384px，`layout-semantic.css` 的注释写着「再宽应分栏或改用 panel」。
   * 抽屉全部在 500px 以上，上那道梯只会得到一个被腰斩的面板——而且不报错。
   */
  readonly width?: DrawerWidth | number | string;
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

const SIDE_CLASS = {
  right:
    "inset-y-0 right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
} as const;

export function Drawer({
  open,
  onClose,
  side = "right",
  width,
  title,
  description,
  footer,
  children,
  className,
}: DrawerProps) {
  /* 挡位走类名（Tailwind 扫的是完整字面量，拼接扫不到且不报错），数字/裸串仍走
     内联样式——两条路不能混，混了会同时出现 class 与 style 而 style 永远赢，挡位
     就成了摆设。 */
  const ladder =
    typeof width === "string" && width in DRAWER_WIDTH_CLASS
      ? DRAWER_WIDTH_CLASS[width as DrawerWidth]
      : null;
  const widthValue = ladder
    ? undefined
    : typeof width === "number"
      ? `${width}px`
      : width;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-drawer bg-scrim",
            "supports-backdrop-filter:backdrop-blur-xs",
            "data-[state=open]:animate-in data-[state=open]:fade-in",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out",
          )}
        />
        <DialogPrimitive.Content
          style={widthValue ? { width: widthValue } : undefined}
          className={cn(
            ladder,
            // 抽屉贴着视口边缘，只有朝内的一侧需要边——故留 border 不改 ring，
            // 由 SIDE_CLASS 决定是 border-l 还是 border-r。
            "fixed z-drawer flex h-full w-full flex-col border-border bg-popover text-foreground shadow-dialog",
            // 抽屉是浮层面板不是页面正文：content 族的 1024 会让它占掉大半屏。
            "max-w-panel-lg outline-none",
            "duration-base ease-standard data-[state=open]:animate-in data-[state=closed]:animate-out",
            SIDE_CLASS[side],
            className,
          )}
        >
          {/* Radix 要求 Content 内必须有可访问名。无标题时给一个隐藏的兜底。 */}
          {title ? (
            <div className="flex items-start justify-between gap-md border-b border-border p-lg">
              <div className="flex flex-col gap-2xs">
                <DialogPrimitive.Title className="text-title-sm">
                  {title}
                </DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="text-body-sm text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close
                className={cn(
                  "inline-flex size-control-md shrink-0 items-center justify-center rounded-md",
                  "text-muted-foreground hover:bg-accent hover:text-foreground",
                  interactive,
                )}
                aria-label="关闭"
              >
                <Icon name="x" size={16} />
              </DialogPrimitive.Close>
            </div>
          ) : (
            <DialogPrimitive.Title className="sr-only">
              抽屉
            </DialogPrimitive.Title>
          )}

          <div className="flex-1 overflow-y-auto p-lg">{children}</div>

          {footer ? (
            <div className="flex items-center justify-end gap-sm border-t border-border p-lg">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
