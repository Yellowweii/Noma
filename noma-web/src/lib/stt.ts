import { getAccessToken, recoverAccessToken } from "./auth";
import { isGuestMode } from "./sessionMode";

const API_BASE =
  "/api/v1";

const TARGET_SAMPLE_RATE = 16000;
const PROCESSOR_BUFFER_SIZE = 4096;
const SEND_SAMPLES = 1600;

export type STTServerMessage =
  | { type: "ready" }
  | { type: "result"; text: string; isFinal: boolean }
  | { type: "finished" }
  | { type: "error"; code?: string; message?: string };

function appendTranscript(base: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return base;
  const separator =
    base && !base.endsWith(" ") && !base.endsWith("\n") ? " " : "";
  return base + separator + trimmed;
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function downsample(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    const fraction = position - index;
    output[i] = input[index] * (1 - fraction) + input[next] * fraction;
  }
  return output;
}

export function isBrowserSTTSupported() {
  return (
    typeof window !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export async function getSTTWebSocketUrl(): Promise<string> {
  const wsBase = new URL(API_BASE, window.location.origin).toString().replace(/\/$/, "").replace(/^http/i, (scheme) =>
    scheme.toLowerCase() === "https" ? "wss" : "ws",
  );
  if (isGuestMode()) return `${wsBase}/guest/stt/stream`;
  let token = getAccessToken();
  if (!token) {
    await recoverAccessToken();
    token = getAccessToken();
  }
  const params = new URLSearchParams();
  if (token) {
    params.set("token", token);
  }
  return `${wsBase}/chat/stt/stream?${params.toString()}`;
}

export class QwenStreamingSTTSession {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private chunks: ArrayBuffer[] = [];
  private committedText = "";
  private closed = false;
  private recording = false;
  private ready = false;
  private stopRequested = false;
  private completion: Promise<string> | null = null;
  private cancelPending: (() => void) | null = null;
  private finishPending: (() => void) | null = null;

  constructor(
    private readonly onTranscript: (text: string, isFinal: boolean) => void,
    private readonly onFinished: () => void,
    private readonly onError: (code: string, message: string) => void,
  ) {}

  async start(initialText: string) {
    this.committedText = initialText;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (this.closed) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.mediaStream = stream;
    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      if (this.closed) return;
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.processor = this.audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      this.mute = this.audioContext.createGain();
      this.mute.gain.value = 0;
      this.recording = true;
      this.processor.onaudioprocess = event => {
        if (!this.recording || this.closed) return;
        const samples = downsample(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
        const chunk = floatTo16BitPCM(samples);
        if (this.ready) this.sendAudio(chunk);
        else this.chunks.push(chunk);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.mute);
      this.mute.connect(this.audioContext.destination);
      await this.connect();
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  stop(): Promise<string> {
    if (!this.completion) return Promise.reject(new Error("aborted"));
    if (this.stopRequested || this.closed) return this.completion;
    this.stopRequested = true;
    this.recording = false;
    this.teardownAudio();
    this.finishPending?.();
    return this.completion;
  }

  private sendAudio(chunk: ArrayBuffer) {
    const ws = this.ws;
    if (!ws || this.closed) return;
    for (let offset = 0; offset < chunk.byteLength; offset += SEND_SAMPLES * 2) {
      ws.send(chunk.slice(offset, offset + SEND_SAMPLES * 2));
    }
  }

  private async connect(): Promise<void> {
    const url = await getSTTWebSocketUrl();
    if (this.closed) throw new Error("aborted");
    let resolveCompletion!: (text: string) => void;
    let rejectCompletion!: (error: Error) => void;
    this.completion = new Promise<string>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // Errors can arrive while recording, before stop() starts awaiting the result.
    void this.completion.catch(() => {});
    return new Promise<void>((resolveReady, rejectReady) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      let settled = false;
      let hasSpeech = false;
      let timer = window.setTimeout(() => fail("timeout", "语音识别启动超时"), 15000);
      const waitForFinish = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fail("timeout", "语音转写超时"), 60000);
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        this.cancelPending = null;
        this.finishPending = null;
        this.closed = true;
        this.recording = false;
        this.teardownAudio();
        this.chunks = [];
        ws.close();
        this.ws = null;
      };
      const fail = (code: string, message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        const error = new Error(message);
        rejectReady(error);
        rejectCompletion(error);
        this.onError(code, message);
      };
      this.cancelPending = () => fail("aborted", "aborted");
      this.finishPending = () => {
        if (!this.ready || settled) return;
        ws.send(JSON.stringify({ action: "finish" }));
        waitForFinish();
      };
      ws.onerror = () => fail("network", "语音识别连接失败");
      ws.onclose = () => fail("network", "语音识别连接已断开");
      ws.onmessage = event => {
        if (settled || typeof event.data !== "string") return;
        let msg: STTServerMessage;
        try { msg = JSON.parse(event.data) as STTServerMessage; } catch { return; }
        if (msg.type === "ready") {
          if (this.ready) return;
          this.ready = true;
          window.clearTimeout(timer);
          // Only the connection startup is buffered; recording then streams live.
          for (const chunk of this.chunks) {
            this.sendAudio(chunk);
          }
          this.chunks = [];
          resolveReady();
          if (this.stopRequested) this.finishPending?.();
        } else if (msg.type === "result" && msg.text.trim()) {
          if (this.stopRequested) waitForFinish();
          if (msg.isFinal) {
            hasSpeech = true;
            // Accumulate final sentences in the background. Keep the input unchanged.
            this.committedText = appendTranscript(this.committedText, msg.text);
          }
        } else if (msg.type === "finished") {
          if (!this.stopRequested) { fail("unknown", "语音识别提前结束"); return; }
          if (!hasSpeech) { fail("no-speech", "no-speech"); return; }
          settled = true;
          cleanup();
          this.onTranscript(this.committedText, true);
          this.onFinished();
          resolveCompletion(this.committedText);
        } else if (msg.type === "error") {
          fail(msg.code || "unknown", msg.message || "语音识别失败");
        }
      };
    });
  }

  private teardownAudio() {
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.mute?.disconnect();
    this.processor = null;
    this.source = null;
    this.mute = null;
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.mediaStream = null;
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  abort() {
    this.closed = true;
    this.recording = false;
    this.teardownAudio();
    this.chunks = [];
    this.cancelPending?.();
    this.ws?.close();
    this.ws = null;
  }
}
