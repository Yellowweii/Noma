"use client";

import { useEffect, useState } from "react";
import { Home, Loader2 } from "lucide-react";
import { NomaLogo } from "@/components/NomaLogo";

// Used only inside HA settings; browsing and cloud chat never mount this gate.
export function LocalAccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "locked" | "ready">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/local/status", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("本地服务暂不可用，请检查部署状态");
        const status = await response.json();
        setState(status.ha_authorized ? "ready" : "locked");
      })
      .catch(error => { setError(error.message); setState("locked"); });
  }, []);

  if (state === "ready") return <>{children}</>;
  return <section className="max-w-2xl rounded-xl border border-noma-border bg-white p-6">
    <div className="w-full max-w-md">
      <NomaLogo className="mx-auto size-14" />
      {state === "loading" ? <Loader2 aria-label="正在连接本地服务" className="mx-auto mt-8 size-5 animate-spin text-noma-brand" /> : <>
        <h3 className="mt-7 text-xl font-semibold text-noma-primary">启用本地设备访问</h3>
        <p className="mt-3 text-sm leading-6 text-noma-secondary">允许当前浏览器查看和控制此实例已授权的家庭设备。无需额外访问密钥。</p>
        <form className="mt-8" onSubmit={async event => {
          event.preventDefault();
          setBusy(true); setError("");
          try {
            const response = await fetch("/api/local/ha/authorize", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "授权失败");
            setState("ready");
          } catch (error) { setError(error instanceof Error ? error.message : "无法连接本地服务"); }
          finally { setBusy(false); }
        }}>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-noma-action px-6 py-3 text-sm font-medium text-white enabled:hover:bg-noma-action-hover disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Home className="size-4" />}启用设备访问
          </button>
        </form>
      </>}
    </div>
  </section>;
}
