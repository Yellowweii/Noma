import { clearLoginSessionState } from "./activeSessionStorage";

const API_BASE = "/api/v1";

let accessToken: string | null = null;
let userId: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getUserId(): string | null {
  return userId;
}

export function setUserId(id: string | null) {
  userId = id;
}

export function clearAccessToken() {
  accessToken = null;
  userId = null;
}

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        clearAccessToken();
        return false;
      }
      if (!res.ok) throw new Error("登录状态暂时无法同步，请稍后重试");
      const body = (await res.json()) as { access_token?: string; user_id?: string };
      if (!body.access_token) {
        throw new Error("登录状态同步响应无效，请稍后重试");
      }
      setAccessToken(body.access_token);
      if (body.user_id) setUserId(body.user_id);
      return true;
    } catch (error) {
      // A gateway restart, network failure or cloud outage does not revoke the
      // HttpOnly session. Only an explicit 401 requires another login.
      throw error instanceof Error ? error : new Error("登录状态暂时无法同步，请稍后重试");
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function recoverAccessToken(): Promise<boolean> {
  if (await refreshAccessToken()) return true;
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    const next = window.location.pathname + window.location.search;
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
  }
  return false;
}

export async function bootstrapSession(): Promise<boolean> {
  if (accessToken) return true;
  return recoverAccessToken();
}

export async function logoutSession(): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("退出登录失败，请稍后重试");
  clearAccessToken();
  clearLoginSessionState();
}

/** @deprecated use getAccessToken */
export const getToken = getAccessToken;
