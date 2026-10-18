/** 将 Markdown 转为适合朗读的纯文本，保留段落边界。 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

// 首段以完整短句/分句换首响，后续合并短句以保持韵律。
export const FIRST_PLAYBACK_CHUNK_CHARS = 48;
const CHUNK_MAX_CHARS = 120;
const wordSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh", { granularity: "word" })
  : null;

function takeChunk(text: string, max: number, first: boolean): string {
  const chars = Array.from(text);
  const limit = Math.min(chars.length, max);
  let sentenceEnd = 0;
  let clauseEnd = 0;
  let wordEnd = 0;
  for (let i = 0; i < limit; i++) {
    const char = chars[i];
    const end = /[。！？!?；;\n]/.test(char) ||
      (char === "." && (i + 1 === chars.length || /\s/.test(chars[i + 1])));
    if (end) {
      sentenceEnd = i + 1;
      if (first) return chars.slice(0, sentenceEnd).join("");
    }
    if (/[，、,:：]/.test(char)) clauseEnd = i + 1;
    if (/\s/.test(char)) wordEnd = i + 1;
  }
  if (chars.length <= max) return text;
  // 无标点的中文也按词边界切分，避免把“空调”等词拆成两段。
  if (!sentenceEnd && !clauseEnd && wordSegmenter) {
    const maxOffset = chars.slice(0, limit).join("").length;
    for (const part of wordSegmenter.segment(text)) {
      const end = part.index + part.segment.length;
      if (end > maxOffset) break;
      wordEnd = Array.from(text.slice(0, end)).length;
    }
  }
  const boundary = sentenceEnd || clauseEnd || wordEnd || limit;
  return chars.slice(0, boundary).join("");
}

export function splitTextForTTS(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest) {
    const chunk = takeChunk(rest, chunks.length < 2 ? FIRST_PLAYBACK_CHUNK_CHARS : CHUNK_MAX_CHARS, chunks.length === 0);
    chunks.push(chunk.trim());
    rest = rest.slice(chunk.length).trimStart();
  }
  return chunks;
}

export function isFirstChunkPrefetchStable(chunk: string): boolean {
  return /[。！？!?；;]$/.test(chunk.trim()) || Array.from(chunk).length >= FIRST_PLAYBACK_CHUNK_CHARS;
}

type SpeechFetch = (text: string, signal?: AbortSignal) => Promise<Blob>;
const cache = new Map<string, Blob>();
const MAX_CACHE = 30;
type Warmup = { controller: AbortController; promise: Promise<Blob> };
const warmups = new Map<string, Warmup>();

function remember(text: string, blob: Blob): Blob {
  cache.delete(text);
  cache.set(text, blob);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return blob;
}

/** 仅已完成的音频才算命中。 */
export function hasSpeechChunk(text: string): boolean {
  return cache.has(text);
}

/** 后台只预取开头两段，避免首段播完才等第二段合成。 */
export function prefetchSpeechChunk(text: string, fetch: SpeechFetch): Promise<Blob> {
  const blob = cache.get(text);
  if (blob) return Promise.resolve(blob);
  const existing = warmups.get(text);
  if (existing && !existing.controller.signal.aborted) return existing.promise;
  if (activeSpeechSession) return Promise.reject(new DOMException("Playback active", "AbortError"));
  if (warmups.size >= 2) {
    const oldest = warmups.keys().next().value!;
    warmups.get(oldest)!.controller.abort();
    warmups.delete(oldest);
  }
  const controller = new AbortController();
  const promise = fetch(text, controller.signal).then(blob => {
    controller.signal.throwIfAborted();
    return remember(text, blob);
  }).finally(() => {
    if (warmups.get(text)?.controller === controller) warmups.delete(text);
  });
  warmups.set(text, { controller, promise });
  return promise;
}

/** 播放接管开头两段的在途请求，取消无关预取。 */
export function createSpeechBlobResolver(fetch: SpeechFetch, signal: AbortSignal, firstChunk: string, secondChunk?: string): (text: string) => Promise<Blob> {
  const adopted = new Map<string, Warmup>();
  for (const [text, warmup] of warmups) {
    if ((text === firstChunk || text === secondChunk) && !warmup.controller.signal.aborted) {
      adopted.set(text, warmup);
      const cancel = () => warmup.controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      void warmup.promise.finally(() => signal.removeEventListener("abort", cancel)).catch(() => {});
    } else {
      warmup.controller.abort();
      warmups.delete(text);
    }
  }
  return async text => {
    signal.throwIfAborted();
    const cached = cache.get(text);
    if (cached) return cached;
    const pending = adopted.get(text);
    if (pending && !pending.controller.signal.aborted) {
      try { return await pending.promise; } catch { signal.throwIfAborted(); }
    }
    const blob = await fetch(text, signal);
    signal.throwIfAborted();
    return remember(text, blob);
  };
}

type SpeechSession = {
  stop: () => void;
};

let activeSpeechSession: SpeechSession | null = null;

/** Stops any in-flight TTS playback and resets the owning UI. */
export function stopActiveSpeech(): void {
  activeSpeechSession?.stop();
}

/** Claims the global speech slot; any previous session is stopped first. */
export function createSpeechSession(onStopped: () => void): {
  signal: AbortSignal;
  stop: () => void;
} {
  stopActiveSpeech();

  const controller = new AbortController();
  let stopped = false;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (activeSpeechSession?.stop === stop) {
      activeSpeechSession = null;
    }
    controller.abort();
    onStopped();
  };

  activeSpeechSession = { stop };

  return { signal: controller.signal, stop };
}

export function finishSpeechSession(stop: () => void): void {
  if (activeSpeechSession?.stop === stop) {
    activeSpeechSession = null;
  }
}
