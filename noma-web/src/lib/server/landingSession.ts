import "server-only";

import { cookies } from "next/headers";
import type { LandingUser } from "@/types";

/** Read the session without rotating the browser's refresh token during SSR. */
export async function getLandingUser(): Promise<LandingUser | null> {
  const token = (await cookies()).get("noma_local_session")?.value;
  if (!token) return null;

  const apiBase = (process.env.NOMA_INTERNAL_API_URL || "http://127.0.0.1:3100/api/v1").replace(/\/$/, "");
  try {
    const response = await fetch(`${apiBase}/auth/session`, {
      headers: { Cookie: `noma_local_session=${encodeURIComponent(token)}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (typeof user.user_id !== "string" || !user.user_id) return null;
    return {
      name: typeof user.name === "string" ? user.name : "",
      avatar_url: typeof user.avatar_url === "string" ? user.avatar_url : undefined,
    };
  } catch {
    return null;
  }
}
