/** 有限前瞻合成 + Web Audio 连续时间轴。 */
const SYNTH_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const LEAD_SECONDS = 0.025;

export type SpeechBlobFetch = (text: string) => Promise<Blob>;
type Slot = AudioBuffer | Error | undefined;

/** 仅收短近乎无声的边缘，保留起音、尾音和句内所有停顿。 */
export function speechPlaybackRange(buffer: AudioBuffer): { offset: number; duration: number } {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const audible = (frame: number) => channels.some(channel => Math.abs(channel[frame]) > 0.0001);
  let first = 0;
  let last = buffer.length - 1;
  while (first <= last && !audible(first)) first++;
  // 全静音或极轻的音频不裁，避免误删。
  if (first > last) return { offset: 0, duration: buffer.duration };
  while (last > first && !audible(last)) last--;
  const start = Math.max(0, first - Math.ceil(buffer.sampleRate * 0.04));
  const end = Math.min(buffer.length, last + 1 + Math.ceil(buffer.sampleRate * 0.12));
  return { offset: start / buffer.sampleRate, duration: (end - start) / buffer.sampleRate };
}

export async function playSpeechDualBuffer(
  chunks: string[],
  resolveBlob: SpeechBlobFetch,
  signal: AbortSignal,
  options?: { onStart?: () => void },
): Promise<void> {
  if (!chunks.length || signal.aborted) return;
  const context = new AudioContext();
  // 在点击调用栈内解锁音频，避免等网络返回后丢失用户手势。
  const resumed = context.resume();
  void resumed.catch(() => {});
  const slots: Slot[] = new Array(chunks.length);
  const sources = new Set<AudioBufferSourceNode>();
  const waiters = new Set<() => void>();
  let nextJob = 0;
  let nextPlay = 0;
  let completed = 0;
  let cursor = 0;
  let closed = false;
  let started = false;
  const wake = () => {
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const changed = () => new Promise<void>(resolve => {
    if (closed || signal.aborted) resolve();
    else waiters.add(resolve);
  });
  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    sources.clear();
    wake();
    void context.close().catch(() => {});
  };
  signal.addEventListener("abort", cleanup, { once: true });

  const backoff = (ms: number) => new Promise<void>(resolve => {
    if (signal.aborted || closed) { resolve(); return; }
    const done = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

  const worker = async () => {
    while (!closed && !signal.aborted) {
      // 短段多时补足约 12 秒前瞻；最多八段，网络并发仍为三。
      while ((nextJob >= completed + 8 ||
        (nextJob >= completed + 4 && cursor - context.currentTime >= 12)) && !closed && !signal.aborted) {
        await changed();
      }
      if (closed || signal.aborted || nextJob >= chunks.length) return;
      const index = nextJob++;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const blob = await resolveBlob(chunks[index]);
          if (closed || signal.aborted) return;
          const buffer = await context.decodeAudioData(await blob.arrayBuffer());
          if (closed || signal.aborted) return;
          slots[index] = buffer;
          wake();
          break;
        } catch (error) {
          if (closed || signal.aborted) return;
          const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
          if (attempt === MAX_RETRIES - 1 || (status >= 400 && status < 500 && status !== 429)) {
            slots[index] = error instanceof Error ? error : new Error(String(error));
            wake();
            break;
          }
          await backoff((status === 429 ? 1000 : 400) * (attempt + 1));
        }
      }
    }
  };

  try {
    // 调度错误只由主循环处理，后台任务不会产生未处理的 rejection。
    for (let i = 0; i < SYNTH_CONCURRENCY; i++) void worker();
    await Promise.race([resumed, new Promise<void>(resolve => {
      if (signal.aborted) resolve();
      else {
        const done = () => { signal.removeEventListener("abort", done); resolve(); };
        signal.addEventListener("abort", done, { once: true });
        void resumed.then(done, done);
      }
    })]);
    while (nextPlay < chunks.length && !closed && !signal.aborted) {
      const slot = slots[nextPlay];
      if (!slot) { await changed(); continue; }
      if (slot instanceof Error) throw slot;
      // 首段往往很短且已缓存，第二段未就绪就开播会造成明显断句。
      // 单段回复直接播放；多段回复先准备好前两段再启动连续时间轴。
      if (!started && chunks.length > 1) {
        const second = slots[1];
        if (!second) { await changed(); continue; }
        if (second instanceof Error) throw second;
      }
      const source = context.createBufferSource();
      source.buffer = slot;
      source.connect(context.destination);
      // 断粮后重新对齐当前时间；恢复的多个片段仍严格串行。
      cursor = Math.max(cursor, context.currentTime + LEAD_SECONDS);
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        completed++;
        wake();
      };
      sources.add(source);
      const range = speechPlaybackRange(slot);
      source.start(cursor, range.offset, range.duration);
      cursor += range.duration;
      slots[nextPlay++] = undefined;
      if (!started) { started = true; options?.onStart?.(); }
      wake();
    }
    while (completed < chunks.length && !closed && !signal.aborted) await changed();
  } finally {
    signal.removeEventListener("abort", cleanup);
    cleanup();
  }
}
