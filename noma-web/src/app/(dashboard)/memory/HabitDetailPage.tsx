"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Info, MoreHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/layout/ScrollArea";
import {
  buildHabitFormationSteps,
  habitDetailBack,
  HabitFormationTimeline,
  LoadError,
  MemoryLoading,
  SectionAction,
  type HabitDetailFrom,
  useMemoryData,
} from "./memory-shared";
import styles from "./memory.module.css";

function parseHabitDetailFrom(value: string | null): HabitDetailFrom | null {
  if (value === "memory" || value === "habits") {
    return value;
  }
  return null;
}

export default function HabitDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const habitId = typeof params.id === "string" ? params.id : "";
  const back = habitDetailBack(parseHabitDetailFrom(searchParams.get("from")));
  const data = useMemoryData();
  const habit = data.sortedHomeItems.find((item) => item.id === habitId);
  const formationSteps = habit ? buildHabitFormationSteps(habit) : [];
  const isPreference = (habit?.formation?.mode ?? habit?.source) === "explicit_preference";

  if (data.loading) {
    return (
      <ScrollArea className={`h-full ${styles.page}`}>
        <MemoryLoading />
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className={`h-full ${styles.page}`}>
      <div className={`${styles.content} ${styles.habitDetailContent}`}>
        <header className={styles.habitDetailHeader}>
          <div className={styles.habitDetailTopRow}>
            <Link href={back.href} className={styles.backLink}>
              <ArrowLeft size={16} aria-hidden="true" />
              {back.label}
            </Link>
            <button
              type="button"
              className={styles.habitDetailMenu}
              aria-label="更多操作"
              disabled
            >
              <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          {habit ? (
            <>
              <h1>{habit.summary}</h1>
              <p className={styles.habitStatusBadge}>
                <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                {isPreference ? "已记住偏好" : "已形成习惯"}
              </p>
            </>
          ) : (
            <h1>{back.label}</h1>
          )}
        </header>

        {data.errors.home ? (
          <LoadError message={data.errors.home} retry={data.retry} />
        ) : !habit ? (
          <p className={styles.empty} role="status">
            找不到这条家庭习惯，可能已被删除。
            <Link href={back.href} className={styles.habitDetailInlineLink}>
              返回列表
            </Link>
          </p>
        ) : (
          <>
            <section className={styles.habitFormation} aria-labelledby="habit-formation-title">
              <h2 id="habit-formation-title">{isPreference ? "Noma 是怎么了解到的" : "这个习惯是怎么形成的"}</h2>
              {formationSteps.length ? (
                <HabitFormationTimeline steps={formationSteps} timeZone={habit.timezone} />
              ) : (
                <p className={styles.empty}>
                  {habit.formation?.status === "pending" || habit.formation?.status === "processing"
                    ? "Noma 正在整理相关证据，稍后可查看。"
                    : "暂时没有可展示的证据摘要。"}
                </p>
              )}
            </section>

            <footer className={styles.habitDetailNotice}>
              <Info size={18} strokeWidth={1.75} aria-hidden="true" />
              <div>
                <p>
                  {isPreference ? "觉得这个偏好不准确？" : "觉得这个习惯不准确？"}
                  <SectionAction href="/settings/memory">管理相关记忆</SectionAction>
                </p>
                <p className={styles.habitDetailNoticeHint}>
                  你可以前往记忆管理查看和删除相关家庭行为记忆。
                </p>
              </div>
            </footer>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
