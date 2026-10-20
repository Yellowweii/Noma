import Link from "next/link";
import { ArrowRight, Box, Globe, KeyRound } from "lucide-react";
import { ScrollArea } from "@/components/layout/ScrollArea";
import styles from "./home-empty-state.module.css";

const steps = [
  {
    icon: Box,
    title: "部署 Home Assistant",
    description: "在家中的设备上安装并运行 Home Assistant",
    href: "/settings/ha",
  },
  {
    icon: KeyRound,
    title: "建立 Noma 连接",
    description: "填写 HA 本地地址，在家中的设备上启动 Noma 连接服务",
    href: "/settings/ha",
  },
  {
    icon: Globe,
    title: "授权 Home Assistant",
    description: "填写长期访问令牌，验证后进入家",
    href: "/settings/ha",
  },
];

export function HomeEmptyState() {
  return (
    <ScrollArea className={`h-full ${styles.page}`}>
      <div className={styles.content}>
        <section className={styles.connection} aria-labelledby="home-connect-title">
          <h1 id="home-connect-title">连接 Home Assistant</h1>
          <p className={styles.description}>
            连接后，你可以查看家庭状态、控制智能设备，让 Noma 逐渐了解你的家庭习惯
          </p>
          <div className={styles.actions}>
            <Link href="/settings/ha" className={styles.connectButton}>
              连接 Home Assistant
            </Link>
          </div>
        </section>

        <section className={styles.quickStart} aria-labelledby="home-quick-start-title">
          <h2 id="home-quick-start-title">快速开始</h2>
          <p className={styles.description}>完成以下准备，即可连接 Home Assistant</p>
          <ol className={styles.steps}>
            {steps.map(({ icon: Icon, title, description, href }) => (
              <li key={title} className={styles.step}>
                <Icon className={styles.stepIcon} size={26} strokeWidth={1.8} aria-hidden="true" />
                <div className={styles.stepContent}>
                  <h3>
                    <Link href={href}>
                      {title}
                      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                    </Link>
                  </h3>
                  <p>{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </ScrollArea>
  );
}
