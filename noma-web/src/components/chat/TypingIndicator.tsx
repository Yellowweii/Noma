import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  className?: string;
}

export function TypingIndicator({ className }: TypingIndicatorProps) {
  return (
    <div
      className={cn("typing-indicator", className)}
      role="status"
      aria-label="正在生成回复"
    >
      <span className="typing-indicator-dot" />
      <span className="typing-indicator-dot" />
      <span className="typing-indicator-dot" />
    </div>
  );
}
