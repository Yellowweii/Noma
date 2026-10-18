"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type TooltipSide = "top" | "bottom";

interface TooltipProps {
  content?: ReactNode;
  side?: TooltipSide;
  children: ReactElement;
}

const SIDE_OFFSET = 8;

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const hide = useCallback(() => {
    setOpen(false);
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({
      top:
        side === "top"
          ? rect.top - SIDE_OFFSET
          : rect.bottom + SIDE_OFFSET,
      left: rect.left + rect.width / 2,
    });
  }, [side]);

  const show = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  useEffect(() => {
    hide();
  }, [content, hide]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const anchor = anchorRef.current;
      if (anchor?.contains(event.target as Node)) return;
      hide();
    };

    const handleScroll = () => {
      hide();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", hide);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex shrink-0 items-center"
        onPointerEnter={content ? show : undefined}
        onPointerLeave={content ? hide : undefined}
      >
        {children}
      </span>
      {content &&
        open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              top: position.top,
              left: position.left,
              transform:
                side === "top"
                  ? "translate(-50%, -100%)"
                  : "translate(-50%, 0)",
            }}
            className="pointer-events-none fixed z-[100]"
          >
            <div
              id={id}
              role="tooltip"
              className={cn(
                "whitespace-nowrap rounded-lg border border-noma-border bg-white px-2.5 py-1.5 text-xs font-medium text-noma-primary shadow-[0_2px_10px_rgba(0,0,0,0.03)]",
                side === "top" ? "tooltip-pop-in-up" : "tooltip-pop-in",
              )}
            >
              {content}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
