"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoginEnteringScreen } from "@/components/login/LoginEnteringScreen";
import { getClerk } from "@/lib/clerk";

let callback: Promise<unknown> | null = null;

export default function GoogleCallbackPage() {
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        callback ??= getClerk().then((clerk) =>
          clerk.handleRedirectCallback({
            signInForceRedirectUrl: "/login/complete",
            signUpForceRedirectUrl: "/login/complete",
          }),
        );
        await callback;
      } catch {
        callback = null;
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!error) {
    return <LoginEnteringScreen activeStep={1} />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-white px-4">
      <p role="alert" className="text-sm text-red-600">
        Google 登录未完成，请重试或使用邮箱验证码登录。
      </p>
      <Link href="/login" className="text-brand-600 underline">
        返回登录
      </Link>
    </div>
  );
}
