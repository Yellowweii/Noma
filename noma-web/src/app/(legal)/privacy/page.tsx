import ReactMarkdown from "react-markdown";
import { privacyPolicy } from "@/content/privacy-policy";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata(
  "Noma 隐私政策",
  "了解 Noma 如何收集、使用和保护账户、对话、长期记忆与智能家居数据，以及你对个人数据拥有的管理和删除权利。",
  "/privacy",
);

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:px-12 sm:py-16">
      <article className="text-base leading-8 text-neutral-700">
        <ReactMarkdown components={{
          h1: ({ children }) => <h1 className="mb-6 text-3xl font-semibold leading-tight text-neutral-900">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-4 mt-10 text-lg font-semibold text-neutral-900">{children}</h2>,
          p: ({ children }) => <p className="my-4">{children}</p>,
          ul: ({ children }) => <ul className="my-4 list-disc space-y-1 pl-5">{children}</ul>,
          strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
        }}>{privacyPolicy}</ReactMarkdown>
      </article>
    </div>
  );
}
