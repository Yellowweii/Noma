import { redirect } from "next/navigation";

export default function NomaSettingsRedirectPage() {
  redirect("/settings/ha");
}
