"use client";

import { useEffect, useSyncExternalStore, type CSSProperties, type SetStateAction } from "react";
import Link from "next/link";
import {
  ArrowRight,
  House,
  Lightbulb,
  Loader2,
  Monitor,
  Snowflake,
} from "lucide-react";
import { api } from "@/lib/api";
import { bootstrapSession, getUserId } from "@/lib/auth";
import type {
  HomeBehaviorMemoryItem,
  MemoryOSItem,
  MemoryOverview,
  MemoryTopic,
  RecentUnderstandingTopic,
} from "@/types";
import styles from "./memory.module.css";

const PROFILE_FIELDS = [
  ["identity", "身份与背景"],
  ["preferences", "偏好与习惯"],
  ["goals", "长期目标"],
  ["values", "看重的事"],
  ["lessons", "经验与感悟"],
] as const;

export function timestamp(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function formatDate(value: string, now = new Date()) {
  if (!timestamp(value)) return "日期未记录";
  const date = new Date(value);
  const dateFormat = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  });
  const calendarDay = (date: Date) => {
    const parts = dateFormat.formatToParts(date);
    const partValue = (type: "year" | "month" | "day") =>
      Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(partValue("year"), partValue("month") - 1, partValue("day")) / 86400000;
  };
  const daysAgo = calendarDay(now) - calendarDay(date);
  if (daysAgo === 0) return "今天";
  if (daysAgo === 1) return "昨天";
  if (daysAgo === 2) return "前天";
  return dateFormat.format(date);
}

export function formatProfileUpdate(value?: string, now = new Date()) {
  if (!value) return null;
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return null;

  const dateFormat = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai",
  });
  const calendarDay = (date: Date) => {
    const parts = dateFormat.formatToParts(date);
    const partValue = (type: "year" | "month" | "day") =>
      Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(partValue("year"), partValue("month") - 1, partValue("day")) / 86400000;
  };
  const daysAgo = calendarDay(now) - calendarDay(updatedAt);
  if (daysAgo === 0) return "今天更新";
  if (daysAgo === 1) return "昨天更新";
  if (daysAgo === 2) return "前天更新";
  if (daysAgo >= 3 && daysAgo <= 7) return "三天前更新";
  return `${dateFormat.format(updatedAt)}更新`;
}

function formatTime(value: string) {
  if (!timestamp(value)) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function formatHabitEvidenceLabel(
  value: string, endTime?: string, timeZone = "Asia/Shanghai", now = new Date(),
) {
  const { date, time } = habitEvidenceLabelParts(value, endTime, timeZone, now);
  return time ? `${date} ${time}` : date;
}

function habitEvidenceLabelParts(
  value: string, endTime?: string, timeZone = "Asia/Shanghai", now = new Date(),
): { date: string; time?: string } {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return { date: "时间未记录" };
  const dates = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", timeZone,
  });
  const parts = (date: Date) => {
    const values = dates.formatToParts(date);
    const get = (type: "year" | "month" | "day") =>
      values.find((part) => part.type === type)?.value ?? "";
    return { year: get("year"), month: get("month"), day: get("day") };
  };
  const currentYear = parts(now).year;
  const first = parts(start);
  const lastDate = endTime ? new Date(endTime) : null;
  const end = lastDate && !Number.isNaN(lastDate.getTime()) ? lastDate : null;
  const last = end ? parts(end) : first;
  const showYear = first.year !== currentYear || last.year !== currentYear;
  const dateLabel = (part: ReturnType<typeof parts>) =>
    `${showYear ? `${part.year}年` : ""}${part.month}月${part.day}日`;
  const times = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
  });
  const sameDay = first.year === last.year && first.month === last.month && first.day === last.day;
  if (end && !sameDay) return { date: `${dateLabel(first)} - ${dateLabel(last)}` };
  const startTime = times.format(start);
  const endTimeLabel = end ? times.format(end) : startTime;
  return {
    date: dateLabel(first),
    time: `${startTime}${endTimeLabel !== startTime ? ` - ${endTimeLabel}` : ""}`,
  };
}

export type HabitFormationStep = { time: string; end_time?: string; text: string };

export function buildHabitFormationSteps(
  item: HomeBehaviorMemoryItem,
): HabitFormationStep[] {
  return item.formation?.status === "completed" ? item.formation.nodes ?? [] : [];
}

type MemorySnapshot = {
  recentTopics: RecentUnderstandingTopic[];
  recentHistory: RecentUnderstandingTopic[];
  items: MemoryOSItem[];
  homeItems: HomeBehaviorMemoryItem[];
  topics: MemoryTopic[];
  overview: MemoryOverview | null;
  loading: boolean;
  errors: Record<string, string>;
};

const emptySnapshot: MemorySnapshot = {
  items: [], homeItems: [], topics: [], recentTopics: [], recentHistory: [], overview: null, loading: true, errors: {},
};
// Keep data across route unmounts, scoped to the authenticated user.
const snapshots = new Map<string, MemorySnapshot>();
const pendingLoads = new Map<string, Promise<void>>();
const itemVersions = new Map<string, number>();
const recentVersions = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => snapshots.get(getUserId() ?? "") ?? emptySnapshot;

