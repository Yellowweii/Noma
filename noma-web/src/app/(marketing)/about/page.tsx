import Link from "next/link";
import { NomaLogo } from "@/components/NomaLogo";
import { publicPageMetadata, SITE_URL } from "@/lib/seo";

export const metadata = publicPageMetadata(
  "Noma：具备长期记忆的 Home Assistant AI 助手",
  "了解 Noma AI 智能家居助手的用途、长期记忆、自然语言设备查询与控制、Home Assistant 连接步骤、使用限制及项目来源。官方网站为 noma-ai.cloud。",
  "/about",
);

const sectionClass = "scroll-mt-8 border-t border-neutral-200 py-10 sm:py-12";
const headingClass = "mb-5 text-2xl font-semibold tracking-tight text-neutral-900";
const linkClass = "rounded underline underline-offset-4 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-700";

const capabilities = [
  {
    title: "自然语言对话",
    description: "通过文字与 Noma 交流日常问题和需求。未登录时可以先体验对话；长期记忆、家庭信息和设备控制需要登录后使用。",
  },
  {
    title: "长期记忆与个性化回应",
    description: "启用记忆后，Noma 会从对话中提取有价值的个人信息、偏好和家庭使用习惯，并在后续相关对话中检索使用。你可以在设置中管理、删除保存的记忆，或关闭自动记忆。",
  },
  {
    title: "Home Assistant 设备查询与控制",
    description: "连接并授权 Home Assistant 后，可以用自然语言查询家庭和设备状态，或请求打开、关闭及调整支持的设备。可执行的操作取决于设备接入情况、设备能力和控制权限。",
  },
  {
    title: "家庭状态与设备管理",
    description: "在「家」页面查看已连接家庭的设备及可用状态，并操作支持的设备；温湿度等环境信息需要 Home Assistant 中存在对应的数据来源。",
  },
];

const steps = [
  {
    title: "先体验对话，再登录使用完整功能",
    content: <>打开 <Link href="/agent" className={linkClass}>Noma 对话页</Link>即可先体验。登录后，可以使用长期记忆、家庭连接和设备控制功能。</>,
  },
  {
    title: "准备 Home Assistant 和智能设备",
    content: "在家中的设备上运行 Home Assistant，并先确认你希望控制的设备已经接入、在线且可正常操作。已有 Home Assistant 的用户可以跳过安装步骤。",
  },
  {
    title: "在 Noma 中建立连接并授权",
    content: <>打开<Link href="/settings/ha" className={linkClass}>「设置 → Home Assistant」</Link>，按照「安装 Home Assistant → 建立连接 → 授权 Home Assistant → 连接完成」向导操作。在对应的 Docker 环境中运行页面生成的连接命令，检测连通后，再创建并填写 Home Assistant 长期访问令牌完成授权。具体命令以当前账号页面生成的内容为准。</>,
  },
  {
    title: "核对设备，再发出自然语言请求",
    content: <>在<Link href="/home" className={linkClass}>「家」页面</Link>确认设备名称和状态，再回到对话页提出具体请求。查看工具执行结果，并核对设备实际状态；未连接设备时仍可使用普通 AI 对话。</>,
  },
];

