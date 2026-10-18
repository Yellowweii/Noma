import type { Clerk } from "@clerk/clerk-js";

export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
let clerkPromise: Promise<Clerk> | null = null;
const loginMarker = "noma_clerk_login";

export function hasClerkLoginIntent(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(loginMarker) === "1";
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("登录服务连接超时，请重试或使用邮箱登录")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export function safeNextPath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value)
    ? value : "/agent";
}

// Load only for Google login, so email login does not wait for Clerk's network.
export function getClerk(): Promise<Clerk> {
  if (!clerkPublishableKey) return Promise.reject(new Error("Google 登录未启用"));
  if (!clerkPromise) {
    clerkPromise = (async () => {
      const { Clerk } = await import("@clerk/clerk-js");
      const clerk = new Clerk(clerkPublishableKey);
      await withTimeout(clerk.load({ signInForceRedirectUrl: "/login/complete", signUpForceRedirectUrl: "/login/complete" }), 15000);
      return clerk;
    })().catch((error) => { clerkPromise = null; throw error; });
  }
  return clerkPromise;
}

/** Clerk session may lag briefly after OAuth redirect; retry before giving up. */
export async function getClerkSessionToken(maxAttempts = 6): Promise<string | null> {
  if (!clerkPublishableKey || !hasClerkLoginIntent()) return null;
  const clerk = await getClerk();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await clerk.session?.getToken({ skipCache: true });
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  return null;
}

export async function startGoogleLogin(next: string): Promise<void> {
  const clerk = await getClerk();
  // Never silently reuse another account's old Clerk session.
  if (clerk.session) await clerk.signOut();
  sessionStorage.setItem("noma_login_next", safeNextPath(next));
  localStorage.setItem(loginMarker, "1");
  if (!clerk.client) throw new Error("Google 登录暂不可用，请稍后重试");
  await clerk.client.signIn.authenticateWithRedirect({
    strategy: "oauth_google",
    redirectUrl: "/login/sso-callback",
    redirectUrlComplete: "/login/complete",
    oidcPrompt: "select_account",
  });
}

export async function signOutClerk(): Promise<void> {
  try {
    if (!clerkPublishableKey || !localStorage.getItem(loginMarker)) return;
    await withTimeout((async () => {
      const clerk = await getClerk();
      await clerk.signOut();
      localStorage.removeItem(loginMarker);
      sessionStorage.removeItem("noma_login_next");
    })(), 5000);
  } catch {
    // Noma logout must finish even if Clerk is unreachable. Keep the marker;
    // a later Google login always clears the previous Clerk session first.
  }
}
