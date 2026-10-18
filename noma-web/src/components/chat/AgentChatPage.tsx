"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { NomaLogo } from "@/components/NomaLogo";
import { AssistantMessageActions } from "@/components/chat/AssistantMessageActions";
import { ChatHeaderActions } from "@/components/chat/ChatHeaderActions";
import { ChatQuotaDialog } from "@/components/chat/ChatQuotaDialog";
import type { ChatQuota } from "@/lib/chatQuota";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { UserMessageBubble } from "@/components/chat/UserMessageBubble";
import { ScrollArea } from "@/components/layout/ScrollArea";
import { FloatingTip } from "@/components/ui/FloatingTip";
import { Tooltip } from "@/components/ui/Tooltip";
import { useChatSessions } from "@/contexts/ChatSessionContext";
import { api, ApiError } from "@/lib/api";
import {
  type SpeechRecognitionErrorCode,
  useSpeechToText,
} from "@/lib/useSpeechToText";
import {
  applySessionSnapshot,
  getInitialSessionViewState,
  getSessionSnapshot,
  isPendingSessionId,
  loadSessionMessages,
  updateSessionScrollTop,
  writeSessionSnapshot,
} from "@/lib/sessionMessageCache";
import { readNewChatIntent } from "@/lib/activeSessionStorage";
import type { ChatMessage, MessageFeedback } from "@/types";
import { cn } from "@/lib/utils";
import styles from "./agent-responsive.module.css";

type AgentChatPageProps = {
  /** 服务端根据 cookie 判断的新聊天意图，用于 SSR 首屏直接输出欢迎页 */
  ssrNewChatIntent?: boolean;
};

