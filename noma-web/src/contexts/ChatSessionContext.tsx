"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, bootstrapSession, getAccessToken } from "@/lib/api";
import {
  clearNewChatIntent,
  clearStoredActiveSessionId,
  readNewChatIntent,
  readStoredActiveSessionId,
  writeNewChatIntent,
  writeStoredActiveSessionId,
} from "@/lib/activeSessionStorage";
import {
  AGENT_PATH,
  isAgentPath,
  parseLegacyAgentSessionId,
} from "@/lib/chatRoutes";
import {
  createBootstrapPendingSessionState,
  readRestorableSessionId,
} from "@/lib/chatSessionBootstrap";
import {
  createPendingSessionId,
  getSessionSnapshot,
  invalidateSessionSnapshot,
  isPendingSessionId,
  prefetchSessionMessages,
  writeSessionSnapshot,
} from "@/lib/sessionMessageCache";
import { sortChatSessions, truncateTitle } from "@/lib/utils";
import type { ChatSession } from "@/types";

interface ChatSessionContextValue {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string) => void;
  createNewChat: () => Promise<ChatSession>;
  resolveSessionId: (sessionId: string) => Promise<string>;
  updateSessionTitle: (sessionId: string, title: string) => void;
  touchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  pinSession: (sessionId: string, pinned: boolean) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  pendingRenameSessionId: string | null;
  beginSessionRename: (sessionId: string) => void;
  clearSessionRenameRequest: () => void;
  loading: boolean;
  loadingMore: boolean;
  hasMoreSessions: boolean;
  sessionLoadError: string;
  loadMoreSessions: () => Promise<void>;
  inputFocusNonce: number;
  /** 客户端已从 localStorage 恢复 session 前为 false，避免 SSR 欢迎页闪现 */
  initialSessionResolved: boolean;
  /** 用户主动进入新聊天（刷新后仍显示欢迎页） */
  newChatIntent: boolean;
  finishNewChatIntent: () => void;
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

function upsertSession(sessions: ChatSession[], session: ChatSession) {
  return sortChatSessions([
    session,
    ...sessions.filter((s) => s.session_id !== session.session_id),
  ]);
}