export default function ProductAboutPage() {
  return (
    <div className="h-full overflow-y-auto bg-[#fafbf9] text-neutral-700 selection:bg-emerald-100">
      <header className="border-b border-neutral-200 bg-white">
        <nav aria-label="产品说明导航" className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-10">
          <Link href="/" aria-label="Noma 首页" className="flex min-h-11 items-center gap-2 rounded text-lg font-semibold text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
            <NomaLogo className="size-8" /> Noma
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/" className="py-3 hover:underline">返回首页</Link>
            <Link href="/agent" className="rounded-full bg-[#315f55] px-5 py-3 font-medium text-white hover:bg-[#274e45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#315f55]">开始体验</Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl break-words px-6 pb-10 pt-12 text-base leading-8 sm:px-10 sm:pt-16">
        <article>
          <header className="pb-10 sm:pb-12">
            <p className="mb-4 text-sm font-medium tracking-wide text-[#315f55]">Noma · 产品说明</p>
            <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-snug tracking-tight text-neutral-900 sm:text-4xl">Noma：具备长期记忆的 Home Assistant AI 助手</h1>
            <p className="mt-6 text-lg leading-9">
              本页介绍的 Noma，官方网站为 <a href={SITE_URL} className={linkClass}>https://noma-ai.cloud</a>，是一款具备长期记忆能力的 AI 智能家居助手。目前通过 Home Assistant 连接设备，支持使用自然语言查询和控制智能家居。
            </p>
            <p className="mt-4">Noma 希望在了解你的偏好和生活习惯的基础上，让家庭的智能家居更好地为你服务。本文中的 Noma 均指上述官网所提供的产品。</p>
            <dl className="mt-7 grid gap-5 rounded-2xl border border-neutral-200 bg-white p-5 text-sm leading-7 sm:grid-cols-2 sm:p-6">
              <div><dt className="font-medium text-neutral-900">产品类型</dt><dd>AI 智能家居助手 / 家庭 AI Agent</dd></div>
              <div><dt className="font-medium text-neutral-900">核心能力</dt><dd>长期记忆、自然语言对话与设备控制</dd></div>
              <div><dt className="font-medium text-neutral-900">当前设备接入方式</dt><dd>Home Assistant</dd></div>
              <div><dt className="font-medium text-neutral-900">适合谁</dt><dd>希望用自然语言控制设备，并获得个性化回应的个人与家庭用户</dd></div>
            </dl>
            <nav aria-label="本页目录" className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#315f55]">
              <a href="#features" className={linkClass}>当前功能</a>
              <a href="#getting-started" className={linkClass}>如何使用</a>
              <a href="#example" className={linkClass}>验证示例</a>
              <a href="#limits" className={linkClass}>使用限制</a>
              <a href="#sources" className={linkClass}>项目来源</a>
            </nav>
          </header>

          <section id="features" aria-labelledby="features-title" className={sectionClass}>
            <h2 id="features-title" className={headingClass}>Noma 目前支持哪些功能？</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {capabilities.map(({ title, description }) => (
                <div key={title}>
                  <h3 className="mb-2 text-lg font-semibold text-neutral-900">{title}</h3>
                  <p>{description}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="getting-started" aria-labelledby="getting-started-title" className={sectionClass}>
            <h2 id="getting-started-title" className={headingClass}>如何开始使用 Noma？</h2>
            <ol className="list-decimal space-y-6 pl-6 marker:font-semibold marker:text-[#315f55]">
              {steps.map(({ title, content }) => (
                <li key={title} className="pl-2"><h3 className="font-semibold text-neutral-900">{title}</h3><p className="mt-1">{content}</p></li>
              ))}
            </ol>
          </section>

          <section id="example" aria-labelledby="example-title" className={sectionClass}>
            <h2 id="example-title" className={headingClass}>可复现验证示例：控制一盏灯</h2>
            <p className="mb-5 rounded-xl border border-neutral-200 bg-white p-4 text-sm leading-7">示例性质：模拟环境的验证流程，不是真实家庭使用案例或用户评价。实际设备效果需要在你自己的已授权家庭中核对。</p>
            <ol className="list-decimal space-y-3 pl-6">
              <li>准备已接入 Home Assistant、支持开关控制且当前账号有权限的测试设备，例如命名为「客厅氛围灯」的灯或虚拟开关。</li>
              <li>连接并授权 Noma 后，先确认「家」页面能显示该设备；在对话中输入「关闭客厅氛围灯」。</li>
              <li>核对本次工具执行结果，再到 Home Assistant 或设备端确认设备状态是否变为关闭。如果执行失败，应以失败信息和设备状态为准。</li>
            </ol>
            <p className="mt-5">项目中的模拟服务测试覆盖了设备控制成功和失败的结果传递。它验证软件处理流程，不代表已验证所有设备品牌、网络环境或某个真实家庭。</p>
          </section>

          <section id="limits" aria-labelledby="limits-title" className={sectionClass}>
            <h2 id="limits-title" className={headingClass}>使用条件、限制与未来规划</h2>
            <ul className="list-disc space-y-3 pl-6">
              <li>设备控制目前依赖 Home Assistant、已建立的连接、设备在线状态和控制权限。不同设备支持的操作不同，不能保证所有品牌或型号均兼容。</li>
              <li>体验模式不读取或保存长期记忆，也不能查看家庭状态或控制设备；这些能力需要登录和相应配置。</li>
              <li>长期记忆需要启用记忆功能，且并非每句话都会保存。AI 理解和执行可能出错，请核对保存的信息、工具结果与实际设备状态。</li>
              <li>Noma 当前提供免费对话额度，具体可用额度以产品内提示为准；不能据此理解为无限使用或永久免费的承诺。</li>
              <li>语音唤醒、无需 Home Assistant 的品牌设备直连，以及感知场景后主动发起的家居服务，是官网展示的未来方向，不应视为当前已提供的通用能力。</li>
            </ul>
            <p className="mt-5">对话、记忆和设备信息的处理方式，以及数据管理与删除权利，见 <Link href="/privacy" className={linkClass}>隐私政策</Link>；使用规则见 <Link href="/terms" className={linkClass}>用户协议</Link>。</p>
          </section>

          <section id="sources" aria-labelledby="sources-title" className={sectionClass}>
            <h2 id="sources-title" className={headingClass}>官方网站与项目来源</h2>
            <p>产品名称为 Noma。官方网站是 <a href={SITE_URL} className={linkClass}>noma-ai.cloud</a>，本页是该网站发布的公开产品说明。</p>
            <p className="mt-3">项目代码托管于 <a href="https://github.com/Yellowweii/Noma" className={linkClass}>GitHub：Yellowweii/Noma</a>。仓库当前为私有，查看需要访问权限；公开的产品功能与使用条件可直接阅读本页。</p>
            <p className="mt-6"><Link href="/agent" className={linkClass}>开始体验 Noma</Link><span className="mx-3 text-neutral-300" aria-hidden="true">/</span><Link href="/" className={linkClass}>返回官网首页</Link></p>
          </section>
        </article>
      </main>
    </div>
  );
}
