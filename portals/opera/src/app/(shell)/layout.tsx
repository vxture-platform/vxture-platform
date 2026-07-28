import type { ReactNode } from "react";
import { SessionProvider } from "@/features/session/SessionProvider";
import { OperaShell } from "@/layout/OperaShell";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <OperaShell>{children}</OperaShell>
    </SessionProvider>
  );
}
