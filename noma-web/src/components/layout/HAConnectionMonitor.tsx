"use client";

import { useEffect } from "react";
import { getUserId } from "@/lib/auth";
import { startHAConnectionMonitor } from "@/lib/haConnectionSnapshot";

export function HAConnectionMonitor({ enabled }: { enabled: boolean }) {
  const userId = enabled ? getUserId() : null;
  useEffect(() => {
    if (!userId) return;
    return startHAConnectionMonitor(userId);
  }, [userId]);
  return null;
}
