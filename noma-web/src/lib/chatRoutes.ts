const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AGENT_PATH = "/agent";

/** 兼容旧链接 /agent/{sessionId}，用于重定向到 /agent */
export function parseLegacyAgentSessionId(pathname: string): string | null {
  const match = pathname.match(/^\/agent\/([^/]+)\/?$/);
  if (!match) return null;
  const sessionId = decodeURIComponent(match[1]);
  return SESSION_ID_RE.test(sessionId) ? sessionId : null;
}

export function isAgentPath(pathname: string) {
  return (
    pathname === AGENT_PATH ||
    pathname === `${AGENT_PATH}/` ||
    parseLegacyAgentSessionId(pathname) != null
  );
}
