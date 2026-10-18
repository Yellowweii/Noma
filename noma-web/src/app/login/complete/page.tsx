"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  LoginEnteringScreen,
  type LoginEnteringStep,
} from "@/components/login/LoginEnteringScreen";
import { api } from "@/lib/api";
import { prepareFreshLoginLanding } from "@/lib/activeSessionStorage";
import { getClerkSessionToken, safeNextPath } from "@/lib/clerk";

function afterPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function CompleteLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const method = searchParams.get("method");
  const isOTP = method === "phone" || method === "email";
  const loginName = method === "phone" ? "手机号登录" : method === "email" ? "邮箱登录" : "Google 登录";
  const otpNext = safeNextPath(searchParams.get("next"));
  const started = useRef(false);
  const [busy, setBusy] = useState(true);
  const [activeStep, setActiveStep] = useState<LoginEnteringStep>(2);
  const [error, setError] = useState("");
  const [syncFailed, setSyncFailed] = useState(false);

  const exchange = useCallback(async () => {
    setBusy(true);
    setError("");
    setSyncFailed(false);
    setActiveStep(2);
    try {
      if (isOTP) {
        await api.getMe();
      } else {
        const token = await getClerkSessionToken();
        if (!token) throw new Error("登录已过期，请返回登录页重试");
        await api.loginClerk(token);
        prepareFreshLoginLanding();
      }
      try {
        await api.importGuestChats();
      } catch {
        setSyncFailed(true);
        throw new Error("登录已完成，但本地聊天记录暂未同步成功。记录仍保留在此浏览器，请点击重试");
      }
      setActiveStep(4);
      await afterPaint();
      const next = isOTP ? otpNext : safeNextPath(sessionStorage.getItem("noma_login_next"));
      if (!isOTP) sessionStorage.removeItem("noma_login_next");
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
      setBusy(false);
    }
  }, [isOTP, otpNext, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    router.prefetch(isOTP ? otpNext : safeNextPath(sessionStorage.getItem("noma_login_next")));
    void exchange();
  }, [exchange, isOTP, otpNext, router]);

  if (busy) {
    return <LoginEnteringScreen activeStep={activeStep} loginLabel={`${loginName}已完成`} />;
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-white px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold text-slate-900">{loginName}</h1>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!busy && error && (
          <button
            type="button"
            onClick={() => void exchange()}
            className="min-h-11 text-sm text-brand-600 underline"
          >
            重试
          </button>
        )}
        {syncFailed && (
          <button type="button" className="block w-full text-sm text-noma-brand" onClick={() => {
            const next = isOTP ? otpNext : safeNextPath(sessionStorage.getItem("noma_login_next"));
            if (!isOTP) sessionStorage.removeItem("noma_login_next");
            router.replace(next);
          }}>
            稍后同步，进入 Noma
          </button>
        )}
        <Link href="/login" className="block text-center text-sm text-slate-500 hover:text-slate-700">
          返回登录
        </Link>
      </div>
    </div>
  );
}

export default function CompleteLoginPage() {
  return (
    <Suspense fallback={<LoginEnteringScreen activeStep={2} loginLabel="登录已完成" />}>
      <CompleteLoginContent />
    </Suspense>
  );
}
