import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardContent } from "./DashboardContent";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  if (!cookieStore.get("noma_local_session")?.value) redirect("/login");
  return <DashboardContent>{children}</DashboardContent>;
}
