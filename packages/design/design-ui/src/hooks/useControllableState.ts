/**
 * useControllableState.ts - 受控/非受控状态支持 Hook
 * @package @vxture/design-ui
 *
 * 功能：支持组件的受控和非受控状态
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Hooks
 */

import { useCallback, useState } from "react";

export interface UseControllableStateProps<T> {
  /** 受控值 */
  value?: T;
  /** 非受控默认值 */
  defaultValue?: T;
  /** 值变化时的回调 */
  onChange?: (value: T) => void;
}

/**
 * 受控/非受控状态支持 Hook
 *
 * @param props 状态配置
 * @returns 状态值和设置方法
 *
 * @example
 * const [value, setValue] = useControllableState({
 *   value,
 *   defaultValue: "",
 *   onChange: (v) => console.log("Changed:", v)
 * });
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateProps<T>): [T, (value: T) => void] {
  const [internalValue, setInternalValue] = useState<T | undefined>(
    defaultValue,
  );

  const isControlled = value !== undefined;

  const currentValue = isControlled ? value : internalValue;

  const setValue = useCallback(
    (nextValue: T) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      onChange?.(nextValue);
    },
    [isControlled, onChange],
  );

  return [currentValue as T, setValue];
}
