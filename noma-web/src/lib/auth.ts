import { clerkPublishableKey, getClerkSessionToken, hasClerkLoginIntent, signOutClerk } from "./clerk";
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
      if (!res.ok) {
        clearAccessToken();
        return false;
      }
      const body = (await res.json()) as { access_token?: string; user_id?: string };
      if (!body.access_token) {
        clearAccessToken();
        return false;
      }
      setAccessToken(body.access_token);
      if (body.user_id) setUserId(body.user_id);
      return true;
    } catch {
      clearAccessToken();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function exchangeClerkSession(): Promise<boolean> {
  if (!clerkPublishableKey || !hasClerkLoginIntent()) return false;
  try {
    const token = await getClerkSessionToken();
    if (!token) return false;
    const res = await fetch(`${API_BASE}/auth/clerk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });
    if (!res.ok) {
      clearAccessToken();
      return false;
    }
    const body = (await res.json()) as { access_token?: string; user_id?: string };
    if (!body.access_token) {
      clearAccessToken();
      return false;
    }
    setAccessToken(body.access_token);
    if (body.user_id) setUserId(body.user_id);
    return true;
  } catch {
    clearAccessToken();
    return false;
  }
}

export async function recoverAccessToken(): Promise<boolean> {
  if (await refreshAccessToken()) return true;
  if (await exchangeClerkSession()) return true;
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
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearAccessToken();
    clearLoginSessionState();
    await signOutClerk();
  }
}

/** @deprecated use getAccessToken */
export const getToken = getAccessToken;
