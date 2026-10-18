"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { stopActiveSpeech } from "@/lib/tts";
import {
  isBrowserSTTSupported,
  QwenStreamingSTTSession,
} from "@/lib/stt";

export type SpeechRecognitionErrorCode =
  | "not-supported"
  | "not-allowed"
  | "no-speech"
  | "network"
  | "timeout"
  | "aborted"
  | "unknown";

export interface UseSpeechToTextOptions {
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: SpeechRecognitionErrorCode) => void;
}

function mapStartError(error: unknown): SpeechRecognitionErrorCode {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "not-allowed";
    if (error.name === "NotFoundError") return "not-supported";
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("连接") || message.includes("network")) {
      return "network";
    }
  }
  return "unknown";
}

export function useSpeechToText({
  onTranscript,
  onError,
}: UseSpeechToTextOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const sessionRef = useRef<QwenStreamingSTTSession | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);


  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!isBrowserSTTSupported()) {
      setIsSupported(false);
      return;
    }
    let cancelled = false;
    void api
      .getSTTStatus()
      .then((status) => {
        if (!cancelled) {
          setIsSupported(status.available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsSupported(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(async (): Promise<string | null> => {
    const session = sessionRef.current;
    if (!session) return null;
    setIsListening(false);
    setIsTranscribing(true);
    try {
      const text = await session.stop();
      return sessionRef.current === session ? text : null;
    } catch {
      return null;
    } finally {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        setIsTranscribing(false);
      }
    }
  }, []);

  const abort = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.abort();
    setIsListening(false);
    setIsStarting(false);
    setIsTranscribing(false);
  }, []);

  const start = useCallback(async (initialText = "") => {
    if (sessionRef.current) return;
    stopActiveSpeech();
    setIsStarting(true);
    const session = new QwenStreamingSTTSession(
      (text, isFinal) => {
        if (sessionRef.current === session) onTranscriptRef.current?.(text, isFinal);
      },
      () => {},
      (code) => {
        if (sessionRef.current !== session || code === "aborted") return;
        sessionRef.current = null;
        setIsListening(false);
        setIsStarting(false);
        setIsTranscribing(false);
        onErrorRef.current?.(
          code === "no-speech" || code === "network" || code === "timeout" ? code : "unknown",
        );
      },
    );
    sessionRef.current = session;
    try {
      await session.start(initialText);
      if (sessionRef.current === session) setIsListening(true);
    } catch (error) {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        onErrorRef.current?.(mapStartError(error));
      }
    } finally {
      if (!sessionRef.current || sessionRef.current === session) setIsStarting(false);
    }
  }, []);

  const toggle = useCallback((initialText = "") => {
    if (isStarting || isTranscribing) return;
    if (isListening) void stop();
    else void start(initialText);
  }, [isListening, isStarting, isTranscribing, start, stop]);

  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return { isListening, isStarting, isTranscribing, isSupported, start, stop, toggle, abort };
}
