"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronUp, MessageCircle } from "lucide-react";
import { ScrollArea } from "@/components/layout/ScrollArea";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { api } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import type { RecentUnderstandingDetail } from "@/types";
import { formatDate, LoadError, MemoryLoading } from "./memory-shared";
import styles from "./memory.module.css";

const detailCache = new Map<string, RecentUnderstandingDetail>();

function cacheKey(topicId: string) {
  return `${getUserId() ?? ""}:${topicId}`;
}

if (typeof window !== "undefined") {
  window.addEventListener("noma:chat-sources-deleted", () => detailCache.clear());
}

function messageTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export default function RecentUnderstandingDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const topicId = typeof params.id === "string" ? params.id : "";
  const fromMemory = searchParams.get("from") === "memory";
  const back = { href: fromMemory ? "/memory" : "/memory/recent", label: fromMemory ? "记忆" : "最近对你的了解" };
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    id: string; detail?: RecentUnderstandingDetail; error?: string; notFound?: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = cacheKey(topicId);
    const cached = detailCache.get(key);
    setResult(cached ? { id: topicId, detail: cached } : null);
    api.getRecentUnderstandingDetail(topicId).then(
      (detail) => {
        detailCache.set(key, detail);
        if (!cancelled) setResult({ id: topicId, detail });
      },
      (error: unknown) => {
        const notFound = (error as { status?: number })?.status === 404;
        if (notFound) detailCache.delete(key);
        if (cancelled || (cached && !notFound)) return;
        setResult({ id: topicId, notFound, error: "暂时无法加载相关对话，请重试。" });
      },
    );
    return () => { cancelled = true; };
  }, [topicId, attempt]);

  useEffect(() => {
    const refresh = () => { setResult(null); setAttempt((value) => value + 1); };
    window.addEventListener("noma:chat-sources-deleted", refresh);
    return () => window.removeEventListener("noma:chat-sources-deleted", refresh);
  }, []);

  useEffect(() => {
    if (!result?.detail?.topic.needs_rebuild) return;
    const timer = window.setTimeout(() => setAttempt((value) => value + 1), 2000);
    return () => window.clearTimeout(timer);
  }, [result]);

  if (!result || result.id !== topicId) {
    return <ScrollArea className={`h-full ${styles.page}`}><MemoryLoading /></ScrollArea>;
  }

  const detail = result.detail;
  return <ScrollArea className={`h-full ${styles.page}`}>
    <div className={`${styles.content} ${styles.understandingDetailContent}`}>
      <header className={styles.understandingDetailHeader}>
        <Link href={back.href} className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />{back.label}
        </Link>
        {detail && <>
          {detail.topic.needs_rebuild ? <p className={styles.empty} role="status">正在根据保留的对话更新这条了解…</p> : <h1 className={styles.understandingSummary}>{detail.topic.summary}</h1>}
          <time className={styles.understandingUpdatedAt} dateTime={detail.topic.updated_at}>
            最近更新 · {formatDate(detail.topic.updated_at)} {messageTime(detail.topic.updated_at)}
          </time>
        </>}
      </header>

      {result.notFound ? <p className={styles.empty} role="status">这条了解已过期或不存在。你可以返回列表查看其他了解。</p>
        : result.error ? <LoadError message={result.error} retry={() => setAttempt((value) => value + 1)} />
        : detail && <section aria-labelledby="understanding-conversations-title">
          <div className={styles.understandingConversationsHeading}>
            <h2 id="understanding-conversations-title"><MessageCircle size={18} aria-hidden="true" />相关对话</h2>
            {detail.conversations.length > 1 && <span>{detail.conversations.length} 条</span>}
          </div>
          {detail.conversations.length ? <ol className={styles.understandingConversations}>
            {detail.conversations.map((conversation) => <li key={conversation.message.message_id}>
              <article aria-label={`${formatDate(conversation.message.created_at)}的对话`}>
                <time className={styles.understandingConversationDate} dateTime={conversation.message.created_at}>
                  {formatDate(conversation.message.created_at)} {messageTime(conversation.message.created_at)}
                </time>
                <div className={styles.understandingUserMessage}>
                  <span className={styles.understandingSpeaker}>你</span>
                  <p>{conversation.message.content}</p>
                </div>
                {conversation.replies.length ? conversation.replies.map((reply) => <details key={reply.message_id} className={styles.understandingReply}>
                  <summary className={styles.understandingReplyToggle}>
                    <span className={styles.understandingReplyShow}>查看回复 <ArrowRight size={14} aria-hidden="true" /></span>
                    <span className={styles.understandingReplyHide}>收起回复 <ChevronUp size={14} aria-hidden="true" /></span>
                  </summary>
                  {reply.content ? <MarkdownMessage content={reply.content} /> : <p className={styles.empty}>回复内容为空。</p>}
                </details>) : <p className={styles.understandingMissingReply}>这条消息暂无回复记录。</p>}
              </article>
            </li>)}
          </ol> : <p className={styles.empty}>相关原始对话已不可用。</p>}
        </section>}
    </div>
  </ScrollArea>;
}
