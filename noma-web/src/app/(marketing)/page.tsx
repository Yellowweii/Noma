import { redirect } from "next/navigation";
import { AGENT_PATH } from "@/lib/chatRoutes";

export const dynamic = "force-dynamic";

export default function Page() {
  redirect(AGENT_PATH);
}
