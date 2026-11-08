/**
 * VerificationCodeInput.tsx - accessible numeric code input with discrete DS slots.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";

import { useId, type ReactNode } from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@vxture/design-system";

interface VerificationCodeInputProps {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly length?: 6 | 8;
  readonly disabled?: boolean | undefined;
  readonly autoFocus?: boolean;
  readonly error?: string | undefined;
  readonly action?: ReactNode;
}

/**
 * Render one semantic input so paste, autofill and keyboard navigation remain native.
 * @param props - Controlled code, accessible label and optional send-code action.
 * @returns A DS input with six or eight independently bordered slots.
 */
export function VerificationCodeInput({
  name,
  label,
  value,
  onChange,
  length = 6,
  disabled,
  autoFocus,
  error,
  action,
}: VerificationCodeInputProps) {
  const id = useId();
  return (
    <div className="accounts-code-field">
      <div className="accounts-code-label">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <InputOTP
        id={id}
        name={name}
        value={value}
        maxLength={length}
        pattern="[0-9]*"
        inputMode="numeric"
        autoComplete="one-time-code"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        containerClassName="accounts-code-container"
        onChange={(next) => onChange(next.replace(/\D/g, "").slice(0, length))}
      >
        <InputOTPGroup className="accounts-code-slots">
          {Array.from({ length }, (_, index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className="accounts-code-slot"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-body-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
