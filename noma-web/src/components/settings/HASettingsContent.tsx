"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ExternalLink, Eye, EyeOff, Home, Loader2 } from "lucide-react";
import { SettingsContentLayout } from "@/components/settings/SettingsContentLayout";
import { FloatingTip } from "@/components/ui/FloatingTip";
import { beginHAConnectionUpdate, readHAConnectionSnapshot, refreshHAConnectionSnapshot, subscribeHAConnectionSnapshot, writeHAConnectionSnapshot } from "@/lib/haConnectionSnapshot";

type LocalStatus = { ha_authorized: boolean; ha_url?: string; ha_configured?: boolean; home_name?: string; last_connected_at?: string };
const defaultHAURL = "http://localhost:8123";
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-noma-placeholder disabled:opacity-50";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-noma-action px-6 py-2.5 text-sm font-medium text-white transition-colors enabled:hover:bg-noma-action-hover disabled:cursor-not-allowed disabled:bg-noma-send-disabled disabled:text-noma-tertiary";

function connectionTime(value?: string | null): string | null {
  return value && Date.parse(value) > 0 ? value : null;
}

function rememberHomeName(name: string) {
  try {
    window.localStorage.setItem("noma-ha-home-name", name);
    window.dispatchEvent(new Event("noma-home-name"));
  } catch { /* The local backend remains the source of truth. */ }
}

export function HASettingsContent() {
  return <HAConnectionDetails />;
}

