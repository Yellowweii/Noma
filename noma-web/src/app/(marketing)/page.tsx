import { getLandingUser } from "@/lib/server/landingSession";
import { publicPageMetadata } from "@/lib/seo";
import LandingPage from "./LandingPage";

export const metadata = publicPageMetadata(
  "Noma - 让家越来越懂你 | AI 智能家居助手",
  "Noma 是一款具备长期记忆能力的 AI 智能家居助手。通过连接 Home Assistant，逐渐了解你的生活习惯，让你能够使用自然语言轻松控制智能家居。",
  "/",
);

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getLandingUser();
  return <LandingPage user={user} />;
}