export function AgentChatPage({
  ssrNewChatIntent = false,
}: AgentChatPageProps) {
  const [quota, setQuota] = useState<ChatQuota>();
  const [quotaOpen, setQuotaOpen] = useState(false);
  const closeQuota = useCallback(() => setQuotaOpen(false), []);
  const quotaExhausted = quota?.remaining === 0;
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void api
        .getChatQuota()
        .then(({ quota: next }) => {
          if (cancelled) return;
          setQuota(next);
          if (next.remaining === 0) setQuotaOpen(true);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    if (!quota) return;
    const timeout = window.setTimeout(
      () => {
        setQuota(undefined);
        setQuotaOpen(false);
      },
      Math.max(0, Date.parse(quota.reset_at) - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [quota]);
  const {
    sessions,
    activeSessionId: routeSessionId,
    loading: sessionsLoading,
    updateSessionTitle,
    touchSession,
    refreshSessions,
    resolveSessionId,
    inputFocusNonce,
    initialSessionResolved,
    newChatIntent,
    finishNewChatIntent,
  } = useChatSessions();
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => getInitialSessionViewState(routeSessionId).messages,
  );
  const [sessionReady, setSessionReady] = useState(
    () => getInitialSessionViewState(routeSessionId).sessionReady,
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingScrollSessionIdRef = useRef<string | null>(null);
  const anchorScrollTopRef = useRef<number | null>(null);
  const isSmoothScrollingRef = useRef(false);
  const activeTurnUserIdRef = useRef<string | null>(null);
  const turnReservePaddingRef = useRef(0);
  const autoScrollEnabledRef = useRef(true);
  const streamingRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const prevStreamingRef = useRef(false);
  const [turnAnchorId, setTurnAnchorId] = useState<string | null>(null);
  const [activeTurnUserId, setActiveTurnUserId] = useState<string | null>(null);
  const [turnReservePadding, setTurnReservePadding] = useState(0);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [speechTip, setSpeechTip] = useState<{
    message: string;
    description?: string;
  } | null>(null);
  const speechBaseRef = useRef("");
  const speechSendPendingRef = useRef(false);
  const [speechTranscribeFromSend, setSpeechTranscribeFromSend] =
    useState(false);
  const [sessionNotFound, setSessionNotFound] = useState(
    () => getInitialSessionViewState(routeSessionId).sessionNotFound,
  );
  const [syncedSessionId, setSyncedSessionId] = useState<string | null>(null);
  const loadedSessionIdRef = useRef<string | null>(routeSessionId);
  const pendingScrollRestoreRef = useRef<number | null>(null);

  function markScrollToBottom(sessionId: string) {
    pendingScrollSessionIdRef.current = sessionId;
  }

  function scrollViewportToBottom() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentViewport = scrollViewportRef.current;
        if (!currentViewport) return;
        setScrollTopProgrammatic(currentViewport, currentViewport.scrollHeight);
      });
    });
  }
  /** 首条消息和移动端轮次需避开顶部操作栏。 */
  const CHAT_HEADER_RESERVE = 64;
  const TURN_ANCHOR_TOP = 20;
  const TURN_BOTTOM_GAP = 24;
  /** 与 assistant 消息 mt-6 一致 */
  const TURN_USER_ASSISTANT_GAP = 24;
  const MESSAGE_GAP = 16;
  const INPUT_MAX_HEIGHT = 220;
  /** 助手消息操作栏占位（mt-2 + h-8）；流式期间隐藏，结束后再渲染 */
  const ASSISTANT_ACTIONS_HEIGHT = 40;

  function getSingleLineHeight(el: HTMLTextAreaElement) {
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);
    return lineHeight + paddingTop + paddingBottom;
  }

  function adjustTextareaHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const singleLineHeight = getSingleLineHeight(el);
    // Always decide expansion using the compact row's available text width.
    // Measuring the expanded full-width textarea would toggle the layout back
    // and forth for text that fits only after its buttons move to a new row.
    const previousWidth = el.style.width;
    const previousFlex = el.style.flex;
    // Compact row: 28px padding + 36px mic + 40px send + 4px gaps.
    const compactRowControlsWidth = 108;
    const compactWidth = (inputBarRef.current?.clientWidth
      ?? el.clientWidth + compactRowControlsWidth) - compactRowControlsWidth;
    el.style.flex = "none";
    el.style.width = `${Math.max(1, compactWidth)}px`;
    const compactScrollHeight = el.scrollHeight;
    el.style.width = previousWidth;
    el.style.flex = previousFlex;
    const expanded =
      input.includes("\n") || compactScrollHeight > singleLineHeight + 1;

    setInputExpanded((prev) => (prev === expanded ? prev : expanded));
    const maxHeight = Math.min(
      INPUT_MAX_HEIGHT,
      parseFloat(window.getComputedStyle(el).maxHeight) || INPUT_MAX_HEIGHT,
    );
    el.style.height = expanded
      ? `${Math.min(el.scrollHeight, maxHeight)}px`
      : `${singleLineHeight}px`;
  }

  function remapTurnUserId(oldId: string, newId: string) {
    if (activeTurnUserIdRef.current === oldId) {
      activeTurnUserIdRef.current = newId;
      setActiveTurnUserId(newId);
    }
    setTurnAnchorId((prev) => (prev === oldId ? newId : prev));
  }

  function smoothScrollTo(
    el: HTMLElement,
    targetTop: number,
    duration = 420,
    onComplete?: () => void,
  ) {
    const start = el.scrollTop;
    const distance = targetTop - start;
    if (Math.abs(distance) < 2) {
      onComplete?.();
      return;
    }

    isSmoothScrollingRef.current = true;
    isProgrammaticScrollRef.current = true;
    const startTime = performance.now();
    function step(now: number) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      el.scrollTop = start + distance * eased;
      lastScrollTopRef.current = el.scrollTop;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        isSmoothScrollingRef.current = false;
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false;
        });
        onComplete?.();
      }
    }
    requestAnimationFrame(step);
  }

  function getTurnAnchorTop(userId: string, currentMessages: ChatMessage[]) {
    const firstUserMsg = currentMessages.find((m) => m.role === "user");
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    return firstUserMsg?.message_id === userId || mobile
      ? CHAT_HEADER_RESERVE
      : TURN_ANCHOR_TOP;
  }

  function getOutputZoneHeight(
    scrollParent: HTMLElement,
    userEl: HTMLElement,
    anchorTop: number,
  ) {
    return Math.max(
      TURN_BOTTOM_GAP,
      scrollParent.clientHeight -
        anchorTop -
        userEl.offsetHeight -
        TURN_BOTTOM_GAP,
    );
  }

  function measureContentGapsBelowUser(
    userId: string,
    currentMessages: ChatMessage[],
  ) {
    const userIdx = currentMessages.findIndex((m) => m.message_id === userId);
    const assistantMsg =
      userIdx >= 0 ? currentMessages[userIdx + 1] : undefined;
    if (assistantMsg?.role !== "assistant") return 0;

    const assistantEl = document.getElementById(
      `msg-${assistantMsg.message_id}`,
    );
    return assistantEl ? TURN_USER_ASSISTANT_GAP : MESSAGE_GAP;
  }

  function measureTurnReservePadding(
    scrollParent: HTMLElement,
    userId: string,
    currentMessages: ChatMessage[],
  ) {
    const userEl = document.getElementById(`msg-${userId}`);
    if (!userEl) return 0;

    const outputZone = getOutputZoneHeight(
      scrollParent,
      userEl,
      getTurnAnchorTop(userId, currentMessages),
    );
    const userIdx = currentMessages.findIndex((m) => m.message_id === userId);
    const assistantMsg =
      userIdx >= 0 ? currentMessages[userIdx + 1] : undefined;
    let assistantH = 0;

    if (assistantMsg?.role === "assistant") {
      const assistantEl = document.getElementById(
        `msg-${assistantMsg.message_id}`,
      );
      assistantH = assistantEl?.offsetHeight ?? 0;
      if (streamingRef.current) {
        assistantH += ASSISTANT_ACTIONS_HEIGHT;
      }
    }

    const gaps = measureContentGapsBelowUser(userId, currentMessages);
    return Math.max(0, outputZone - assistantH - gaps);
  }

  function getMaxScrollTop() {
    const scrollParent = scrollViewportRef.current;
    if (!scrollParent) return 0;

    const maxNatural = Math.max(
      0,
      scrollParent.scrollHeight - scrollParent.clientHeight,
    );
    const anchor = anchorScrollTopRef.current;
    const userId = activeTurnUserIdRef.current;

    if (
      anchor == null ||
      !userId ||
      !autoScrollEnabledRef.current ||
      !streamingRef.current
    ) {
      return maxNatural;
    }

    if (turnReservePaddingRef.current > 1) {
      return anchor;
    }

    return maxNatural;
  }

  function setScrollTopProgrammatic(el: HTMLElement, top: number) {
    isProgrammaticScrollRef.current = true;
    el.scrollTop = top;
    lastScrollTopRef.current = top;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });
  }

  function disableAutoScroll() {
    if (streamingRef.current && activeTurnUserIdRef.current) {
      autoScrollEnabledRef.current = false;
    }
  }

  function followStreamScroll() {
    if (
      !streamingRef.current ||
      !autoScrollEnabledRef.current ||
      activeTurnUserIdRef.current == null ||
      isSmoothScrollingRef.current
    ) {
      return;
    }
    const scrollParent = scrollViewportRef.current;
    if (!scrollParent) return;

    if (turnReservePaddingRef.current > 1) {
      clampScrollPosition();
      return;
    }

    setScrollTopProgrammatic(scrollParent, getMaxScrollTop());
  }

  /** 结束本轮流式：释放滚动锁定，但保留 turnReservePadding 留白。 */
  function releaseTurnScrollLock() {
    activeTurnUserIdRef.current = null;
    setActiveTurnUserId(null);
    anchorScrollTopRef.current = null;
  }

  function clampScrollPosition() {
    const scrollParent = scrollViewportRef.current;
    if (
      !scrollParent ||
      !autoScrollEnabledRef.current ||
      !streamingRef.current ||
      isSmoothScrollingRef.current
    ) {
      return;
    }
    const maxTop = getMaxScrollTop();
    if (scrollParent.scrollTop > maxTop + 1) {
      setScrollTopProgrammatic(scrollParent, maxTop);
    }
  }

  /** 流式结束后操作栏才挂载，需在 DOM 更新后再滚到底。 */
  function scrollToBottomIfFollowing() {
    if (!autoScrollEnabledRef.current) return;

    const scrollParent = scrollViewportRef.current;
    if (!scrollParent) return;

    const maxTop = Math.max(
      0,
      scrollParent.scrollHeight - scrollParent.clientHeight,
    );
    if (scrollParent.scrollTop >= maxTop - ASSISTANT_ACTIONS_HEIGHT - 8) {
      setScrollTopProgrammatic(scrollParent, maxTop);
    }
  }

  function syncTurnReserve(currentMessages: ChatMessage[]) {
    const scrollParent = scrollViewportRef.current;
    const userId = activeTurnUserIdRef.current;
    if (!scrollParent || !userId) {
      return;
    }

    const next = measureTurnReservePadding(
      scrollParent,
      userId,
      currentMessages,
    );
    turnReservePaddingRef.current = next;
    setTurnReservePadding((prev) => (prev === next ? prev : next));
  }

  useLayoutEffect(() => {
    adjustTextareaHeight();
    const el = textareaRef.current;
    if (!el) return;
    // Text can wrap when the sidebar, orientation or viewport width changes.
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      adjustTextareaHeight();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [input, inputExpanded]);

  const handleSpeechTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      setInput(text);
      if (isFinal) {
        speechBaseRef.current = text;
      }
    },
    [],
  );

  const handleSpeechError = useCallback((error: SpeechRecognitionErrorCode) => {
    if (error === "aborted" || error === "no-speech") return;
    const tips: Record<
      Exclude<SpeechRecognitionErrorCode, "aborted" | "no-speech">,
      { message: string; description: string }
    > = {
      "not-allowed": {
        message: "无法使用麦克风",
        description: "请允许浏览器访问麦克风",
      },
      "not-supported": {
        message: "语音识别不可用",
        description: "当前浏览器不支持麦克风输入",
      },
      network: {
        message: "语音识别失败",
        description: "网络异常，请稍后重试",
      },
      timeout: {
        message: "语音识别超时",
        description: "识别服务响应超时，请稍后重试",
      },
      unknown: {
        message: "语音识别失败",
        description: "请稍后重试",
      },
    };
    setSpeechTip(tips[error] ?? tips.unknown);
  }, []);

  const {
    isListening,
    isStarting,
    isTranscribing,
    isSupported: speechSupported,
    toggle: toggleSpeech,
    stop: stopSpeech,
    abort: abortSpeech,
  } = useSpeechToText({
    onTranscript: handleSpeechTranscript,
    onError: handleSpeechError,
  });

  const focusChatInput = useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el || el.readOnly) return;
      el.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (sessionNotFound) return;
    if (!initialSessionResolved && !ssrNewChatIntent && !newChatIntent) return;
    if (!routeSessionId) return;
    focusChatInput();
  }, [
    routeSessionId,
    sessionNotFound,
    inputFocusNonce,
    initialSessionResolved,
    ssrNewChatIntent,
    newChatIntent,
    focusChatInput,
    sessionReady,
    messages.length,
  ]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useLayoutEffect(() => {
    if (!routeSessionId) return;

    const previousSessionId = loadedSessionIdRef.current;
    if (
      previousSessionId &&
      previousSessionId !== routeSessionId &&
      scrollViewportRef.current
    ) {
      updateSessionScrollTop(
        previousSessionId,
        scrollViewportRef.current.scrollTop,
      );
    }
    const isPendingPromotion =
      !!previousSessionId &&
      isPendingSessionId(previousSessionId) &&
      previousSessionId !== routeSessionId;

    loadedSessionIdRef.current = routeSessionId;

    if (!isPendingPromotion) {
      abortRef.current?.abort();
      abortRef.current = null;
      abortSpeech();
      setStreaming(false);
      setStreamingMessageId(null);
      setLoading(false);
      setInput("");
      setInputExpanded(false);
      setTurnAnchorId(null);
      setSessionNotFound(false);
      anchorScrollTopRef.current = null;
      activeTurnUserIdRef.current = null;
      setActiveTurnUserId(null);
      turnReservePaddingRef.current = 0;
      setTurnReservePadding(0);
      autoScrollEnabledRef.current = true;
    }

    const cached = getSessionSnapshot(routeSessionId);
    pendingScrollRestoreRef.current = null;

    if (cached?.fetched) {
      const applied = applySessionSnapshot(cached);
      if (isPendingPromotion && messagesRef.current.length > 0) {
        writeSessionSnapshot(routeSessionId, {
          messages: messagesRef.current,
          scrollTop: cached.scrollTop,
          fetched: true,
        });
        setSessionNotFound(false);
        setSessionReady(true);
      } else {
        setMessages(applied.messages);
        setSessionNotFound(applied.notFound);
        setSessionReady(true);
        markScrollToBottom(routeSessionId);
      }
    } else if (cached) {
      setMessages(cached.messages);
      setSessionNotFound(false);
      setSessionReady(false);
    } else {
      setMessages([]);
      setSessionNotFound(false);
      setSessionReady(false);
    }

    let cancelled = false;
    if (!(isPendingPromotion && messagesRef.current.length > 0)) {
      void loadSessionMessages(routeSessionId)
        .then((snapshot) => {
          if (cancelled || loadedSessionIdRef.current !== routeSessionId)
            return;
          const applied = applySessionSnapshot(snapshot);
          setMessages(applied.messages);
          setSessionNotFound(applied.notFound);
        })
        .catch(() => {
          if (cancelled || loadedSessionIdRef.current !== routeSessionId)
            return;
        })
        .finally(() => {
          if (!cancelled && loadedSessionIdRef.current === routeSessionId) {
            setSessionReady(true);
            markScrollToBottom(routeSessionId);
          }
        });
    }

    setSyncedSessionId(routeSessionId);

    return () => {
      cancelled = true;
    };
  }, [routeSessionId, abortSpeech]);

  useEffect(() => {
    if (!routeSessionId || !sessionReady) return;
    writeSessionSnapshot(routeSessionId, {
      messages,
      scrollTop: scrollViewportRef.current?.scrollTop,
      fetched: true,
    });
  }, [routeSessionId, messages, sessionReady]);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !activeTurnUserId || !streaming) return;

    lastScrollTopRef.current = viewport.scrollTop;

    function onScroll(e: Event) {
      const el = scrollViewportRef.current;
      if (!el) return;
      const top = el.scrollTop;
      const delta = top - lastScrollTopRef.current;
      lastScrollTopRef.current = top;

      if (
        e.isTrusted &&
        !isProgrammaticScrollRef.current &&
        !isSmoothScrollingRef.current &&
        autoScrollEnabledRef.current &&
        delta < -3
      ) {
        disableAutoScroll();
      }

      if (autoScrollEnabledRef.current) {
        clampScrollPosition();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        disableAutoScroll();
      }
    }

    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", disableAutoScroll, { passive: true });
    viewport.addEventListener("touchmove", disableAutoScroll, {
      passive: true,
    });
    viewport.addEventListener("keydown", onKeyDown);
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", disableAutoScroll);
      viewport.removeEventListener("touchmove", disableAutoScroll);
      viewport.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTurnUserId, turnReservePadding, streaming]);

  useLayoutEffect(() => {
    if (!activeTurnUserIdRef.current || !streaming) return;
    syncTurnReserve(messages);
    requestAnimationFrame(() => {
      followStreamScroll();
    });
  }, [messages, streaming, activeTurnUserId]);

  useLayoutEffect(() => {
    const streamJustEnded = prevStreamingRef.current && !streaming;
    prevStreamingRef.current = streaming;
    if (!streamJustEnded) return;
    scrollToBottomIfFollowing();
  }, [streaming, messages]);

  useEffect(() => {
    if (!sessionReady || !routeSessionId) return;
    if (pendingScrollSessionIdRef.current !== routeSessionId) return;

    pendingScrollSessionIdRef.current = null;
    scrollViewportToBottom();
  }, [messages, routeSessionId, sessionReady]);

  useLayoutEffect(() => {
    if (!turnAnchorId) return;

    const anchorId = turnAnchorId;

    function anchorTurn() {
      const el = document.getElementById(`msg-${anchorId}`);
      const scrollParent = scrollViewportRef.current;
      if (!el || !scrollParent) return false;

      const parentRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const distanceFromTop = elRect.top - parentRect.top;
      const relativeTop = elRect.top - parentRect.top + scrollParent.scrollTop;
      const anchorTop = getTurnAnchorTop(anchorId, messagesRef.current);
      const targetTop = Math.max(0, relativeTop - anchorTop);

      anchorScrollTopRef.current = targetTop;
      activeTurnUserIdRef.current = anchorId;

      const finishAnchor = () => {
        setActiveTurnUserId(anchorId);
        turnReservePaddingRef.current = 0;
        syncTurnReserve(messagesRef.current);
        lastScrollTopRef.current = scrollParent.scrollTop;
        requestAnimationFrame(() => clampScrollPosition());
        setTurnAnchorId(null);
      };

      const shouldAnimate =
        scrollParent.scrollTop > targetTop + 8 ||
        distanceFromTop > anchorTop + 8;

      if (shouldAnimate) {
        smoothScrollTo(scrollParent, targetTop, 420, finishAnchor);
      } else {
        scrollParent.scrollTop = targetTop;
        finishAnchor();
      }

      return true;
    }

    requestAnimationFrame(() => {
      if (!anchorTurn()) {
        requestAnimationFrame(anchorTurn);
      }
    });
  }, [turnAnchorId, messages]);

  async function submitTurn(
    content: string,
    options?: {
      regenerate?: { assistantId: string; userId: string };
    },
  ) {
    if (quotaExhausted) {
      setQuotaOpen(true);
      return;
    }
    if (!routeSessionId || streaming || !sessionReady) {
      return;
    }

    let sessionId: string;
    try {
      sessionId = await resolveSessionId(routeSessionId);
    } catch {
      return;
    }

    const isRegenerate = !!options?.regenerate;
    const messagesBeforeTurn = messages;
    const isFirstMessage = !isRegenerate && messages.length === 0;
    if (isFirstMessage) finishNewChatIntent();
    const assistantId = `stream-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      message_id: assistantId,
      session_id: sessionId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };

    let userMsg: ChatMessage;
    if (isRegenerate) {
      userMsg = {
        message_id: options!.regenerate!.userId,
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      activeTurnUserIdRef.current = userMsg.message_id;
      setMessages((prev) => [
        ...prev.filter(
          (m) => m.message_id !== options!.regenerate!.assistantId,
        ),
        assistantMsg,
      ]);
    } else {
      userMsg = {
        message_id: `temp-${Date.now()}`,
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      activeTurnUserIdRef.current = userMsg.message_id;
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
    }

    autoScrollEnabledRef.current = true;
    setActiveTurnUserId(null);
    setStreaming(true);
    setStreamingMessageId(assistantId);
    setTurnAnchorId(userMsg.message_id);

    if (!isRegenerate) {
      if (!isFirstMessage) {
        touchSession(sessionId);
      }
    } else {
      touchSession(sessionId);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await api.sendMessage(
        sessionId,
        content,
        (ev) => {
          if (ev.type === "meta" && ev.data?.message_id) {
            const newId = ev.data.message_id;
            remapTurnUserId(userMsg.message_id, newId);
            setMessages((prev) =>
              prev.map((m) =>
                m.message_id === userMsg.message_id
                  ? { ...m, message_id: newId! }
                  : m,
              ),
            );
          }
          if (ev.type === "meta" && ev.data?.assistant_message_id) {
            const newAssistantId = ev.data.assistant_message_id;
            setStreamingMessageId((current) =>
              current === assistantId ? newAssistantId : current,
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.message_id === assistantId
                  ? { ...m, message_id: newAssistantId! }
                  : m,
              ),
            );
          }
          if (ev.type === "meta" && ev.data?.session_title) {
            updateSessionTitle(sessionId, ev.data.session_title);
          }
          if (ev.type === "token" && ev.content) {
            setMessages((prev) =>
              prev.map((m) =>
                m.message_id === assistantId
                  ? { ...m, content: m.content + ev.content }
                  : m,
              ),
            );
          }
        },
        controller.signal,
        isRegenerate
          ? {
              regenerate: true,
              replaceAssistantId: options!.regenerate!.assistantId,
            }
          : undefined,
      );
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (
        err instanceof ApiError &&
        err.code === "CHAT_DAILY_LIMIT" &&
        err.quota
      ) {
        setQuota(err.quota);
        setQuotaOpen(true);
        setMessages(messagesBeforeTurn);
        if (!isRegenerate) setInput((current) => current || content);
      } else if (aborted) {
        setMessages((prev) =>
          prev.filter(
            (m) => m.message_id !== assistantId || m.content.length > 0,
          ),
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.message_id === assistantId
              ? {
                  ...m,
                  content:
                    err instanceof ApiError
                      ? `抱歉，本次请求处理失败：${err.message}`
                      : "抱歉，连接中断或无法连接服务，请稍后重试。",
                }
              : m,
          ),
        );
      }
    } finally {
      abortRef.current = null;
      syncTurnReserve(messagesRef.current);
      releaseTurnScrollLock();
      setStreaming(false);
      setStreamingMessageId(null);
      if (isFirstMessage && sessionId) {
        void refreshSessions();
      }
    }
  }

  async function handleSend() {
    if (quotaExhausted) {
      setQuotaOpen(true);
      return;
    }
    if (
      (!input.trim() && !isListening) ||
      loading ||
      streaming ||
      !sessionReady ||
      isStarting ||
      isTranscribing ||
      speechSendPendingRef.current
    ) {
      return;
    }
    speechSendPendingRef.current = true;
    if (isListening) {
      setSpeechTranscribeFromSend(true);
    }
    let transcript: string | null;
    try {
      transcript = isListening ? await stopSpeech() : input;
    } finally {
      speechSendPendingRef.current = false;
      setSpeechTranscribeFromSend(false);
    }
    if (transcript == null || !transcript.trim()) return;
    speechBaseRef.current = "";
    const content = transcript.trim();
    setInput("");
    setLoading(true);
    setLoading(false);
    await submitTurn(content);
  }

  function handleRegenerate(assistantId: string) {
    if (streaming || !sessionReady) {
      return;
    }
    const assistantIndex = messages.findIndex(
      (m) => m.message_id === assistantId,
    );
    if (assistantIndex <= 0) {
      return;
    }
    const userMsg = messages[assistantIndex - 1];
    if (userMsg.role !== "user") {
      return;
    }
    void submitTurn(userMsg.content, {
      regenerate: { assistantId, userId: userMsg.message_id },
    });
  }

  function handleMessageFeedback(
    messageId: string,
    feedback: MessageFeedback | null,
  ) {
    if (messageId.startsWith("stream-") || messageId.startsWith("temp-")) {
      return;
    }
    const previous = messages.find((m) => m.message_id === messageId)?.feedback;
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === messageId
          ? { ...m, feedback: feedback ?? undefined }
          : m,
      ),
    );
    void api.setMessageFeedback(messageId, feedback).catch(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === messageId ? { ...m, feedback: previous } : m,
        ),
      );
    });
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  if (sessionNotFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-medium text-noma-primary">
          对话不存在或无法访问
        </p>
        <p className="text-sm text-noma-secondary">
          链接可能已失效，或该对话还没有任何消息。
        </p>
        <Link
          href="/agent"
          className="rounded-lg bg-noma-brand px-4 py-2 text-sm text-white transition-colors hover:bg-noma-brand-hover"
        >
          开始新对话
        </Link>
      </div>
    );
  }

  const isRestoringSession =
    initialSessionResolved &&
    !!routeSessionId &&
    !isPendingSessionId(routeSessionId) &&
    syncedSessionId !== routeSessionId &&
    !newChatIntent;

  const bootWelcome = ssrNewChatIntent && !initialSessionResolved;

  const isNewChat =
    messages.length === 0 &&
    (bootWelcome ||
      (initialSessionResolved &&
        (newChatIntent ||
          !routeSessionId ||
          (routeSessionId != null && isPendingSessionId(routeSessionId)) ||
          (!isRestoringSession && sessionReady && messages.length === 0))));
  const activeSession = sessions.find((s) => s.session_id === routeSessionId);

  const canSend =
    !loading &&
    !isStarting &&
    !isTranscribing &&
    !!routeSessionId &&
    (sessionsLoading || sessionReady) &&
    (input.trim().length > 0 || isListening);

  function handleToggleSpeech() {
    if (quotaExhausted) {
      setQuotaOpen(true);
      return;
    }
    if (streaming || !sessionReady) return;
    toggleSpeech(input);
  }

  const showMicSpinner = isTranscribing && !speechTranscribeFromSend;
  const showSendSpinner = isTranscribing && speechTranscribeFromSend;
  const sendLooksActive =
    input.trim().length > 0 || isListening || showSendSpinner || showMicSpinner;
  const sendClickable = canSend || showSendSpinner;

  const micButton = (
    <Tooltip
      side="top"
      content={
        isStarting || isTranscribing || isListening ? undefined : "语音输入"
      }
    >
      <button
        type="button"
        onClick={handleToggleSpeech}
        disabled={
          quotaExhausted ||
          !speechSupported ||
          streaming ||
          !sessionReady ||
          isStarting ||
          isTranscribing
        }
        aria-label={
          showMicSpinner ? "正在转写" : isListening ? "暂停并转写" : "语音输入"
        }
        aria-pressed={isListening}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
          streaming ||
            !sessionReady ||
            isStarting ||
            (isTranscribing && speechTranscribeFromSend)
            ? "cursor-not-allowed text-noma-placeholder"
            : isListening || showMicSpinner
              ? "bg-noma-soft text-noma-primary"
              : "text-noma-secondary hover:bg-noma-soft hover:text-noma-primary",
        )}
      >
        {showMicSpinner ? (
          <Loader2 className="size-[18px] animate-spin" />
        ) : isListening ? (
          <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
        ) : (
          <Mic className="size-[18px]" strokeWidth={2} />
        )}
      </button>
    </Tooltip>
  );

  const sendButton = streaming ? (
    <button
      onClick={handleStop}
      aria-label="停止生成"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-noma-brand text-white transition-colors duration-150 hover:bg-noma-brand-hover"
    >
      <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
    </button>
  ) : (
    <button
      onClick={handleSend}
      disabled={quotaExhausted || !sendClickable}
      aria-label={showSendSpinner ? "正在转写" : "发送消息"}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
        sendLooksActive
          ? "bg-noma-brand text-white hover:bg-noma-brand-hover"
          : "cursor-not-allowed bg-noma-send-disabled text-noma-send-disabled-text",
      )}
    >
      {showSendSpinner ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
      ) : (
        <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
      )}
    </button>
  );

  const speechStatusLabel = isTranscribing
    ? "正在转写"
    : isListening
      ? "正在录音"
      : null;
  const showSpeechStatus = !!speechStatusLabel && !input;

  const inputBar = (
    <div
      ref={inputBarRef}
      className={cn(
        "border border-noma-border bg-white shadow-[0_4px_18px_rgba(0,0,0,0.035)] transition-[border-color,box-shadow] duration-150",
        inputExpanded
          ? "flex flex-col rounded-3xl px-4 py-2.5"
          : "relative flex min-h-14 items-center gap-0.5 rounded-full py-2 pl-5 pr-2",
      )}
    >
      {showSpeechStatus && !inputExpanded && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] leading-6 text-noma-placeholder">
          {speechStatusLabel}
        </span>
      )}
      <div
        className={cn(
          inputExpanded && showSpeechStatus
            ? "relative w-full min-w-0"
            : "contents",
        )}
      >
        {showSpeechStatus && inputExpanded && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] leading-6 text-noma-placeholder">
            {speechStatusLabel}
          </span>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          readOnly={
            quotaExhausted || isListening || isStarting || isTranscribing
          }
          onClick={() => {
            if (quotaExhausted) setQuotaOpen(true);
          }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            quotaExhausted
              ? "今日免费额度已用完，明天再来聊聊吧…"
              : showSpeechStatus
                ? ""
                : "问问 Noma"
          }
          rows={1}
          className={cn(
            styles.input,
            "min-h-[1.5rem] min-w-0 resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-noma-placeholder",
            inputExpanded
              ? "scrollbar-hidden block w-full overflow-y-auto py-1"
              : "flex-1 overflow-hidden py-1.5 pr-1",
          )}
        />
      </div>
      {inputExpanded ? (
        <div className="mt-0.5 flex justify-end gap-1">
          {micButton}
          {sendButton}
        </div>
      ) : (
        <>
          {micButton}
          {sendButton}
        </>
      )}
    </div>
  );

  const lastAssistantMessageId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.message_id;

  if (isNewChat) {
    return (
      <div className={cn(styles.welcome, "flex h-full min-h-0 flex-col items-center bg-white px-6 py-8")}>
        <ChatQuotaDialog open={quotaOpen} quota={quota} onClose={closeQuota} />
        <FloatingTip
          open={speechTip != null}
          message={speechTip?.message ?? ""}
          description={speechTip?.description}
          variant="error"
          onClose={() => setSpeechTip(null)}
        />
        <div className={cn(styles.welcomeContent, "w-full max-w-3xl")}>
          <div className={cn(styles.welcomeHero, "flex flex-col items-center text-center")}>
            <NomaLogo className="mb-5 size-12 sm:mb-8 sm:size-14" />
            <h1 className="text-2xl font-semibold leading-tight text-noma-primary sm:text-[28px]">
              Hi，我是 <span className="text-noma-brand">Noma</span>
            </h1>
            <p className="mt-3 text-[14px] font-normal leading-normal text-noma-secondary">
              懂你，也让智能家居更好地为你服务
            </p>
          </div>
          <div className={styles.welcomeComposer}>
            {inputBar}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.chat, "relative flex h-full min-h-0 flex-col overflow-hidden bg-white")}>
      <ChatQuotaDialog open={quotaOpen} quota={quota} onClose={closeQuota} />
      <FloatingTip
        open={speechTip != null}
        message={speechTip?.message ?? ""}
        description={speechTip?.description}
        variant="error"
        onClose={() => setSpeechTip(null)}
      />
      {activeSession && (
        <div className={cn(styles.headerActions, "pointer-events-none absolute right-4 top-4 z-20")}>
          <div className="pointer-events-auto">
            <ChatHeaderActions session={activeSession} />
          </div>
        </div>
      )}

      <ScrollArea
        viewportRef={scrollViewportRef}
        className={cn(styles.messages, "min-h-0 flex-1 px-6 pb-2 pt-4")}
      >
        <div className="mx-auto max-w-3xl">
          {messages.map((msg, index) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const isUserAfterAssistant =
              prev?.role === "assistant" && msg.role === "user";
            const isAssistantAfterUser =
              prev?.role === "user" && msg.role === "assistant";
            const isFirstMessage = index === 0;
            const messageTopMargin = isFirstMessage
              ? undefined
              : isUserAfterAssistant
                ? "mt-5"
                : isAssistantAfterUser
                  ? "mt-6"
                  : "mt-4";
            const isEmptyStreamingAssistant =
              streaming &&
              msg.role === "assistant" &&
              msg.message_id === streamingMessageId &&
              !msg.content;
            const isStreamingAssistant =
              streaming && msg.message_id === streamingMessageId;

            return (
              <div
                key={msg.message_id}
                id={`msg-${msg.message_id}`}
                className={cn(
                  "flex scroll-mt-5 rounded-xl transition-shadow duration-150",
                  isFirstMessage && activeSession && "pt-12",
                  isFirstMessage && styles.firstMessage,
                  messageTopMargin,
                  msg.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {msg.role === "user" ? (
                  <UserMessageBubble content={msg.content} className={styles.userBubble} />
                ) : (
                  <div className="group w-full min-w-0 text-[15px] leading-[1.55] text-noma-primary">
                    {isEmptyStreamingAssistant ? (
                      <TypingIndicator />
                    ) : (
                      <MarkdownMessage content={msg.content} />
                    )}
                    <AssistantMessageActions
                      content={msg.content}
                      feedback={msg.feedback ?? null}
                      disabled={isStreamingAssistant}
                      prefetchOnHover={
                        msg.message_id === lastAssistantMessageId
                      }
                      onRegenerate={
                        msg.message_id === lastAssistantMessageId
                          ? () => handleRegenerate(msg.message_id)
                          : undefined
                      }
                      onFeedbackChange={(feedback) =>
                        handleMessageFeedback(msg.message_id, feedback)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}

          {turnReservePadding > 0 && (
            <div
              aria-hidden
              className="shrink-0"
              style={{ height: turnReservePadding }}
            />
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className={cn(styles.composer, "shrink-0 px-6 pb-4 pt-2")}>
        <div className="mx-auto max-w-3xl">
          {inputBar}
        </div>
      </div>
    </div>
  );
}
