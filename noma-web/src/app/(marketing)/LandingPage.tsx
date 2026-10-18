"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  AirVent,
  Check,
  Fan,
  Github,
  Leaf,
  Lightbulb,
  LockKeyhole,
  MoreHorizontal,
  MoonStar,
  PanelsTopLeft,
  Smartphone,
  Monitor,
  House,
  Sparkles,
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { NomaLogo } from "@/components/NomaLogo";
import { FeedbackButton } from "@/components/settings/FeedbackButton";
import styles from "./landing.module.css";
import { HeroSection } from "./hero/HeroSection";
import { FaqItem } from "./FaqItem";
import { LandingHeaderActions } from "./LandingHeaderActions";
import type { LandingUser } from "@/types";

gsap.registerPlugin(useGSAP, ScrollTrigger);


export default function LandingPage({ user }: { user: LandingUser | null }) {
  const root = useRef<HTMLDivElement>(null);
  const [videoError, setVideoError] = useState(false);

  useGSAP(
    () => {
      if (!root.current) return;
      let mounted = true;
      document.fonts.ready.then(() => {
        if (mounted) ScrollTrigger.refresh();
      });
      // FAQ changes the height of later sections.
      const resizeObserver = new ResizeObserver(() => ScrollTrigger.refresh());
      const main = root.current.querySelector("main");
      if (main) resizeObserver.observe(main);
      return () => {
        mounted = false;
        resizeObserver.disconnect();
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className={styles.page} data-landing-scroller>
      <a className={styles.skipLink} href="#main">
        跳转到主要内容
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Noma 首页">
            <NomaLogo className={styles.brandLogo} />
            <span>Noma</span>
          </Link>
          <LandingHeaderActions user={user} />
        </div>
      </header>
      <main id="main">
        <HeroSection isSignedIn={!!user} />
        <section id="experience" className={`${styles.section} ${styles.videoSection}`} aria-labelledby="experience-title">
          <div className={styles.videoHeading}>
            <h2 id="experience-title">一分钟，看懂 Noma</h2>
          </div>
          <div className={styles.videoFrame}>
            <video src="/videos/noma-promo.mp4?v=e587fe2cf2bc" poster="/videos/noma-promo-poster.png?v=73852d9e302a" preload="none" playsInline controls
              aria-label="Noma 品牌宣传视频：从日常对话到记忆，再到智能家居行动"
              onError={() => setVideoError(true)} />
          </div>
          {videoError && <p className={styles.videoError} role="status">视频暂时无法播放，请使用播放器重试。你也可以继续向下了解如何开始。</p>}
        </section>
        <section
          id="start"
          className={`${styles.section} ${styles.getStarted}`}
          aria-labelledby="start-title"
        >
          <div className={styles.startIntro}>
            <div>
              <h2 id="start-title">懂你的日常，<br />连接家的每一种可能</h2>
            </div>
            <div className={styles.startLead}>
              <p>从随时随地掌控，到记得你的偏好，再到连接不同品牌的设备。让家的智能，围绕你的生活展开。</p>
            </div>
          </div>
          <div className={styles.valueCards}>
            <article className={styles.valueCard} aria-labelledby="value-access-title">
              <div className={`${styles.valueVisual} ${styles.accessArtwork}`} role="img" aria-label="手机和平板同步展示 Noma 我的家设备界面" />
              <div className={styles.valueCopy}>
                <span className={styles.valueEyebrow}><Monitor size={14} aria-hidden="true" /><Smartphone size={14} aria-hidden="true" /> 跨端互通 · 远程控制</span>
                <h3 id="value-access-title">无论在哪，家都在手边。</h3>
                <p>手机、平板、电脑，同一账号连接同一个家。出门在外，也能查看设备状态，用一句话远程调整家中的灯光与空调。</p>
              </div>
            </article>
            <article className={styles.valueCard} aria-labelledby="value-memory-title">
              <div className={styles.valueVisual}>
                <Image className={styles.featurePhoto} src="/images/features/personalized-memory-v2.webp" alt="浅绿色记忆盒中收纳着月亮、光照和温度卡片，象征 Noma 记住你的生活偏好" fill unoptimized sizes="(max-width: 800px) 90vw, (max-width: 1000px) 44vw, 420px" />
                <span className={styles.memoryTag}><Sparkles size={13} aria-hidden="true" /> 记得你的生活偏好</span>
              </div>
              <div className={styles.valueCopy}>
                <span className={styles.valueEyebrow}><Sparkles size={14} aria-hidden="true" /> 长期记忆 · 个性化控制</span>
                <h3 id="value-memory-title">你的习惯，不用反复交代。</h3>
                <p>Noma 从日常对话中记住你的偏好与家居习惯。下次说“我要睡觉了”，它便能结合已有记忆，让灯光和温度更合你心意。</p>
              </div>
            </article>
            <article className={styles.valueCard} aria-labelledby="value-connect-title">
              <div className={styles.valueVisual}>
                <Image className={styles.featurePhoto} src="/images/features/connected-home.webp" alt="浅色桌面上的智能灯、家庭网关和智能插座" fill unoptimized sizes="(max-width: 800px) 90vw, (max-width: 1000px) 44vw, 420px" />
                <div className={styles.ecosystemBrands} aria-label="支持的智能家居生态">
                  <span><Image src="/images/brands/mijia.png" alt="" width={24} height={24} unoptimized />米家</span>
                  <span><Image src="/images/brands/home-assistant.png" alt="" width={24} height={24} unoptimized />Home Assistant</span>
                  <span><Image src="/images/brands/tuya.png" alt="" width={24} height={24} unoptimized />涂鸦</span>
                  <span><Image src="/images/brands/homekit.png" alt="" width={24} height={24} unoptimized />HomeKit</span>
                </div>
              </div>
              <div className={styles.valueCopy}>
                <span className={styles.valueEyebrow}><House size={14} aria-hidden="true" /> 多品牌接入 · 统一掌控</span>
                <h3 id="value-connect-title">不同品牌，也能默契配合。</h3>
                <p>通过 Home Assistant，连接米家、涂鸦、HomeKit 等生态中的兼容设备。让不同品牌的灯光、窗帘与空调，都能通过 Noma 自然控制。</p>
              </div>
            </article>
          </div>
        </section>
        <section id="vision" className={styles.visionSection} aria-labelledby="vision-title">
          <div className={`${styles.section} ${styles.visionInner}`}>
            <h2 id="vision-title">未来，让家更自然、<span>更主动地懂你</span></h2>
            <div className={styles.visionCopy}>
              <p>Noma 会感知你的生活场景，结合你的习惯与家庭环境，<br className={styles.visionLineBreak} />在合适的时机主动执行智能家居操作，或为你提供贴心建议。</p>
            </div>
            <div className={styles.visionCards}>
              <article className={`${styles.visionCard} ${styles.visionVoiceCard}`} aria-labelledby="vision-voice-title">
                <Image className={styles.visionImage} src="/images/vision/voice-living-room.webp" alt="" fill sizes="(max-width: 666px) 90vw, (max-width: 1000px) 600px, (max-width: 1454px) 44vw, 628px" />
                <div className={styles.visionCardCopy}>
                  <span className={styles.visionNumber}>01</span>
                  <h3 id="vision-voice-title">语音唤醒，随时对话</h3>
                  <p>只需一句“Hey Noma”，就能自然地唤醒它。无论做家务、躺在沙发上，还是双手忙碌时，都能轻松说出你的需求。</p>
                </div>
                <ul className={styles.visionVoiceExamples} aria-label="未来语音交互示例">
                  <li><AudioLines size={17} aria-hidden="true" /><span>Hey Noma，打开客厅灯</span></li>
                  <li><AudioLines size={17} aria-hidden="true" /><span>Hey Noma，空调调到 26 度</span></li>
                  <li><AudioLines size={17} aria-hidden="true" /><span>Hey Noma，我要睡觉了</span></li>
                </ul>
                <div className={styles.visionVoiceBubble} aria-hidden="true">
                  <NomaLogo className={styles.visionBubbleLogo} />
                  <AudioLines size={30} />
                </div>
              </article>
              <article className={styles.visionCard} aria-labelledby="vision-care-title">
                <Image className={styles.visionImage} src="/images/vision/proactive-bedroom.webp" alt="" fill sizes="(max-width: 666px) 90vw, (max-width: 1000px) 600px, (max-width: 1454px) 44vw, 628px" />
                <div className={styles.visionCardCopy}>
                  <span className={styles.visionNumber}>02</span>
                  <h3 id="vision-care-title">主动理解，贴心服务</h3>
                  <p>Noma 能感知你的生活场景，结合你的习惯与家庭环境，在合适的时机主动执行智能家居操作，或为你提供贴心建议。</p>
                </div>
                <ul className={styles.visionNotices} aria-label="未来主动服务场景示例">
                  <li className={styles.visionNoticeAir}>
                    <span className={styles.visionNoticeIcon}><Fan size={21} aria-hidden="true" /></span>
                    <div><strong>室内温度有些高</strong><span>要帮你把空调调到喜欢的 26°C 吗？</span></div>
                  </li>
                  <li className={styles.visionNoticeRest}>
                    <span className={styles.visionNoticeIcon}><MoonStar size={21} aria-hidden="true" /></span>
                    <div><strong>检测到你准备休息</strong><span>已按照睡前习惯调整灯光和空调</span></div>
                  </li>
                  <li className={styles.visionNoticeEnergy}>
                    <span className={styles.visionNoticeIcon}><Leaf size={21} aria-hidden="true" /></span>
                    <div><strong>发现一个节能建议</strong><span>客厅长时间无人，建议关闭照明</span></div>
                  </li>
                </ul>
              </article>
              <article className={`${styles.visionCard} ${styles.visionConnectCard}`} aria-labelledby="vision-connect-title">
                <Image className={styles.visionImage} src="/images/vision/direct-connect-reference.webp" alt="" fill sizes="(max-width: 1000px) 90vw, 1280px" />
                <div className={styles.visionCardCopy}>
                  <span className={styles.visionNumber}>03</span>
                  <h3 id="vision-connect-title">轻松连接，自由掌控</h3>
                  <p>无需依赖 Home Assistant，也能直接连接更多品牌的智能家居设备，让智能生活不再受复杂配置的限制。</p>
                  <ul className={styles.visionConnectBenefits}>
                    <li><Check size={17} aria-hidden="true" />支持主流品牌设备</li>
                    <li><Check size={17} aria-hidden="true" />简单配对，快速接入</li>
                    <li><Check size={17} aria-hidden="true" />无需复杂配置</li>
                  </ul>
                </div>
                <div className={styles.visionConnectNetwork} aria-label="Noma 连接灯光、窗帘、空调、门锁和更多设备的未来愿景">
                  <svg className={`${styles.visionConnectLines} ${styles.visionConnectLinesWide}`} viewBox="0 0 600 240" fill="none" preserveAspectRatio="none" aria-hidden="true"><path d="M300 170 Q240 70 100 27 M300 170 Q330 65 394 27 M300 170 L52 152 M300 170 L436 199 M300 170 Q445 200 567 93" /></svg>
                  <svg className={`${styles.visionConnectLines} ${styles.visionConnectLinesCompact}`} viewBox="0 0 600 240" fill="none" preserveAspectRatio="none" aria-hidden="true"><path d="M345 80 Q240 30 72 26 M345 80 L360 26 M345 80 Q210 150 66 153 M345 80 Q430 140 426 202 M345 80 L553 94" /></svg>
                  <div className={styles.visionDeviceLight}><span><Lightbulb /></span>灯光</div>
                  <div className={styles.visionDeviceCurtain}><span><PanelsTopLeft /></span>窗帘</div>
                  <div className={styles.visionDeviceAir}><span><AirVent /></span>空调</div>
                  <div className={styles.visionDeviceLock}><span><LockKeyhole /></span>门锁</div>
                  <div className={styles.visionDeviceMore}><span><MoreHorizontal /></span>更多设备</div>
                </div>
              </article>
            </div>
          </div>
        </section>
        <section id="faq" className={`${styles.section} ${styles.faqSection}`} aria-labelledby="faq-title">
          <div className={styles.faqIntro}>
            <h2 id="faq-title">常见问题</h2>
          </div>
          <div className={styles.faqList}>
            <FaqItem question="Noma 是什么？">
              <p>Noma 是一款面向家庭场景的 Home AI Agent（家庭 AI 助手）。它能够在日常交流中逐渐了解你、记住你的生活习惯，并通过连接智能家居，让家越来越懂你的需求。</p>
            </FaqItem>
            <FaqItem question="Noma 可以免费使用吗？">
              <p>可以。Noma 目前完全免费，每位用户每天享有免费对话额度，达到上限后可在第二天继续使用。未来可能推出付费计划，提供更高的使用额度和更多功能。</p>
            </FaqItem>
            <FaqItem question="Noma 与普通智能家居助手有什么不同？">
              <p>普通智能家居助手通常以指令控制为主。Noma 不仅能够控制设备，还会逐渐记住你的个人偏好和家庭使用习惯。随着使用次数增加，它能够结合你的习惯，更好地理解和执行你的需求。</p>
            </FaqItem>
            <FaqItem question="Noma 支持哪些智能家居设备？">
              <p>Noma 目前通过 Home Assistant 连接智能家居，支持多种品牌和类型的设备，包括部分米家、Aqara、飞利浦等智能设备。具体兼容性取决于设备型号及 Home Assistant 的支持情况。</p>
            </FaqItem>
            <FaqItem question="Home Assistant 是什么？">
              <p>Home Assistant 是一个开源的智能家居平台，可以把不同品牌的设备连接起来，统一管理和控制。Noma 通过它了解家中的设备状态，并执行你的设备控制请求。</p>
            </FaqItem>
            <FaqItem question="使用 Noma 必须安装 Home Assistant 吗？">
              <p>如果你希望通过 Noma 控制智能家居，目前需要先配置 Home Assistant，并将设备接入其中。如果只是想体验 Noma 的 AI 对话功能，则不需要连接 Home Assistant。</p>
            </FaqItem>
            <FaqItem question="Noma 会如何保护我的隐私和数据？">
              <p>Noma 需要处理部分对话内容和设备信息，以提供个性化的 AI 服务，部分功能依赖第三方 AI 与云服务。你可以在产品中查看、管理和删除已保存的记忆。有关数据的收集、使用与保护方式，请查看 <Link href="/privacy">隐私政策</Link>。</p>
            </FaqItem>
          </div>
          <div className={styles.faqFeedback}>
            <p>没有找到你想问的？</p>
            <FeedbackButton className={styles.faqFeedbackButton}>
              告诉我 <ArrowRight size={15} aria-hidden="true" />
            </FeedbackButton>
          </div>
        </section>
        <section className={styles.finalCta} aria-labelledby="cta-title">
          <div className={styles.ctaLandscape} aria-hidden="true" />
          <div className={styles.ctaContent}>
            <h2 id="cta-title">开始体验 <span>Noma</span></h2>
            <p className={styles.ctaSubtitle}>让 AI，更懂你的家</p>
            <Link href="/agent" className={styles.primaryButton}>
              开启你的 Noma 之旅 <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerMain}>
            <div className={styles.footerBrand}>
              <Link href="/" className={styles.footerBrandLink} aria-label="Noma 首页">
                <NomaLogo className={styles.footerLogo} />
                <span>Noma</span>
              </Link>
              <p>让 AI，更懂你的家</p>
            </div>
            <div className={styles.footerMeta}>
              <nav className={styles.footerNav} aria-label="产品与支持">
                <ul>
                  <li><Link href="/about">产品说明</Link></li>
                  <li><Link href="/terms" target="_blank" rel="noopener noreferrer">用户协议</Link></li>
                  <li><Link href="/privacy" target="_blank" rel="noopener noreferrer">隐私政策</Link></li>
                  <li><FeedbackButton className={styles.footerContactButton}>问题反馈</FeedbackButton></li>
                  <li>
                    <a className={styles.footerIconLink} href="https://github.com/Yellowweii/Noma" target="_blank" rel="noopener noreferrer" aria-label="Noma GitHub（在新标签页打开）">
                      <Github size={18} aria-hidden="true" />
                    </a>
                  </li>
                </ul>
              </nav>
              <p className={styles.footerCopyright}>© 2026 Noma. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
