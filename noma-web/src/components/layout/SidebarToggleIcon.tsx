import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <PanelLeft className={cn("size-5 shrink-0", className)} strokeWidth={1.75} />
  );
}
