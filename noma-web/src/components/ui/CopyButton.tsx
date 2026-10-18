"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
  onError?: () => void;
};

export function CopyButton({ value, label = "复制", className, onError }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      if (!mounted.current) return;
      setCopied(true);
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        setCopied(false);
        resetTimer.current = null;
      }, 2000);
    } catch {
      if (mounted.current) onError?.();
    }
  }

  return <button type="button" onClick={() => void handleCopy()} aria-label={copied ? "已复制" : label} title={copied ? "已复制" : label} className={className}>
    <span aria-hidden="true" className="relative block size-4 shrink-0">
      <Copy strokeWidth={1.75} className={cn("absolute inset-0 size-4 transition-transform duration-100 ease-out motion-reduce:transition-none", copied ? "scale-0 delay-0" : "scale-100 delay-100")} />
      <Check strokeWidth={1.75} className={cn("absolute inset-0 size-4 transition-transform duration-100 ease-out motion-reduce:transition-none", copied ? "scale-100 delay-100" : "scale-0 delay-0")} />
    </span>
  </button>;
}
