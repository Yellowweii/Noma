import Link from "next/link";
import { WechatGroupButton } from "./WechatGroupButton";
import styles from "./hero-demo.module.css";

export function HeroTextContent({ isSignedIn = false }: { isSignedIn?: boolean }) {
  return (
    <div className={styles.heroCopy}>
      <h1 id="hero-title" className={styles.heroTitle}>
        <span>Noma，让家</span><span>越来越懂你</span>
      </h1>
      <p className={styles.heroDescription}>
        <span>Noma 会逐渐了解你，记住你的生活习惯，</span><span>让智能家居更懂你的需求</span>
      </p>
      <div className={styles.heroActions}>
        <Link href="/agent" className={styles.heroPrimary}>
          {isSignedIn ? "进入 Noma" : "开始体验"}
        </Link>
        <WechatGroupButton />
      </div>
    </div>
  );
}
