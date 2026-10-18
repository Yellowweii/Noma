"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import type { MessageFeedback } from "@/types";
import { api } from "@/lib/api";
import { playSpeechDualBuffer } from "@/lib/speechPlaybackEngine";
import {
  createSpeechBlobResolver,
  createSpeechSession,
  finishSpeechSession,
  isFirstChunkPrefetchStable,
  markdownToPlainText,
  prefetchSpeechChunk,
  splitTextForTTS,
} from "@/lib/tts";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/CopyButton";

type Feedback = MessageFeedback | null;

const STREAM_PREFETCH_DEBOUNCE_MS = 800;

type AssistantMessageActionsProps = {
  content: string;
  feedback?: Feedback;
  disabled?: boolean;
  /** 仅最后一条助手消息：流式期间按稳定性预缓存首段；结束时补漏 */
  prefetchOnHover?: boolean;
  onRegenerate?: () => void;
  onFeedbackChange?: (feedback: Feedback) => void | Promise<void>;
};

function ActionButton({
  label,
  onClick,
  onMouseEnter,
  onFocus,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150",
        active
          ? "bg-noma-soft text-noma-brand hover:bg-noma-soft hover:text-noma-brand"
          : "text-noma-tertiary hover:bg-noma-soft hover:text-noma-brand",
      )}
    >
      {children}
    </button>
  );
}

export function AssistantMessageActions({
  content,
  feedback = null,
  disabled = false,
  prefetchOnHover = false,
  onRegenerate,
  onFeedbackChange,
}: AssistantMessageActionsProps) {
  const [speaking, setSpeaking] = useState(false);
  const [loadingSpeech, setLoadingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const chunks = useMemo(() => splitTextForTTS(markdownToPlainText(content)), [content]);
  const firstChunk = chunks[0] ?? "";
  const secondChunk = chunks[1] ?? "";

  function prefetchFirstChunkOnInteract() {
    if (!disabled && firstChunk) {
      void prefetchSpeechChunk(firstChunk, api.synthesizeSpeech).catch(() => {});
      if (secondChunk) void prefetchSpeechChunk(secondChunk, api.synthesizeSpeech).catch(() => {});
    }
  }

  useEffect(() => () => { abortRef.current?.(); }, []);

  // 首段稳定后定时预取；后续 token 不再重置这个定时器。
  useEffect(() => {
    if (!prefetchOnHover || !firstChunk || (disabled && !isFirstChunkPrefetchStable(firstChunk))) return;
    const timer = window.setTimeout(() => {
      void prefetchSpeechChunk(firstChunk, api.synthesizeSpeech).catch(() => {});
    }, disabled ? STREAM_PREFETCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [firstChunk, disabled, prefetchOnHover]);

  // 第二段在回复完成后预取，避免流式生成时反复合成不稳定文本。
  useEffect(() => {
    if (!prefetchOnHover || disabled || !secondChunk) return;
    void prefetchSpeechChunk(secondChunk, api.synthesizeSpeech).catch(() => {});
  }, [secondChunk, disabled, prefetchOnHover]);


  if (disabled || !content.trim()) {
    return null;
  }

  function handleFeedback(next: MessageFeedback) {
    const value = feedback === next ? null : next;
    void onFeedbackChange?.(value);
  }

  function stopSpeech() {
    abortRef.current?.();
    abortRef.current = null;
    setSpeaking(false);
    setLoadingSpeech(false);
  }

  async function handleSpeak() {
    if (speaking || loadingSpeech) {
      stopSpeech();
      return;
    }
    if (chunks.length === 0) return;
    setSpeechError(false);
    const { signal, stop } = createSpeechSession(() => {
      abortRef.current = null;
      setSpeaking(false);
      setLoadingSpeech(false);
    });
    abortRef.current = stop;
    setLoadingSpeech(true);
    const resolveSpeechBlob = createSpeechBlobResolver(api.synthesizeSpeech, signal, chunks[0], chunks[1]);
    try {
      await playSpeechDualBuffer(chunks, resolveSpeechBlob, signal, {
        onStart: () => {
          setLoadingSpeech(false);
          setSpeaking(true);
        },
      });
    } catch {
      if (!signal.aborted) {
        setSpeechError(true);
        window.setTimeout(() => setSpeechError(false), 3000);
      }
    } finally {
      if (!signal.aborted) {
        finishSpeechSession(stop);
        stop();
      }
    }
  }

  return (
    <div className="mt-2 flex items-center gap-0.5">
      <CopyButton value={content} className="flex h-8 w-8 items-center justify-center rounded-lg text-noma-tertiary transition-colors duration-150 hover:bg-noma-soft hover:text-noma-brand" />

      {onRegenerate && (
        <ActionButton label="重新生成" onClick={onRegenerate}>
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
        </ActionButton>
      )}

      <ActionButton
        label="有帮助"
        onClick={() => handleFeedback("up")}
        active={feedback === "up"}
      >
        <ThumbsUp
          className="h-4 w-4 shrink-0"
          strokeWidth={1.75}
          fill={feedback === "up" ? "currentColor" : "none"}
        />
      </ActionButton>

      <ActionButton
        label="没有帮助"
        onClick={() => handleFeedback("down")}
        active={feedback === "down"}
      >
        <ThumbsDown
          className="h-4 w-4 shrink-0"
          strokeWidth={1.75}
          fill={feedback === "down" ? "currentColor" : "none"}
        />
      </ActionButton>

      <ActionButton
        label={
          speechError
            ? "朗读失败，请稍后再试"
            : loadingSpeech
              ? "缓冲中"
              : speaking
                ? "停止朗读"
                : "朗读"
        }
        onClick={() => void handleSpeak()}
        onMouseEnter={prefetchFirstChunkOnInteract}
        onFocus={prefetchFirstChunkOnInteract}
        active={speaking || loadingSpeech || speechError}
      >
        <Volume2 className="h-4 w-4" strokeWidth={1.75} />
      </ActionButton>
    </div>
  );
}
