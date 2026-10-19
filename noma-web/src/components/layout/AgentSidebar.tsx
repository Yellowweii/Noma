"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useUser } from "@/contexts/UserContext";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Brain,
  ChevronDown,
  Home,
  LogOut,
  Search,
  Settings,
  SquarePen,
} from "lucide-react";
import { SessionSearchDialog } from "@/components/chat/SessionSearchDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsMenuPopover } from "@/components/settings/SettingsMenuPopover";
import { NomaLogo } from "@/components/NomaLogo";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useChatSessions } from "@/contexts/ChatSessionContext";
import { ChatSessionItem } from "@/components/layout/ChatSessionItem";
import { SidebarToggleIcon } from "@/components/layout/SidebarToggleIcon";
import { ScrollArea } from "@/components/layout/ScrollArea";
import { getUserDisplayName, UserAvatar } from "@/components/layout/UserAvatar";
import type { ChatSession } from "@/types";
import styles from "@/components/chat/agent-responsive.module.css";

const navItems = [
  { href: "/memory", label: "记忆", icon: Brain },
  { href: "/home", label: "家", icon: Home },
  { href: "/settings/ha", label: "设置", icon: Settings },
];

const memoryPathStorageKey = "noma_last_memory_path";

function isMemoryPath(pathname: string) {
  return (
    pathname === "/memory" ||
    pathname.startsWith("/memory/profile") ||
    pathname.startsWith("/memory/recent") ||
    pathname.startsWith("/memory/habits")
  );
}

interface AgentSidebarProps {
  width?: number;
  expandedWidth?: number;
  collapsed?: boolean;
  resizing?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}

interface SessionListGroupProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  sessions: ChatSession[];
  isAgent: boolean;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
}

