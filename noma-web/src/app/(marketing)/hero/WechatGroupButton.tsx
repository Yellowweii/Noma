"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import styles from "./wechat-group.module.css";

const communityQRCodeURL = "/api/v1/community/qr-code";

export function WechatGroupButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [qrCodeSrc, setQRCodeSrc] = useState("/wechat-group.jpg");
  const [hint, setHint] = useState("使用微信扫一扫，扫码加入群聊");

  useEffect(() => {
    if (!open) return;
    const scroller = dialogRef.current?.closest<HTMLElement>("[data-landing-scroller]");
    if (!scroller) return;
    const previousOverflow = scroller.style.overflowY;
    scroller.style.overflowY = "hidden";
    return () => { scroller.style.overflowY = previousOverflow; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        onClick={() => {
          const agent = navigator.userAgent;
          // A new URL on every opening also refreshes an already-mounted image.
          setQRCodeSrc(`${communityQRCodeURL}?t=${Date.now()}`);
          setHint(/MicroMessenger/i.test(agent)
            ? "长按二维码，选择「识别图中二维码」加入群聊"
            : /Android|iPhone|iPad|iPod/i.test(agent)
              ? "长按图片保存后，在微信「扫一扫」中从相册选择"
              : "使用微信扫一扫，扫码加入群聊");
          dialogRef.current?.showModal();
          setOpen(true);
        }}
      >
        加入用户交流群
      </button>
      <dialog
        ref={dialogRef}
        className={`${styles.dialog} modal-pop-in motion-reduce:animate-none`}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
            dialogRef.current?.close();
          }
        }}
      >
        <div className={styles.header}>
          <h2 id={titleId}>Noma 用户交流群</h2>
          <button type="button" className="flex size-9 items-center justify-center rounded-lg text-noma-secondary hover:bg-noma-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-noma-brand" autoFocus aria-label="关闭交流群二维码" onClick={() => dialogRef.current?.close()}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.description}>交流智能家居玩法，反馈 Noma 使用建议</p>
        <Image
          src={qrCodeSrc}
          alt="Noma 用户交流群微信二维码"
          width={1080}
          height={1596}
          unoptimized
          onError={() => setQRCodeSrc("/wechat-group.jpg")}
          className={styles.qrcode}
        />
        <p id={hintId} className={styles.hint}>{hint}</p>
      </dialog>
    </>
  );
}
