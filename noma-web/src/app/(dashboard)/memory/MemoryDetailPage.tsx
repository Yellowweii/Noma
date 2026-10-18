"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { ArrowLeft, BookOpen, Check, ChevronDown, Compass, Heart, Target, UserRound, type LucideIcon } from "lucide-react";
import { ScrollArea } from "@/components/layout/ScrollArea";
import { formatProfileUpdate, HabitList, LoadError, MemoryLoading, RecentUnderstandingList, SectionAction, timestamp, useMemoryData } from "./memory-shared";
import styles from "./memory.module.css";

const TITLES = { profile: "Noma 眼中的你", recent: "最近对你的了解", habits: "Noma 记住的家庭习惯" };
const RECENT_RANGES = [
  { value: "3", label: "最近 3 天" },
  { value: "7", label: "最近 7 天" },
  { value: "30", label: "最近 30 天" },
] as const;
const PORTRAIT_DIMS: [string, string, LucideIcon][] = [
  ["identity", "身份信息", UserRound],
  ["preferences", "长期偏好", Heart],
  ["goals", "长期目标", Target],
  ["lessons", "经验", BookOpen],
  ["values", "价值观", Compass],
];

function RecentRangeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const selectedIndex = RECENT_RANGES.findIndex((range) => range.value === value);
  const selectedLabel = RECENT_RANGES[selectedIndex]?.label;

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setActiveIndex(selectedIndex);
        setOpen(true);
      } else {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => (index + direction + RECENT_RANGES.length) % RECENT_RANGES.length);
      }
    } else if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : RECENT_RANGES.length - 1);
    } else if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return <div
    ref={rootRef}
    className={styles.recentRange}
    onKeyDown={handleKeyDown}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}
  >
    <button
      ref={triggerRef}
      type="button"
      className={styles.recentRangeTrigger}
      aria-label={`记忆时间范围：${selectedLabel}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={() => {
        setActiveIndex(selectedIndex);
        setOpen(!open);
      }}
    >
      {selectedLabel}
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className={styles.recentRangeMenu} role="menu" aria-label="记忆时间范围">
      {RECENT_RANGES.map((range, index) => <button
        key={range.value}
        ref={(node) => { optionRefs.current[index] = node; }}
        type="button"
        role="menuitemradio"
        aria-checked={value === range.value}
        tabIndex={activeIndex === index ? 0 : -1}
        className={styles.recentRangeOption}
        onClick={() => {
          onChange(range.value);
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        {range.label}
        {value === range.value && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}

export default function MemoryDetailPage({ view }: { view: keyof typeof TITLES }) {
  const data = useMemoryData();
  const [recentRange, setRecentRange] = useState("30");
  const rangeLabel = RECENT_RANGES.find((range) => range.value === recentRange)?.label;
  const profileUpdatedLabel = formatProfileUpdate(data.profileUpdatedAt);
  const now = Date.now();
  const recentItems = data.recentHistory.filter((item) => timestamp(item.updated_at) >= now - Number(recentRange) * 86400000 && timestamp(item.updated_at) <= now);

  if (view === "recent" && data.loading) {
    return <ScrollArea className={`h-full ${styles.page}`}><MemoryLoading /></ScrollArea>;
  }

  return <ScrollArea className={`h-full ${styles.page}`}>
    <div className={`${styles.content} ${styles.detailContent} ${view === "profile" ? styles.portraitContent : view === "recent" ? styles.recentContent : ""}`}>
      {view === "profile" ? <header className={styles.portraitHeader}>
        <Link href="/memory" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" />记忆</Link>
        <div className={styles.portraitTitleRow}>
          <h1>{TITLES[view]}</h1>
          {!data.loading && !data.errors.profile && profileUpdatedLabel && <time className={styles.portraitUpdatedAt} dateTime={data.profileUpdatedAt}>{profileUpdatedLabel}</time>}
        </div>
        <p>这是基于我们长期相处中积累的记忆，形成的关于你的长期画像。随着我们交流的增多，它也会持续更新。</p>
      </header> : view === "recent" ? <header className={styles.recentHeader}>
        <Link href="/memory" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" />记忆</Link>
        <div className={styles.recentHeaderRow}>
          <div className={styles.recentHeaderText}>
            <h1>{TITLES[view]}</h1>
            <p>Noma 会根据你日常的对话、行为和使用习惯，不断加深对你的理解。</p>
          </div>
          <RecentRangeSelect value={recentRange} onChange={setRecentRange} />
        </div>
      </header> : <header className={styles.detailHeader}>
        <Link href="/memory" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" />记忆</Link>
        <h1>{TITLES[view]}</h1>
      </header>}
      {data.loading ? <MemoryLoading /> : <>
        {view === "profile" && <section aria-label="完整画像">
          {data.errors.profile ? <LoadError message={data.errors.profile} retry={data.retry} /> : data.profileSummary ? <div className={styles.portraitSummary}>
            <UserRound size={22} strokeWidth={1.75} aria-hidden="true" />
            <div><h2>关于你</h2><div className={styles.profileSummary}><ReactMarkdown>{data.profileSummary}</ReactMarkdown></div></div>
          </div> : <p className={styles.empty}>Noma 还在慢慢了解你。随着对话积累，你的画像会逐渐清晰。</p>}
          {!data.errors.profile && <section className={styles.portraitUnderstanding} aria-label="画像维度">
            <dl className={styles.portraitDims}>{PORTRAIT_DIMS.map(([key, label, Icon]) => {
              const field = data.profileFields.find((f) => f.key === key);
              return <div key={key} className={styles.portraitDim}>
                <span className={styles.portraitIcon}><Icon size={20} strokeWidth={1.75} aria-hidden="true" /></span>
                <dt>{label}</dt>
                {field ? <dd>{field.value}</dd> : <dd className={styles.portraitDimEmpty}>Noma 还在持续了解中...</dd>}
              </div>;
            })}</dl>
          </section>}
          <div className={styles.portraitEvidence}>
            <SectionAction href="/settings/memory">
              查看形成这些理解的记忆
            </SectionAction>
            <LoadError message={data.errors.personal} retry={data.retry} />
          </div>
        </section>}
        {view === "recent" && <section aria-label={`${rangeLabel}的记忆`}>
          {data.errors.recentHistory ? <LoadError message={data.errors.recentHistory} retry={data.retry} /> : recentItems.length ? <RecentUnderstandingList topics={recentItems} /> : <p className={styles.empty}>{`${rangeLabel}还没有形成新的了解。`}</p>}
        </section>}
        {view === "habits" && <section aria-label="全部家庭习惯">
          {data.errors.home ? <LoadError message={data.errors.home} retry={data.retry} /> : data.sortedHomeItems.length ? <HabitList items={data.sortedHomeItems} from="habits" /> : <p className={styles.empty}>还没有记录家庭习惯。告诉 Noma 你喜欢的灯光、温度或日常安排，它会慢慢记住。</p>}
        </section>}
      </>}
    </div>
  </ScrollArea>;
}
