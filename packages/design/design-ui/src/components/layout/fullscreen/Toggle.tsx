/**
 * Toggle.tsx - 全屏切换组件
 * @package @vxture/design-ui
 *
 * 功能：提供一个 UI 控件来切换全屏模式
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import { useRef } from "react";
import { Button } from "../../base/form/Button";
import { Icon } from "../../../icons/Icon";
import { FullscreenToggleProps } from "../../../types/fullscreen";
import { useFullscreenContext } from "./Provider";
import { cn } from "../../../utils/cn";

export function FullscreenToggle({
  targetId,
  mode = "pseudo",
  lockScroll,
  className,
  children,
}: FullscreenToggleProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const {
    isFullscreen,
    targetId: activeId,
    toggleFullscreen,
  } = useFullscreenContext();

  /**
   * 检查是否是当前全屏目标
   */
  const isActive = isFullscreen && activeId === targetId;

  /**
   * 切换全屏
   */
  const handleToggle = () => {
    const targetElement = document.querySelector(
      `[data-fullscreen-id="${targetId}"]`,
    );
    if (targetElement instanceof HTMLElement) {
      toggleFullscreen(targetId, targetElement, { mode, lockScroll });
    }
  };

  /**
   * 渲染默认图标
   */
  const renderDefaultIcon = () => {
    if (isActive) {
      return <Icon name="minimize" size="sm" />;
    }
    return <Icon name="maximize" size="sm" />;
  };

  /**
   * 获取默认文本
   */
  const getDefaultText = () => {
    if (isActive) {
      return "退出全屏";
    }
    return mode === "pseudo" ? "工作区全屏" : "显示器全屏";
  };

  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="icon-md"
      onClick={handleToggle}
      title={getDefaultText()}
      className={cn(
        "transition-colors duration-200",
        {
          "bg-primary text-content-on-fill hover:bg-primary-hover": isActive,
        },
        className,
      )}
    >
      {children || renderDefaultIcon()}
    </Button>
  );
}
