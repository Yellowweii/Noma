import type { ChatMessage, ChatSession } from "@/types";

export type GuestSession = ChatSession & { messages: ChatMessage[]; import_user_id?: string };
type StoredSession = Omit<GuestSession, "messages">;
type StoredMessage = ChatMessage & { position: number };
const legacyKey = "noma.guest.chats";
let database: Promise<IDBDatabase> | null = null;
let initialized: Promise<void> | null = null;
let cached: GuestSession[] = [];

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("本地聊天记录保存失败"));
    transaction.onerror = () => reject(transaction.error);
  });
  void promise.catch(() => {});
  return promise;
}

function open(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("noma-guest-chats", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("conversations", { keyPath: "session_id" });
        const messages = db.createObjectStore("messages", { keyPath: "message_id" });
        messages.createIndex("session_id", "session_id");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; initialized = null; };
        resolve(db);
      };
      request.onerror = () => { database = null; reject(request.error); };
      request.onblocked = () => { database = null; reject(new Error("请关闭其他 Noma 页面后重试本地记录迁移")); };
    });
  }
  return database;
}

function cacheSession(session: GuestSession | null, id: string) {
  cached = [...cached.filter((item) => item.session_id !== id), ...(session ? [session] : [])];
}

function put(transaction: IDBTransaction, session: GuestSession) {
  const { messages, ...conversation } = session;
  transaction.objectStore("conversations").put(conversation);
  messages.forEach((message, position) => transaction.objectStore("messages").put({ ...message, position }));
}

function orderedMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages.sort((a, b) => Number.isFinite(a.position) && Number.isFinite(b.position)
    ? a.position - b.position : a.created_at.localeCompare(b.created_at))
    .map(({ position: _position, ...message }) => message);
}

async function initialize() {
  if (!initialized) {
    initialized = (async () => {
      const db = await open();
      let legacy: GuestSession[] = [];
      try {
        const parsed = JSON.parse(localStorage.getItem(legacyKey) || "[]");
        if (Array.isArray(parsed)) legacy = parsed;
      } catch { /* No readable legacy records. */ }
      if (legacy.length) {
        const transaction = db.transaction(["conversations", "messages"], "readwrite");
        const done = committed(transaction);
        for (const session of legacy) {
          const existing = await result(transaction.objectStore("conversations").get(session.session_id));
          if (!existing) put(transaction, session);
        }
        await done;
        // Delete the old copy only after the IndexedDB transaction commits.
        localStorage.removeItem(legacyKey);
      }
    })().catch((error) => { initialized = null; throw error; });
  }
  await initialized;
}

export function readGuestChatCache() { return cached; }

/** The sidebar only needs metadata; avoid reading every conversation's messages. */
export async function listGuestSessions(): Promise<ChatSession[]> {
  await initialize();
  const db = await open();
  const transaction = db.transaction("conversations", "readonly");
  const done = committed(transaction);
  const sessions = await result<StoredSession[]>(transaction.objectStore("conversations").getAll());
  await done;
  return sessions.map(({ import_user_id: _owner, ...session }) => session);
}

/** Read the selected conversation through the message index, including empty chats. */
export async function loadGuestSession(id: string): Promise<GuestSession | null> {
  await initialize();
  const db = await open();
  const transaction = db.transaction(["conversations", "messages"], "readonly");
  const done = committed(transaction);
  const [conversation, messages] = await Promise.all([
    result<StoredSession | undefined>(transaction.objectStore("conversations").get(id)),
    result<StoredMessage[]>(transaction.objectStore("messages").index("session_id").getAll(id)),
  ]);
  await done;
  const session = conversation ? { ...conversation, messages: orderedMessages(messages) } : null;
  cacheSession(session, id);
  return session;
}

export async function loadGuestChatCache(): Promise<GuestSession[]> {
  await initialize();
  const db = await open();
  const transaction = db.transaction(["conversations", "messages"], "readonly");
  const done = committed(transaction);
  const [sessions, messages] = await Promise.all([
    result<StoredSession[]>(transaction.objectStore("conversations").getAll()),
    result<StoredMessage[]>(transaction.objectStore("messages").getAll()),
  ]);
  await done;
  const grouped = new Map<string, StoredMessage[]>();
  for (const message of messages) {
    const list = grouped.get(message.session_id) || [];
    list.push(message);
    grouped.set(message.session_id, list);
  }
  cached = sessions.map((session) => ({ ...session, messages: orderedMessages(grouped.get(session.session_id) || []) }));
  return cached;
}

export async function createGuestSession(session: GuestSession) {
  await initialize();
  const db = await open();
  const transaction = db.transaction(["conversations", "messages"], "readwrite");
  const done = committed(transaction);
  put(transaction, session);
  await done;
  cacheSession(session, session.session_id);
}

export async function changeGuestSession(id: string, change: (session: GuestSession) => void | "delete") {
  await initialize();
  const db = await open();
  const transaction = db.transaction(["conversations", "messages"], "readwrite");
  const done = committed(transaction);
  const [conversation, messages] = await Promise.all([
    result<StoredSession | undefined>(transaction.objectStore("conversations").get(id)),
    result<StoredMessage[]>(transaction.objectStore("messages").index("session_id").getAll(id)),
  ]);
  if (!conversation) { await done; throw Object.assign(new Error("session not found"), { status: 404 }); }
  const session: GuestSession = { ...conversation, messages: orderedMessages(messages) };
  let removed: boolean;
  try {
    removed = change(session) === "delete";
  } catch (error) {
    transaction.abort();
    await done.catch(() => {});
    throw error;
  }
  const remaining = new Set(removed ? [] : session.messages.map((message) => message.message_id));
  for (const message of messages) {
    if (!remaining.has(message.message_id)) transaction.objectStore("messages").delete(message.message_id);
  }
  if (removed) transaction.objectStore("conversations").delete(id);
  else put(transaction, session);
  await done;
  cacheSession(removed ? null : session, id);
  return session;
}
