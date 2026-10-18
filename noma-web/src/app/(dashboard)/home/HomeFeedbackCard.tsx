"use client";

import { useId } from "react";
import { ArrowRight, Info } from "lucide-react";
import { FeedbackButton } from "@/components/settings/FeedbackButton";
import memoryStyles from "../memory/memory.module.css";
import styles from "./home-dashboard.module.css";

export function HomeFeedbackCard() {
  const id = useId();
  return <section className={styles.feedbackCard} aria-labelledby={`${id}-title`}>
    <div className={styles.feedbackHeading}>
      <Info size={18} strokeWidth={1.75} aria-hidden="true" />
      <div className={styles.feedbackIntro}>
        <span id={`${id}-title`}>设备功能不完整？</span>
        <FeedbackButton className={`${memoryStyles.sectionAction} ${styles.feedbackToggle}`}>
          反馈问题<ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </FeedbackButton>
      </div>
    </div>
  </section>;
}
