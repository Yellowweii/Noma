"use client";

import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@/components/layout/ScrollArea";
import {
  HabitList,
  LoadError,
  MemoryLoading,
  RecentUnderstandingList,
  SectionAction,
  useMemoryData,
} from "./memory-shared";
import styles from "./memory.module.css";

export default function MemoryPage() {
  const data = useMemoryData();
  return (
    <ScrollArea className={`h-full ${styles.page} ${styles.overview}`}>
      <h1 className="sr-only">记忆</h1>
      {data.loading ? (
        <MemoryLoading />
      ) : (
        <div className={styles.content}>
          <section className={`${styles.section} ${styles.boundedSection}`} aria-labelledby="profile-title">
            <div className={styles.sectionHeading}>
              <h2 id="profile-title">Noma 眼中的你</h2>
              {data.profileSummary && (
                <SectionAction href="/memory/profile">查看完整画像</SectionAction>
              )}
            </div>
            <div className={`${styles.sectionBody} ${styles.profilePreview}`}>
              {data.errors.profile ? (
                <LoadError message={data.errors.profile} retry={data.retry} />
              ) : data.profileSummary ? (
                <div className={styles.profileSummary}><ReactMarkdown>{data.profileSummary}</ReactMarkdown></div>
              ) : (
                <p className={styles.empty}>
                  Noma 还在慢慢了解你。随着对话积累，你的画像会逐渐清晰。
                </p>
              )}
            </div>
          </section>
          <section
            className={`${styles.section} ${styles.recentSection} ${styles.boundedSection}`}
            aria-labelledby="recent-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="recent-title">最近对你的了解</h2>
              {(data.recentTopics.length > 0 || data.recentHistory.length > 0) && (
                <SectionAction href="/memory/recent">
                  查看最近 30 天
                </SectionAction>
              )}
            </div>
            <div className={styles.sectionBody}>
              {data.errors.recent ? (
                <LoadError message={data.errors.recent} retry={data.retry} />
              ) : data.recentTopics.length ? (
                <RecentUnderstandingList topics={data.recentTopics.slice(0, 4)} from="memory" />
              ) : (
                <p className={styles.empty}>
                  最近还没有形成新的了解，和 Noma 多聊聊，它会逐渐记住对你重要的事
                </p>
              )}
            </div>
          </section>
          <section
            className={`${styles.section} ${styles.homeSection}`}
            aria-labelledby="home-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="home-title">Noma 记住的家庭习惯</h2>
              {data.sortedHomeItems.length > 3 && (
                <SectionAction href="/memory/habits">
                  查看全部家庭习惯
                </SectionAction>
              )}
            </div>
            <div className={styles.sectionBody}>
              {data.errors.home ? (
                <LoadError message={data.errors.home} retry={data.retry} />
              ) : data.sortedHomeItems.length ? (
                <HabitList items={data.sortedHomeItems.slice(0, 3)} from="memory" />
              ) : (
                <p className={styles.empty}>
                  还没有形成稳定的家庭习惯，随着你使用 Noma 控制家中的设备，这里会逐渐出现
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </ScrollArea>
  );
}
