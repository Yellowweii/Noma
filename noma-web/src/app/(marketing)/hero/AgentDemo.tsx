"use client";

import { useId, useState } from "react";
import { ArrowUp, Brain, ChevronDown, Copy, Home, Mic, PanelLeft, RotateCcw, Search, Settings, SquarePen, ThumbsDown, ThumbsUp, UserRound, Volume2 } from "lucide-react";
import { NomaLogo } from "@/components/NomaLogo";
import { UserMessageBubble } from "@/components/chat/UserMessageBubble";
import { HERO_PROMPT, type HeroFrame } from "./hero-timeline";
import styles from "./hero-demo.module.css";

/** The real product's chat layout and message bubble, driven by local Hero copy. */
export function AgentDemo({ frame }: { frame: HeroFrame }) {
  const { typing, typed, reply, streaming } = frame;
  const [recentOpen, setRecentOpen] = useState(true);
  const recentId = useId();

  return (
    <div className={styles.agentScene} aria-hidden={frame.agentHidden} inert={frame.agentHidden} data-agent-demo>
      <div className={styles.agentCanvas}>
      <aside className={styles.sidebar} aria-label="Noma 导航">
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarBrand}><NomaLogo className={styles.logo} /><span>Noma</span></span>
          <span className={styles.sidebarTools}><Search /><PanelLeft /></span>
        </div>
        <nav className={styles.sidebarNav}>
          <span className={styles.sidebarItem}><SquarePen /><span>新聊天</span></span>
          <span className={styles.sidebarItem}><Brain /><span>记忆</span></span>
          <span className={styles.sidebarItem}><Home /><span>家</span></span>
          <span className={styles.sidebarItem}><Settings /><span>设置</span></span>
        </nav>
        <button type="button" className={styles.sessionLabel} aria-expanded={recentOpen} aria-controls={recentId}
          aria-label={recentOpen ? "折叠最近会话" : "展开最近会话"} onClick={() => setRecentOpen(open => !open)}>
          最近 <ChevronDown aria-hidden="true" />
        </button>
        <ul id={recentId} className={styles.recentSessions} hidden={!recentOpen} aria-label="最近会话">
          {!frame.conversationHidden && <li className={styles.currentSession} title="睡前环境调整" aria-current="true">睡前环境调整</li>}
        </ul>
        <span className={styles.sidebarFoot}><span className={styles.userAvatar}><UserRound /></span><span>用户768040</span></span>
      </aside>
      <div className={styles.chat}>
        <div className={styles.welcomePage} data-hero-welcome aria-hidden={frame.welcomeHidden}>
          <div className={styles.welcomeContent}>
            <NomaLogo className={styles.welcomeLogo} />
            <h2>Hi，我是 <span>Noma</span></h2>
            <p>懂你，也让智能家居更好地为你服务</p>
          </div>
          <div className={styles.welcomeComposer}>
            <span className={typing ? styles.typed : ""}>{typing ? typed : "问问 Noma"}{typing && <i className={styles.cursor} />}</span>
            <Mic aria-hidden="true" /><span className={styles.send}><ArrowUp aria-hidden="true" /></span>
          </div>
        </div>
        <div className={styles.conversationPage} data-hero-conversation aria-hidden={frame.conversationHidden}>
          <div className={styles.messages}>
            <div className={styles.user}><UserMessageBubble content={HERO_PROMPT} className={styles.bubble} /></div>
            {frame.thinking && <div className={styles.thinking} aria-label="正在生成回复"><i /><i /><i /></div>}
            {frame.replyStarted && <div className={styles.response}>
              <p className={styles.agentReply}>{reply}{streaming && <i className={styles.streamCursor} aria-hidden="true" />}</p>
              {!streaming && <span className={styles.messageActions} aria-hidden="true"><Copy /><ThumbsUp /><ThumbsDown /><RotateCcw /><Volume2 /></span>}
            </div>}
          </div>
          <div className={styles.chatComposer}>
            <span>问问 Noma</span><Mic aria-hidden="true" /><span className={styles.send}><ArrowUp aria-hidden="true" /></span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
