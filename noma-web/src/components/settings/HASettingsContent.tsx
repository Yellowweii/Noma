"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { SettingsContentLayout } from "@/components/settings/SettingsContentLayout";
import { FeedbackButton } from "@/components/settings/FeedbackButton";
import { refreshHAConnectionSnapshot } from "@/lib/haConnectionSnapshot";
import { LocalAccessGate } from "@/components/local/LocalAccessGate";

type LocalStatus = { ha_url: string; ha_configured: boolean; allowed_entities: string[] };

export function HASettingsContent() {
  return <SettingsContentLayout title="Home Assistant" description="通过局域网连接你的 Home Assistant，查看家庭状态并控制已授权的设备" decorative footer={<FeedbackButton>反馈</FeedbackButton>}>
    <LocalAccessGate><HAConnectionDetails /></LocalAccessGate>
  </SettingsContentLayout>;
}

function HAConnectionDetails() {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudNote, setCloudNote] = useState("");

  async function check() {
    setLoading(true); setError(""); setCloudNote("");
    try {
      const response = await fetch("/api/local/status", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok || !body.ha_authorized) throw new Error("本地设备授权已过期，请刷新后重新授权");
      setStatus(body);
      const [home, cloud] = await Promise.allSettled([
        refreshHAConnectionSnapshot(),
        fetch("/api/local/cloud/capabilities", { cache: "no-store", credentials: "same-origin" }).then(async response => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "云端尚未支持本地工具协议");
          return true;
        }),
      ]);
      setConnected(home.status === "fulfilled" && home.value?.connected === true);
      if (home.status === "rejected") setError(home.reason instanceof Error ? home.reason.message : "HA 连接检测失败");
      setCloudReady(cloud.status === "fulfilled");
      if (cloud.status === "rejected") setCloudNote(cloud.reason instanceof Error ? cloud.reason.message : "云端协议尚未就绪");
    } catch (error) { setError(error instanceof Error ? error.message : "连接检测失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void check(); }, []);

  return <div className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-noma-border bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-noma-primary">本地连接</h3>
          <span className="inline-flex items-center gap-1.5 text-sm text-noma-secondary">{loading ? <Loader2 className="size-4 animate-spin" /> : connected ? <Check className="size-4 text-noma-brand" /> : <CircleAlert className="size-4" />}{loading ? "检测中" : connected ? "已连接" : status?.ha_configured ? "暂时无法连接" : "尚未配置"}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-noma-secondary">Noma Local 直接访问局域网中的 Home Assistant，无需建立远程连接。</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex gap-4"><dt className="w-20 shrink-0 text-noma-secondary">服务地址</dt><dd className="break-all text-noma-primary">{status?.ha_url || "尚未配置"}</dd></div>
          <div className="flex gap-4"><dt className="w-20 shrink-0 text-noma-secondary">授权设备</dt><dd className="break-all text-noma-primary">{status?.allowed_entities.length ? status.allowed_entities.join("、") : "暂无授权设备"}</dd></div>
        </dl>
        {!status?.ha_configured && <p className="mt-5 rounded-lg bg-noma-soft p-4 text-sm leading-6 text-noma-secondary">请在本地部署配置中填写 HA 地址和访问令牌，并授权需要使用的设备，然后重启 Noma Local。</p>}
        <p className="mt-4 text-xs leading-5 text-noma-tertiary">HA 访问令牌仅由本地后端保存，不会发送至云端。</p>
      </section>
      <section className="rounded-xl border border-noma-border bg-white p-6">
        <h3 className="text-base font-semibold text-noma-primary">云端 Agent</h3>
        <p className="mt-3 text-sm leading-6 text-noma-secondary">{loading ? "正在检测云端工具协议…" : cloudReady ? "云端已支持本地工具执行，可以通过对话控制授权设备。" : cloudNote || "云端尚未启用本地工具协议。"}</p>
        <p className="mt-3 text-xs leading-5 text-noma-tertiary">账号、对话和记忆仍由 Noma Cloud 提供。</p>
      </section>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={() => void check()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-noma-action px-6 py-2.5 text-sm font-medium text-white enabled:hover:bg-noma-action-hover disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />重新检测</button>
    </div>;
}
