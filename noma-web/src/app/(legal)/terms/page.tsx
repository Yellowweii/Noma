import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { userAgreement } from "@/content/user-agreement";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata(
  "Noma 用户协议",
  "阅读 Noma 用户协议，了解 AI 对话、长期记忆和 Home Assistant 智能家居连接服务的使用规则、账户责任与服务约定。",
  "/terms",
);

export default function UserAgreementPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:px-12 sm:py-16">
      <article className="text-base leading-8 text-neutral-700">
        <ReactMarkdown components={{
          h1: ({ children }) => <h1 className="mb-6 text-3xl font-semibold leading-tight text-neutral-900">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-4 mt-10 text-lg font-semibold text-neutral-900">{children}</h2>,
          p: ({ children }) => <p className="my-4">{children}</p>,
          ul: ({ children }) => <ul className="my-4 list-disc space-y-1 pl-5">{children}</ul>,
          strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
          a: ({ href, children }) => <Link href={href ?? "/privacy"} className="rounded underline underline-offset-4 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-700">{children}</Link>,
        }}>{userAgreement}</ReactMarkdown>
      </article>
    </div>
  );
}
