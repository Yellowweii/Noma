"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/layout/ScrollArea";
import styles from "./guest.module.css";

export function GuestFeaturePage({ feature }: { feature: "memory" | "home" }) {
  const pathname = usePathname();
  const isMemory = feature === "memory";

  return (
    <ScrollArea className={styles.page}>
      <div className={styles.content}>
        <section className={styles.intro}>
          <h1>{isMemory ? "登录后查看你的记忆" : "登录后连接你的家"}</h1>
          <p className={styles.description}>
            {isMemory
              ? "登录后，查看 Noma 眼中的你、最近对你的了解和家庭习惯"
              : "登录后，连接 Home Assistant，即可查看家庭状态、控制智能设备，让 Noma 逐渐了解你的家庭习惯"}
          </p>
          <div className={styles.actions}>
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={styles.login}>
              立即登录
            </Link>
            <Link href="/agent" className={styles.continue}>继续体验聊天</Link>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
