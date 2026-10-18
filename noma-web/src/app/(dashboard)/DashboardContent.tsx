"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GuestFeaturePage } from "@/components/guest/GuestFeaturePage";
import { ResizableDashboardShell } from "@/components/layout/ResizableDashboardShell";
import { HAConnectionMonitor } from "@/components/layout/HAConnectionMonitor";
import { ChatSessionProvider } from "@/contexts/ChatSessionContext";
import { UserProvider } from "@/contexts/UserContext";
import { bootstrapSession, getAccessToken } from "@/lib/api";
import { setGuestMode } from "@/lib/sessionMode";

export function DashboardContent({ children, initiallyGuest }: {
  children: React.ReactNode;
  initiallyGuest: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authState, setAuthState] = useState<"loading" | "ok" | "guest">(() => {
    const state = getAccessToken() ? "ok" : initiallyGuest ? "guest" : "loading";
    // Initialize browser storage routing before the session provider restores it.
    if (typeof window !== "undefined") setGuestMode(state === "guest");
    return state;
  });

  useEffect(() => {
    if (authState !== "loading") return;
    let cancelled = false;
    (async () => {
      const ok = getAccessToken() ? true : await bootstrapSession();
      if (cancelled) return;
      setGuestMode(!ok);
      setAuthState(ok ? "ok" : "guest");
    })();
    return () => { cancelled = true; };
  }, [authState]);

  useEffect(() => {
    if (authState === "guest" && pathname.startsWith("/memory/")) {
      router.replace("/memory");
    }
  }, [authState, pathname, router]);

  const guestFeature = pathname.startsWith("/memory")
    ? "memory"
    : pathname.startsWith("/home") ? "home" : null;

  return (
    <UserProvider key={authState === "guest" ? "guest" : "account"} isGuest={authState === "guest"}>
      <HAConnectionMonitor enabled={authState === "ok"} />
      <ChatSessionProvider>
        <ResizableDashboardShell>
          {authState === "guest" && guestFeature
            ? <GuestFeaturePage feature={guestFeature} />
            : children}
        </ResizableDashboardShell>
      </ChatSessionProvider>
    </UserProvider>
  );
}