async function loadMemoryData() {
  if (!(await bootstrapSession())) return;
  const userId = getUserId();
  if (!userId) return;
  const pending = pendingLoads.get(userId);
  if (pending) return pending;
  const itemVersion = itemVersions.get(userId) ?? 0;
  const recentVersion = recentVersions.get(userId) ?? 0;
  const load = (async () => {
    const results = await Promise.allSettled([
      api.listMemoryOSItems(),
      api.getMemoryOverview(),
      api.listHomeHabits(),
      api.listMemoryTopics(),
      api.listRecentUnderstanding(),
      api.listRecentUnderstanding(true),
    ]);
    const [personal, summary, home, graph, recent, recentHistory] = results;
    const previous = snapshots.get(userId) ?? emptySnapshot;
    const errors: Record<string, string> = {};
    results.forEach((result, i) => {
      if (result.status === "rejected")
        errors[["personal", "profile", "home", "topics", "recent", "recentHistory"][i]] =
          "暂时无法加载，请重试。";
    });
    snapshots.set(userId, {
      // A response started before a deletion must not restore the deleted item.
      items: (itemVersions.get(userId) ?? 0) !== itemVersion
        ? previous.items
        : personal.status === "fulfilled" ? (personal.value.items ?? []) : previous.items,
      overview: summary.status === "fulfilled" ? summary.value : previous.overview,
      homeItems: home.status === "fulfilled" ? (home.value.items ?? []) : previous.homeItems,
      topics: graph.status === "fulfilled" ? (graph.value.topics ?? []) : previous.topics,
      recentTopics: (recentVersions.get(userId) ?? 0) !== recentVersion ? previous.recentTopics : recent.status === "fulfilled" ? (recent.value.topics ?? []) : previous.recentTopics,
      recentHistory: (recentVersions.get(userId) ?? 0) !== recentVersion ? previous.recentHistory : recentHistory.status === "fulfilled" ? (recentHistory.value.topics ?? []) : previous.recentHistory,
      loading: false,
      errors,
    });
    notify();
    if ((recent.status === "fulfilled" && recent.value.rebuilding) || (recentHistory.status === "fulfilled" && recentHistory.value.rebuilding)) {
      window.setTimeout(() => { if (getUserId() === userId) void loadMemoryData(); }, 2000);
    }
  })();
  pendingLoads.set(userId, load);
  try {
    await load;
  } finally {
    pendingLoads.delete(userId);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("noma:chat-sources-deleted", () => {
    const userId = getUserId();
    if (!userId) return;
    recentVersions.set(userId, (recentVersions.get(userId) ?? 0) + 1);
    const previous = snapshots.get(userId);
    if (previous) snapshots.set(userId, { ...previous, recentTopics: [], recentHistory: [] });
    notify();
    // Let a pre-deletion request finish before fetching the current source view.
    void (pendingLoads.get(userId) ?? Promise.resolve()).then(() => loadMemoryData());
  });
}

export function useMemoryData() {
  const { items, homeItems, topics, recentTopics, recentHistory, overview, loading, errors } =
    useSyncExternalStore(subscribe, getSnapshot, () => emptySnapshot);

  useEffect(() => {
    // Cached content stays visible while checking for newer memories.
    void loadMemoryData();
  }, []);

  function setItems(update: SetStateAction<MemoryOSItem[]>) {
    const userId = getUserId();
    if (!userId) return;
    const previous = snapshots.get(userId) ?? emptySnapshot;
    const next = typeof update === "function" ? update(previous.items) : update;
    itemVersions.set(userId, (itemVersions.get(userId) ?? 0) + 1);
    snapshots.set(userId, { ...previous, items: next });
    notify();
  }

  const sortedItems = [...items].sort(
    (a, b) => timestamp(b.source_time || b.create_time) - timestamp(a.source_time || a.create_time),
  );
  const sortedHomeItems = [...homeItems].sort(
    (a, b) => timestamp(b.create_time) - timestamp(a.create_time),
  );
  const profileFields = PROFILE_FIELDS.flatMap(([key, label]) => {
    const value = overview?.profile?.[key];
    return typeof value === "string" && value.trim()
      ? [{ key, label, value }]
      : [];
  });
  const profileSummary =
    overview?.profile_summary?.trim() ||
    profileFields.map((field) => field.value).join("；");

  return {
    recentTopics: [...recentTopics].sort((a, b) => timestamp(b.updated_at) - timestamp(a.updated_at)),
    recentHistory: [...recentHistory].sort((a, b) => timestamp(b.updated_at) - timestamp(a.updated_at)),
    sortedItems,
    sortedHomeItems,
    topics,
    profileFields,
    profileSummary,
    profileUpdatedAt: overview?.profile_updated_at,
    loading,
    errors,
    setItems,
    retry: () => { void loadMemoryData(); },
  };
}

export function MemoryLoading() {
  return (
    <div className={styles.loading} role="status">
      <Loader2 className="animate-spin" size={24} />
      <span>正在整理你的记忆…</span>
    </div>
  );
}

export function LoadError({
  message,
  retry,
}: {
  message?: string;
  retry: () => void;
}) {
  return message ? (
    <p className={styles.empty} role="alert">
      {message}{" "}
      <button type="button" className={styles.retry} onClick={retry}>
        重新加载
      </button>
    </p>
  ) : null;
}

export function SectionAction({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={styles.sectionAction}>
      {children}
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}

function HabitIcon({ item }: { item: HomeBehaviorMemoryItem }) {
  const text = `${item.summary} ${item.scene ?? ""}`;
  const Icon = /空调|温度|制冷|暖气/.test(text)
    ? Snowflake
    : /电视|观影|影音/.test(text)
      ? Monitor
      : /灯|照明|亮度/.test(text)
        ? Lightbulb
        : House;
  return <Icon size={20} strokeWidth={1.75} aria-hidden="true" />;
}

function formatTimelineDate(value: string, now: Date) {
  const label = formatDate(value, now);
  return ["今天", "昨天", "前天"].includes(label)
    ? label
    : habitEvidenceLabelParts(value, undefined, "Asia/Shanghai", now).date;
}

type TimelineItem = Pick<MemoryOSItem, "id" | "summary" | "source_time"> & { href?: string };

export function MemoryTimeline({ items }: { items: TimelineItem[] }) {
  const now = new Date();
  const dates = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai",
  });
  const groups = new Map<string, { dateTime?: string; label: string; items: TimelineItem[] }>();
  items.forEach((item) => {
    const sourceTime = item.source_time || "";
    const hasDate = timestamp(sourceTime) !== 0;
    const key = hasDate ? dates.format(new Date(sourceTime)) : `unknown-${item.id}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, {
        dateTime: hasDate ? new Date(sourceTime).toISOString() : undefined,
        label: hasDate ? formatTimelineDate(sourceTime, now) : "日期未记录",
        items: [item],
      });
    }
  });

  return (
    <ol className={styles.timeline}>
      {Array.from(groups, ([key, group]) => (
        <li key={key}>
          <time dateTime={group.dateTime}>{group.label}</time>
          <span className={styles.timelineMarker} aria-hidden="true">
            <span />
          </span>
          <ol className={styles.timelineEntries}>
            {group.items.map((item) => {
              const content = <p>
                  <span className={styles.timelineTime}>{item.source_time ? formatTime(item.source_time) : "对话时间未记录"}</span>
                  {item.summary}
                </p>;
              return <li key={item.id}>
                {item.href ? <Link href={item.href} className={styles.recentEntry}>
                  {content}
                  <ArrowRight className={styles.recentEntryArrow} size={18} aria-hidden="true" />
                </Link> : content}
              </li>;
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

export function RecentUnderstandingList({ topics, from = "recent" }: { topics: RecentUnderstandingTopic[]; from?: "memory" | "recent" }) {
  return <MemoryTimeline items={topics.map((topic) => ({
    id: topic.id,
    summary: topic.summary,
    source_time: topic.updated_at,
    href: `/memory/recent/${encodeURIComponent(topic.id)}?from=${from}`,
  }))} />;
}

export function HabitFormationTimeline({ steps, timeZone }: { steps: HabitFormationStep[]; timeZone?: string }) {
  return (
    <ol className={`${styles.habitFormationTimeline}${steps.length === 1 ? ` ${styles.habitFormationSingle}` : ""}`}>
      {steps.map((step, index) => {
        const label = habitEvidenceLabelParts(step.time, step.end_time, timeZone);
        return (
        <li
          key={`${step.time}-${index}`}
          style={{ "--formation-delay": `${Math.min(index, 8) * 160}ms` } as CSSProperties}
        >
          <time
            dateTime={
              timestamp(step.time) ? new Date(step.time).toISOString() : undefined
            }
          >
            {label.date}
            {label.time ? <span className={styles.timelineClock}>{label.time}</span> : null}
          </time>
          <span className={styles.timelineMarker} aria-hidden="true">
            <span />
          </span>
          <p>{step.text}</p>
        </li>
        );
      })}
    </ol>
  );
}

export type HabitDetailFrom = "memory" | "habits";

export function habitDetailBack(from: HabitDetailFrom | null | undefined) {
  if (from === "memory") {
    return { href: "/memory", label: "记忆" } as const;
  }
  return { href: "/memory/habits", label: "家庭习惯" } as const;
}

export function HabitList({
  items,
  from,
}: {
  items: HomeBehaviorMemoryItem[];
  from?: HabitDetailFrom;
}) {
  const fromQuery = from ? `?from=${from}` : "";
  return (
    <ul className={styles.habitGrid}>
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/memory/habits/${item.id}${fromQuery}`} className={styles.habitCard}>
            <span className={styles.habitIcon}>
              <HabitIcon item={item} />
            </span>
            <div>
              <p>{item.summary}</p>
              <time
                dateTime={
                  timestamp(item.create_time)
                    ? new Date(item.create_time).toISOString()
                    : undefined
                }
              >
                {formatDate(item.create_time)}
              </time>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
