"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Search, Trash2 } from "lucide-react";
import { SettingsContentLayout } from "@/components/settings/SettingsContentLayout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  type HomeBehaviorMemoryItem,
  type MemoryOSItem,
} from "@/types";

type MemoryCategory = "all" | "personal" | "home_behavior";

type SettingsMemoryRow =
  | {
      kind: "personal";
      id: string;
      summary: string;
      create_time: string;
    }
  | {
      kind: "home_behavior";
      id: string;
      summary: string;
      scene?: string;
      room?: string;
      create_time: string;
    };

const CATEGORIES: { value: MemoryCategory; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "personal", label: "个人记忆" },
  { value: "home_behavior", label: "家庭行为记忆" },
];
const PAGE_SIZE = 7;
const EXPANSION_CACHE_TTL_MS = 10 * 60 * 1000;
const MEMORY_SETTING_CACHE_KEY = "noma-memory-enabled";

function readMemorySettingCache(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MEMORY_SETTING_CACHE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function writeMemorySettingCache(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MEMORY_SETTING_CACHE_KEY, String(enabled));
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function rowTime(row: SettingsMemoryRow) {
  const t = new Date(row.create_time).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function personalRows(items: MemoryOSItem[]): SettingsMemoryRow[] {
  return items.map((item) => ({
    kind: "personal" as const,
    id: item.id,
    summary: item.summary,
    create_time: item.create_time,
  }));
}

function homeRows(items: HomeBehaviorMemoryItem[]): SettingsMemoryRow[] {
  return items.map((item) => ({
    kind: "home_behavior" as const,
    id: item.id,
    summary: item.summary,
    scene: item.scene,
    room: item.room,
    create_time: item.create_time,
  }));
}

function MemoryToggleSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-7 w-[52px] shrink-0 animate-pulse rounded-full bg-noma-soft"
    />
  );
}

