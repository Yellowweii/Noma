import { SettingsDecoration } from "@/components/settings/SettingsDecoration";
import { cn } from "@/lib/utils";
import styles from "./settings-responsive.module.css";

interface SettingsContentLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  decorative?: boolean;
  footer?: React.ReactNode;
  headerRight?: React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function SettingsContentLayout({
  title,
  description,
  children,
  decorative = false,
  footer,
  headerRight,
  className,
  headerClassName,
}: SettingsContentLayoutProps) {
  return (
    <div className="relative min-h-full bg-white">
      {decorative && <SettingsDecoration />}

      <div className={cn("relative px-12 py-10", styles.content, className)}>
        <div
          className={cn(
            "mb-8 flex items-start justify-between gap-4",
            styles.header,
            headerClassName,
          )}
        >
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold leading-tight text-slate-900">
              {title}
            </h2>
            {description && (
              <p className="mt-2 text-sm text-slate-500">{description}</p>
            )}
          </div>
          {headerRight}
          {decorative && (
            <p className={cn(styles.tagline, "hidden shrink-0 text-right text-xs leading-relaxed text-slate-400 lg:block")}>
              更懂你
              <br />
              也让智能家居更好地为你服务
            </p>
          )}
        </div>

        {children}

        {footer && <div className="mt-20 flex justify-end">{footer}</div>}
      </div>
    </div>
  );
}
