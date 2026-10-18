"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatBubbleOvalLeftIcon } from "@heroicons/react/24/outline";
import { X } from "lucide-react";
import { useChatSessions } from "@/contexts/ChatSessionContext";
import { cn, sortChatSessions } from "@/lib/utils";
import type { ChatSession } from "@/types";
import { api } from "@/lib/api";

type SessionSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionSelect?: () => void;
};

function isSearchableSession(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed !== "新对话";
}

function SessionSearchItem({
  session,
  highlighted,
  onHover,
  onSelect,
  itemRef,
}: {
  session: ChatSession;
  highlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
  itemRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={itemRef}
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100",
        highlighted ? "bg-noma-soft" : "hover:bg-noma-soft",
      )}
    >
      <ChatBubbleOvalLeftIcon
        className="size-5 shrink-0 stroke-[1.5] text-noma-secondary"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[15px] text-noma-primary">
        {session.title}
      </span>
    </button>
  );
}

export function SessionSearchDialog({
  open,
  onOpenChange,
  onSessionSelect,
}: SessionSearchDialogProps) {
  const { sessions, setActiveSessionId } = useChatSessions();
  const [searchSessions, setSearchSessions] = useState<ChatSession[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearchLoading(true);
    setSearchSessions([]);
    setSearchError(false);
    // Search still covers all history, fetched only when the search is opened.
    void api.listChatSessions().then((list) => {
      if (!cancelled) setSearchSessions(list);
    }).catch(() => { if (!cancelled) setSearchError(true); })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [open]);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const filteredSessionsRef = useRef<ChatSession[]>([]);
  const highlightIndexRef = useRef(0);
  const shouldScrollRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const sync = () => viewportRef.current?.style.setProperty(
      "--search-viewport-height", `${viewport?.height ?? window.innerHeight}px`,
    );
    sync();
    viewport?.addEventListener("resize", sync);
    return () => viewport?.removeEventListener("resize", sync);
  }, [open]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = sortChatSessions([...sessions, ...searchSessions.filter((item) => !sessions.some((session) => session.session_id === item.session_id))]);
    return source.filter((session) => {
      if (!isSearchableSession(session.title)) return false;
      if (!normalizedQuery) return true;
      return session.title.toLowerCase().includes(normalizedQuery);
    });
  }, [sessions, searchSessions, query]);

  filteredSessionsRef.current = filteredSessions;
  highlightIndexRef.current = highlightIndex;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    setQuery("");
    setHighlightIndex(0);
    highlightIndexRef.current = 0;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    setHighlightIndex(0);
    highlightIndexRef.current = 0;
  }, [query, filteredSessions.length]);

  useEffect(() => {
    if (!shouldScrollRef.current) return;
    shouldScrollRef.current = false;
    itemRefs.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      const list = filteredSessionsRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.length === 0) return;
        shouldScrollRef.current = true;
        setHighlightIndex((prev) => {
          const next = (prev + 1) % list.length;
          highlightIndexRef.current = next;
          return next;
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (list.length === 0) return;
        shouldScrollRef.current = true;
        setHighlightIndex((prev) => {
          const next = (prev - 1 + list.length) % list.length;
          highlightIndexRef.current = next;
          return next;
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const target = list[highlightIndexRef.current];
        if (!target) return;
        onOpenChange(false);
        setActiveSessionId(target.session_id);
        onSessionSelect?.();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange, setActiveSessionId, onSessionSelect]);

  function selectSession(sessionId: string) {
    onOpenChange(false);
    setActiveSessionId(sessionId);
    onSessionSelect?.();
  }

  if (!open) return null;

  return createPortal(
    <div ref={viewportRef} className="fixed inset-0 z-[100] flex items-start justify-center px-3 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-4 sm:pt-[12dvh]">
      <button
        type="button"
        aria-label="关闭搜索"
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索对话"
        className="modal-pop-in relative z-10 flex max-h-[min(640px,calc(var(--search-viewport-height,100dvh)-2rem-env(safe-area-inset-top)))] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-noma-border bg-white shadow-[0_20px_60px_rgba(15,23,42,0.12)] sm:max-h-[min(640px,calc(var(--search-viewport-height,100dvh)-24dvh))]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-noma-border px-5 py-4">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索…"
            aria-label="搜索对话"
            className="min-w-0 flex-1 bg-transparent text-base text-noma-primary outline-none placeholder:text-noma-placeholder sm:text-[15px]"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="关闭"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-noma-secondary hover:bg-noma-soft hover:text-noma-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="shrink-0 px-5 pb-2 pt-4">
          <p className="text-[15px] font-medium text-noma-primary">最近聊天</p>
        </div>

        <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {filteredSessions.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-noma-secondary">
              {searchLoading ? "正在加载聊天记录…" : searchError ? "加载失败，请重新打开搜索" : query.trim() ? "没有匹配的对话" : "暂无聊天记录"}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filteredSessions.map((session, index) => (
                <SessionSearchItem
                  key={session.session_id}
                  session={session}
                  highlighted={index === highlightIndex}
                  onHover={() => setHighlightIndex(index)}
                  onSelect={() => selectSession(session.session_id)}
                  itemRef={(node) => {
                    itemRefs.current[index] = node;
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
