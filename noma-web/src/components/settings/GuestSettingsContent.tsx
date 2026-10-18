"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { SettingsContentLayout } from "@/components/settings/SettingsContentLayout";
import styles from "./settings-responsive.module.css";

type GuestSettingsFeature = "ha" | "memory" | "profile";

const copy = {
  ha: {
    title: "Home Assistant",
    description: "连接后，你可以查看家庭状态、控制智能设备，让 Noma 更好地为你服务",
    cardTitle: "登录后使用 Home Assistant",
    cardDescription: "连接你的 Home Assistant，查看家庭状态、控制智能设备，让 Noma 逐渐了解你的家庭习惯",
  },
  memory: {
    title: "记忆",
    description: "管理 Noma 记住的关于你的信息，让每一次交流都更懂你",
    cardTitle: "登录后查看你的记忆",
    cardDescription: "Noma 会在对话中记住你的兴趣、习惯和重要信息，逐渐了解你，提供更个性化的回应",
  },
  profile: {
    title: "个人资料",
    description: "管理你的个人资料和账号信息。",
    cardTitle: "登录后管理个人资料",
    cardDescription: "登录后，你可以设置昵称和头像，查看账号信息。",
  },
} as const;

const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-full px-6 py-2 text-sm font-medium leading-6 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-noma-brand";

export function GuestSettingsContent({ feature }: { feature: GuestSettingsFeature }) {
  const pathname = usePathname();
  const content = copy[feature];

  return (
    <SettingsContentLayout
      title={content.title}
      description={content.description}
      className="w-full max-w-5xl"
    >
      <section className={`${styles.guestCard} relative flex items-center gap-8 overflow-hidden rounded-xl bg-[#f7f8f7] px-6 py-8`}>
        <div className={`${styles.guestIntro} relative z-10 flex min-w-0 flex-1 items-start gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-noma-brand-surface text-noma-brand">
            <LockKeyhole className="size-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-6 text-noma-primary">{content.cardTitle}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-noma-secondary">{content.cardDescription}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={`/login?next=${encodeURIComponent(pathname)}`}
                className={`${buttonClass} bg-noma-brand text-white hover:bg-noma-brand-hover`}
              >
                登录 Noma
              </Link>
              {feature === "ha" && (
                <a
                  href="https://www.home-assistant.io/getting-started/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${buttonClass} border border-noma-border bg-white text-noma-primary hover:bg-noma-soft`}
                >
                  查看接入教程
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    </SettingsContentLayout>
  );
}
