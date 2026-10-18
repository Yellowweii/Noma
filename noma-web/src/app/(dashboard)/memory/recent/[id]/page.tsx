import { Suspense } from "react";
import { ScrollArea } from "@/components/layout/ScrollArea";
import RecentUnderstandingDetailPage from "../../RecentUnderstandingDetailPage";
import { MemoryLoading } from "../../memory-shared";
import styles from "../../memory.module.css";

export default function RecentUnderstandingDetailRoute() {
  return <Suspense fallback={<ScrollArea className={`h-full ${styles.page}`}><MemoryLoading /></ScrollArea>}>
    <RecentUnderstandingDetailPage />
  </Suspense>;
}
