import { SettingsContentLayout } from "@/components/settings/SettingsContentLayout";
import { NomaLogo } from "@/components/NomaLogo";
import { FeedbackButton } from "@/components/settings/FeedbackButton";
import Link from "next/link";
import { ArrowRight, FileText, Github, MessageCircle, Shield } from "lucide-react";

const resources = [
  {
    title: "GitHub",
    icon: Github,
    href: "https://github.com/Yellowweii/Noma",
  },
  {
    title: "隐私政策",
    icon: Shield,
    href: "/privacy",
  },
  {
    title: "用户协议",
    icon: FileText,
    href: "/terms",
  },
  {
    title: "用户反馈",
    icon: MessageCircle,
    href: null,
  },
];

export default function AboutSettingsPage() {
  return (
    <SettingsContentLayout
      className="w-full max-w-2xl"
      title="关于 Noma"
      description="让 AI，更懂你的家"
    >
      <section aria-label="Noma 产品介绍" className="-mt-2">
        <NomaLogo className="mx-auto size-20" />
        <h3 className="mt-4 text-center text-3xl font-semibold tracking-tight text-noma-primary">Noma</h3>
        <p className="mt-7 px-3 text-sm leading-7 text-noma-secondary">
          Noma 是一个懂你的家庭 AI Agent<br className="hidden sm:block" />
          通过长期记忆与智能家居，让家更智能、更舒适
        </p>
      </section>

      <nav aria-label="关于 Noma 的相关资源" className="mt-8">
        <ul className="space-y-1">
          {resources.map(({ title, icon: Icon, href }) => {
            const content = (
              <>
                <Icon className="size-7 shrink-0 text-noma-primary" strokeWidth={1.75} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-noma-primary">{title}</span>
                </div>
                <ArrowRight className="size-5 shrink-0 text-gray-400" aria-hidden="true" />
              </>
            );
            return (
              <li key={title} className="py-1">
                {href ? (
                  <Link href={href} target="_blank" rel="noopener noreferrer" aria-label={`${title}（在新标签页打开）`}
                    className="flex items-center gap-6 rounded-lg px-3 py-3 transition-colors hover:bg-noma-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-noma-brand">
                    {content}
                  </Link>
                ) : (
                  <FeedbackButton>{content}</FeedbackButton>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

    </SettingsContentLayout>
  );
}
