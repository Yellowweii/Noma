function storageKey() {
  return "noma.activeSessionId";
}

function intentCookie() {
  return NEW_CHAT_INTENT_COOKIE;
}

export const NEW_CHAT_INTENT_COOKIE = "noma.newChatIntent";

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNewChatIntentValue(value: string | undefined): boolean {
  return value === "1";
}

export function readStoredActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey());
  if (!raw || !SESSION_ID_RE.test(raw)) return null;
  return raw;
}

export function writeStoredActiveSessionId(sessionId: string) {
  if (typeof window === "undefined") return;
  if (!SESSION_ID_RE.test(sessionId)) return;
  window.localStorage.setItem(storageKey(), sessionId);
}

export function clearStoredActiveSessionId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey());
}

export function readNewChatIntent(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((part) => {
    const [key, value] = part.trim().split("=");
    return key === intentCookie() && value === "1";
  });
}

export function writeNewChatIntent() {
  if (typeof document === "undefined") return;
  document.cookie = `${intentCookie()}=1; path=/; max-age=86400; SameSite=Lax`;
}

export function clearNewChatIntent() {
  if (typeof document === "undefined") return;
  document.cookie = `${intentCookie()}=; path=/; max-age=0; SameSite=Lax`;
}

/** 登录成功后进入应用：不恢复上次会话，默认展示新对话欢迎页 */
export function prepareFreshLoginLanding() {
  clearStoredActiveSessionId();
  writeNewChatIntent();
}

/** 退出登录时清理客户端会话状态 */
export function clearLoginSessionState() {
  clearStoredActiveSessionId();
  clearNewChatIntent();
}

/** Consume the backend's one-time Google landing hint before restoring a conversation. */
export function consumeFreshLoginLanding(): boolean {
  if (typeof document === "undefined" || !document.cookie.split(";").some((part) => part.trim() === "noma.freshLogin=1")) return false;
  prepareFreshLoginLanding();
  document.cookie = "noma.freshLogin=; path=/; max-age=0; SameSite=Lax";
  return true;
}
