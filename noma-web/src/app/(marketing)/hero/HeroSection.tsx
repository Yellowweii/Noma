"use client";

import { useRef } from "react";
import { HeroDemo } from "./HeroDemo";
import { HeroTextContent } from "./HeroTextContent";
import styles from "./hero-demo.module.css";

export function HeroSection({ isSignedIn = false }: { isSignedIn?: boolean }) {
  const storyTrack = useRef<HTMLDivElement>(null);

  return (
    <section className={styles.heroSection} aria-labelledby="hero-title">
      <div className={styles.heroInner}>
        <div ref={storyTrack} className={styles.heroTrack} data-hero-track>
          <div className={styles.heroStage} data-hero-stage>
            <div className={styles.heroIntro} data-hero-intro>
              <HeroTextContent isSignedIn={isSignedIn} />
            </div>
            <div className={styles.heroVisual} data-hero-visual><HeroDemo scrollTrack={storyTrack} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
