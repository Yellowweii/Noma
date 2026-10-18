"use client";

import { SettingsNav } from "@/components/settings/SettingsNav";
import styles from "@/components/settings/settings-responsive.module.css";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <div className={styles.frame}>
      <div className={styles.layout}>
        <aside className={`${styles.navigation} flex w-[220px] shrink-0 flex-col border-r border-noma-border bg-white px-3 py-6`}>
          <h1 className={`${styles.heading} px-3 pb-4 text-lg font-semibold text-slate-900`}>设置</h1>
          <div className={styles.pageNav}><SettingsNav /></div>
        </aside>
        <main className={`${styles.main} scrollbar-hidden min-w-0 flex-1 overflow-y-auto`}>
          {children}
        </main>
      </div>
    </div>
  );
}
