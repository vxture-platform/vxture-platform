/**
 * ShellSearchBox.tsx - 外壳全局搜索（header 内联输入 + 下方结果面板）。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Shell
 *
 * **就地输入，不弹对话框**：header 上那一格就是真的输入框，敲字即检索，结果
 * 挂在输入框正下方。曾经做成"点一下开一个居中的命令面板"，那是 command
 * palette 的交互——它的前提是"我要执行一个命令"，所以值得占据整屏焦点；而
 * header 搜索的前提是"我随手找个东西"，中途弹出一个盖住页面的框，反而把人从
 * 当前上下文里拽出来，找完还要再关一次。
 *
 * 键盘巡航仍由 cmdk 承担：`Command` 包住输入框与结果列表两者（而不是只包列表），
 * 方向键与 Enter 才能在输入框有焦点时驱动列表选中。结果面板走 Popover 的
 * **Anchor** 而非 Trigger——输入框不是触发器，点它应该落焦点而不是开浮层；
 * 开合由"有没有内容可展示"决定。
 *
 * **不做客户端过滤**（`shouldFilter={false}`）。结果从哪来、怎么排、怎么匹配
 * 全由调用方决定：本地注册表即时匹配也好，打后端也好，两者并存也好——组件
 * 只按 `groups` 原样渲染。若让 cmdk 再筛一遍，后端返回的模糊匹配结果会被前端
 * 的严格子串匹配二次剔除，出现"接口明明返回了却不显示"的静默失败。
 *
 * 零业务语义：组件不认识"成员""发票""页面"，分组标题与条目全部由 props 给。
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  Icon,
  Kbd,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Spinner,
  cn,
} from "@vxture/design-ui";
import type { IconName } from "@vxture/design-ui";

export interface ShellSearchItem {
  key: string;
  label: string;
  /** 副行：邮箱、编号、路径……由调用方决定放什么。 */
  description?: string | undefined;
  icon?: IconName | undefined;
  /** 右端补充信息（金额、状态、时间）。 */
  meta?: ReactNode | undefined;
  onSelect: () => void;
}

export interface ShellSearchGroup {
  key: string;
  heading: string;
  items: ReadonlyArray<ShellSearchItem>;
}

export interface ShellSearchLabels {
  /** 输入框占位文案，同时作为它的无障碍名。 */
  placeholder?: string;
  /** 无结果时的文案。 */
  empty?: string;
  /** 正在检索时的提示。 */
  loading?: string;
  /** 结果面板的无障碍名。 */
  resultsLabel?: string;
}

export interface ShellSearchBoxProps {
  /** 受控查询串。调用方据此本地过滤 / 发起请求。 */
  query: string;
  onQueryChange: (query: string) => void;
  groups: ReadonlyArray<ShellSearchGroup>;
  /** 远端结果仍在路上——面板顶部显示转圈，不清空已有分组。 */
  loading?: boolean | undefined;
  labels?: ShellSearchLabels | undefined;
  /**
   * 聚焦输入框的快捷键字母（配 ⌘/Ctrl），默认 "k"。传 null 关闭绑定——嵌在
   * 已有全局快捷键体系里的产品可以自己接管。
   */
  shortcutKey?: string | null | undefined;
  className?: string | undefined;
}

const DEFAULT_LABELS: Required<ShellSearchLabels> = {
  placeholder: "搜索",
  empty: "没有匹配结果",
  loading: "检索中",
  resultsLabel: "搜索结果",
};

/**
 * Mac 显 ⌘、其余显 Ctrl。必须在 effect 里判定：navigator 在 SSR 不存在，
 * 首帧直接读会让服务端与客户端渲染出不同的键位标示，触发 hydration 不匹配。
 */
function useModifierLabel(): string {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMac(
      /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent),
    );
  }, []);
  return isMac ? "⌘" : "Ctrl";
}

