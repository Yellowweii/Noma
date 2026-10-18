import { Check } from "lucide-react";

import { NomaLogo } from "@/components/NomaLogo";
import { cn } from "@/lib/utils";

export type LoginEnteringStep = 1 | 2 | 3 | 4;

const STEPS = [
  { id: 1 as const, label: "Google 登录已完成" },
  { id: 2 as const, label: "正在同步你的信息" },
  { id: 3 as const, label: "即将进入 Noma" },
];

const PROGRESS_BY_STEP: Record<LoginEnteringStep, number> = {
  1: 28,
  2: 45,
  3: 78,
  4: 100,
};

type StepStatus = "done" | "active" | "pending";

function getStepStatus(stepId: 1 | 2 | 3, activeStep: LoginEnteringStep): StepStatus {
  if (activeStep === 4 || stepId < activeStep) return "done";
  if (stepId === activeStep) return "active";
  return "pending";
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-noma-brand">
        <Check className="size-3 stroke-[3] text-white" aria-hidden="true" />
      </span>
    );
  }

  if (status === "active") {
    return (
      <span className="relative flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border-2 border-[#dce5e1]" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-noma-brand border-r-transparent border-b-transparent" />
      </span>
    );
  }

  return (
    <span
      className="size-5 shrink-0 rounded-full border-2 border-[#dce5e1]"
      aria-hidden="true"
    />
  );
}

type LoginEnteringScreenProps = {
  activeStep: LoginEnteringStep;
  loginLabel?: string;
};

export function LoginEnteringScreen({ activeStep, loginLabel = "Google 登录已完成" }: LoginEnteringScreenProps) {
  return (
    <div className="relative flex h-full min-h-full flex-col bg-white">
      <div className="absolute left-8 top-8 flex items-center gap-2">
        <NomaLogo className="size-8" />
        <span className="text-[17px] font-semibold leading-none text-noma-primary">Noma</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <NomaLogo className="size-20" />
        <h1 className="mt-8 text-center text-[28px] font-semibold leading-tight tracking-[-0.02em] text-noma-primary">
          正在进入 Noma
        </h1>
        <p className="mt-2 text-center text-sm text-noma-secondary">
          Noma 正在同步你的信息与偏好
        </p>

        <div className="mt-10 w-full max-w-[420px]">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[#e8eeeb]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={PROGRESS_BY_STEP[activeStep]}
            aria-label="登录进度"
          >
            <div
              className="h-full rounded-full bg-noma-brand transition-[width] duration-700 ease-out"
              style={{ width: `${PROGRESS_BY_STEP[activeStep]}%` }}
            />
          </div>

          <ol className="mx-auto mt-10 w-fit space-y-6">
            {STEPS.map((step, index) => {
              const status = getStepStatus(step.id, activeStep);
              const isLast = index === STEPS.length - 1;

              return (
                <li key={step.id} className="relative flex items-center gap-3">
                  {!isLast && (
                    <span
                      className="absolute left-[9px] top-5 h-[calc(100%+8px)] w-px bg-[#e3e8e5]"
                      aria-hidden="true"
                    />
                  )}
                  <StepIcon status={status} />
                  <span
                    className={cn(
                      "text-sm leading-none",
                      status === "pending" ? "text-noma-tertiary" : "text-noma-primary",
                    )}
                  >
                    {step.id === 1 ? loginLabel : step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