function HAConnectionDetails() {
  const snapshot = useSyncExternalStore(subscribeHAConnectionSnapshot, () => readHAConnectionSnapshot(undefined, true), () => null);
  const [status, setStatus] = useState<LocalStatus | null>(() => snapshot ? {
    ha_authorized: snapshot.connection.authorized === true, ha_configured: snapshot.connection.prepared,
    ha_url: snapshot.connection.local_url, home_name: snapshot.connection.home_name, last_connected_at: snapshot.connection.last_connected_at,
  } : null);
  const [loading, setLoading] = useState(() => !snapshot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(snapshot?.connected === true);
  const [showToken, setShowToken] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [url, setURL] = useState(snapshot?.connection.local_url || defaultHAURL);
  const [urlChanged, setURLChanged] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<string | null>(snapshot?.lastConnectedAt ?? null);
  const [homeName, setHomeName] = useState(snapshot?.connection.home_name || "我的家");
  const [savedHomeName, setSavedHomeName] = useState(snapshot?.connection.home_name || "我的家");
  const [savingHomeName, setSavingHomeName] = useState(false);
  const [homeNameSaved, setHomeNameSaved] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const nameEdited = useRef(false);
  const addressEdited = useRef(false);
  let tokenCreationURL: string | undefined;
  try {
    const address = new URL("/profile/security", url);
    if (address.protocol === "http:" || address.protocol === "https:") tokenCreationURL = address.href;
  } catch { /* Keep the creation link hidden while the address is incomplete. */ }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [response, defaultsResponse] = await Promise.all([
          fetch("/api/local/status", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/local/ha/defaults", { cache: "no-store", credentials: "same-origin" }),
        ]);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "无法读取本地连接设置");
        const defaults = defaultsResponse.ok ? await defaultsResponse.json() : null;
        if (!active) return;
        setStatus(body);
        if (!addressEdited.current) setURL(body.ha_url || defaults?.ha_url || defaultHAURL);
        if (!nameEdited.current) setHomeName(body.home_name || "我的家");
        setSavedHomeName(body.home_name || "我的家");
        if (body.home_name) rememberHomeName(body.home_name);
        setLastConnectedAt(connectionTime(body.last_connected_at));
        if (body.ha_authorized && body.ha_configured) {
          const snapshot = await refreshHAConnectionSnapshot();
          if (active) {
            setConnected(snapshot?.connected === true);
            setLastConnectedAt(connectionTime(body.last_connected_at) || snapshot?.lastConnectedAt || null);
          }
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "连接检测失败");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!snapshot || submitting.current) return;
    const connection = snapshot.connection;
    setStatus({ ha_authorized: connection.authorized === true, ha_configured: connection.prepared,
      ha_url: connection.local_url, home_name: connection.home_name, last_connected_at: connection.last_connected_at });
    setConnected(snapshot.connected);
    setLastConnectedAt(snapshot.lastConnectedAt);
    setLoading(false);
    if (!addressEdited.current && connection.local_url) setURL(connection.local_url);
    if (connection.home_name) {
      if (!nameEdited.current) setHomeName(connection.home_name);
      setSavedHomeName(connection.home_name);
      rememberHomeName(connection.home_name);
    }
  }, [snapshot]);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true); setError("");
    const finishUpdate = beginHAConnectionUpdate();
    try {
      const input: { ha_token?: string; ha_url?: string } = {};
      const token = tokenInput.current?.value.trim();
      if (token) input.ha_token = token;
      if (urlChanged) input.ha_url = url.trim();
      // The credential lives only in this input until submitted to the local backend.
      if (tokenInput.current) tokenInput.current.value = "";
      setShowToken(false);
      const response = await fetch("/api/local/ha/configure", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "连接失败，请检查地址和访问令牌");
      setStatus(body); setConnected(true);
      setURL(body.ha_url);
      setURLChanged(false);
      setHomeName(body.home_name || "我的家");
      setSavedHomeName(body.home_name || "我的家");
      rememberHomeName(body.home_name || "我的家");
      const connectedAt = connectionTime(body.last_connected_at) || new Date().toISOString();
      setLastConnectedAt(connectedAt);
      // Publish the verified result before ending the pending state so an old
      // offline snapshot cannot briefly bring the connection form back.
      writeHAConnectionSnapshot({
        available: true, prepared: true, authorized: true, ha_reachable: true,
        local_url: body.ha_url, home_name: body.home_name || "我的家", last_connected_at: connectedAt,
      }, true, true);
    } catch (error) { setError(error instanceof Error ? error.message : "无法连接本地服务"); }
    finally {
      finishUpdate();
      submitting.current = false;
      setSaving(false);
      void refreshHAConnectionSnapshot().catch(() => {});
    }
  }

  async function saveHomeName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = homeName.trim();
    if (submitting.current || !name || name === savedHomeName) return;
    submitting.current = true;
    setSavingHomeName(true); setHomeNameSaved(false); setError("");
    const finishUpdate = beginHAConnectionUpdate();
    try {
      const response = await fetch("/api/local/ha/name", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ home_name: name }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "家庭名称保存失败");
      setHomeName(body.home_name); setSavedHomeName(body.home_name);
      nameEdited.current = false;
      setStatus(previous => previous ? { ...previous, home_name: body.home_name } : previous);
      rememberHomeName(body.home_name);
      const current = readHAConnectionSnapshot();
      if (current) writeHAConnectionSnapshot({ ...current.connection, home_name: body.home_name }, current.connected);
      setHomeNameSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "家庭名称保存失败"); }
    finally { finishUpdate(); submitting.current = false; setSavingHomeName(false); }
  }

  if (loading) return <SettingsContentLayout title="Home Assistant" description="连接你部署的 Home Assistant，通过 Noma 查看和控制家中设备">
    <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 aria-hidden="true" size={18} className="animate-spin" />正在检查连接状态…</div>
  </SettingsContentLayout>;

  const isConnected = snapshot?.connection.authorized ? snapshot.connected : connected;
  if (status?.ha_authorized && status.ha_configured && isConnected) {
    const lastConnection = connectionTime(status.last_connected_at) || lastConnectedAt || snapshot?.lastConnectedAt;
    return <>
      <SettingsContentLayout className="w-full max-w-2xl" headerClassName="!mb-0 pb-3" title="Home Assistant" description="连接你的 Home Assistant，让 Noma 控制家中的智能设备">
        <div className="flex flex-col gap-6 pt-4">
          <section aria-live="polite" className="rounded-xl border border-noma-action/15 bg-noma-action-surface p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-noma-action/10 bg-white"><Home size={20} className="text-noma-action" /></span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-noma-action"><span className="size-2 rounded-full bg-noma-action" />已连接</p>
                <p className="mt-1 text-sm leading-5 text-noma-primary">上次连接：{lastConnection ? <time dateTime={lastConnection}>{new Date(lastConnection).toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</time> : "暂无记录"}</p>
              </div>
            </div>
          </section>
          <form onSubmit={event => void saveHomeName(event)} className="space-y-6">
            <div className="w-full space-y-2">
              <label htmlFor="ha-saved-home-name" className="block text-sm font-medium text-slate-700">家庭名称</label>
              <input id="ha-saved-home-name" value={homeName} onChange={event => { nameEdited.current = true; setHomeName(event.target.value); setHomeNameSaved(false); }} disabled={savingHomeName} maxLength={80} autoComplete="off" placeholder="我的家" className={`${inputClass} focus:border-noma-brand/40`} />
            </div>
            <div className="flex items-center justify-end gap-3"><button type="submit" disabled={savingHomeName || !homeName.trim() || homeName.trim() === savedHomeName} className={primaryClass}>{savingHomeName && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}保存</button></div>
          </form>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      </SettingsContentLayout>
      <FloatingTip open={homeNameSaved} message="保存成功" description="家庭名称已更新" variant="success" onClose={() => setHomeNameSaved(false)} />
    </>;
  }

  return <SettingsContentLayout title="Home Assistant" description="连接你部署的 Home Assistant，通过 Noma 查看和控制家中设备"><form autoComplete="off" className="max-w-2xl space-y-5" onSubmit={connect}>
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label htmlFor="ha-token" className="block text-sm font-medium text-slate-700">Home Assistant 长期访问令牌</label>
        {tokenCreationURL && <a href={tokenCreationURL} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded text-xs leading-5 text-noma-primary hover:text-noma-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-noma-brand focus-visible:ring-offset-2">前往创建令牌 <ExternalLink aria-hidden="true" size={12} /></a>}
      </div>
      <div className="relative">
        <input ref={tokenInput} id="ha-token" name="ha_token" type={showToken ? "text" : "password"} autoComplete="off" spellCheck={false} data-form-type="other" data-1p-ignore data-lpignore="true" maxLength={8192} disabled={loading || saving} placeholder={status?.ha_configured ? "留空则保持现有令牌" : "请输入长期访问令牌"} className={`${inputClass} pr-11`} />
        <button type="button" disabled={loading || saving} onClick={() => setShowToken(show => !show)} aria-label={showToken ? "隐藏令牌" : "显示令牌"} aria-pressed={showToken} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 enabled:hover:bg-noma-soft disabled:opacity-50">{showToken ? <Eye size={16} /> : <EyeOff size={16} />}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">在 Home Assistant 中：个人资料 → 安全 → 长期访问令牌 → 创建令牌。</p>
    </div>
    <div>
      <button type="button" aria-expanded={advancedOpen} aria-controls="ha-connection-advanced" className="inline-flex items-center gap-2 rounded-lg text-sm text-noma-secondary hover:text-noma-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-noma-brand" onClick={() => setAdvancedOpen(open => !open)}>自定义 Home Assistant 地址 <ChevronDown aria-hidden="true" size={14} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} /></button>
      <div id="ha-connection-advanced" hidden={!advancedOpen} className="mt-4 space-y-4">
        <div>
          <label htmlFor="ha-url" className="mb-2 block text-sm font-medium text-slate-700">Home Assistant 地址</label>
          <input id="ha-url" type="url" value={url} disabled={loading || saving} onChange={event => { addressEdited.current = true; setURL(event.target.value); setURLChanged(true); }} placeholder={defaultHAURL} autoComplete="off" className={inputClass} />
          <p className="mt-2 text-xs leading-5 text-noma-tertiary">填写你部署的 Home Assistant 的局域网地址，例如 http://192.168.1.100:8123。</p>
        </div>
      </div>
    </div>
    <div aria-live="polite" className="min-h-5">{error && <p role="alert" className="text-sm text-red-600">{error}</p>}</div>
    <div className="flex justify-end">
      <button type="submit" disabled={loading || saving} aria-label={saving ? "正在连接" : "连接"} aria-busy={saving} className="inline-flex min-h-10 min-w-24 items-center justify-center rounded-full bg-noma-action px-6 py-2.5 text-sm font-medium text-white enabled:hover:bg-noma-action-hover disabled:cursor-wait">
        {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : "连接"}
      </button>
    </div>
  </form></SettingsContentLayout>;
}
