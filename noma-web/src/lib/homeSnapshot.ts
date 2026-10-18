import type { Device, HomeStatus } from "@/types";
import { getUserId } from "./auth";

export type HomeSnapshot = { status: HomeStatus | null; devices: Device[] | null };

// Share the latest connection result and devices between settings and home.
const homeSnapshots = new Map<string, HomeSnapshot>();

export function readHomeSnapshot(userId = getUserId()) {
  return userId ? homeSnapshots.get(userId) : undefined;
}

export function writeHomeSnapshot(
  update: (previous?: HomeSnapshot) => HomeSnapshot,
  userId = getUserId(),
) {
  if (userId) homeSnapshots.set(userId, update(homeSnapshots.get(userId)));
}

export function clearHomeSnapshot(userId = getUserId()) {
  if (userId) homeSnapshots.delete(userId);
}
