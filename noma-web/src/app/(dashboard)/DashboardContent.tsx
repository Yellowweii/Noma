"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoginEnteringScreen } from "@/components/login/LoginEnteringScreen";
import { ResizableDashboardShell } from "@/components/layout/ResizableDashboardShell";
import { HAConnectionMonitor } from "@/components/layout/HAConnectionMonitor";
import { ChatSessionProvider } from "@/contexts/ChatSessionContext";
import { UserProvider } from "@/contexts/UserContext";
import { bootstrapSession, getAccessToken } from "@/lib/api";

export function DashboardContent({ children, sessionReady = false }: {
  children: React.ReactNode;
  sessionReady?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(sessionReady);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = getAccessToken() ? true : await bootstrapSession();
      if (cancelled) return;
      if (!ok) {
        router.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
        return;
      }
      setAuthenticated(true);
    })();
    return () => { cancelled = true; };
  }, [pathname, router]);

  // The gateway already validated the HttpOnly session before rendering the protected layout.
  if (!authenticated && !getAccessToken()) return <LoginEnteringScreen activeStep={2} />;

  return (
    <UserProvider>
      <HAConnectionMonitor enabled />
      <ChatSessionProvider>
        <ResizableDashboardShell>
          {children}
        </ResizableDashboardShell>
      </ChatSessionProvider>
    </UserProvider>
  );
}
