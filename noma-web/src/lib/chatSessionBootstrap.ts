import { readStoredActiveSessionId } from "@/lib/activeSessionStorage";
import { parseLegacyAgentSessionId } from "@/lib/chatRoutes";
import {
  createPendingSessionId,
  writeSessionSnapshot,
} from "@/lib/sessionMessageCache";

export type InitialChatSessionState = {
  sessionId: string;
  needsPendingBootstrap: boolean;
};

/** SSR 与客户端首帧共用：始终 pending，避免 hydration 不一致 */
export function createBootstrapPendingSessionState(): InitialChatSessionState {
  const pendingId = createPendingSessionId();
  writeSessionSnapshot(pendingId, { messages: [], fetched: true });
  return { sessionId: pendingId, needsPendingBootstrap: true };
}

/** 仅在客户端 useLayoutEffect 中调用，恢复上次选中的 session */
export function readRestorableSessionId(): string | null {
  if (typeof window === "undefined") return null;

  const legacySessionId = parseLegacyAgentSessionId(window.location.pathname);
  if (legacySessionId) return legacySessionId;

  return readStoredActiveSessionId();
}
