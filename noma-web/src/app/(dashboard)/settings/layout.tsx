"use client";

import { usePathname } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import { GuestSettingsContent } from "@/components/settings/GuestSettingsContent";
import { SettingsNav } from "@/components/settings/SettingsNav";
import styles from "@/components/settings/settings-responsive.module.css";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isGuest } = useUser();
  const pathname = usePathname();
  const guestFeature = pathname === "/settings/ha" || pathname === "/settings/noma"
    ? "ha"
    : pathname === "/settings/memory" || pathname === "/settings/preferences"
      ? "memory"
      : pathname === "/settings/profile" ? "profile" : null;

  return (
    <div className={styles.frame}>
      <div className={styles.layout}>
        <aside className={`${styles.navigation} flex w-[220px] shrink-0 flex-col border-r border-noma-border bg-white px-3 py-6`}>
          <h1 className={`${styles.heading} px-3 pb-4 text-lg font-semibold text-slate-900`}>设置</h1>
          <div className={styles.pageNav}><SettingsNav /></div>
        </aside>
        <main className={`${styles.main} scrollbar-hidden min-w-0 flex-1 overflow-y-auto`}>
          {isGuest && guestFeature ? <GuestSettingsContent key={guestFeature} feature={guestFeature} /> : children}
        </main>
      </div>
    </div>
  );
}
