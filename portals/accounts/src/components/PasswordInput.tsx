/**
 * Password control with a consistent, localized visibility action.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-10
 */
"use client";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Input, cn } from "@vxture/design-system";

/** Preserve native input semantics while keeping visibility state out of storage. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  ComponentProps<typeof Input> & { trailingAction?: ReactNode }
>(function PasswordInput(
  { className, trailingAction, disabled, ...props },
  ref,
) {
  const t = useTranslations("accountsForms");
  const [visible, setVisible] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const [actionWidth, setActionWidth] = useState<number>();
  useEffect(() => {
    const node = actions.current;
    if (!node) return;
    // Translations and font preferences can change the inline action's width.
    const measure = () =>
      setActionWidth(node.getBoundingClientRect().width + 12);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const label = t(visible ? "hide_password" : "show_password");
  return (
    <div className="accounts-password-control">
      <Input
        {...props}
        ref={ref}
        disabled={disabled}
        type={visible ? "text" : "password"}
        style={{ ...props.style, paddingInlineEnd: actionWidth }}
        className={cn(
          "pr-3xl",
          trailingAction && "accounts-password-with-action",
          className,
        )}
      />
      <div ref={actions} className="accounts-password-actions">
        {trailingAction}
        <Button
          type="button"
          variant="ghost"
          size="icon-md"
          aria-label={label}
          title={label}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((value) => !value)}
        >
          <Icon name={visible ? "eye" : "eye-slash"} size="sm" />
        </Button>
      </div>
    </div>
  );
});