function SessionListGroup({
  title,
  open,
  onToggle,
  sessions,
  isAgent,
  activeSessionId,
  onSelect,
  onPin,
  onRename,
  onDelete,
}: SessionListGroupProps) {
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!transitioning) return;

    // Also finish when reduced motion disables transition events.
    const timeout = window.setTimeout(() => setTransitioning(false), 240);
    return () => window.clearTimeout(timeout);
  }, [open, transitioning]);

  if (sessions.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => {
          setTransitioning(true);
          onToggle();
        }}
        aria-expanded={open}
        aria-label={open ? `折叠${title}` : `展开${title}`}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-left"
      >
        <span className="text-xs font-medium text-slate-500">{title}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ease-in-out motion-reduce:transition-none",
            !open && "-rotate-90",
          )}
        />
      </button>
      <div
        inert={!open}
        aria-hidden={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-in-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "grid-template-rows"
          ) {
            setTransitioning(false);
          }
        }}
      >
        <div
          className={cn(
            "min-h-0",
            (transitioning || !open) && "overflow-hidden",
          )}
        >
          {(open || transitioning) && (
            <div className="space-y-0.5 py-0.5">
              {sessions.map((session) => (
                <ChatSessionItem
                  key={session.session_id}
                  session={session}
                  active={isAgent && activeSessionId === session.session_id}
                  onSelect={() => onSelect(session.session_id)}
                  onPin={(pinned) => onPin(session.session_id, pinned)}
                  onRename={(title) => onRename(session.session_id, title)}
                  onDelete={() => onDelete(session.session_id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentSidebar({
  width = 256,
  expandedWidth = width,
  collapsed = false,
  resizing = false,
  onToggleCollapse,
  onNavigate,
}: AgentSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsAnchorRef = useRef<HTMLAnchorElement>(null);
  function openMobileSettings(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (!window.matchMedia("(max-width: 767px)").matches || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    event.preventDefault();
    setSettingsOpen(true);
    return true;
  }
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createNewChat,
    pinSession,
    renameSession,
    deleteSession,
    loadingMore,
    hasMoreSessions,
    sessionLoadError,
    loadMoreSessions,
  } = useChatSessions();
  const isAgent = pathname.startsWith("/agent");
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const { user } = useUser();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [memoryHref, setMemoryHref] = useState("/memory");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sessionViewportRef = useRef<HTMLDivElement>(null);
  const sessionSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = sessionViewportRef.current;
    const sentinel = sessionSentinelRef.current;
    if (collapsed || !recentOpen || !viewport || !sentinel || !hasMoreSessions || loadingMore || sessionLoadError) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMoreSessions();
    }, { root: viewport, rootMargin: "0px 0px 160px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [collapsed, recentOpen, pinnedOpen, hasMoreSessions, loadingMore, sessionLoadError, loadMoreSessions]);

  useEffect(() => {
    const visitingMemory = isMemoryPath(pathname);
    const memoryPath = `${pathname}${window.location.search}`;
    if (visitingMemory) setMemoryHref(memoryPath);

    try {
      if (visitingMemory) {
        window.sessionStorage.setItem(memoryPathStorageKey, memoryPath);
      } else {
        const savedPath = window.sessionStorage.getItem(memoryPathStorageKey);
        if (savedPath && isMemoryPath(savedPath)) setMemoryHref(savedPath);
      }
    } catch {
      // Keep in-session navigation working when browser storage is unavailable.
    }
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setUserMenuOpen(false);
    try {
      await api.logout();
      router.replace("/login");
    } catch {
      setLoggingOut(false);
    }
  }, [loggingOut, router]);

  useEffect(() => {
    if (!userMenuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  const { pinnedSessions, recentSessions } = useMemo(() => {
    const pinned: ChatSession[] = [];
    const recent: ChatSession[] = [];
    for (const session of sessions) {
      const title = session.title.trim();
      if (!title || title === "新对话") continue;
      if (session.is_pinned) pinned.push(session);
      else recent.push(session);
    }
    return { pinnedSessions: pinned, recentSessions: recent };
  }, [sessions]);

  const itemClass = "flex min-w-[44px] w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";
  const expandedOnlyClass = cn(styles.sidebarExpandedOnly, collapsed && styles.sidebarExpandedHidden);

  const navIconClass = "size-5 shrink-0";
  const logoIconClass = "size-[22px] shrink-0";
  const headerIconBtnClass =
    "rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600";
  const headerIconClass = "size-5 shrink-0";
  const headerIconStroke = 1.75;
  const sidebarHoverClass = "hover:bg-noma-soft";
  const sidebarActiveClass = "bg-noma-brand-active";

  const sessionHandlers = {
    onSelect: (sessionId: string) => {
      setActiveSessionId(sessionId);
      onNavigate?.();
    },
    onPin: (sessionId: string, pinned: boolean) =>
      pinSession(sessionId, pinned).catch(() => {}),
    onRename: (sessionId: string, title: string) =>
      renameSession(sessionId, title).catch(() => {}),
    onDelete: (sessionId: string) => deleteSession(sessionId).catch(() => {}),
  };

  return (
    <aside
      style={{ width }}
      className={cn(
        "relative flex h-full shrink-0 flex-col bg-white",
        !resizing && styles.sidebarFrame,
      )}
    >
      <div
        className={cn(styles.sidebarContent, "flex h-full min-h-0 w-full shrink-0 flex-col")}
      >
      <div
        className="relative h-[52px] shrink-0"
      >
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="打开侧边栏"
            aria-hidden={!collapsed}
            inert={!collapsed}
            className={cn(
              "group absolute left-[9px] top-2.5 flex h-[42px] w-11 items-center justify-center rounded-lg text-slate-700 transition-opacity duration-100",
              !collapsed && "pointer-events-none opacity-0",
              sidebarHoverClass,
              "hover:text-slate-900",
            )}
          >
            <NomaLogo className={cn(logoIconClass, "transition-opacity group-hover:opacity-0")} />
            <SidebarToggleIcon className="absolute opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <div
          inert={collapsed}
          aria-hidden={collapsed}
          className={cn(styles.sidebarHeader, "absolute left-0 top-0 flex items-center justify-between pl-2 pr-3 pt-2.5", expandedOnlyClass)}
          style={{ width: expandedWidth }}
        >
          <Link
            href="/agent"
            onClick={onNavigate}
            className={cn(
              itemClass,
              "font-semibold leading-none text-noma-primary transition-colors hover:text-noma-brand",
            )}
          >
            <NomaLogo className={logoIconClass} />
            <span className="text-[17px]">Noma</span>
          </Link>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="搜索对话"
              aria-label="搜索对话"
              className={cn(headerIconBtnClass, sidebarHoverClass)}
            >
              <Search
                className={headerIconClass}
                strokeWidth={headerIconStroke}
              />
            </button>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="关闭侧边栏"
                aria-label="关闭侧边栏"
                className={cn(headerIconBtnClass, sidebarHoverClass)}
              >
                <SidebarToggleIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden pl-2"
      >
        <div className="pr-4">
          <button
            onClick={() => { void createNewChat().catch(() => {}); onNavigate?.(); }}
            className={cn(itemClass, "text-slate-700", sidebarHoverClass)}
            title={collapsed ? "新聊天" : undefined}
            aria-label="新聊天"
          >
            <SquarePen className={navIconClass} />
            <span aria-hidden={collapsed} className={expandedOnlyClass}>新聊天</span>
          </button>

          <nav className="mt-1 space-y-0.5">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href.startsWith("/settings")
                ? settingsOpen || pathname.startsWith("/settings")
                : !settingsOpen && pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  ref={href.startsWith("/settings") ? settingsAnchorRef : undefined}
                  href={href === "/memory" ? memoryHref : href}
                  onClick={(event) => {
                    if (href.startsWith("/settings") && openMobileSettings(event)) return;
                    onNavigate?.();
                  }}
                  title={collapsed ? label : undefined}
                  aria-label={label}
                  className={cn(
                    itemClass,
                    active
                      ? cn(sidebarActiveClass, "text-slate-900")
                      : cn("text-slate-700", sidebarHoverClass),
                  )}
                >
                  <Icon className={navIconClass} />
                  <span aria-hidden={collapsed} className={expandedOnlyClass}>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

          <ScrollArea
            inert={collapsed}
            aria-hidden={collapsed}
            className={cn(styles.sidebarSessionList, "mt-4 min-h-0 flex-1", expandedOnlyClass)}
            style={{ width: expandedWidth - 8 }}
            viewportRef={sessionViewportRef}
          >
            <div className="pr-4">
              <SessionListGroup
                title="置顶"
                open={pinnedOpen}
                onToggle={() => setPinnedOpen((open) => !open)}
                sessions={pinnedSessions}
                isAgent={isAgent}
                activeSessionId={activeSessionId}
                {...sessionHandlers}
              />
              <SessionListGroup
                title="最近"
                open={recentOpen}
                onToggle={() => setRecentOpen((open) => !open)}
                sessions={recentSessions}
                isAgent={isAgent}
                activeSessionId={activeSessionId}
                {...sessionHandlers}
              />
              <div ref={sessionSentinelRef} className="h-px" aria-hidden="true" />
              {(loadingMore || sessionLoadError) && <div className="px-3 py-3 text-center text-xs text-noma-tertiary" role="status">
                {sessionLoadError ? <button onClick={() => void loadMoreSessions()} className="text-noma-brand">{sessionLoadError}</button> : "正在加载更多对话…"}
              </div>}
            </div>
          </ScrollArea>
      </div>

      {user && (
        <div
          className={cn(
            "mt-auto shrink-0 border-t border-slate-200 pl-2 pr-4 py-3",
          )}
        >
          <div
            ref={userMenuRef}
            className="group relative w-full"
          >
            <button
              type="button"
              onClick={() => setUserMenuOpen((open) => !open)}
              disabled={loggingOut}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label="账号菜单"
              className={cn(
                "flex min-w-[44px] w-full items-center gap-2.5 rounded-lg p-1 transition-colors disabled:opacity-60",
                sidebarHoverClass,
                userMenuOpen && sidebarActiveClass,
              )}
            >
              <UserAvatar
                name={user.name}
                email={user.email}
                avatarUrl={user.avatar_url}
                size="sidebar"
              />
                <span aria-hidden={collapsed} className={cn("min-w-0 flex-1 truncate text-left text-[13.5px] font-medium text-slate-900", expandedOnlyClass)}>
                  {getUserDisplayName(user.name)}
                </span>
            </button>

            {collapsed && !userMenuOpen && (
              <div
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-2.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              >
                <span
                  aria-hidden
                  className="absolute right-full top-1/2 -translate-y-1/2 border-y-[5px] border-r-[6px] border-y-transparent border-r-slate-800"
                />
                {getUserDisplayName(user.name)}
              </div>
            )}

            {userMenuOpen && (
              <div
                role="menu"
                className={cn(
                  "menu-pop-in-up absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-noma-border bg-white shadow-lg",
                  collapsed ? "left-0 w-64" : "inset-x-0 w-auto max-w-full",
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <UserAvatar
                    name={user.name}
                    email={user.email}
                    avatarUrl={user.avatar_url}
                    size="sidebar"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-noma-primary">
                      {getUserDisplayName(user.name)}
                    </p>
                    <p className="truncate text-xs text-noma-secondary">
                      {user.email || user.phone}
                    </p>
                  </div>
                </div>

                <div className="border-t border-noma-border" />

                <div className="p-1.5">
                  <Link
                    href="/settings/ha"
                    role="menuitem"
                    onClick={(event) => { setUserMenuOpen(false); if (!openMobileSettings(event)) onNavigate?.(); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm text-noma-primary transition-colors duration-150 hover:bg-noma-soft focus-visible:bg-noma-soft"
                  >
                    <Settings
                      className="size-4 shrink-0 text-noma-secondary"
                      strokeWidth={1.75}
                    />
                    设置
                  </Link>
                </div>

                <div className="border-t border-noma-border" />

                <div className="p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setLogoutConfirmOpen(true);
                    }}
                    disabled={loggingOut}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm text-red-600 transition-colors duration-150 enabled:hover:bg-red-50 focus-visible:bg-red-50 disabled:opacity-60"
                  >
                    <LogOut className="size-4 shrink-0" strokeWidth={1.75} />
                    退出登录
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      <SessionSearchDialog open={searchOpen} onOpenChange={setSearchOpen} onSessionSelect={onNavigate} />
      <SettingsMenuPopover open={settingsOpen} anchor={settingsAnchorRef.current} onOpenChange={setSettingsOpen} onNavigate={onNavigate} />
      <ConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title="退出登录"
        description="确定要退出当前账号吗？"
        confirmLabel="退出登录"
        onConfirm={() => void handleLogout()}
      />
    </aside>
  );
}
