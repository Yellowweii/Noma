"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Loader2, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { NomaLogo } from "@/components/NomaLogo";
import { api } from "@/lib/api";
import { safeNextPath } from "@/lib/safeNext";
import styles from "./login.module.css";

const cloudLoginErrors: Record<string, string> = {
  state: "登录已失效，请重新使用 Google 登录",
  cloud: "暂时无法完成官网登录，请重试或使用手机号、邮箱登录",
  denied: "已取消 Google 登录",
};

function getOtpErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes("'Email' failed on the 'email' tag")) {
    return "请输入有效的邮箱地址";
  }
  return error.message;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"email" | "phone">("phone");
  const [code, setCode] = useState("");
  const [loadingMethod, setLoadingMethod] = useState<"otp" | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [phoneCooldown, setPhoneCooldown] = useState(0);
  const [error, setError] = useState<string | null>(cloudLoginErrors[searchParams.get("error") || ""] || null);
  const [info, setInfo] = useState<string | null>(null);
  const loading = loadingMethod !== null;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (phoneCooldown <= 0) return;
    const timer = setInterval(() => setPhoneCooldown((s) => Math.max(0, s - 60)), 60000);
    return () => clearInterval(timer);
  }, [phoneCooldown]);

  const formatPhoneCooldown = (seconds: number) => seconds >= 86400
    ? `${Math.ceil(seconds / 86400)}天后可获取`
    : seconds >= 3600 ? `${Math.ceil(seconds / 3600)}小时后可获取`
      : `${Math.ceil(seconds / 60)}分钟后可获取`;

  function validatePhone() {
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError("请输入有效的 11 位手机号");
      setInfo(null);
      return false;
    }
    return true;
  }

  function validateEmail() {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(value ? "请输入有效的邮箱地址" : "请先输入邮箱");
      setInfo(null);
      return false;
    }
    return true;
  }

  async function handleSendCode() {
    if (method === "email" ? !validateEmail() : !validatePhone()) return;
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      if (method === "email") {
        const res = await api.sendOtp(email.trim());
        setCooldown(res.cooldown_seconds);
        setInfo("验证码已发送，请查收邮件");
      } else {
        const res = await api.sendPhoneOtp(phone.trim());
        setPhoneCooldown(res.cooldown_seconds);
        setInfo("验证码已发送，请查收短信");
      }
    } catch (err) {
      if (err instanceof Error && "cooldownSeconds" in err && typeof err.cooldownSeconds === "number") {
        if (method === "email") setCooldown(err.cooldownSeconds);
        else setPhoneCooldown(err.cooldownSeconds);
      }
      setError(getOtpErrorMessage(err, "发送失败"));
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (method === "email" ? !validateEmail() : !validatePhone()) return;
    setLoadingMethod("otp");
    setInfo(null);
    try {
      if (method === "email") await api.verifyOtp(email.trim(), code.trim());
      else await api.loginPhone(phone.trim(), code.trim());
      router.push(`/login/complete?method=${method}&next=${encodeURIComponent(nextPath)}`);
    } catch (err) {
      setError(getOtpErrorMessage(err, "登录失败"));
    } finally {
      setLoadingMethod(null);
    }
  }

  function handleGoogleLogin() {
    const params = new URLSearchParams({ next: nextPath });
    window.location.assign(`/api/local/auth/google?${params.toString()}`);
  }

  const form = (
    <div className="m-auto w-full max-w-[340px] shrink-0">
      <div className="mx-auto flex w-fit items-center gap-2">
        <NomaLogo className="h-9 w-9" />
        <h1 className="text-[28px] font-medium leading-9 tracking-[-0.5px] text-[#14212b]">Noma</h1>
      </div>

      <p className="mt-2 text-center text-[13px] leading-5 text-[#8b95a4]">让 AI，更懂你的家</p>

      <div role="tablist" aria-label="登录方式" className="mt-8 flex gap-7 border-b border-[#e5e9ed] text-sm">
        {(["phone", "email"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={method === item}
            onClick={() => { setMethod(item); setCode(""); setError(null); setInfo(null); }}
            className={`relative pb-3 transition-colors ${method === item ? "font-medium text-[#14212b] after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#418b7c]" : "text-[#84909f] hover:text-[#14212b]"}`}>
            {item === "phone" ? "手机号登录" : "邮箱登录"}
          </button>
        ))}
      </div>

      <form aria-label={method === "phone" ? "手机验证码登录" : "邮箱验证码登录"} onSubmit={handleSubmit} className="mt-5">
        <div className="flex h-11 items-center gap-2.5 rounded-xl border border-[#dfe4e9] px-3.5">
          {method === "email" ? <Mail aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[#84909f]" strokeWidth={1.7} /> :
            <Smartphone aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[#84909f]" strokeWidth={1.7} />}
          <input
            type={method === "email" ? "email" : "tel"}
            aria-label={method === "email" ? "邮箱地址" : "手机号"}
            autoComplete={method === "email" ? "email" : "tel"}
            inputMode={method === "email" ? "email" : "numeric"}
            placeholder={method === "email" ? "请输入邮箱地址" : "请输入 11 位手机号"}
            required
            maxLength={method === "phone" ? 11 : undefined}
            value={method === "email" ? email : phone}
            onChange={(e) => method === "email" ? setEmail(e.target.value) : setPhone(e.target.value.replace(/\D/g, ""))}
            className={`${styles.input} h-full min-w-0 flex-1 bg-transparent text-base text-[#14212b] outline-none placeholder:text-[#7c8796] sm:text-sm`}
          />
        </div>

        <div className="mt-3 flex h-11 items-center gap-2.5 rounded-xl border border-[#dfe4e9] px-3.5">
          <ShieldCheck aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[#84909f]" strokeWidth={1.7} />
          <input
            type="text"
            aria-label="6 位验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="请输入验证码"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${styles.input} h-full min-w-0 flex-1 bg-transparent text-base text-[#14212b] outline-none placeholder:text-[#7c8796] sm:text-sm`}
          />
          <button
            type="button"
            aria-label={sending ? "正在发送验证码" : method === "email" && cooldown > 0 ? `${cooldown} 秒后可重新获取验证码` : method === "phone" && phoneCooldown > 0 ? formatPhoneCooldown(phoneCooldown) : "获取验证码"}
            disabled={sending || (method === "email" ? cooldown > 0 || !email.trim() : phoneCooldown > 0 || !phone.trim())}
            onClick={handleSendCode}
            className="flex h-5 min-w-[84px] shrink-0 items-center justify-center border-l border-[#e5e9ed] pl-3 text-[13px] font-medium text-[#278575] transition-colors enabled:hover:text-noma-brand-hover focus-visible:outline-noma-brand disabled:cursor-not-allowed disabled:text-noma-placeholder"
          >
            {sending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : method === "email" && cooldown > 0 ? (
              `${cooldown}s`
            ) : method === "phone" && phoneCooldown > 0 ? (
              formatPhoneCooldown(phoneCooldown)
            ) : (
              "获取验证码"
            )}
          </button>
        </div>

        {error && <p role="alert" className="mt-4 text-left text-sm text-red-600">{error}</p>}
        {info && <p role="status" className="mt-4 text-left text-sm text-noma-brand">{info}</p>}

        <button
          type="submit"
          disabled={loading || !(method === "email" ? email.trim() : phone.trim()) || code.length !== 6}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#418b7c] text-sm font-normal text-white transition-colors enabled:hover:bg-[#36796c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-noma-brand disabled:cursor-not-allowed disabled:bg-noma-send-disabled disabled:text-noma-send-disabled-text"
        >
          {loadingMethod === "otp" && <Loader2 aria-hidden="true" className="h-[18px] w-[18px] animate-spin" />}
          登录
        </button>
      </form>

      <div className="mb-4 mt-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#e5e9ed]" />
        <span className="shrink-0 text-xs leading-5 text-[#84909f]">或使用其他方式登录</span>
        <div className="h-px flex-1 bg-[#e5e9ed]" />
      </div>

      <button type="button" onClick={handleGoogleLogin} disabled={loading}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[#d9dfe5] text-sm font-normal text-[#14212b] transition-colors hover:bg-[#f8faf9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-noma-brand disabled:cursor-not-allowed disabled:opacity-60">
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.36Z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z" />
          <path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.35-2.59Z" />
          <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.35 2.59C7.19 7.72 9.4 5.96 12 5.96Z" />
        </svg>
        使用 Google 登录
      </button>

      <p className="mt-5 text-center text-xs leading-5 text-[#8b95a4]">
        登录即表示您同意我们的{" "}
        <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#278575] hover:underline">服务条款</Link>
        {" "}和{" "}
        <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#278575] hover:underline">隐私政策</Link>
      </p>
    </div>
  );

  return (
    <main className="scrollbar-hidden relative flex h-full flex-col items-center overflow-y-auto bg-white px-6 py-8 sm:px-8">
      {form}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-white">
          <Loader2 aria-label="正在加载登录页面" className="h-6 w-6 animate-spin text-noma-brand" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
