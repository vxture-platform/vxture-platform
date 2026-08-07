/**
 * Container.tsx - 全屏容器组件
 * @package @vxture/design-ui
 *
 * 功能：定义一个全屏目标区域，可在其中实现全屏功能
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  FullscreenContainerProps,
  FullscreenContainerRef,
} from "../../../types/fullscreen";
import { useFullscreenContext } from "./Provider";
import { Portal } from "./Portal";
import { cn } from "../../../utils/cn";

export const FullscreenContainer = forwardRef<
  FullscreenContainerRef,
  FullscreenContainerProps
>(
  (
    { id, mode = "pseudo", lockScroll, portal = false, className, children },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, targetId, enterFullscreen, exitFullscreen } =
      useFullscreenContext();
    const [isActive, setIsActive] = useState(false);

    /**
     * 检查当前容器是否是全屏目标
     */
    const isTarget = isFullscreen && targetId === id;

    /**
     * 暴露给父组件的方法
     */
    useImperativeHandle(ref, () => ({
      enter: () => {
        if (containerRef.current) {
          enterFullscreen(id, containerRef.current, { mode, lockScroll });
        }
      },
      exit: exitFullscreen,
      toggle: () => {
        if (isTarget) {
          exitFullscreen();
        } else if (containerRef.current) {
          enterFullscreen(id, containerRef.current, { mode, lockScroll });
        }
      },
    }));

    /**
     * 监听全屏状态变化
     */
    useEffect(() => {
      setIsActive(isTarget);

      // 应用 pseudo 全屏样式
      if (isTarget && mode === "pseudo" && containerRef.current) {
        containerRef.current.classList.add("vx-fullscreen-active");
      } else if (containerRef.current) {
        containerRef.current.classList.remove("vx-fullscreen-active");
      }
    }, [isTarget, mode]);

    const content = (
      <div
        ref={containerRef}
        className={cn(
          "vx-fullscreen-container",
          {
            "vx-fullscreen-active": isTarget && mode === "pseudo",
          },
          className,
        )}
        data-fullscreen-id={id}
      >
        {children}
      </div>
    );

    // 如果需要 Portal 并且当前是激活状态，则使用 Portal
    if (portal && isActive) {
      return <Portal>{content}</Portal>;
    }

    return content;
  },
);

FullscreenContainer.displayName = "FullscreenContainer";
