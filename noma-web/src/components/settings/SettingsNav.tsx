"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Brain, Home, Info, LockKeyhole, User } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { cn } from "@/lib/utils";
import styles from "./settings-responsive.module.css";

const settingsNavItems = [
  { href: "/settings/ha", label: "Home Assistant", icon: Home },
  { href: "/settings/memory", label: "记忆", icon: Brain },
  { href: "/settings/profile", label: "个人资料", icon: User },
  { href: "/settings/about", label: "关于 Noma", icon: Info },
] as const;

export function SettingsNav({ onNavigate, inPopover = false }: { onNavigate?: () => void; inPopover?: boolean }) {
  const pathname = usePathname();
  const { isGuest } = useUser();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (inPopover) return;
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < navRect.left) nav.scrollLeft -= navRect.left - activeRect.left;
    else if (activeRect.right > navRect.right) nav.scrollLeft += activeRect.right - navRect.right;
  }, [pathname, inPopover]);

  return (
    <nav ref={navRef} aria-label="设置分类" className={cn(styles.nav, inPopover && styles.popoverNav, "scrollbar-hidden")}>
      {settingsNavItems.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          pathname.startsWith(`${href}/`) ||
          (href === "/settings/ha" && pathname === "/settings/noma");

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-noma-brand-active text-slate-900"
                : "text-slate-700 hover:bg-noma-soft",
            )}
          >
            <Icon className="size-5 shrink-0" strokeWidth={1.75} />
            <span className="flex-1">{label}</span>
            {isGuest && (href === "/settings/ha" || href === "/settings/memory" || href === "/settings/profile") && (
              <LockKeyhole className="size-4 shrink-0 text-noma-brand" strokeWidth={1.75} aria-label="登录后可用" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
