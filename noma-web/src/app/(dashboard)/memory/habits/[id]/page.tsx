import { Suspense } from "react";
import { ScrollArea } from "@/components/layout/ScrollArea";
import HabitDetailPage from "../../HabitDetailPage";
import { MemoryLoading } from "../../memory-shared";
import styles from "../../memory.module.css";

function HabitDetailFallback() {
  return (
    <ScrollArea className={`h-full ${styles.page}`}>
      <MemoryLoading />
    </ScrollArea>
  );
}

export default function HabitDetailRoute() {
  return (
    <Suspense fallback={<HabitDetailFallback />}>
      <HabitDetailPage />
    </Suspense>
  );
}
