"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SettingsNav } from "./SettingsNav";

export function SettingsMenuPopover({ open, anchor, onOpenChange, onNavigate }: {
  open: boolean;
  anchor: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover || !anchor) return;
    const syncPosition = () => {
      const rect = anchor.getBoundingClientRect();
      popover.style.left = `${Math.max(12, Math.min(rect.right + 8, window.innerWidth - popover.offsetWidth - 12))}px`;
      popover.style.top = `${Math.max(12, Math.min(rect.top, window.innerHeight - popover.offsetHeight - 12))}px`;
    };
    popover.showPopover();
    syncPosition();
    (popover.querySelector<HTMLElement>("a[aria-current='page']") ?? popover.querySelector<HTMLElement>("a"))?.focus({ preventScroll: true });
    const media = window.matchMedia("(max-width: 767px)");
    const closeOnDesktop = () => { if (!media.matches) popover.hidePopover(); };
    media.addEventListener("change", closeOnDesktop);
    window.addEventListener("resize", syncPosition);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
      window.removeEventListener("resize", syncPosition);
      popover.hidePopover();
      if (anchor.isConnected && !anchor.closest("[inert]")) anchor.focus({ preventScroll: true });
    };
  }, [open, anchor]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      popover="auto"
      role="dialog"
      aria-label="设置"
      onToggle={(event) => {
        if (!event.currentTarget.matches(":popover-open")) onOpenChange(false);
      }}
      className="menu-pop-in motion-reduce:animate-none fixed m-0 max-h-[80dvh] w-56 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-noma-border bg-white p-1.5 text-noma-primary shadow-lg"
    >
      <SettingsNav inPopover onNavigate={() => { popoverRef.current?.hidePopover(); onNavigate?.(); }} />
    </div>,
    document.body,
  );
}
