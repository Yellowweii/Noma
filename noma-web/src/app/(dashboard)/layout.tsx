import { cookies } from "next/headers";
import { DashboardContent } from "./DashboardContent";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  // Visitors without a session can render the guest shell immediately.
  const initiallyGuest = !cookieStore.get("noma_local_session")?.value;
  return <DashboardContent initiallyGuest={initiallyGuest}>{children}</DashboardContent>;
}
