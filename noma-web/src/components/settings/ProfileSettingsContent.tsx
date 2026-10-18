"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { SettingsContentLayout } from "@/components/settings/SettingsContentLayout";
import {
  getUserDisplayName,
  preloadUserAvatar,
  UserAvatar,
} from "@/components/layout/UserAvatar";
import {
  FloatingTip,
  type FloatingTipVariant,
} from "@/components/ui/FloatingTip";
import { useUser } from "@/contexts/UserContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import styles from "./settings-responsive.module.css";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const inputClassName =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-noma-placeholder";

const readonlyInputClassName =
  "w-full rounded-lg border border-slate-200 bg-noma-soft px-3 py-2.5 text-sm text-noma-primary outline-none cursor-default";

const labelClassName = "w-12 shrink-0 text-sm font-medium text-slate-700";
const fieldClassName = "min-w-0 w-full max-w-md";

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ProfileSettingsContent() {
  const { user, loading, refreshUser } = useUser();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [autofillLocked, setAutofillLocked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  const [tip, setTip] = useState<{
    message: string;
    variant: FloatingTipVariant;
    description?: string;
  } | null>(null);

  const name =
    nameOverride ?? (user ? getUserDisplayName(user.name) : "");
  const isPhoneUser = Boolean(user?.phone);
  const hasChanges = !!user && (
    name.trim() !== getUserDisplayName(user.name).trim() ||
    (avatarOverride != null && avatarOverride !== (user.avatar_url?.trim() ?? ""))
  );

  function showTip(
    message: string,
    variant: FloatingTipVariant = "info",
    description?: string,
  ) {
    setTip({ message, variant, description });
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showTip("请选择图片文件");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      showTip("图片不能超过 2MB");
      return;
    }

    try {
      const avatarUrl = await readFileAsDataURL(file);
      setAvatarOverride(avatarUrl);
    } catch {
      showTip("读取图片失败，请重试", "error");
    }
  }

  async function handleSave() {
    if (!user || savingRef.current || !hasChanges) return;

    const nextName = name.trim();
    if (!nextName) {
      showTip("昵称不能为空");
      return;
    }

    const nameChanged = nextName !== user.name.trim();
    const currentAvatar = user.avatar_url?.trim() ?? "";
    const avatarChanged =
      avatarOverride != null && avatarOverride !== currentAvatar;

    if (!nameChanged && !avatarChanged) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const payload: { name?: string; avatar_url?: string } = {};
      if (nameChanged) payload.name = nextName;
      if (avatarChanged) payload.avatar_url = avatarOverride!;

      const updated = await api.updateMe(payload);
      if (updated.avatar_url) {
        preloadUserAvatar(updated.avatar_url);
      }
      setNameOverride(null);
      setAvatarOverride(null);
      await refreshUser();
      showTip("保存成功", "success", "个人资料已更新");
    } catch {
      showTip("保存失败，请重试", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!user && !loading) {
    return (
      <SettingsContentLayout title="个人资料">
        <p className="text-sm text-red-600">无法加载用户信息，请刷新后重试。</p>
      </SettingsContentLayout>
    );
  }

  return (
    <>
      <SettingsContentLayout title="个人资料">
        <div className="space-y-8">
          <div className={cn(styles.profileRow, "flex items-center gap-12")}>
            <span className={labelClassName}>头像</span>
            <div className="relative inline-flex">
              {user ? (
                <UserAvatar
                  name={name}
                  email={user.email}
                  avatarUrl={avatarOverride ?? user.avatar_url}
                  size="xl"
                />
              ) : (
                <div className="size-24 animate-pulse rounded-full bg-noma-soft" />
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleAvatarChange(e)}
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={!user}
                aria-label="更换头像"
                title="更换头像"
                className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full border-2 border-white bg-white text-noma-primary shadow-[0_1px_4px_rgba(0,0,0,0.12)] transition-colors hover:bg-noma-soft disabled:opacity-50"
              >
                <Camera className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <form
            className="space-y-8"
            autoComplete="off"
            onSubmit={(event) => event.preventDefault()}
          >
          <div className={cn(styles.profileRow, "flex items-center gap-12")}>
            <label htmlFor="noma-profile-nickname" className={labelClassName}>
              昵称
            </label>
            <input
              id="noma-profile-nickname"
              name="noma_profile_nickname"
              type="text"
              value={name}
              readOnly={autofillLocked}
              onFocus={() => setAutofillLocked(false)}
              onChange={(e) => setNameOverride(e.target.value)}
              disabled={!user}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className={cn(inputClassName, fieldClassName)}
            />
          </div>

          <div className={cn(styles.profileRow, "flex items-start gap-12")}>
            <label htmlFor="profile-login-identity" className={cn(labelClassName, "pt-2.5")}>
              {isPhoneUser ? "手机号" : "邮箱"}
            </label>
            <div className={fieldClassName}>
              <input
                id="profile-login-identity"
                type={isPhoneUser ? "tel" : "email"}
                value={isPhoneUser ? user?.phone ?? "" : user?.email ?? ""}
                readOnly
                aria-readonly="true"
                className={readonlyInputClassName}
              />
            </div>
          </div>
          <div className="flex w-full max-w-[34rem] justify-end">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!user || !hasChanges || saving}
              className="inline-flex min-w-[120px] items-center justify-center rounded-full bg-noma-action px-8 py-3 text-sm font-medium text-white transition-colors enabled:hover:bg-noma-action-hover disabled:cursor-not-allowed disabled:bg-noma-send-disabled disabled:text-noma-tertiary"
            >
              保存更改
            </button>
          </div>
          </form>
        </div>
      </SettingsContentLayout>

      <FloatingTip
        open={tip != null}
        message={tip?.message ?? ""}
        description={tip?.description}
        variant={tip?.variant}
        onClose={() => setTip(null)}
      />
    </>
  );
}
