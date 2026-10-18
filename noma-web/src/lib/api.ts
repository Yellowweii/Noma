import {
  bootstrapSession,
  logoutSession,
  clearAccessToken,
  getAccessToken,
  getUserId,
  recoverAccessToken,
  setAccessToken,
  setUserId,
} from "./auth";
import { isGuestMode } from "./sessionMode";
import { guestChat, importGuestChats, sendGuestMessage } from "./guestChat";
import type { ChatQuota } from "./chatQuota";
import { localUUID } from "./localId";

const API_BASE =
  "/api/v1";

class ApiError extends Error {
  code?: string;
  email?: string;
  quota?: ChatQuota;
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type AuthResponse = {
  user: import("@/types").User;
  user_id: string;
  access_token: string;
  expires_in: number;
};

async function fetchWithAuth(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<Response> {
  const token = getAccessToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (
    res.status === 401 &&
    !retried &&
    !path.startsWith("/auth/otp/") &&
    !path.startsWith("/auth/clerk") &&
    !path.startsWith("/auth/refresh")
  ) {
    const ok = await recoverAccessToken();
    if (ok) return fetchWithAuth(path, options, true);
  }

  return res;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetchWithAuth(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

async function authRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new ApiError(res.status, body.error || res.statusText);
    error.code = body.code;
    error.email = body.email;
    throw error;
  }
  const data = (await res.json()) as T & {
    access_token?: string;
    user_id?: string;
    user?: { user_id?: string };
  };
  if (data.access_token) {
    setAccessToken(data.access_token);
  }
  if (data.user_id) {
    setUserId(data.user_id);
  } else if (data.user?.user_id) {
    setUserId(data.user.user_id);
  }
  return data;
}

async function consumeMessageStream(res: Response, onEvent: (event: import("@/types").AgentStreamEvent) => void) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new ApiError(res.status, body.error || res.statusText);
    error.code = body.code;
    error.quota = body.quota;
    throw error;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("stream not supported");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      let eventName = "message";
      let dataLine = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLine = line.slice(5).trim();
        }
      }

      if (eventName === "error" && dataLine) {
        const err = JSON.parse(dataLine) as { error?: string };
        throw new ApiError(500, err.error || "stream error");
      }

      if (dataLine) {
        onEvent(JSON.parse(dataLine) as import("@/types").AgentStreamEvent);
      }
    }
  }
}

