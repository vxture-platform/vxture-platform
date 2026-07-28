import type { ReactNode } from "react";
import { SessionProvider } from "@/features/session/SessionProvider";
import { CapShell } from "@/layout/CapShell";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <CapShell>{children}</CapShell>
    </SessionProvider>
  );
}
