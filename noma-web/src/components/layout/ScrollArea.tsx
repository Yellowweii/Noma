"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  viewportRef?: Ref<HTMLDivElement>;
}

type DragState = {
  pointerId: number;
  startY: number;
  startScrollTop: number;
  maxThumbTop: number;
  scrollRange: number;
};

export function ScrollArea({
  children,
  className,
  viewportRef,
  ...props
}: ScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const trackHoverRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [thumbTop, setThumbTop] = useState(0);
  const [showThumb, setShowThumb] = useState(false);
  const [trackHover, setTrackHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scrollable, setScrollable] = useState(false);

  const clearHideTimer = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    if (draggingRef.current || trackHoverRef.current) return;
    clearHideTimer();
    timeoutRef.current = window.setTimeout(() => setShowThumb(false), 700);
  }, [clearHideTimer]);

  const updateThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollHeight, clientHeight, scrollTop } = el;
    const canScroll = scrollHeight > clientHeight + 1;
    setScrollable(canScroll);

    if (!canScroll) return;

    const height = Math.max((clientHeight / scrollHeight) * clientHeight, 24);
    const maxTop = clientHeight - height;
    const scrollRange = scrollHeight - clientHeight;
    const top = scrollRange > 0 ? (scrollTop / scrollRange) * maxTop : 0;
    setThumbHeight(height);
    setThumbTop(top);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateThumb();
    const resizeObserver = new ResizeObserver(updateThumb);
    resizeObserver.observe(el);
    // Keep the thumb in sync while collapsible content changes height.
    for (const child of Array.from(el.children)) resizeObserver.observe(child);
    const mutationObserver = new MutationObserver(updateThumb);
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    function onScroll() {
      updateThumb();
      setShowThumb(true);
      if (!draggingRef.current) scheduleHide();
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      el.removeEventListener("scroll", onScroll);
      clearHideTimer();
    };
  }, [updateThumb, children, scheduleHide, clearHideTimer]);

  useEffect(() => {
    if (!dragging) return;

    function onPointerMove(e: PointerEvent) {
      const drag = dragStateRef.current;
      const el = scrollRef.current;
      if (!drag || !el || e.pointerId !== drag.pointerId) return;

      const deltaY = e.clientY - drag.startY;
      const scrollDelta =
        drag.maxThumbTop > 0 ? (deltaY / drag.maxThumbTop) * drag.scrollRange : 0;
      el.scrollTop = Math.min(
        drag.scrollRange,
        Math.max(0, drag.startScrollTop + scrollDelta),
      );
    }

    function onPointerUp(e: PointerEvent) {
      const drag = dragStateRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      dragStateRef.current = null;
      draggingRef.current = false;
      setDragging(false);
      scheduleHide();
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragging, scheduleHide]);

  function handleThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();

    const el = scrollRef.current;
    if (!el) return;

    const maxThumbTop = el.clientHeight - thumbHeight;
    const scrollRange = el.scrollHeight - el.clientHeight;

    dragStateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScrollTop: el.scrollTop,
      maxThumbTop,
      scrollRange,
    };
    draggingRef.current = true;
    setDragging(true);
    setShowThumb(true);
    clearHideTimer();
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;

    const el = scrollRef.current;
    if (!el) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const maxThumbTop = el.clientHeight - thumbHeight;
    const scrollRange = el.scrollHeight - el.clientHeight;
    const nextTop = Math.min(maxThumbTop, Math.max(0, clickY - thumbHeight / 2));
    el.scrollTop =
      maxThumbTop > 0 ? (nextTop / maxThumbTop) * scrollRange : 0;
    setShowThumb(true);
    scheduleHide();
  }

  const thumbVisible = showThumb || trackHover || dragging;

  return (
    <div className={cn("relative min-h-0", className)} {...props}>
      <div
        ref={(node) => {
          scrollRef.current = node;
          if (typeof viewportRef === "function") {
            viewportRef(node);
          } else if (viewportRef) {
            viewportRef.current = node;
          }
        }}
        className="scrollbar-hidden size-full overflow-x-hidden overflow-y-auto"
      >
        {children}
      </div>
      {scrollable && (
        <div
          aria-hidden
          onMouseEnter={() => {
            trackHoverRef.current = true;
            setTrackHover(true);
            setShowThumb(true);
            clearHideTimer();
          }}
          onMouseLeave={() => {
            trackHoverRef.current = false;
            setTrackHover(false);
            if (!draggingRef.current) scheduleHide();
          }}
          onPointerDown={handleTrackPointerDown}
          className={cn(
            "absolute bottom-0 right-0 top-0 z-10 w-4 cursor-default transition-opacity duration-200",
            thumbVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <div
            onPointerDown={handleThumbPointerDown}
            className={cn(
              "absolute right-1 w-2 rounded-full bg-slate-300/90 transition-colors",
              dragging ? "cursor-grabbing bg-slate-400" : "cursor-grab hover:bg-slate-400",
            )}
            style={{
              height: thumbHeight,
              transform: `translateY(${thumbTop}px)`,
            }}
          />
        </div>
      )}
    </div>
  );
}
