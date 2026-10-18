"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Device, HomeStatus } from "@/types";
import { ScrollArea } from "@/components/layout/ScrollArea";
import { FloatingTip, type FloatingTipVariant } from "@/components/ui/FloatingTip";
import { DeviceCard, DeviceDetailPanel } from "./DeviceCard";
import { HomeEmptyState } from "./HomeEmptyState";
import { HomeFeedbackCard } from "./HomeFeedbackCard";
import { controlDeviceOptimistically, retainLightSettings } from "./home-device-control";
import { homeControlDomains, homeSummary, isHomeSensor, relatedEntityGroups, roomKey } from "./home-devices";
import { getUserId } from "@/lib/auth";
import { readHomeSnapshot, writeHomeSnapshot } from "@/lib/homeSnapshot";
import { cn } from "@/lib/utils";
import styles from "./home-dashboard.module.css";

function readHomeName() {
  try {
    return window.localStorage.getItem("noma-ha-home-name")?.trim() || "我的家";
  } catch {
    return "我的家";
  }
}

function roomFilterClassName(selected: boolean) {
  return cn(
    "rounded-full border px-4 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-noma-brand focus-visible:ring-offset-2",
    selected
      ? "border-transparent bg-noma-brand-active font-medium text-slate-900"
      : "border-slate-200 text-slate-600 hover:bg-noma-soft",
  );
}

