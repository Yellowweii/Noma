"use client";

import Link from "next/link";
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
  const guestLimit = quota.guest_limit ?? (quota.guest ? quota.limit : 30);
  const userLimit = quota.user_limit ?? (quota.guest ? 200 : quota.limit);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-5 py-8">
      <button aria-label="关闭额度提示" className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="chat-quota-title" aria-describedby="chat-quota-description" className={quota.guest ? "relative max-h-[calc(100dvh-4rem)] w-full max-w-[548px] overflow-y-auto rounded-[24px] bg-white px-5 py-6 text-center shadow-[0_24px_80px_rgba(15,23,42,0.15)] sm:px-8 sm:py-10" : "relative max-h-[calc(100dvh-4rem)] w-full max-w-[428px] overflow-y-auto rounded-[20px] bg-white px-5 pb-6 pt-7 text-center shadow-[0_24px_80px_rgba(15,23,42,0.15)] sm:px-8 sm:pb-7 sm:pt-8"}>
        <h2 id="chat-quota-title" className={quota.guest ? "text-2xl font-semibold text-noma-primary" : "text-lg font-semibold text-noma-primary"}>{quota.guest ? "今日免费额度已用完" : "今日对话额度已用完"}</h2>
        <p id="chat-quota-description" className={quota.guest ? "mt-4 text-[15px] leading-7 text-noma-secondary" : "mt-3 text-sm leading-6 text-noma-secondary"}>
          {quota.guest ? <>每天可免费对话 {guestLimit} 轮。登录后可提升至每天 {userLimit} 轮，<br className="hidden sm:block" />并解锁记忆与家等完整功能。</> : <>登录用户每天可对话 {userLimit} 轮，今天的额度已用完。<br />每天 0 点恢复额度，明天再来聊吧。</>}
        </p>
        {quota.guest && <div className="mt-6 grid grid-cols-2 rounded-2xl bg-[#f5f8f8] py-5 text-[15px] text-noma-secondary">
          <div className="border-r border-noma-border"><p>未登录</p><p className="mt-1 font-semibold text-[#174c51]">{guestLimit} 轮/天</p></div>
          <div><p>登录用户</p><p className="mt-1 font-semibold text-[#174c51]">{userLimit} 轮/天</p></div>
        </div>}
        <div className={quota.guest ? "mt-6 flex gap-3" : "mt-5 flex justify-center"}>
          {quota.guest && <Link href="/login?next=%2Fagent" className="flex h-12 flex-1 items-center justify-center rounded-full bg-noma-brand text-[15px] font-semibold text-white transition-colors hover:bg-noma-brand-hover">立即登录</Link>}
          <button onClick={onClose} className={quota.guest ? "h-12 flex-1 rounded-full border border-noma-border text-[15px] font-semibold text-noma-primary hover:bg-noma-soft" : "h-10 rounded-full border border-noma-border px-8 text-sm font-medium text-noma-primary hover:bg-noma-soft"}>明天再来</button>
        </div>
        {quota.guest ? <p className="mt-4 text-sm leading-6 text-noma-tertiary">登录后可继续当前对话，并保存聊天记录。</p> : <p className="mt-3 text-xs leading-5 text-noma-tertiary">额度将在次日自动恢复</p>}
      </div>
    </div>, document.body,
  );
}
