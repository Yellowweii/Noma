import { cn } from "@/lib/utils";

type NomaLogoProps = {
  className?: string;
  title?: string;
  variant?: "brand" | "dark";
};

export function NomaLogo({
  className,
  title = "Noma",
  variant = "brand",
}: NomaLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 144 144"
      fill={variant === "dark" ? "#111827" : "#3F7F74"}
      role="img"
      aria-label={title}
      className={cn("shrink-0 select-none", className)}
    >
      <g transform="rotate(-18 72 72)">
        {[0, 90, 180, 270].map((angle) => (
          <path
            key={angle}
            transform={`rotate(${angle} 72 72)`}
            d="M72 63C45 63 20 48 23 30C26 13 54 13 68 26C79 37 80 50 72 63Z"
          />
        ))}
      </g>
    </svg>
  );
}
