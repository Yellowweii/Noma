import { api } from "@/lib/api";
import { localUUID } from "./localId";
import type { ChatMessage } from "@/types";

export type SessionSnapshot = {
  messages: ChatMessage[];
  scrollTop?: number;
  fetched: boolean;
  notFound?: boolean;
};

const cache = new Map<string, SessionSnapshot>();
const inflight = new Map<string, Promise<SessionSnapshot>>();

const PREFETCH_CONCURRENCY = 4;
const PENDING_SESSION_PREFIX = "pending:";

export function isPendingSessionId(sessionId: string) {
  return sessionId.startsWith(PENDING_SESSION_PREFIX);
}

export function createPendingSessionId() {
  return `${PENDING_SESSION_PREFIX}${localUUID()}`;
}

export function getSessionSnapshot(
  sessionId: string,
): SessionSnapshot | undefined {
  return cache.get(sessionId);
}

export function writeSessionSnapshot(
  sessionId: string,
  snapshot: SessionSnapshot,
) {
  cache.set(sessionId, snapshot);
}

export function updateSessionScrollTop(sessionId: string, scrollTop: number) {
  const existing = cache.get(sessionId);
  if (!existing) return;
  cache.set(sessionId, { ...existing, scrollTop });
}

export function invalidateSessionSnapshot(sessionId: string) {
  cache.delete(sessionId);
  inflight.delete(sessionId);
}

async function fetchSessionSnapshot(
  sessionId: string,
): Promise<SessionSnapshot> {
  try {
    const ownedMessages = await api.getChatMessages(sessionId);
    return {
      messages: ownedMessages,
      fetched: true,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return {
        messages: [],
        fetched: true,
        notFound: true,
      };
    }
    throw err;
  }
}

function mergeSnapshot(
  sessionId: string,
  snapshot: SessionSnapshot,
): SessionSnapshot {
  const previous = cache.get(sessionId);
  const merged: SessionSnapshot = {
    ...snapshot,
    scrollTop: previous?.scrollTop,
  };
  cache.set(sessionId, merged);
  return merged;
}

export function loadSessionMessages(
  sessionId: string,
): Promise<SessionSnapshot> {
  if (isPendingSessionId(sessionId)) {
    return Promise.resolve(
      mergeSnapshot(sessionId, { messages: [], fetched: true }),
    );
  }

  const pending = inflight.get(sessionId);
  if (pending) return pending;

  const promise = fetchSessionSnapshot(sessionId)
    .then((snapshot) => mergeSnapshot(sessionId, snapshot))
    .finally(() => {
      inflight.delete(sessionId);
    });

  inflight.set(sessionId, promise);
  return promise;
}

export function prefetchSessionMessages(sessionId: string) {
  if (
    isPendingSessionId(sessionId) ||
    cache.get(sessionId)?.fetched ||
    inflight.has(sessionId)
  ) {
    return;
  }
  void loadSessionMessages(sessionId).catch(() => {});
}

export async function prefetchSessionMessagesBatch(sessionIds: string[]) {
  const pending = sessionIds.filter(
    (id) => !cache.get(id)?.fetched && !inflight.has(id),
  );

  for (let i = 0; i < pending.length; i += PREFETCH_CONCURRENCY) {
    const chunk = pending.slice(i, i + PREFETCH_CONCURRENCY);
    await Promise.allSettled(chunk.map((id) => loadSessionMessages(id)));
  }
}

export function applySessionSnapshot(snapshot: SessionSnapshot) {
  return {
    messages: snapshot.messages,
    notFound: snapshot.notFound ?? false,
  };
}

export function getInitialSessionViewState(sessionId: string | null): {
  messages: ChatMessage[];
  sessionReady: boolean;
  sessionNotFound: boolean;
} {
  if (!sessionId) {
    return { messages: [], sessionReady: true, sessionNotFound: false };
  }

  const cached = getSessionSnapshot(sessionId);
  if (cached?.fetched) {
    const applied = applySessionSnapshot(cached);
    return {
      messages: applied.messages,
      sessionReady: true,
      sessionNotFound: applied.notFound,
    };
  }

  if (cached) {
    return {
      messages: cached.messages,
      sessionReady: false,
      sessionNotFound: false,
    };
  }

  return { messages: [], sessionReady: false, sessionNotFound: false };
}
