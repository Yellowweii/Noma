"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { AgentDemo } from "./AgentDemo";
import { SmartHomeScene } from "./SmartHomeScene";
import { HERO_TIMELINE as T, getHeroFrame } from "./hero-timeline";
import styles from "./hero-demo.module.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SCROLL_STORY_END = T.complete + .6;

/** One GSAP timeline owns both the story and its scroll playhead. */
export function HeroDemo({ scrollTrack }: { scrollTrack?: RefObject<HTMLDivElement | null> }) {
  const container = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(() => getHeroFrame(0));

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const canvas = element.querySelector<HTMLElement>("[data-hero-canvas]");
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      element.style.setProperty("--hero-fit-scale", String(entry.contentRect.width / canvas.offsetWidth));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.style.removeProperty("--hero-fit-scale");
    };
  }, []);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({
      motion: "(prefers-reduced-motion: no-preference)",
      reduced: "(prefers-reduced-motion: reduce)",
      mobile: "(max-width: 800px)",
    }, context => {
      if (scrollTrack && context.conditions?.mobile) return;
      const reduced = !!context.conditions?.reduced;
      // A parent's host ref may attach after its child's layout effect on mount.
      const track = scrollTrack ? container.current?.closest<HTMLElement>("[data-hero-track]") : null;
      const scroller = container.current?.closest<HTMLElement>("[data-landing-scroller]");
      const stage = container.current?.closest<HTMLElement>("[data-hero-stage]");
      let lastFrame = "";
      const syncFrame = (time: number) => {
        const next = getHeroFrame(time);
        const key = JSON.stringify(next);
        if (key !== lastFrame) {
          lastFrame = key;
          setFrame(next);
        }
      };

      // Keep the original smoothstep easing while rendering directly on one ticker.
      const ease = (value: number) => value * value * (3 - 2 * value);
      const story = gsap.timeline({ paused: true });
      story
        .to({}, { duration: scrollTrack ? SCROLL_STORY_END : T.duration }, 0)
        .fromTo("[data-hero-welcome]", { opacity: 1 }, { opacity: 0, duration: T.welcomeFade, ease }, T.user)
        .fromTo("[data-hero-conversation]", { opacity: 0 }, { opacity: 1, duration: T.welcomeFade, ease }, T.user)
        .fromTo("[data-agent-demo]", { opacity: 1, scale: 1 }, { opacity: 0, scale: .96, duration: T.agentFade, ease }, T.agentOut)
        .fromTo("[data-home-scene]", { opacity: 0, scale: .97 }, { opacity: 1, scale: 1, duration: T.homeFade, ease }, T.homeIn);

      for (const [device, start, duration] of [
        ["bedroom", T.bedroom, T.bedroomFade],
        ["air", T.air, T.airFade],
        ["living", T.living, T.livingFade],
      ] as const) {
        story.fromTo(`[data-device-reveal="${device}"]`, { opacity: 0 }, { opacity: 1, duration, ease }, start);
      }
      story.fromTo("[data-hero-airflow]", { y: 0 }, { y: 3, duration: 1, repeat: 2, yoyo: true, ease: "sine.inOut" }, T.air);

      if (!scrollTrack) {
        story
          .to("[data-home-scene]", { opacity: 0, scale: .97, duration: T.homeFade, ease }, T.homeOut)
          .to("[data-agent-demo]", { opacity: 1, scale: 1, duration: T.agentFade, ease }, T.agentIn)
          .to("[data-hero-welcome]", { opacity: 1, duration: T.agentFade, ease }, T.agentIn)
          .to("[data-hero-conversation]", { opacity: 0, duration: T.agentFade, ease }, T.agentIn);
      }
      story.eventCallback("onUpdate", () => syncFrame(story.time()));

      if (reduced) {
        story.time(SCROLL_STORY_END);
        syncFrame(SCROLL_STORY_END);
        return;
      }
      syncFrame(0);

      if (scrollTrack) {
        // Never fall back to autoplay when scroll-driven elements aren't ready.
        if (!track || !scroller || !stage) return;
        const intro = track.querySelector<HTMLElement>("[data-hero-intro]");
        const visual = container.current?.closest<HTMLElement>("[data-hero-visual]");
        if (!intro || !visual) return;
        const headerHeight = () => parseFloat(getComputedStyle(track).getPropertyValue("--hero-header-height")) || 64;
        const handoff = gsap.timeline({ paused: true })
          .fromTo(intro, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -32, duration: .55, ease: "power1.inOut" }, 0)
          .fromTo(visual, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .75, ease: "power1.out" }, .25);
        let distance = 1;
        let handoffDistance = 1;
        const measure = () => {
          distance = Math.max(1, track.offsetHeight - stage.offsetHeight);
          // The stage height resolves 100svh, keeping this in sync with the CSS clamp.
          const viewportHeight = stage.offsetHeight + headerHeight();
          handoffDistance = Math.min(640, Math.max(360, viewportHeight * .65));
        };
        measure();
        const render = (value: number) => {
          const travel = value * distance;
          handoff.progress(Math.min(1, travel / handoffDistance));
          // Show the full-size welcome frame before advancing the existing story.
          story.progress(Math.max(0, Math.min(1, (travel - handoffDistance) / Math.max(1, distance - handoffDistance))));
        };
        const playhead = { progress: 0 };
        const driver = gsap.to(playhead, {
          progress: 1, duration: 1, ease: "none", paused: true,
          onUpdate: () => render(playhead.progress),
        });
        render(0);
        ScrollTrigger.create({
          trigger: track,
          scroller,
          animation: driver,
          start: () => `top top+=${headerHeight()}`,
          end: () => `+=${distance}`,
          scrub: .45,
          invalidateOnRefresh: true,
          onRefreshInit: measure,
          // A fast fling must settle the final frame before releasing the stage.
          onLeave: self => { self.getTween()?.progress(1); },
          onLeaveBack: self => { self.getTween()?.progress(1); },
        });
        return;
      }

      // Preserve standalone playback without an idle frame loop while hidden.
      story.repeat(-1);
      let visible = false;
      const syncPlayback = () => { story.paused(!visible || document.hidden); };
      const observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        syncPlayback();
      }, { threshold: .15 });
      if (container.current) observer.observe(container.current);
      document.addEventListener("visibilitychange", syncPlayback);
      return () => {
        observer.disconnect();
        document.removeEventListener("visibilitychange", syncPlayback);
      };
    });
    return () => media.revert();
  }, { scope: container, dependencies: [scrollTrack], revertOnUpdate: true });

  return (
    <div ref={container} className={styles.root} data-hero-demo data-phase={frame.phase}>
      <div className={styles.scene} data-hero-canvas>
        <AgentDemo frame={frame} />
        <SmartHomeScene frame={frame} />
      </div>
      <p className="sr-only">你说「我准备睡觉了」，Noma 根据生活习惯回应；卧室灯调暗，空调开启至 26℃，客厅灯关闭。</p>
    </div>
  );
}
