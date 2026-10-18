"use client";

import { Check, CircleCheck, CircleX, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type FloatingTipVariant = "success" | "error" | "info";

interface FloatingTipProps {
  open: boolean;
  message: string;
  description?: string;
  onClose: () => void;
  duration?: number;
  variant?: FloatingTipVariant;
}

const variantIconClassName: Record<
  Exclude<FloatingTipVariant, "info">,
  string
> = {
  success: "text-noma-active",
  error: "text-red-600",
};

function RichSuccessIcon() {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-noma-active"
      aria-hidden="true"
    >
      <Check className="h-4 w-4 text-white" strokeWidth={2.5} />
    </div>
  );
}

function RichErrorIcon() {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600"
      aria-hidden="true"
    >
      <X className="h-4 w-4 text-white" strokeWidth={2.5} />
    </div>
  );
}

export function FloatingTip({
  open,
  message,
  description,
  onClose,
  duration = 2000,
  variant = "info",
}: FloatingTipProps) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [open, message, description, duration, onClose]);

  if (!open || !message) return null;

  const isRich = !!description;
  const Icon =
    variant === "success" ? CircleCheck : variant === "error" ? CircleX : null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-8 z-[100] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "toast-pop-in flex bg-noma-toast-bg shadow-noma-toast",
          isRich
            ? "items-center gap-3 rounded-xl px-5 py-4"
            : "items-center gap-2 rounded-pill px-6 py-3 text-sm font-medium text-noma-toast-text",
        )}
      >
        {variant === "success" && isRich ? (
          <RichSuccessIcon />
        ) : variant === "error" && isRich ? (
          <RichErrorIcon />
        ) : Icon && variant !== "info" ? (
          <Icon
            className={`h-4 w-4 shrink-0 ${variantIconClassName[variant]}`}
            aria-hidden="true"
          />
        ) : null}
        {isRich ? (
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-5 text-noma-toast-text">
              {message}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-noma-secondary">
              {description}
            </p>
          </div>
        ) : (
          message
        )}
      </div>
    </div>,
    document.body,
  );
}