function MemoryToggle({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="启用记忆"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative h-7 w-[52px] shrink-0 rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-noma-brand focus-visible:ring-offset-4 motion-reduce:transition-none disabled:cursor-wait disabled:opacity-60",
        enabled ? "bg-noma-brand" : "bg-[#d9dedc]",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-[3px] size-[22px] rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none",
          enabled ? "translate-x-[27px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

function MemoryListSkeleton() {
  return (
    <ul aria-label="正在加载记忆" aria-busy="true" className="mt-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <li
          key={index}
          className="flex min-h-[72px] items-center justify-between gap-6 border-b border-noma-border py-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-noma-soft" />
            <div className="h-3 w-24 animate-pulse rounded bg-noma-soft" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MemorySettingsContent() {
  const [personalItems, setPersonalItems] = useState<MemoryOSItem[]>([]);
  const [homeItems, setHomeItems] = useState<HomeBehaviorMemoryItem[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memorySettingLoaded, setMemorySettingLoaded] = useState(false);
  const [memorySettingSaving, setMemorySettingSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SettingsMemoryRow | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const expansionCache = useRef<
    Partial<Record<MemoryCategory, { count: number; expiresAt: number }>>
  >({});

  function handleCategoryChange(nextCategory: MemoryCategory) {
    if (nextCategory === category) return;
    const cached = expansionCache.current[nextCategory];
    if (cached && cached.expiresAt > Date.now()) {
      setVisibleCount(cached.count);
    } else {
      delete expansionCache.current[nextCategory];
      setVisibleCount(PAGE_SIZE);
    }
    setCategory(nextCategory);
  }

  function handleLoadMore() {
    const count = visibleCount + PAGE_SIZE;
    expansionCache.current[category] = {
      count,
      expiresAt: Date.now() + EXPANSION_CACHE_TTL_MS,
    };
    setVisibleCount(count);
  }

  const allRows = useMemo(() => {
    const merged = [...personalRows(personalItems), ...homeRows(homeItems)];
    merged.sort((a, b) => rowTime(b) - rowTime(a));
    return merged;
  }, [personalItems, homeItems]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return allRows.filter((row) => {
      if (category === "personal" && row.kind !== "personal") return false;
      if (category === "home_behavior" && row.kind !== "home_behavior") {
        return false;
      }
      if (!needle) return true;
      const haystack = [
        row.summary,
        row.kind === "home_behavior" ? row.scene : "",
        row.kind === "home_behavior" ? row.room : "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [allRows, category, query]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      const cached = readMemorySettingCache();
      if (cached !== null && !cancelled) {
        setMemoryEnabled(cached);
      }
      try {
        const settings = await api.getSettings();
        if (!cancelled) {
          setMemoryEnabled(settings.auto_memory_enabled);
          writeMemorySettingCache(settings.auto_memory_enabled);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载记忆设置失败");
        }
      } finally {
        if (!cancelled) setMemorySettingLoaded(true);
      }
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [personalRes, homeRes] = await Promise.all([
          api.listMemoryOSItems(),
          api.listHomeBehaviorMemories(),
        ]);
        if (cancelled) return;
        const nextPersonal = personalRes.items ?? [];
        nextPersonal.sort(
          (a, b) =>
            new Date(b.create_time).getTime() -
            new Date(a.create_time).getTime(),
        );
        setPersonalItems(nextPersonal);
        setHomeItems(homeRes.items ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载记忆失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function handleMemoryToggle(enabled: boolean) {
    if (memorySettingSaving) return;
    const previous = memoryEnabled;
    setMemoryEnabled(enabled);
    setMemorySettingSaving(true);
    setError("");
    try {
      await api.updateMemorySettings(enabled);
      writeMemorySettingCache(enabled);
    } catch (e) {
      setMemoryEnabled(previous);
      setError(e instanceof Error ? e.message : "更新记忆设置失败");
    } finally {
      setMemorySettingSaving(false);
    }
  }

  async function handleDelete(row: SettingsMemoryRow) {
    if (deletingId) return;
    setError("");
    setDeletingId(row.id);
    try {
      if (row.kind === "personal") {
        await api.deleteMemoryOSItem(row.id);
        setPersonalItems((prev) => prev.filter((item) => item.id !== row.id));
      } else {
        await api.deleteHomeBehaviorMemory(row.id);
        setHomeItems((prev) => prev.filter((item) => item.id !== row.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  const totalCount = allRows.length;

  return (
    <SettingsContentLayout
      title="记忆"
      description="管理 Noma 记住的关于你的信息，帮助我更好地理解你、提供更个性化的回应"
      className="w-full max-w-[828px]"
      headerClassName="!mb-0 border-b border-noma-border pb-6"
    >
      {error && (
        <div
          role="alert"
          className="mt-5 flex items-center justify-between gap-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="shrink-0 rounded px-2 py-1 underline focus-visible:outline focus-visible:outline-2"
          >
            重新加载
          </button>
        </div>
      )}

      <section className="border-b border-noma-border py-5">
        <div className="flex items-center justify-between gap-6">
          <h3 className="text-base font-semibold text-slate-900">启用记忆</h3>
          {memorySettingLoaded ? (
            <MemoryToggle
              enabled={memoryEnabled}
              disabled={memorySettingSaving}
              onChange={handleMemoryToggle}
            />
          ) : (
            <MemoryToggleSkeleton />
          )}
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
          开启后，Noma 会在长期相处中逐渐了解你的偏好、习惯和重要背景
        </p>
      </section>

      <section className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">我的记忆</h3>
          <label className="relative w-full sm:w-[53%]">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={1.5}
            />
            <input
              type="search"
              aria-label="搜索记忆"
              placeholder="搜索记忆"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                expansionCache.current = {};
                setVisibleCount(PAGE_SIZE);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-noma-placeholder"
            />
          </label>
        </div>

        <div
          role="group"
          aria-label="记忆分类"
          className="mt-3 flex flex-wrap gap-2"
        >
          {CATEGORIES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => handleCategoryChange(value)}
              className={cn(
                "rounded-full border px-4 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-noma-brand focus-visible:ring-offset-2",
                category === value
                  ? "border-transparent bg-noma-brand-active font-medium text-slate-900"
                  : "border-slate-200 text-slate-600 hover:bg-noma-soft",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <MemoryListSkeleton />
        ) : filteredItems.length === 0 ? (
          !error && (
            <p role="status" className="py-8 text-sm text-slate-500">
              {totalCount === 0
                ? "还没有保存的记忆。"
                : "没有找到匹配的记忆。"}
            </p>
          )
        ) : (
          <ul className="mt-3">
            {filteredItems.slice(0, visibleCount).map((row) => (
              <li
                key={`${row.kind}:${row.id}`}
                className="group border-b border-noma-border last:border-b-0"
              >
                <div className="flex min-h-[47px] items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 rounded-sm py-3 text-left">
                    <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-slate-900">
                      {row.summary || "—"}
                    </span>
                    {row.create_time ? (
                      <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                        {formatDate(row.create_time)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-slate-400">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(row)}
                      disabled={deletingId !== null}
                      aria-label={`删除记忆：${row.summary}`}
                      title="删除记忆"
                      className="flex size-11 items-center justify-center rounded-lg transition-colors group-hover:text-slate-500 hover:bg-red-50 hover:!text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-wait disabled:opacity-50"
                    >
                      {deletingId === row.id ? (
                        <Loader2 className="size-[18px] animate-spin" />
                      ) : (
                        <Trash2 className="size-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && filteredItems.length > visibleCount && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              className="inline-flex items-center gap-2 rounded-full bg-noma-soft px-7 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-noma-brand-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-noma-brand"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
              加载更多
            </button>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除记忆"
        description="删除后无法恢复，确定要删除这条记忆吗？"
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </SettingsContentLayout>
  );
}
