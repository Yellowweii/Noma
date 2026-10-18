"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "./landing.module.css";

gsap.registerPlugin(useGSAP);

export function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const answer = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!answer.current) return;
    gsap.to(answer.current, {
      height: open ? "auto" : 0,
      opacity: open ? 1 : 0,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.32,
      ease: "power2.inOut",
      overwrite: true,
    });
  }, { dependencies: [open], scope: answer });

  return (
    <div className={styles.faqItem}>
      <h3>
        <button
          id={`${id}-question`}
          type="button"
          className={styles.faqQuestion}
          aria-expanded={open}
          aria-controls={`${id}-answer`}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{question}</span>
          <span className={styles.faqIcon} aria-hidden="true" />
        </button>
      </h3>
      <div
        ref={answer}
        id={`${id}-answer`}
        className={styles.faqAnswer}
        role="region"
        aria-labelledby={`${id}-question`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className={styles.faqAnswerInner}>{children}</div>
      </div>
    </div>
  );
}