export function HomeDashboard() {
  const [status, setStatus] = useState<HomeStatus | null>(() => readHomeSnapshot()?.status ?? null);
  const [devices, setDevices] = useState<Device[]>(() => readHomeSnapshot()?.devices ?? []);
  const devicesRef = useRef(devices);
  const controlRevision = useRef(0);
  const deviceRevisions = useRef(new Map<string, number>());
  const [loading, setLoading] = useState(() => {
    const snapshot = readHomeSnapshot();
    return !snapshot || snapshot.devices === null;
  });
  const [refreshing, setRefreshing] = useState(false);
  const loadSequence = useRef(0);
  const loadPending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const controlCompletion = useRef(new Map<string, Promise<void>>());
  const [controlTip, setControlTip] = useState<{ message: string; variant: FloatingTipVariant } | null>(null);
  const [selectedRoom, setSelectedRoom] = useState("all");
  const [homeName, setHomeName] = useState(readHomeName);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    function syncHomeName() { setHomeName(readHomeName()); }
    syncHomeName();
    window.addEventListener("storage", syncHomeName);
    window.addEventListener("focus", syncHomeName);
    return () => {
      window.removeEventListener("storage", syncHomeName);
      window.removeEventListener("focus", syncHomeName);
    };
  }, []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    loadPending.current = true;
    const revision = controlRevision.current;
    let userId = getUserId();
    let nextStatus: HomeStatus | null = null;
    setError(null);
    try {
      nextStatus = await api.getHomeStatus();
      userId ??= getUserId();
      if (sequence !== loadSequence.current) return;
      if (nextStatus.configured === false || nextStatus.ha_reachable !== true) {
        setStatus(nextStatus);
        devicesRef.current = [];
        setDevices([]);
        writeHomeSnapshot(() => ({ status: nextStatus, devices: [] }), userId);
        return;
      }
      // Commit status and devices together so reconnecting never renders an empty dashboard first.
      const nextDevices = await api.listDevices();
      if (sequence !== loadSequence.current) return;
      const list = (Array.isArray(nextDevices) ? nextDevices : []).map(device => {
        const previous = devicesRef.current.find(current => current.entity_id === device.entity_id);
        return inFlight.current.has(device.entity_id) || (deviceRevisions.current.get(device.entity_id) ?? 0) > revision
          ? previous ?? device
          : retainLightSettings(device, previous);
      });
      setStatus(nextStatus);
      devicesRef.current = list;
      setDevices(list);
      writeHomeSnapshot(() => ({ status: nextStatus, devices: list }), userId);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      if (nextStatus) setStatus(nextStatus);
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      if (sequence === loadSequence.current) {
        loadPending.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!loadPending.current) void load();
    }, 10_000);
    return () => {
      window.clearInterval(timer);
      loadSequence.current++;
      loadPending.current = false;
    };
  }, [load]);

  async function control(device: Device, action: string, params?: Record<string, unknown>): Promise<boolean> {
    while (inFlight.current.has(device.entity_id)) {
      const queuedAdjustment = (device.domain === "light" && action === "turn_on" &&
        ["brightness_pct", "rgb_color", "rgbw_color", "rgbww_color", "white", "color_temp_kelvin"].some(key => params?.[key] !== undefined)) ||
        (device.domain === "cover" && action === "set_cover_position" && params?.position !== undefined) ||
        (device.domain === "media_player" && action === "volume_set" && params?.volume_level !== undefined) ||
        (device.domain === "climate" && action === "set_temperature" && params?.temperature !== undefined);
      if (!queuedAdjustment) return false;
      const previous = controlCompletion.current.get(device.entity_id);
      if (!previous) return false;
      await previous;
    }
    inFlight.current.add(device.entity_id);
    let finish!: () => void;
    controlCompletion.current.set(device.entity_id, new Promise<void>(resolve => { finish = resolve; }));
    setPending(new Set(inFlight.current));
    setControlTip(null);
    const userId = getUserId();
    // A queued adjustment must roll back to the latest settled value, not its stale render props.
    const previous = devicesRef.current.find(item => item.entity_id === device.entity_id) ?? device;
    const update = (updated: Device) => {
      deviceRevisions.current.set(device.entity_id, ++controlRevision.current);
      const list = devicesRef.current.map(item => item.entity_id === device.entity_id ? updated : item);
      devicesRef.current = list;
      setDevices(list);
      writeHomeSnapshot(snapshot => ({ status: snapshot?.status ?? status, devices: list }), userId);
    };
    try {
      const result = await controlDeviceOptimistically(previous, action, params, api, update);
      if (result !== "confirmed") {
        const operation = action === "turn_on" ?
          (params && Object.keys(params).length > 0 ? "调整" : "开启") : action === "turn_off" ? "关闭" : "操作";
        setControlTip({
          message: result === "unconfirmed" ? `${device.name}指令已发送，暂时无法确认状态，请刷新` : `${device.name}${operation}失败，请重试`,
          variant: result === "unconfirmed" ? "info" : "error",
        });
      }
      return result !== "failed";
    } finally {
      inFlight.current.delete(device.entity_id);
      controlCompletion.current.delete(device.entity_id);
      setPending(new Set(inFlight.current));
      finish();
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-noma-brand" aria-label="加载中" />
  </div>;
  if (status?.configured === false || status?.ha_reachable !== true) return <HomeEmptyState />;
  const connected = status?.ha_reachable === true;

  const groups = new Map<string, { name: string; devices: Device[] }>();
  const homeDevices = devices.filter(device => device.home_visible !== false &&
    (homeControlDomains.has(device.domain) || isHomeSensor(device)));
  for (const device of homeDevices) {
    const key = roomKey(device);
    if (!groups.has(key)) groups.set(key, { name: device.room?.trim() || "未分配区域", devices: [] });
    groups.get(key)!.devices.push(device);
  }
  const rooms = [...groups.entries()].sort(([a], [b]) => a === "unassigned" ? 1 : b === "unassigned" ? -1 : 0);
  const activeRoom = selectedRoom === "all" || groups.has(selectedRoom) ? selectedRoom : "all";
  const visibleRooms = rooms.filter(([key]) => activeRoom === "all" || activeRoom === key);
  const detailDevice = detailId ? homeDevices.find(device => device.entity_id === detailId) : undefined;

  return (
    <ScrollArea className={`h-full ${styles.page}`}>
      <div className={styles.content}>
        <header className={styles.overview}>
          <div className={styles.homeInfo}>
            <h1 className={styles.homeTitle}>{homeName}</h1>
            {!connected && <div className={styles.summary}>
                <span className={`${styles.connection} ${styles.disconnected}`}>
                  {status ? "Home Assistant 暂时无法连接" : "Home Assistant 连接状态暂时无法获取"}
                </span>
            </div>}
            {!connected && <Link href="/settings/ha" className={styles.refresh}>前往设置 → Home Assistant</Link>}
          </div>
          <button type="button" className={styles.refresh} disabled={refreshing || pending.size > 0}
            onClick={() => { setRefreshing(true); void load(); }}>
            <RefreshCw size={15} className={refreshing ? styles.spinner : undefined} aria-hidden="true" />
            {refreshing ? "更新中" : "刷新设备"}
          </button>
        </header>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <section aria-label="区域设备">
          {rooms.length > 0 && <div className={styles.filters} aria-label="按房间筛选">
            <button type="button" className={roomFilterClassName(activeRoom === "all")}
              aria-pressed={activeRoom === "all"} onClick={() => setSelectedRoom("all")}>全部</button>
            {rooms.map(([key, group]) => <button key={key} type="button" aria-pressed={activeRoom === key}
              className={roomFilterClassName(activeRoom === key)}
              onClick={() => setSelectedRoom(key)}>{group.name}</button>)}
          </div>}
          {homeDevices.length === 0 && !error && <p className={styles.empty}>
            {connected ? "尚未发现设备，请在 Home Assistant 中添加设备后刷新" : "连接恢复后可刷新设备列表"}
          </p>}
          {visibleRooms.map(([key, group]) => <section key={key} className={styles.room} aria-label={group.name}>
            <div className={styles.roomHeading}><h3>{group.name}</h3><span>{homeSummary(group.devices)}</span></div>
            <div className={styles.deviceGrid}>
              {relatedEntityGroups(group.devices).map(entities => <div
                key={entities[0].device_id || entities[0].entity_id}
                className={entities.length > 1 ? styles.relatedGroup : undefined}
                data-device-id={entities[0].device_id || undefined}>
                {entities.map(device => <DeviceCard key={device.entity_id} device={device}
                  pending={pending.has(device.entity_id)}
                  onControl={(action, params) => control(device, action, params)}
                  onOpenDetail={() => setDetailId(device.entity_id)} />)}
              </div>)}
            </div>
          </section>)}
        </section>
        {homeDevices.length > 0 && <HomeFeedbackCard />}
      </div>
      {detailDevice && <DeviceDetailPanel key={detailDevice.entity_id} device={detailDevice}
        pending={pending.has(detailDevice.entity_id)}
        onControl={(action, params) => control(detailDevice, action, params)} onClose={() => setDetailId(null)} />}
      <FloatingTip open={controlTip !== null} message={controlTip?.message ?? ""}
        variant={controlTip?.variant} duration={3000} onClose={() => setControlTip(null)} />
    </ScrollArea>
  );
}
