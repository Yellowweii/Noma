"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatBubbleOvalLeftIcon } from "@heroicons/react/24/outline";
import { prefetchSessionMessages } from "@/lib/sessionMessageCache";
import { MoreHorizontal, Pin, PinOff, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useChatSessions } from "@/contexts/ChatSessionContext";
import type { ChatSession } from "@/types";
import styles from "@/components/chat/agent-responsive.module.css";

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay"
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

interface ChatSessionItemProps {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
  onPin: (pinned: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

export function ChatSessionItem({
  session,
  active,
  onSelect,
  onPin,
  onRename,
  onDelete,
}: ChatSessionItemProps) {
  const { pendingRenameSessionId, clearSessionRenameRequest } =
    useChatSessions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const itemRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(session.title);
  }, [session.title]);

  useEffect(() => {
    if (!menuOpen) return;

    function preventScroll(e: WheelEvent | TouchEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
    }

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("wheel", preventScroll, { passive: false });
    document.addEventListener("touchmove", preventScroll, { passive: false });
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("wheel", preventScroll);
      document.removeEventListener("touchmove", preventScroll);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !menuPanelRef.current) return;

    const triggerRect = menuRef.current.getBoundingClientRect();
    const menuHeight = menuPanelRef.current.offsetHeight;
    const scrollParent = findScrollParent(menuRef.current);
    const containerRect = scrollParent?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };

    const spaceBelow = containerRect.bottom - triggerRect.bottom - 4;
    const spaceAbove = triggerRect.top - containerRect.top - 4;
    setMenuAbove(spaceBelow < menuHeight && spaceAbove >= spaceBelow);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (pendingRenameSessionId !== session.session_id) return;
    setRenaming(true);
    itemRef.current?.scrollIntoView({ block: "nearest" });
    clearSessionRenameRequest();
  }, [pendingRenameSessionId, session.session_id, clearSessionRenameRequest]);

  function commitRename() {
    const next = draftTitle.trim();
    setRenaming(false);
    if (!next || next === session.title) {
      setDraftTitle(session.title);
      return;
    }
    onRename(next);
  }

  function handleDelete() {
    setMenuOpen(false);
    setDeleteConfirmOpen(true);
  }

  return (
    <div
      ref={itemRef}
      className={cn(
        "group relative flex w-full items-center rounded-lg transition-colors",
        renaming && "z-10 py-0.5",
        !renaming && active && "bg-noma-brand-active",
        !renaming && !active && "hover:bg-noma-soft",
        menuOpen && "z-50",
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            }
            if (e.key === "Escape") {
              setDraftTitle(session.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 w-full rounded-lg border border-noma-brand/30 bg-white px-3 py-2 text-sm text-noma-primary outline-none focus:border-noma-brand/50"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onMouseEnter={() => prefetchSessionMessages(session.session_id)}
          onFocus={() => prefetchSessionMessages(session.session_id)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-14 text-left text-sm transition-colors",
            active ? "text-slate-900" : "text-slate-700",
          )}
        >
          {session.is_pinned && (
            <ChatBubbleOvalLeftIcon
              className="size-5 shrink-0 stroke-[1.5]"
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
        </button>
      )}

      {!renaming && (
        <div
          ref={menuRef}
          className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPin(!session.is_pinned);
            }}
            className={cn(styles.sessionAction, "rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100")}
            aria-label={session.is_pinned ? "取消置顶" : "置顶"}
            title={session.is_pinned ? "取消置顶" : "置顶"}
          >
            {session.is_pinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            className={cn(
              "rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100",
              styles.sessionAction,
              menuOpen && "opacity-100",
            )}
            aria-label="会话操作"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              ref={menuPanelRef}
              className={cn(
                "absolute right-0 z-50 w-32 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg",
                menuAbove
                  ? "menu-pop-in-up bottom-full mb-1"
                  : "menu-pop-in top-full mt-1",
              )}
            >
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onPin(!session.is_pinned);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {session.is_pinned ? (
                  <PinOff className="h-3.5 w-3.5" />
                ) : (
                  <Pin className="h-3.5 w-3.5" />
                )}
                {session.is_pinned ? "取消置顶" : "置顶"}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                重命名
              </button>
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="删除会话"
        description={`确定删除\u201c${session.title}\u201d吗？删除后无法恢复。`}
        onConfirm={onDelete}
      />
    </div>
  );
}
