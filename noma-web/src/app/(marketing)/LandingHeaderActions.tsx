"use client";

import Link from "next/link";
import type { LandingUser } from "@/types";
import styles from "./landing.module.css";

export function LandingHeaderActions({ user }: { user: LandingUser | null }) {
  return (
    <div className={styles.headerActions}>
      {!user && (
        <Link href="/login" className={styles.login}>登录</Link>
      )}
      <Link href={user ? "/agent" : "/login?next=%2Fagent"} className={styles.navCta} aria-label={user ? "进入 Noma" : "登录使用"}>
        {user ? "进入 Noma" : "登录使用"}
      </Link>
    </div>
  );
}
