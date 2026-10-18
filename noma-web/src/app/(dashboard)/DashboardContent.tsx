"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ResizableDashboardShell } from "@/components/layout/ResizableDashboardShell";
import { HAConnectionMonitor } from "@/components/layout/HAConnectionMonitor";
import { ChatSessionProvider } from "@/contexts/ChatSessionContext";
import { UserProvider } from "@/contexts/UserContext";
import { bootstrapSession, getAccessToken } from "@/lib/api";

export function DashboardContent({ children }: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

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

  if (!authenticated) return <div className="flex h-full items-center justify-center bg-white"><Loader2 aria-label="正在验证登录状态" className="size-5 animate-spin text-noma-brand" /></div>;

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
