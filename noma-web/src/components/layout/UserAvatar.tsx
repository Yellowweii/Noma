"use client";

import { useEffect, useState } from "react";

import { DefaultUserAvatar } from "@/components/DefaultUserAvatar";
import { cn } from "@/lib/utils";

export const DEFAULT_USER_DISPLAY_NAME = "Noma 用户";

const loadedAvatarUrls = new Set<string>();

/** 侧边栏加载用户信息后预拉头像，避免菜单内二次挂载闪烁 */
export function preloadUserAvatar(avatarUrl?: string) {
  const normalizedUrl = avatarUrl?.trim() ?? "";
  if (!normalizedUrl || loadedAvatarUrls.has(normalizedUrl)) return;

  const img = new window.Image();
  img.referrerPolicy = "no-referrer";
  img.onload = () => {
    loadedAvatarUrls.add(normalizedUrl);
  };
  img.src = normalizedUrl;
}

/** 有 Google 名称时显示名称，否则显示默认占位名 */
export function getUserDisplayName(name: string) {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  return DEFAULT_USER_DISPLAY_NAME;
}

interface UserAvatarProps {
  name: string;
  email: string;
  avatarUrl?: string;
  size?: "sm" | "sidebar" | "md" | "lg" | "xl";
  className?: string;
  eager?: boolean;
}

export function UserAvatar({
  name,
  email,
  avatarUrl,
  size = "md",
  className,
  eager = false,
}: UserAvatarProps) {
  const normalizedUrl = avatarUrl?.trim() ?? "";
  const [imageError, setImageError] = useState(false);
  const [loaded, setLoaded] = useState(
    () => !!normalizedUrl && (eager || loadedAvatarUrls.has(normalizedUrl)),
  );
  const sizeClass =
    size === "sm"
      ? "size-8"
      : size === "sidebar"
        ? "size-9"
        : size === "lg"
          ? "size-20"
          : size === "xl"
            ? "size-24"
            : "size-10";
  const alt = getUserDisplayName(name);
  const useDefault = !normalizedUrl || imageError;
  void email;

  useEffect(() => {
    setImageError(false);
    if (!normalizedUrl) {
      setLoaded(false);
      return;
    }

    if (eager || loadedAvatarUrls.has(normalizedUrl)) {
      setLoaded(true);
      return;
    }

    setLoaded(false);
    let cancelled = false;
    const img = new window.Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      if (cancelled) return;
      loadedAvatarUrls.add(normalizedUrl);
      setLoaded(true);
    };
    img.onerror = () => {
      if (cancelled) return;
      setImageError(true);
    };
    img.src = normalizedUrl;

    return () => {
      cancelled = true;
    };
  }, [normalizedUrl, eager]);

  if (useDefault || !loaded) {
    return (
      <DefaultUserAvatar
        title={alt}
        className={cn("rounded-full", sizeClass, className)}
      />
    );
  }

  return (
    <span className={cn("relative inline-block shrink-0", sizeClass, className)}>
      {/* Match the visible ellipse and surrounding space in DefaultUserAvatar's 1254×1254 viewBox. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={normalizedUrl}
        alt={alt}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => loadedAvatarUrls.add(normalizedUrl)}
        onError={() => setImageError(true)}
        className="absolute rounded-full object-cover"
        style={{ left: `${125 / 1254 * 100}%`, top: `${136 / 1254 * 100}%`, width: `${1004 / 1254 * 100}%`, height: `${1014 / 1254 * 100}%` }}
      />
    </span>
  );
}
