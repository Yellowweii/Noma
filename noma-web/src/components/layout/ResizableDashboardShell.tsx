"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AgentSidebar } from "@/components/layout/AgentSidebar";
import { SidebarToggleIcon } from "@/components/layout/SidebarToggleIcon";
import { usePathname } from "next/navigation";
import { useChatSessions } from "@/contexts/ChatSessionContext";
import { cn } from "@/lib/utils";
import styles from "@/components/chat/agent-responsive.module.css";

const STORAGE_KEY_COLLAPSED = "noma-sidebar-collapsed";
const DEFAULT_WIDTH = 256;
const COLLAPSED_WIDTH = 56;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

function readStoredCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY_COLLAPSED) === "1";
}

export function ResizableDashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAgent = pathname.startsWith("/agent");
  const needsMobileHeader = pathname.startsWith("/home") || pathname.startsWith("/memory");
  const hasMobileSidebar = isAgent || pathname.startsWith("/settings") || needsMobileHeader;
  const { pendingRenameSessionId } = useChatSessions();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [smallScreen, setSmallScreen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawerMotion, setDrawerMotion] = useState(false);
  const [layoutSnap, setLayoutSnap] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mobile = hasMobileSidebar && smallScreen;

  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = (event?: MediaQueryListEvent) => {
      setSmallScreen(media.matches);
      setMobileOpen(false);
      // Arm the drawer transition only after this breakpoint's closed layout paints.
      setDrawerMotion(false);
      if (event) setLayoutSnap(true);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!layoutSnap) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setLayoutSnap(false));
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutSnap]);

  useEffect(() => {
    if (!smallScreen) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setDrawerMotion(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [smallScreen]);

  useEffect(() => {
    // Header rename edits the existing sidebar row, including on a phone.
    if (mobile && pendingRenameSessionId) setMobileOpen(true);
  }, [mobile, pendingRenameSessionId]);

  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    const focusTarget = sidebarRef.current?.querySelector<HTMLInputElement>("input")
      ?? sidebarRef.current?.querySelector<HTMLButtonElement>("button[aria-label='关闭侧边栏']");
    let focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const sidebar = sidebarRef.current;
      // Portal dialogs manage their own keyboard navigation.
      if (!sidebar || (!sidebar.contains(document.activeElement) && document.activeElement !== document.body)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(sidebar.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), [tabindex='0']",
      )).filter((element) => element.getClientRects().length && !element.closest("[inert]"));
      const first = targets[0], last = targets[targets.length - 1];
      if (document.activeElement === document.body) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobile, mobileOpen]);

  useEffect(() => {
    setCollapsed(readStoredCollapsed());
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY_COLLAPSED, next ? "1" : "0");
      return next;
    });
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      setDragging(true);
    },
    [collapsed, sidebarWidth],
  );

  useEffect(() => {
    if (!dragging) return;

    function onMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, drag.startWidth + e.clientX - drag.startX),
      );
      setSidebarWidth(next);
    }

    function onMouseUp() {
      dragRef.current = null;
      setDragging(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : sidebarWidth;

  return (
    <div className={cn("flex h-screen overflow-hidden bg-noma-canvas", hasMobileSidebar && styles.shell, layoutSnap && styles.sidebarLayoutSnap)}>
      {hasMobileSidebar && <button
        ref={triggerRef}
        type="button"
        aria-label="打开侧边栏"
        aria-expanded={mobileOpen}
        aria-controls="agent-sidebar"
        onClick={() => setMobileOpen(true)}
        className={cn(styles.sidebarTrigger, "size-10 items-center justify-center rounded-md bg-white text-slate-400 transition-colors hover:bg-noma-soft hover:text-slate-600")}
      ><SidebarToggleIcon /></button>}
      {hasMobileSidebar && <button
        type="button"
        aria-label="关闭侧边栏遮罩"
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
        tabIndex={-1}
        onClick={() => { closeMobileSidebar(); triggerRef.current?.focus(); }}
        className={cn(styles.sidebarBackdrop, mobileOpen && styles.sidebarBackdropOpen, drawerMotion && styles.sidebarMotion)}
      />}
      <div
        ref={sidebarRef}
        id="agent-sidebar"
        role={mobile && mobileOpen ? "dialog" : undefined}
        aria-modal={mobile && mobileOpen ? true : undefined}
        aria-label={mobile && mobileOpen ? "导航与聊天记录" : undefined}
        inert={mobile && !mobileOpen}
        className={cn(hasMobileSidebar && styles.sidebar, mobileOpen && styles.sidebarOpen, drawerMotion && styles.sidebarMotion, !hasMobileSidebar && "flex min-h-0 shrink-0")}
      >
        <AgentSidebar
          width={effectiveWidth}
          expandedWidth={sidebarWidth}
          collapsed={mobile ? false : collapsed}
          resizing={dragging}
          onToggleCollapse={mobile ? () => { closeMobileSidebar(); triggerRef.current?.focus(); } : toggleCollapsed}
          onNavigate={mobile ? closeMobileSidebar : undefined}
        />
      </div>
        <div
          role="separator"
          aria-hidden={collapsed}
          aria-orientation="vertical"
          aria-label="调整侧边栏宽度"
          onMouseDown={onMouseDown}
          className={cn(styles.sidebarResizeHandle, "group relative shrink-0 cursor-col-resize touch-none select-none bg-noma-border hover:bg-noma-tertiary/40", collapsed && "pointer-events-none", hasMobileSidebar && styles.separator)}
          style={{ width: collapsed ? 0 : 1 }}
        >
          <div className="absolute inset-y-0 -left-1.5 w-3" />
        </div>
      {needsMobileHeader && <header inert={mobile && mobileOpen} className={styles.moduleHeader}>
        <p>{pathname.startsWith("/home") ? "家" : "记忆"}</p>
      </header>}
      <main inert={mobile && mobileOpen} className={cn("min-w-0 flex-1 overflow-hidden", needsMobileHeader && styles.moduleMain)}>{children}</main>
    </div>
  );
}
