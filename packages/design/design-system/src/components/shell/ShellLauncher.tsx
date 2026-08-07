/**
 * ShellLauncher.tsx - 外壳功能板块切换器（launcher）。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Shell
 *
 * 数据驱动的目的地切换面板：调用方传 items（icon/label/description/active），
 * 组件只负责触发器 + 弹层 + 列表渲染，不认识任何具体产品/域名——不管调用方
 * 传的是"运营业务域/平台自治域"还是别的什么，组件本身零业务语义。
 *
 * 放在 design-system（不是 design-ui）：要复用同目录 `ShellChrome.tsx` 里的
 * `ShellIconButton`，依赖方向是单向 design-system → design-ui，design-ui
 * 不能反过来引 design-system 的导出——跟 `ShellLocaleSwitcher` 留在这个文件
 * 的理由一致（复用同文件的部件，不是因为本身需要 `@vxture/shared`）。
 */

import { useState } from "react";
import {
  Button,
  Icon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@vxture/design-ui";
import type { IconName } from "@vxture/design-ui";
import { ShellIconButton } from "./ShellChrome";

export interface ShellLauncherItem {
  key: string;
  icon: IconName;
  label: string;
  description?: string | undefined;
  active?: boolean | undefined;
}

export interface ShellLauncherProps {
  items: ShellLauncherItem[];
  onSelect: (key: string) => void;
  buttonLabel?: string | undefined;
  panelLabel?: string | undefined;
  align?: "start" | "end" | undefined;
  className?: string | undefined;
}

export function ShellLauncher({
  items,
  onSelect,
  buttonLabel = "功能板块",
  panelLabel = "选择功能板块",
  align = "start",
  className,
}: ShellLauncherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("inline-flex", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ShellIconButton icon="app-grid" label={buttonLabel} active={open}>
            <Icon name="app-grid" size="lg" />
          </ShellIconButton>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          sideOffset={8}
          aria-label={panelLabel}
          className="w-auto min-w-media-2xl p-xs"
        >
          <div className="flex flex-col gap-2xs" role="menu">
            {items.map((item) => (
              <Button
                key={item.key}
                variant={item.active ? "secondary" : "ghost"}
                role="menuitemradio"
                aria-checked={item.active}
                className="h-auto w-full justify-start gap-sm px-sm py-xs text-left"
                onClick={() => {
                  setOpen(false);
                  onSelect(item.key);
                }}
              >
                <Icon name={item.icon} size="md" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-none">
                  <span className="text-label-md">{item.label}</span>
                  {item.description ? (
                    <span className="text-body-sm text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {item.active ? <Icon name="check" size="sm" /> : null}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
