"use client";

import Link from "next/link";
import { useEffect } from "react";
import { loadGuestChatCache } from "@/lib/guestChat";
import type { LandingUser } from "@/types";
import styles from "./landing.module.css";

export function LandingHeaderActions({ user }: { user: LandingUser | null }) {
  useEffect(() => {
    if (!user) void loadGuestChatCache().catch(() => {});
  }, [user]);
  return (
    <div className={styles.headerActions}>
      {!user && (
        <Link href="/login" className={styles.login}>登录</Link>
      )}
      <Link href="/agent" className={styles.navCta} aria-label={user ? "进入 Noma" : "开始体验"}>
        {user ? "进入 Noma" : "开始体验"}
      </Link>
    </div>
  );
}
