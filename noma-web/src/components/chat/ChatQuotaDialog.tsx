"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatQuota } from "@/lib/chatQuota";

export function ChatQuotaDialog({ open, quota, onClose }: { open: boolean; quota?: ChatQuota; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const targets = dialogRef.current?.querySelectorAll<HTMLElement>("a, button");
      if (!targets?.length) return;
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) {
        dialogRef.current?.querySelector<HTMLElement>("a, button")?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("focusin", onFocusIn); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open, onClose]);
  if (!mounted || !open || !quota) return null;
  const userLimit = quota.user_limit ?? quota.limit;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-5 py-8">
      <button aria-label="关闭额度提示" className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="chat-quota-title" aria-describedby="chat-quota-description" className="relative max-h-[calc(100dvh-4rem)] w-full max-w-[428px] overflow-y-auto rounded-[20px] bg-white px-5 pb-6 pt-7 text-center shadow-[0_24px_80px_rgba(15,23,42,0.15)] sm:px-8 sm:pb-7 sm:pt-8">
        <h2 id="chat-quota-title" className="text-lg font-semibold text-noma-primary">今日对话额度已用完</h2>
        <p id="chat-quota-description" className="mt-3 text-sm leading-6 text-noma-secondary">
          登录用户每天可对话 {userLimit} 轮，今天的额度已用完。<br />每天 0 点恢复额度，明天再来聊吧。
        </p>
        <div className="mt-5 flex justify-center">
          <button onClick={onClose} className="h-10 rounded-full border border-noma-border px-8 text-sm font-medium text-noma-primary hover:bg-noma-soft">明天再来</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-noma-tertiary">额度将在次日自动恢复</p>
      </div>
    </div>, document.body,
  );
}
