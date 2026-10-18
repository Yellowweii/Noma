"use client";

import { useId, useRef, type ReactNode } from "react";
import Image from "next/image";
import { X } from "lucide-react";

export function FeedbackButton({ children, className, title = "用户反馈", description = "使用微信扫码添加好友，告诉我你的想法和建议" }: { children: ReactNode; className?: string; title?: string; description?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
        className={className ?? "flex w-full items-center gap-6 rounded-lg px-3 py-3 text-left transition-colors hover:bg-noma-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-noma-brand"}
      >
        {children}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="modal-pop-in motion-reduce:animate-none m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-noma-border bg-white p-5 text-noma-primary shadow-xl backdrop:bg-black/30"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
            dialogRef.current?.close();
          }
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" autoFocus aria-label="关闭二维码" onClick={() => dialogRef.current?.close()}
            className="flex size-9 items-center justify-center rounded-lg text-noma-secondary hover:bg-noma-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-noma-brand">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {description && <p id={descriptionId} className="mt-2 text-sm text-noma-secondary">{description}</p>}
        <Image src="/wechat-feedback.jpg" alt="微信添加好友二维码，微信号 HW1119765689" width={888} height={1131} unoptimized className="mt-3 h-auto w-full" />
        <p className="mt-2 text-center text-sm text-noma-secondary">微信号：<span className="select-all text-noma-primary">HW1119765689</span></p>
      </dialog>
    </>
  );
}
