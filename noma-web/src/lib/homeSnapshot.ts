import type { Device, HomeStatus } from "@/types";
import { getUserId } from "./auth";

export type HomeSnapshot = { status: HomeStatus | null; devices: Device[] | null };

// Share the latest connection result and devices between settings and home.
const homeSnapshots = new Map<string, HomeSnapshot>();
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const storageKey = (userId: string) => `noma-home:v2:${userId}`;

export function readHomeSnapshot(userId = getUserId()) {
  if (!userId) return undefined;
  let snapshot = homeSnapshots.get(userId);
  if (!snapshot && typeof window !== "undefined") {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey(userId)) || "null");
      if (saved?.userId === userId && Number.isFinite(saved.savedAt) && saved.savedAt <= Date.now() && Date.now() - saved.savedAt < CACHE_MAX_AGE_MS &&
        typeof saved.status?.configured === "boolean" && typeof saved.status?.ha_reachable === "boolean" &&
        Array.isArray(saved.devices) && saved.devices.length <= 10000 && saved.devices.every((device: Device) =>
          typeof device?.entity_id === "string" && typeof device.domain === "string" && typeof device.state === "string")) {
        snapshot = { status: saved.status, devices: saved.devices };
        homeSnapshots.set(userId, snapshot);
      }
    } catch { /* Cache failure must not block live device reads. */ }
  }
  return snapshot;
}

export function writeHomeSnapshot(
  update: (previous?: HomeSnapshot) => HomeSnapshot,
  userId = getUserId(),
) {
  if (!userId || userId !== getUserId()) return;
  const snapshot = update(readHomeSnapshot(userId));
  homeSnapshots.set(userId, snapshot);
  try {
    window.sessionStorage.setItem(storageKey(userId), JSON.stringify({ ...snapshot, userId, savedAt: Date.now() }));
  } catch { /* In-memory cache remains available if storage is full or disabled. */ }
}

export function clearHomeSnapshot(userId = getUserId()) {
  if (!userId) return;
  homeSnapshots.delete(userId);
  try { window.sessionStorage.removeItem(storageKey(userId)); } catch { /* Storage is optional. */ }
}
