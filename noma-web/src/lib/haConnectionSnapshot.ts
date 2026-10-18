import { api } from "./api";
import { bootstrapSession, getUserId } from "./auth";
import { writeHomeSnapshot } from "./homeSnapshot";
import type { HAConnectionStatus } from "@/types";

export const HA_CONNECTION_REFRESH_MS = 10000;
const DEFAULT_HA_URL = "http://host.docker.internal:8123";

export type HAConnectionSnapshot = {
  userId: string;
  connection: HAConnectionStatus;
  connected: boolean;
  lastConnectedAt: string | null;
  checkedAt: number;
};

const snapshots = new Map<string, HAConnectionSnapshot>();
const listeners = new Set<() => void>();
const revisions = new Map<string, number>();
const mutations = new Map<string, number>();
const pending = new Map<string, { revision: number; promise: Promise<HAConnectionSnapshot | null> }>();
const storageKey = (userId: string) => `noma-ha-connection:${userId}`;

function isTemporary(snapshot: HAConnectionSnapshot) {
  return snapshot.connection.prepared && !snapshot.connection.authorized && snapshot.connection.local_url !== DEFAULT_HA_URL;
}

export function readHAConnectionSnapshot(userId = getUserId(), includeTemporary = false): HAConnectionSnapshot | null {
  if (!userId) return null;
  let snapshot = snapshots.get(userId);
  if (!snapshot && typeof window !== "undefined") {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "null") as HAConnectionSnapshot | null;
      if (saved?.userId === userId && typeof saved.connected === "boolean" && Number.isFinite(saved.checkedAt) && typeof saved.connection?.available === "boolean" && typeof saved.connection.prepared === "boolean" && (saved.lastConnectedAt === null || Number.isFinite(Date.parse(saved.lastConnectedAt)))) {
        // Binding commands are kept in memory only, never restored from storage.
        saved.connection = { ...saved.connection, command: undefined };
        snapshots.set(userId, saved);
        snapshot = saved;
      }
    } catch { /* A missing or invalid cache falls back to a live check. */ }
  }
  return snapshot && (includeTemporary || !isTemporary(snapshot)) ? snapshot : null;
}

export function subscribeHAConnectionSnapshot(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function beginHAConnectionUpdate(userId = getUserId()) {
  if (!userId) return () => {};
  revisions.set(userId, (revisions.get(userId) ?? 0) + 1);
  mutations.set(userId, (mutations.get(userId) ?? 0) + 1);
  return () => { mutations.set(userId, Math.max(0, (mutations.get(userId) ?? 1) - 1)); };
}

export function writeHAConnectionSnapshot(connection: HAConnectionStatus, connected: boolean, verified = false, userId = getUserId()): HAConnectionSnapshot | null {
  if (!userId || userId !== getUserId()) return null;
  const previous = readHAConnectionSnapshot(userId);
  let lastConnectedAt = previous?.connection.connection_id === connection.connection_id ? previous?.lastConnectedAt ?? null : null;
  if (!lastConnectedAt && typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(`noma-ha-last-connected:${userId}:${connection.connection_id || "legacy"}`);
      if (saved && Number.isFinite(Date.parse(saved))) lastConnectedAt = saved;
    } catch { /* Older timestamps are optional. */ }
  }
  if (connected && verified) lastConnectedAt = new Date().toISOString();
  const snapshot = { userId, connection: { ...connection }, connected, lastConnectedAt, checkedAt: Date.now() };
  revisions.set(userId, (revisions.get(userId) ?? 0) + 1);
  snapshots.set(userId, snapshot);
  try {
    if (isTemporary(snapshot)) {
      window.localStorage.removeItem(storageKey(userId));
    } else {
      const { command: _command, ...publicConnection } = connection;
      window.localStorage.setItem(storageKey(userId), JSON.stringify({ ...snapshot, connection: publicConnection }));
    }
  } catch { /* In-memory caching still works when browser storage is unavailable. */ }
  listeners.forEach(listener => listener());
  return snapshot;
}

export async function refreshHAConnectionSnapshot(userId = getUserId()): Promise<HAConnectionSnapshot | null> {
  if (!userId) {
    if (!await bootstrapSession()) return null;
    userId = getUserId();
  }
  if (!userId || userId !== getUserId()) return null;
  if (mutations.get(userId)) return snapshots.get(userId) ?? null;
  const revision = revisions.get(userId) ?? 0;
  const existing = pending.get(userId);
  if (existing?.revision === revision) return existing.promise;
  const ownerId = userId;
  const promise = (async () => {
    const [connectionResult, statusResult] = await Promise.allSettled([api.getHAConnection(), api.getHomeStatus()]);
    if (getUserId() !== ownerId || (revisions.get(ownerId) ?? 0) !== revision || mutations.get(ownerId)) return snapshots.get(ownerId) ?? null;
    // An unreachable prepared tunnel invalidates a cached success even if the
    // home request fails or returns a conflicting result from another route.
    const tunnelOffline = connectionResult.status === "fulfilled" && connectionResult.value.prepared && connectionResult.value.ha_reachable === false;
    if (statusResult.status === "rejected" && !tunnelOffline) throw statusResult.reason;
    const status = statusResult.status === "fulfilled" ? statusResult.value : null;
    const connected = !tunnelOffline && !!status?.configured && status.ha_reachable === true;
    const connection = connectionResult.status === "fulfilled" ? connectionResult.value : !connected ? snapshots.get(ownerId)?.connection : undefined;
    if (!connection) throw connectionResult.status === "rejected" ? connectionResult.reason : new Error("连接状态暂不可用");
    const snapshot = writeHAConnectionSnapshot(connection, connected, true, ownerId);
    writeHomeSnapshot(previous => ({
      status: tunnelOffline ? { ...(status ?? previous?.status), configured: connection.authorized === true, ha_reachable: false } : status,
      devices: connected ? previous?.devices ?? null : [],
    }), ownerId);
    return snapshot;
  })();
  pending.set(ownerId, { revision, promise });
  try { return await promise; }
  finally { if (pending.get(ownerId)?.promise === promise) pending.delete(ownerId); }
}

// Mounted by the dashboard shell, so changing pages does not stop checking HA.
export function startHAConnectionMonitor(userId: string) {
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout>;
  async function check() {
    try { await refreshHAConnectionSnapshot(userId); }
    catch { /* A transport failure preserves the last confirmed status and timestamp. */ }
    finally { if (!stopped) timeout = setTimeout(check, HA_CONNECTION_REFRESH_MS); }
  }
  const cached = readHAConnectionSnapshot(userId);
  timeout = setTimeout(check, cached ? Math.max(0, HA_CONNECTION_REFRESH_MS - (Date.now() - cached.checkedAt)) : 0);
  return () => { stopped = true; clearTimeout(timeout); };
}
