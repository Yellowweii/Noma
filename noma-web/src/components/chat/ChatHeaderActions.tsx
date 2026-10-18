"use client";

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  SquarePen,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useChatSessions } from "@/contexts/ChatSessionContext";
import type { ChatSession } from "@/types";
import { cn } from "@/lib/utils";

type ChatHeaderActionsProps = {
  session: ChatSession;
};

export function ChatHeaderActions({ session }: ChatHeaderActionsProps) {
  const { beginSessionRename, pinSession, deleteSession, createNewChat } =
    useChatSessions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function handleRename() {
    setMenuOpen(false);
    beginSessionRename(session.session_id);
  }

  function handlePin() {
    setMenuOpen(false);
    void pinSession(session.session_id, !session.is_pinned);
  }

  function handleDeleteConfirm() {
    setDeleteConfirmOpen(false);
    void deleteSession(session.session_id);
  }

  const toolbarBtnClass =
    "inline-flex items-center justify-center rounded-lg text-noma-primary transition-colors duration-150 hover:bg-noma-soft";

  return (
    <>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            void createNewChat().catch(() => {});
          }}
          aria-label="新聊天"
          title="新聊天"
          className={cn(toolbarBtnClass, "size-10 md:size-8")}
        >
          <SquarePen className="size-5" strokeWidth={1.75} />
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="更多操作"
            aria-expanded={menuOpen}
            className={cn(
              toolbarBtnClass,
              "size-10 md:size-8",
              menuOpen && "bg-noma-soft",
            )}
          >
            <MoreHorizontal className="size-5" strokeWidth={1.75} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="menu-pop-in absolute right-0 top-full z-50 mt-1 w-36 rounded-xl border border-noma-border bg-white p-1.5 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={handlePin}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-noma-primary transition-colors hover:bg-noma-soft focus-visible:bg-noma-soft"
              >
                {session.is_pinned ? (
                  <PinOff className="size-3.5 shrink-0 text-noma-secondary" />
                ) : (
                  <Pin className="size-3.5 shrink-0 text-noma-secondary" />
                )}
                {session.is_pinned ? "取消置顶" : "置顶"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleRename}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-noma-primary transition-colors hover:bg-noma-soft focus-visible:bg-noma-soft"
              >
                <Pencil className="size-3.5 shrink-0 text-noma-secondary" />
                重命名
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteConfirmOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 focus-visible:bg-red-50"
              >
                <Trash2 className="size-3.5 shrink-0" />
                删除
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="删除对话"
        description="删除后无法恢复，确定要删除这条对话吗？"
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}
