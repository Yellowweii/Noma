"use client";

import { useEffect } from "react";
import { startHAConnectionMonitor } from "@/lib/haConnectionSnapshot";

export function HAConnectionMonitor({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    // The monitor also retries session bootstrap after temporary failures.
    return startHAConnectionMonitor();
  }, [enabled]);
  return null;
}
