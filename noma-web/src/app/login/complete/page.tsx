"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  LoginEnteringScreen,
  type LoginEnteringStep,
} from "@/components/login/LoginEnteringScreen";
import { api, bootstrapSession } from "@/lib/api";
import { prepareFreshLoginLanding } from "@/lib/activeSessionStorage";
import { safeNextPath } from "@/lib/safeNext";

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
  const isCloud = method === "google";
  const loginName = method === "phone" ? "手机号登录" : method === "email" ? "邮箱登录" : "Google 登录";
  const otpNext = safeNextPath(searchParams.get("next"));
  const started = useRef(false);
  const [busy, setBusy] = useState(true);
  const [activeStep, setActiveStep] = useState<LoginEnteringStep>(2);
  const [error, setError] = useState("");

  const exchange = useCallback(async () => {
    if (!isOTP && !isCloud) {
      setError("请返回登录页重新登录");
      setBusy(false);
      return;
    }
    setBusy(true);
    setError("");
    setActiveStep(2);
    try {
      if (!await bootstrapSession()) throw new Error("登录已过期，请返回登录页重新登录");
      await api.getMe();
      if (isCloud) prepareFreshLoginLanding();
      setActiveStep(4);
      await afterPaint();
      router.replace(otpNext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
      setBusy(false);
    }
  }, [isCloud, isOTP, otpNext, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (isOTP || isCloud) router.prefetch(otpNext);
    void exchange();
  }, [exchange, isCloud, isOTP, otpNext, router]);

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
