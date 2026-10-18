"use client";

import Image from "next/image";
import { Lightbulb, Snowflake } from "lucide-react";
import { type HeroFrame } from "./hero-timeline";
import styles from "./hero-demo.module.css";

/** One continuous home panorama. Local photo masks let each real device change in sequence. */
export function SmartHomeScene({ frame }: { frame: HeroFrame }) {
  const { brightness, airOn, livingOff } = frame;
  const images = [
    { key: "bedroom", mask: styles.bedroomPhotoChange },
    { key: "air", mask: styles.airPhotoChange },
    { key: "living", mask: styles.livingPhotoChange },
  ];

  return (
    <div className={styles.physicalScene}
      aria-hidden={frame.homeHidden}
      aria-label={`卧室灯亮度 ${brightness}%，空调${airOn ? "已开启至 26℃" : "待机"}，客厅灯${livingOff ? "已关闭" : "已开启"}`}
      data-home-scene>
      <div className={styles.panorama} aria-hidden="true">
        <Image src="/images/hero/home-panorama-before.png" alt="" fill priority sizes="90vw"
          className={styles.panoramaImage} />
        {images.map(image => (
          <div key={image.key} className={`${styles.panoramaAfter} ${image.mask}`}
            data-photo-change={image.key} data-device-reveal={image.key}>
            <Image src="/images/hero/home-panorama-bedtime.png" alt="" fill priority sizes="90vw"
              className={styles.panoramaImage} />
          </div>
        ))}
        <span className={styles.acDisplay} data-device-reveal="air">26℃</span>
        <svg viewBox="0 0 120 72" className={styles.airflow} data-device-reveal="air" data-hero-airflow fill="none" aria-hidden="true">
          <path d="M28 2C16 21 37 30 24 53M59 2C46 23 72 37 56 67M91 2C78 19 103 34 89 54" stroke="#abb9b4" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <div className={`${styles.deviceCallout} ${styles.bedroomCallout}`} data-device-reveal="bedroom">
          <Lightbulb size={14} /><span>卧室灯<small>20% 亮度</small></span>
        </div>
        <div className={`${styles.deviceCallout} ${styles.airCallout}`} data-device-reveal="air">
          <Snowflake size={14} /><span>壁挂空调<small>26℃ · 已开启</small></span>
        </div>
        <div className={`${styles.deviceCallout} ${styles.livingCallout}`} data-device-reveal="living">
          <Lightbulb size={14} /><span>客厅灯<small>已关闭</small></span>
        </div>
        <span className={`${styles.devicePin} ${styles.bedroomPin}`} data-device-reveal="bedroom" aria-hidden="true" />
        <span className={`${styles.devicePin} ${styles.airPin}`} data-device-reveal="air" aria-hidden="true" />
        <span className={`${styles.devicePin} ${styles.livingPin}`} data-device-reveal="living" aria-hidden="true" />
      </div>
    </div>
  );
}