export function ShellSearchBox({
  query,
  onQueryChange,
  groups,
  loading = false,
  labels,
  shortcutKey = "k",
  className,
}: ShellSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * 面板是否被**主动关掉**（选中一项 / Esc / 点到外面）。
   *
   * 开合刻意不挂在"输入框有没有焦点"上：选中一项时条目要先拿到点击、输入框
   * 会先失焦，用焦点当条件就会在条目响应之前把面板拆掉；而选中之后清空输入
   * 又会让焦点态与查询串两个来源互相追尾，出现"选完了面板还开着"。改成
   * 「有输入 且 没被关掉」——单向、无竞态：敲字即开，主动关闭才关。
   */
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const modifier = useModifierLabel();
  const text = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(labels ?? {}) }),
    [labels],
  );

  useEffect(() => {
    if (!shortcutKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== shortcutKey.toLowerCase()) return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutKey]);

  const hasResults = groups.some((group) => group.items.length > 0);
  /* 空查询时不开面板：还没敲字就弹一个"没有匹配结果"，等于告诉用户搜索坏了。
     有查询就开——即使还没有结果，也要把"检索中"或"没找到"说出来。 */
  const open = !dismissed && query.trim().length > 0;

  const setQuery = (next: string) => {
    // 重新敲字 = 重新开始找，把上一次的"关掉"作废。
    setDismissed(false);
    onQueryChange(next);
  };

  return (
    <Command
      shouldFilter={false}
      // 输入框与结果列表**同在一个 Command 内**，否则输入框拿着焦点时方向键
      // 驱动不了列表。Command 默认是个 flex 列容器，这里只当无样式包裹层用。
      className={cn("contents bg-transparent", className)}
    >
      <Popover open={open} onOpenChange={(next) => setDismissed(!next)}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "flex h-control-md w-full max-w-panel-sm items-center gap-xs rounded-lg px-sm",
              "bg-muted/60 text-body-sm text-muted-foreground",
              "transition-colors duration-fast",
              "focus-within:bg-card focus-within:ring-ring focus-within:ring-2",
            )}
          >
            <Icon name="search" size="sm" className="shrink-0" />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-label={text.placeholder}
              placeholder={text.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // 不挂 onBlur：点结果项会先让输入框失焦，在 blur 里关面板等于在
              // 条目收到点击之前把它拆掉。关闭只有三个来源——Esc、点到外面
              // （Popover 自己管）、选中一项。
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // 一次 Esc 收面板、再一次清输入：先收面板保留已敲的词，是因为
                // "看错了想重新看看结果"比"这一整串都不要了"常见得多。
                if (open) setDismissed(true);
                else if (query) onQueryChange("");
              }}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-foreground outline-none",
                "placeholder:text-muted-foreground",
                // 原生 search 控件的清除叉与放大镜跟这里的图标重复，且样式不可控。
                "[&::-webkit-search-cancel-button]:appearance-none",
              )}
            />
            {shortcutKey && !query ? (
              <Kbd className="shrink-0">
                {modifier}
                {shortcutKey.toUpperCase()}
              </Kbd>
            ) : null}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={6}
          aria-label={text.resultsLabel}
          // 焦点必须留在输入框里——面板一抢焦点就再也打不了字。
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="w-(--radix-popover-trigger-width) p-xs"
        >
          <CommandList id={listId}>
            {loading ? (
              <div
                className="flex items-center justify-center gap-xs py-md text-body-sm text-muted-foreground"
                role="status"
              >
                <Spinner size="sm" />
                <span>{text.loading}</span>
              </div>
            ) : null}

            {!loading && !hasResults ? (
              <CommandEmpty>{text.empty}</CommandEmpty>
            ) : null}

            {groups.map((group) =>
              group.items.length > 0 ? (
                <CommandGroup key={group.key} heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.key}
                      // cmdk 用 value 做键盘巡航的身份；条目 label 可能重名
                      // （两个租户同名成员），用唯一 key 才不会串行。
                      value={`${group.key}:${item.key}`}
                      onSelect={() => {
                        setDismissed(true);
                        onQueryChange("");
                        inputRef.current?.blur();
                        item.onSelect();
                      }}
                      className="gap-sm"
                    >
                      {item.icon ? (
                        <Icon name={item.icon} size="sm" className="shrink-0" />
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col gap-none">
                        <span className="truncate text-label-md">
                          {item.label}
                        </span>
                        {item.description ? (
                          <span className="truncate text-body-sm text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      {item.meta ? (
                        <span className="shrink-0 text-body-sm text-muted-foreground">
                          {item.meta}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