export const api = {
  sendOtp: async (email: string) => {
    const res = await fetch(`${API_BASE}/auth/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      cooldown_seconds?: number;
      message?: string;
    };
    if (!res.ok) {
      const err = new ApiError(res.status, body.error || res.statusText);
      if (body.cooldown_seconds) {
        (err as ApiError & { cooldownSeconds?: number }).cooldownSeconds =
          body.cooldown_seconds;
      }
      throw err;
    }
    return {
      message: body.message || "ok",
      cooldown_seconds: body.cooldown_seconds || 60,
    };
  },

  verifyOtp: (email: string, code: string) =>
    authRequest<AuthResponse>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  sendPhoneOtp: async (phone: string) => {
    const res = await fetch(`${API_BASE}/auth/phone/send-code`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ phone }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; cooldown_seconds?: number; message?: string };
    if (!res.ok) {
      const err = new ApiError(res.status, body.error || res.statusText);
      if (body.cooldown_seconds) (err as ApiError & { cooldownSeconds?: number }).cooldownSeconds = body.cooldown_seconds;
      throw err;
    }
    return { message: body.message || "ok", cooldown_seconds: body.cooldown_seconds || 604800 };
  },

  loginPhone: (phone: string, code: string) =>
    authRequest<AuthResponse>("/auth/phone/login", {
      method: "POST", body: JSON.stringify({ phone, code }),
    }),

  loginClerk: (token: string) =>
    authRequest<AuthResponse>("/auth/clerk", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),

  logout: logoutSession,

  importGuestChats: async () => {
    const id = getUserId();
    if (!id || !getAccessToken()) throw new Error("请先登录");
    await importGuestChats(id, (session, messages) => request("/chat/import", {
      method: "POST", body: JSON.stringify({ session, messages }),
    }));
  },

  getMe: () => request<import("@/types").User>("/me"),

  updateMe: (data: { avatar_url?: string; name?: string }) =>
    request<import("@/types").User>("/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listChatSessions: () =>
    isGuestMode() ? guestChat.listSessions() :
    request<import("@/types").ChatSession[]>("/chat/sessions"),

  listChatSessionPage: async (cursor = "", limit = 20): Promise<{ sessions: import("@/types").ChatSession[]; next_cursor?: string }> => {
    if (isGuestMode()) {
      const list = await guestChat.listSessions();
      const start = cursor ? Math.max(0, list.findIndex((session) => session.session_id === cursor) + 1) : 0;
      const sessions = list.slice(start, start + limit);
      return { sessions, next_cursor: start + limit < list.length ? sessions.at(-1)?.session_id : undefined };
    }
    return request(`/chat/sessions?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`);
  },

  getChatSession: async (id: string): Promise<import("@/types").ChatSession> => {
    if (isGuestMode()) {
      const session = (await guestChat.listSessions()).find((item) => item.session_id === id);
      if (!session) throw new ApiError(404, "session not found");
      return session;
    }
    return request(`/chat/sessions/${encodeURIComponent(id)}`);
  },

  getLatestChatSession: () =>
    isGuestMode() ? guestChat.latestSession() :
    request<import("@/types").ChatSession | null>("/chat/sessions/latest"),

  createChatSession: () =>
    isGuestMode() ? guestChat.createSession() :
    request<import("@/types").ChatSession>("/chat/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  updateChatSession: (
    sessionId: string,
    data: { title?: string; is_pinned?: boolean },
  ) =>
    isGuestMode() ? guestChat.updateSession(sessionId, data) :
    request<import("@/types").ChatSession>(`/chat/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteChatSession: async (sessionId: string) => {
    if (isGuestMode()) return guestChat.deleteSession(sessionId);
    await request<void>(`/chat/sessions/${sessionId}`, { method: "DELETE" });
    window.dispatchEvent(new Event("noma:chat-sources-deleted"));
  },
  deleteChatMessage: async (messageId: string) => {
    if (isGuestMode()) return guestChat.deleteMessage(messageId);
    await request<void>(`/chat/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    window.dispatchEvent(new Event("noma:chat-sources-deleted"));
  },
  deleteChatMessages: async (sessionId: string, messageIds: string[]) => {
    if (isGuestMode()) return guestChat.deleteMessages(sessionId, messageIds);
    await request<void>(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "DELETE", body: JSON.stringify({ message_ids: messageIds }),
    });
    window.dispatchEvent(new Event("noma:chat-sources-deleted"));
  },

  getChatMessages: (sessionId: string) =>
    isGuestMode() ? guestChat.getMessages(sessionId) :
    request<import("@/types").ChatMessage[]>(
      `/chat/sessions/${sessionId}/messages`,
    ),

  setMessageFeedback: (
    messageId: string,
    feedback: import("@/types").MessageFeedback | null,
  ) =>
    isGuestMode() ? guestChat.setFeedback(messageId, feedback) :
    request<import("@/types").ChatMessage>(
      `/chat/messages/${messageId}/feedback`,
      {
        method: "PATCH",
        body: JSON.stringify({ feedback }),
      },
    ),

  getSTTStatus: () =>
    request<{ available: boolean }>(isGuestMode() ? "/guest/stt/status" : "/chat/stt/status"),

  synthesizeSpeech: async (text: string, signal?: AbortSignal): Promise<Blob> => {
    const res = await fetchWithAuth(isGuestMode() ? "/guest/tts" : "/chat/tts", {
      method: "POST",
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error || res.statusText);
    }
    return res.blob();
  },

  getChatTurnTrace: (messageId: string) =>
    request<import("@/types").TurnTraceResponse>(
      `/chat/trace/${messageId}`,
    ),

  getChatQuota: async (): Promise<{ quota: ChatQuota; anonymous_id?: string }> => {
    const path = isGuestMode() ? "/guest/chat/quota" : "/chat/quota";
    return request(path, { cache: "no-store" });
  },

  sendMessage: async (
    sessionId: string,
    content: string,
    onEvent: (event: import("@/types").AgentStreamEvent) => void,
    signal?: AbortSignal,
    options?: {
      regenerate?: boolean;
      replaceAssistantId?: string;
    },
  ) => {
    if (isGuestMode()) {
      return sendGuestMessage(API_BASE, sessionId, content, onEvent, consumeMessageStream, signal, options);
    }
    const requestId = localUUID();
    const doFetch = (retried = false): Promise<Response> => {
      const token = getAccessToken();
      return fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          content,
          regenerate: options?.regenerate ?? false,
          replace_assistant_id: options?.replaceAssistantId,
          request_id: requestId,
        }),
        signal,
      }).then(async (res) => {
        if (res.status === 401 && !retried) {
          const ok = await recoverAccessToken();
          if (ok) return doFetch(true);
        }
        return res;
      });
    };

    const res = await doFetch();

    await consumeMessageStream(res, onEvent);
  },

  getMemoryOverview: () =>
    request<import("@/types").MemoryOverview>("/memory/overview"),

  listMemoryOSItems: () =>
    request<{ items: import("@/types").MemoryOSItem[] }>("/memory/items"),

  listRecentUnderstanding: (history = false) =>
    request<{ topics: import("@/types").RecentUnderstandingTopic[]; rebuilding?: boolean }>(`/memory/recent-understanding${history ? "?history=true" : ""}`),
  getRecentUnderstandingDetail: (id: string) =>
    request<import("@/types").RecentUnderstandingDetail>(`/memory/recent-understanding/${encodeURIComponent(id)}`),

  listHomeBehaviorMemories: (query?: string) => {
    const q = query?.trim();
    const suffix = q ? `?query=${encodeURIComponent(q)}` : "";
    return request<{ items: import("@/types").HomeBehaviorMemoryItem[] }>(
      `/memory/home-items${suffix}`,
    );
  },
  listHomeHabits: () =>
    request<{ items: import("@/types").HomeBehaviorMemoryItem[] }>("/memory/home-items?habits_only=true"),

  deleteMemoryOSItem: (id: string) =>
    request<{ ok: boolean }>(`/memory/items/${id}`, { method: "DELETE" }),

  deleteHomeBehaviorMemory: (id: string) =>
    request<{ ok: boolean }>(`/memory/home-items/${id}`, { method: "DELETE" }),

  listMemoryTopics: () =>
    request<{ topics: import("@/types").MemoryTopic[] }>("/memory/topics"),

  getMemoryRetrieveDebug: (query: string) =>
    request<Record<string, unknown>>(
      `/admin/memory/retrieve-debug?query=${encodeURIComponent(query)}`,
    ),

  getHomeStatus: () =>
    request<
      import("@/types").HomeStatus & { configured?: boolean; message?: string }
    >("/home/status", { cache: "no-store" }),

  listDevices: (includeSensors = false) => request<import("@/types").Device[]>(`/home/devices${includeSensors ? "?include_sensors=true" : ""}`),

  controlDevice: (
    id: string,
    action: string,
    params?: Record<string, unknown>,
  ) =>
    request<{ ok: boolean }>(
      `/home/devices/${encodeURIComponent(id)}/control`,
      {
        method: "POST",
        body: JSON.stringify({ action, params }),
      },
    ),

  getSettings: () => request<import("@/types").UserSettings>("/settings"),

  updateMemorySettings: (autoMemoryEnabled: boolean) =>
    request<{ ok: boolean; auto_memory_enabled: boolean }>("/settings/memory", {
      method: "PUT",
      body: JSON.stringify({ auto_memory_enabled: autoMemoryEnabled }),
    }),

  getHAConnection: () =>
    request<import("@/types").HAConnectionStatus>("/ha/connections", { cache: "no-store" }),

  prepareHAConnection: (localUrl?: string) =>
    request<{ connection_id: string; command: string }>("/ha/connections", {
      method: "POST",
      body: JSON.stringify({ local_url: localUrl }),
    }),

  authorizeHAConnection: (connectionId: string, token: string, homeName: string) =>
    request<{ ok: boolean; home_name: string }>("/ha/connections/authorize", {
      method: "PUT",
      body: JSON.stringify({ connection_id: connectionId, token, home_name: homeName }),
    }),
};

export {
  ApiError,
  API_BASE,
  bootstrapSession,
  getAccessToken,
  getUserId,
  setAccessToken,
  clearAccessToken,
};
export { getAccessToken as getToken };
