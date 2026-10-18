import type { AgentStreamEvent, ChatMessage, ChatSession, MessageFeedback } from "@/types";
import { sortChatSessions } from "./utils";
import { localUUID } from "./localId";
import { changeGuestSession, createGuestSession, listGuestSessions, loadGuestSession, loadGuestChatCache, readGuestChatCache, type GuestSession } from "./guestChatStorage";
export { loadGuestChatCache, readGuestChatCache } from "./guestChatStorage";

async function find(sessionId: string) {
  const session = await loadGuestSession(sessionId);
  if (!session) throw Object.assign(new Error("session not found"), { status: 404 });
  return session;
}

async function deleteMessages(sessionId: string, messageIds: string[]) {
  await changeGuestSession(sessionId, (session) => {
    const removed = new Set(messageIds);
    let removingReply = false;
    session.messages = session.messages.filter((message) => {
      if (message.role === "user") removingReply = removed.has(message.message_id);
      return !removed.has(message.message_id) && !removingReply;
    });
  });
}

export const guestChat = {
  async listSessions() {
    return sortChatSessions(await listGuestSessions());
  },
  async latestSession() { return (await guestChat.listSessions())[0] ?? null; },
  async createSession(): Promise<ChatSession> {
    const now = new Date().toISOString();
    const session: GuestSession = { session_id: localUUID(), user_id: "guest", title: "新对话", is_pinned: false, created_at: now, updated_at: now, messages: [] };
    await createGuestSession(session);
    return session;
  },
  async updateSession(sessionId: string, data: { title?: string; is_pinned?: boolean }) {
    return changeGuestSession(sessionId, (session) => {
      Object.assign(session, data, { updated_at: new Date().toISOString() });
      if (data.is_pinned !== undefined) session.pinned_at = data.is_pinned ? new Date().toISOString() : undefined;
    });
  },
  async deleteSession(sessionId: string) { await changeGuestSession(sessionId, () => "delete"); },
  async getMessages(sessionId: string) { return (await find(sessionId)).messages; },
  async deleteMessage(messageId: string) {
    const session = (await loadGuestChatCache()).find((item) => item.messages.some((message) => message.message_id === messageId));
    if (session) await deleteMessages(session.session_id, [messageId]);
  },
  deleteMessages,
  async setFeedback(messageId: string, feedback: MessageFeedback | null) {
    const session = (await loadGuestChatCache()).find((item) => item.messages.some((message) => message.message_id === messageId));
    if (!session) throw new Error("message not found");
    const updated = await changeGuestSession(session.session_id, (item) => {
      const message = item.messages.find((entry) => entry.message_id === messageId)!;
      message.feedback = feedback ?? undefined;
    });
    return updated.messages.find((message) => message.message_id === messageId)!;
  },
};

export async function sendGuestMessage(
  apiBase: string, sessionId: string, content: string,
  onEvent: (event: AgentStreamEvent) => void,
  consume: (response: Response, onEvent: (event: AgentStreamEvent) => void) => Promise<void>,
  signal?: AbortSignal,
  options?: { regenerate?: boolean; replaceAssistantId?: string },
) {
  const session = await find(sessionId);
  const generateTitle = !options?.regenerate && session.messages.length === 0 && (!session.title || session.title === "新对话");
  let history = session.messages;
  let pendingUserId: string | undefined;
  let replacedAssistant: ChatMessage | undefined;
  let replacedIndex = -1;
  let pendingCreatedAt: string | undefined;
  if (options?.regenerate) {
    const index = history.findIndex((message) => message.message_id === options.replaceAssistantId && message.role === "assistant");
    if (index < 1 || history[index - 1].role !== "user") throw new Error("invalid assistant message");
    replacedIndex = index;
    replacedAssistant = history[index];
    history = history.slice(0, index - 1);
    await changeGuestSession(sessionId, (item) => { item.messages = item.messages.filter((message) => message.message_id !== options.replaceAssistantId); });
  } else {
    const message: ChatMessage = { message_id: localUUID(), session_id: sessionId, role: "user", content, created_at: new Date().toISOString() };
    pendingUserId = message.message_id;
    pendingCreatedAt = message.created_at;
    await changeGuestSession(sessionId, (item) => {
      item.messages.push(message);
      item.updated_at = message.created_at;
    });
    onEvent({ type: "meta", data: { message_id: message.message_id } });
  }
  let reply = "";
  let completed = false;
  let titleUpdate = Promise.resolve();
  try {
    const response = await fetch(`${apiBase}/guest/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content, history: history.slice(-20).map(({ role, content: text }) => ({ role, content: text })), ...(generateTitle ? { generate_title: true } : {}) }), signal,
    });
    if (response.status === 429) {
      // A rejected turn must not leave an unanswered local message or destroy
      // the previous reply when regeneration was requested.
      await changeGuestSession(sessionId, (item) => {
        if (pendingUserId) item.messages = item.messages.filter((message) => message.message_id !== pendingUserId);
        if (replacedAssistant && !item.messages.some((message) => message.message_id === replacedAssistant!.message_id)) {
          item.messages.splice(replacedIndex, 0, replacedAssistant);
        }
        if (item.updated_at === pendingCreatedAt) item.updated_at = session.updated_at;
      });
    }
    await consume(response, (event) => {
      if (event.type === "meta" && event.data?.session_title) {
        if (!generateTitle) return;
        const title = event.data.session_title;
        titleUpdate = titleUpdate.then(async () => {
          let applied = false;
          try {
            await changeGuestSession(sessionId, (item) => {
              // A delayed generated title must not overwrite a manual rename.
              if (item.title && item.title !== "新对话") return;
              item.title = title;
              applied = true;
            });
          } catch (error) {
            if ((error as { status?: number }).status !== 404) throw error;
          }
          if (applied) onEvent(event);
        });
        void titleUpdate.catch(() => {});
        return;
      }
      if (event.type === "token") reply += event.content || "";
      if (event.type === "done") completed = true;
      onEvent(event);
    });
  } finally {
    await titleUpdate;
    if (reply) {
      const message: ChatMessage = { message_id: localUUID(), session_id: sessionId, role: "assistant", content: reply, created_at: new Date().toISOString() };
      try {
        await changeGuestSession(sessionId, (item) => { item.messages.push(message); item.updated_at = message.created_at; });
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
      if (completed) onEvent({ type: "meta", data: { assistant_message_id: message.message_id } });
    }
  }
}

export async function importGuestChats(userId: string, upload: (session: ChatSession, messages: ChatMessage[]) => Promise<unknown>) {
  const sessions = await loadGuestChatCache();
  for (const session of sessions) {
    if (session.messages.length === 0 || (session.import_user_id && session.import_user_id !== userId)) continue;
    const claimed = await changeGuestSession(session.session_id, (item) => {
      if (!item.import_user_id) item.import_user_id = userId;
    });
    if (claimed.import_user_id !== userId) continue;
    const { messages, import_user_id: _owner, ...metadata } = claimed;
    for (let start = 0; start < messages.length; start += 20) {
      await upload(metadata, messages.slice(start, start + 20));
    }
    await changeGuestSession(session.session_id, (current) => {
      // Another tab may have appended messages while the import was running.
      if (current.updated_at === claimed.updated_at && current.title === claimed.title && current.is_pinned === claimed.is_pinned && current.pinned_at === claimed.pinned_at && JSON.stringify(current.messages) === JSON.stringify(claimed.messages)) return "delete";
    });
  }
  if (readGuestChatCache().length === 0) localStorage.removeItem("noma.guest.activeSessionId");
}
