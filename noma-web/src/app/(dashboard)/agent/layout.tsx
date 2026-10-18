import { cookies } from "next/headers";
import { AgentChatPage } from "@/components/chat/AgentChatPage";
import {
  isNewChatIntentValue,
  NEW_CHAT_INTENT_COOKIE,
} from "@/lib/activeSessionStorage";

export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const ssrNewChatIntent = isNewChatIntentValue(
    cookieStore.get(NEW_CHAT_INTENT_COOKIE)?.value,
  );

  return (
    <div className="relative h-full min-h-0">
      <AgentChatPage ssrNewChatIntent={ssrNewChatIntent} />
      <div className="hidden" aria-hidden>
        {children}
      </div>
    </div>
  );
}
