"use client";

import { useEffect, useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { NomaLogo } from "@/components/NomaLogo";

// The existing application mounts only after the local household instance is unlocked.
export function LocalAccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "locked" | "ready">("loading");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/local/status", { credentials: "same-origin", cache: "no-store" })
      .then(response => {
        if (response.ok) setState("ready");
        else if (response.status === 401) setState("locked");
        else throw new Error("本地服务暂不可用，请检查部署状态");
      })
      .catch(error => { setError(error.message); setState("locked"); });
  }, []);

  if (state === "ready") return <>{children}</>;
  return <div className="flex h-full items-center justify-center overflow-auto bg-white px-6 py-10">
    <div className="w-full max-w-sm">
      <NomaLogo className="mx-auto size-14" />
      {state === "loading" ? <Loader2 aria-label="正在连接本地服务" className="mx-auto mt-8 size-5 animate-spin text-noma-brand" /> : <>
        <h1 className="mt-7 text-center text-2xl font-semibold text-noma-primary">连接你的 Noma Local</h1>
        <p className="mt-3 text-center text-sm leading-6 text-noma-secondary">使用部署时设置的访问密钥解锁本地实例。</p>
        <form className="mt-8" onSubmit={async event => {
          event.preventDefault();
          setBusy(true); setError("");
          try {
            const response = await fetch("/api/local/unlock", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "解锁失败");
            setKey(""); setState("ready");
          } catch (error) { setError(error instanceof Error ? error.message : "无法连接本地服务"); }
          finally { setBusy(false); }
        }}>
          <label htmlFor="local-key" className="text-sm font-medium text-noma-primary">本地访问密钥</label>
          <input id="local-key" type="password" autoComplete="current-password" value={key} onChange={event => setKey(event.target.value)} minLength={24} required className="mt-2 w-full rounded-lg border border-noma-border px-3 py-3 text-sm outline-none focus:border-noma-brand" />
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-noma-action px-6 py-3 text-sm font-medium text-white enabled:hover:bg-noma-action-hover disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}解锁
          </button>
        </form>
      </>}
    </div>
  </div>;
}
