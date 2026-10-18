"use client";

import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";

type UserMessageBubbleProps = {
  content: string;
  className?: string;
};

function hasExplicitLineBreak(content: string) {
  return content.trim().includes("\n");
}

function measureMultiline(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getClientRects().length > 1;
}

export function UserMessageBubble({
  content,
  className,
}: UserMessageBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [isMultiline, setIsMultiline] = useState(() =>
    hasExplicitLineBreak(content),
  );

  useLayoutEffect(() => {
    if (hasExplicitLineBreak(content)) {
      setIsMultiline(true);
      return;
    }

    const element = bubbleRef.current;
    if (!element) return;

    const sync = () => {
      setIsMultiline(measureMultiline(element));
    };

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  const compact = !isMultiline;

  return (
    <div
      ref={bubbleRef}
      className={cn(
        "relative max-w-[min(72%,30rem)] whitespace-pre-wrap break-words",
        "bg-noma-soft px-4 text-[15px] leading-[1.55] tracking-[-0.01em] text-noma-primary",
        compact ? "rounded-full py-[9px]" : "rounded-[20px] py-3",
        className,
      )}
    >
      {content}
    </div>
  );
}
