import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function truncateTitle(text: string, max = 40) {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("") + "…";
}

export function sortChatSessions(sessions: import("@/types").ChatSession[]) {
  return [...sessions].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (a.is_pinned && b.is_pinned) {
      const aPinned = new Date(a.pinned_at ?? a.updated_at).getTime();
      const bPinned = new Date(b.pinned_at ?? b.updated_at).getTime();
      return aPinned - bPinned;
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