function placeholderSession(sessionId: string): ChatSession {
  return {
    session_id: sessionId,
    user_id: "",
    title: "",
    is_pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const initialSessionRef = useRef(createBootstrapPendingSessionState());
  const clientRestoreDoneRef = useRef(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    () => initialSessionRef.current.sessionId,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState("");
  const nextCursorRef = useRef<string | undefined>(undefined);
  const pageLoadingRef = useRef(false);
  const pageGenerationRef = useRef(0);
  const deletedSessionsRef = useRef(new Set<string>());
  const [pendingRenameSessionId, setPendingRenameSessionId] = useState<
    string | null
  >(null);
  const [inputFocusNonce, setInputFocusNonce] = useState(0);
  const [initialSessionResolved, setInitialSessionResolved] = useState(false);
  const [newChatIntent, setNewChatIntent] = useState(false);
  const pendingSessionsRef = useRef(new Map<string, Promise<ChatSession>>());
  const bootstrapPendingIdRef = useRef<string | null>(
    initialSessionRef.current.needsPendingBootstrap
      ? initialSessionRef.current.sessionId
      : null,
  );
  const restoredSessionIdRef = useRef<string | null>(
    initialSessionRef.current.needsPendingBootstrap
      ? null
      : initialSessionRef.current.sessionId,
  );
  const sessionsHydratedRef = useRef(false);

  const persistActiveSessionId = useCallback((sessionId: string | null) => {
    if (sessionId && !isPendingSessionId(sessionId)) {
      writeStoredActiveSessionId(sessionId);
      return;
    }
    if (!sessionId) {
      clearStoredActiveSessionId();
    }
  }, []);

  const applyActiveSessionId = useCallback(
    (sessionId: string | null) => {
      setActiveSessionIdState(sessionId);
      persistActiveSessionId(sessionId);
    },
    [persistActiveSessionId],
  );

  useLayoutEffect(() => {
    if (clientRestoreDoneRef.current) return;
    clientRestoreDoneRef.current = true;

    const restoredId = readRestorableSessionId();
    if (restoredId) {
      const pendingId = bootstrapPendingIdRef.current;
      if (pendingId) {
        invalidateSessionSnapshot(pendingId);
        pendingSessionsRef.current.delete(pendingId);
        bootstrapPendingIdRef.current = null;
      }

      restoredSessionIdRef.current = restoredId;
      applyActiveSessionId(restoredId);
    }

    setInitialSessionResolved(true);
    setNewChatIntent(readNewChatIntent());
  }, [applyActiveSessionId]);

  const migratePendingSession = useCallback(
    (pendingId: string, session: ChatSession) => {
      const snapshot = getSessionSnapshot(pendingId);
      if (snapshot) {
        writeSessionSnapshot(session.session_id, snapshot);
        invalidateSessionSnapshot(pendingId);
      }
      pendingSessionsRef.current.delete(pendingId);
      setActiveSessionIdState((current) => {
        const next = current === pendingId ? session.session_id : current;
        if (next && next !== current) {
          writeStoredActiveSessionId(next);
        }
        return next;
      });
      setSessions((prev) => upsertSession(prev, session));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function pickFallbackSessionId(sorted: ChatSession[]) {
      const storedId = readStoredActiveSessionId();
      const storedSession = storedId
        ? sorted.find((session) => session.session_id === storedId)
        : undefined;
      if (storedSession) return storedSession.session_id;

      // The restored conversation can be older than the first sidebar page.
      if (storedId) {
        try {
          const restored = await api.getChatSession(storedId);
          if (cancelled) return null;
          setSessions((prev) => upsertSession(prev, restored));
          return restored.session_id;
        } catch (error) {
          if ((error as { status?: number }).status !== 404) return storedId;
        }
      }

      try {
        const latest = await api.getLatestChatSession();
        if (cancelled) return null;
        return latest?.session_id ?? sorted[0]?.session_id ?? null;
      } catch {
        if (cancelled) return null;
        return sorted[0]?.session_id ?? null;
      }
    }

    async function hydrateSessions() {
      setLoading(true);
      if (!getAccessToken()) {
        const ok = await bootstrapSession();
        if (cancelled || !ok) {
          throw new Error("Auth bootstrap failed");
        }
      }

      const page = await api.listChatSessionPage();
      if (cancelled) return null;

      const sorted = sortChatSessions(page.sessions);
      setSessions(sorted);
      nextCursorRef.current = page.next_cursor;
      setHasMoreSessions(Boolean(page.next_cursor));
      setSessionLoadError("");
      sessionsHydratedRef.current = true;
      return sorted;
    }

    async function init() {
      const legacySessionId = parseLegacyAgentSessionId(pathname);
      if (legacySessionId) {
        const bootstrapPendingId = bootstrapPendingIdRef.current;
        if (bootstrapPendingId) {
          invalidateSessionSnapshot(bootstrapPendingId);
          pendingSessionsRef.current.delete(bootstrapPendingId);
          bootstrapPendingIdRef.current = null;
        }
        applyActiveSessionId(legacySessionId);
        restoredSessionIdRef.current = legacySessionId;
        router.replace(AGENT_PATH);
        if (!sessionsHydratedRef.current) {
          try { await hydrateSessions(); } finally { if (!cancelled) setLoading(false); }
        }
        return;
      }

      if (sessionsHydratedRef.current) return;

      const pendingId = bootstrapPendingIdRef.current;

      try {
        const sorted = await hydrateSessions();
        if (cancelled || !sorted) return;

        if (!pendingId) {
          const restoredId = restoredSessionIdRef.current;
          if (restoredId && !sorted.some((s) => s.session_id === restoredId)) {
            const fallbackId = await pickFallbackSessionId(sorted);
            if (cancelled || !fallbackId) return;
            applyActiveSessionId(fallbackId);
            restoredSessionIdRef.current = fallbackId;
          }
          return;
        }

        if (restoredSessionIdRef.current) {
          bootstrapPendingIdRef.current = null;
          return;
        }

        const promise = api.createChatSession().then((session) => {
          migratePendingSession(pendingId, session);
          return session;
        });
        pendingSessionsRef.current.set(pendingId, promise);
        bootstrapPendingIdRef.current = null;
      } catch {
        // ignore bootstrap failures; UI keeps last known session state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init().catch(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [pathname, router, migratePendingSession, applyActiveSessionId]);

  useEffect(() => {
    if (!sessions.length) return;
    if (activeSessionId && !isPendingSessionId(activeSessionId)) {
      prefetchSessionMessages(activeSessionId);
    }
  }, [activeSessionId]);

  const ensureAgentView = useCallback(() => {
    if (!isAgentPath(pathname)) {
      router.push(AGENT_PATH);
    }
  }, [pathname, router]);

  const resolveSessionId = useCallback(async (sessionId: string) => {
    if (!isPendingSessionId(sessionId)) return sessionId;
    const pending = pendingSessionsRef.current.get(sessionId);
    if (!pending) {
      throw new Error("Pending session expired");
    }
    const session = await pending;
    return session.session_id;
  }, []);

  const requestInputFocus = useCallback(() => {
    setInputFocusNonce((nonce) => nonce + 1);
  }, []);

  const createNewChat = useCallback(async () => {
    ensureAgentView();
    writeNewChatIntent();
    setNewChatIntent(true);

    if (activeSessionId) {
      if (isPendingSessionId(activeSessionId)) {
        requestInputFocus();
        return placeholderSession(activeSessionId);
      }
      const cached = getSessionSnapshot(activeSessionId);
      if (cached?.fetched && cached.messages.length === 0) {
        const existing = sessions.find(
          (s) => s.session_id === activeSessionId,
        );
        requestInputFocus();
        return existing ?? placeholderSession(activeSessionId);
      }
    }

    const pendingId = createPendingSessionId();
    writeSessionSnapshot(pendingId, { messages: [], fetched: true });

    if (activeSessionId && isPendingSessionId(activeSessionId)) {
      invalidateSessionSnapshot(activeSessionId);
      pendingSessionsRef.current.delete(activeSessionId);
    }

    clearStoredActiveSessionId();
    applyActiveSessionId(pendingId);
    requestInputFocus();

    const promise = api.createChatSession().then((session) => {
      migratePendingSession(pendingId, session);
      return session;
    });
    pendingSessionsRef.current.set(pendingId, promise);

    return placeholderSession(pendingId);
  }, [
    activeSessionId,
    sessions,
    ensureAgentView,
    migratePendingSession,
    requestInputFocus,
    applyActiveSessionId,
  ]);

  const refreshSessions = useCallback(async () => {
    try {
      const page = await api.listChatSessionPage();
      // Keep already loaded pages and their cursor while refreshing new titles.
      setSessions((prev) => sortChatSessions([...page.sessions, ...prev.filter((item) => !page.sessions.some((fresh) => fresh.session_id === item.session_id))]
        .filter((item) => !deletedSessionsRef.current.has(item.session_id))));
      if (!sessionsHydratedRef.current) {
        nextCursorRef.current = page.next_cursor;
        setHasMoreSessions(Boolean(page.next_cursor));
      }
    } catch {
      // ignore
    }
  }, []);

  const loadMoreSessions = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || pageLoadingRef.current) return;
    pageLoadingRef.current = true;
    const generation = pageGenerationRef.current;
    setLoadingMore(true);
    setSessionLoadError("");
    try {
      const page = await api.listChatSessionPage(cursor);
      if (generation !== pageGenerationRef.current) return;
      setSessions((prev) => {
        const known = new Set(prev.map((item) => item.session_id));
        return sortChatSessions([...prev, ...page.sessions.filter((item) => !known.has(item.session_id) && !deletedSessionsRef.current.has(item.session_id))]);
      });
      nextCursorRef.current = page.next_cursor;
      setHasMoreSessions(Boolean(page.next_cursor));
    } catch {
      setSessionLoadError("加载失败，点击重试");
    } finally {
      pageLoadingRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => () => { pageGenerationRef.current += 1; }, []);

  const updateSessionTitle = useCallback((sessionId: string, title: string) => {
    const nextTitle = truncateTitle(title);
    if (!nextTitle || nextTitle === "新对话") return;
    setSessions((prev) => {
      const existing = prev.find((s) => s.session_id === sessionId);
      const session: ChatSession = existing
        ? {
            ...existing,
            title: nextTitle,
            updated_at: new Date().toISOString(),
          }
        : {
            session_id: sessionId,
            user_id: "",
            title: nextTitle,
            is_pinned: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
      return upsertSession(prev, session);
    });
  }, []);

  const touchSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const existing = prev.find((s) => s.session_id === sessionId);
      if (!existing) return prev;
      return upsertSession(prev, {
        ...existing,
        updated_at: new Date().toISOString(),
      });
    });
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const nextTitle = truncateTitle(title, 80);
      const updated = await api.updateChatSession(sessionId, {
        title: nextTitle,
      });
      setSessions((prev) => upsertSession(prev, updated));
    },
    [],
  );

  const pinSession = useCallback(async (sessionId: string, pinned: boolean) => {
    let snapshot: ChatSession[] = [];
    setSessions((prev) => {
      snapshot = prev;
      const session = prev.find((s) => s.session_id === sessionId);
      if (!session) return prev;
      return upsertSession(prev, {
        ...session,
        is_pinned: pinned,
        pinned_at: pinned ? new Date().toISOString() : undefined,
      });
    });

    try {
      const updated = await api.updateChatSession(sessionId, {
        is_pinned: pinned,
      });
      setSessions((prev) => {
        const previous = prev.find((s) => s.session_id === sessionId);
        if (!previous) return upsertSession(prev, updated);
        return upsertSession(prev, {
          ...updated,
          updated_at: previous.updated_at,
          pinned_at: pinned ? updated.pinned_at : undefined,
        });
      });
    } catch {
      setSessions(snapshot);
    }
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await api.deleteChatSession(sessionId);
      deletedSessionsRef.current.add(sessionId);
      invalidateSessionSnapshot(sessionId);
      let nextActiveId: string | null = null;
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.session_id !== sessionId);
        if (activeSessionId === sessionId) {
          nextActiveId = remaining[0]?.session_id ?? null;
        }
        return remaining;
      });

      if (activeSessionId !== sessionId) return;

      if (nextActiveId) {
        applyActiveSessionId(nextActiveId);
        return;
      }

      try {
        const latest = await api.getLatestChatSession();
        if (latest && latest.session_id !== sessionId) {
          applyActiveSessionId(latest.session_id);
          return;
        }
      } catch {
        // fall through to create
      }

      await createNewChat();
    },
    [activeSessionId, createNewChat, applyActiveSessionId],
  );

  const finishNewChatIntent = useCallback(() => {
    clearNewChatIntent();
    setNewChatIntent(false);
  }, []);

  const selectSession = useCallback(
    (id: string) => {
      clearNewChatIntent();
      setNewChatIntent(false);
      applyActiveSessionId(id);
      requestInputFocus();
      ensureAgentView();
      if (!sessions.some((session) => session.session_id === id)) {
        void api.getChatSession(id).then((session) => setSessions((prev) => upsertSession(prev, session))).catch(() => {});
      }
    },
    [ensureAgentView, requestInputFocus, applyActiveSessionId, sessions],
  );

  const beginSessionRename = useCallback((sessionId: string) => {
    setPendingRenameSessionId(sessionId);
  }, []);

  const clearSessionRenameRequest = useCallback(() => {
    setPendingRenameSessionId(null);
  }, []);

  return (
    <ChatSessionContext.Provider
      value={{
        sessions,
        activeSessionId,
        setActiveSessionId: selectSession,
        createNewChat,
        resolveSessionId,
        updateSessionTitle,
        touchSession,
        renameSession,
        pinSession,
        deleteSession,
        refreshSessions,
        pendingRenameSessionId,
        beginSessionRename,
        clearSessionRenameRequest,
        loading,
        loadingMore,
        hasMoreSessions,
        sessionLoadError,
        loadMoreSessions,
        inputFocusNonce,
        initialSessionResolved,
        newChatIntent,
        finishNewChatIntent,
      }}
    >
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSessions() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error("useChatSessions must be used within ChatSessionProvider");
  }
  return ctx;
}
