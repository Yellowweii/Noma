/** Leave time to read the reply and settle into the finished home before looping. */
export const HERO_TIMELINE = {
  duration: 19, typing: .45, user: 1.75, thinking: 2.1, reply: 2.65,
  replyEnd: 5.2, agentOut: 7, homeIn: 7.2,
  bedroom: 8.8, air: 10.25, living: 11.65, complete: 12.85,
  homeOut: 15.5, agentIn: 15.7,
  agentFade: 1.4, homeFade: 1.4, welcomeFade: .45,
  bedroomFade: 1.05, airFade: .9, livingFade: 1.1,
} as const;
export const HERO_PROMPT = "我准备睡觉了";
export const HERO_REPLY = "我已经根据你的习惯调整好了睡前环境。卧室灯已调暗，空调已调到 26℃，客厅灯已关闭。";
export function progress(time: number, start: number, duration: number) {
  return Math.max(0, Math.min(1, (time - start) / duration));
}
export function easeProgress(time: number, start: number, duration: number) {
  const value = progress(time, start, duration);
  return value * value * (3 - 2 * value);
}

/** Only text, labels and accessibility states go through React; GSAP renders continuous motion. */
export function getHeroFrame(time: number) {
  const T = HERO_TIMELINE;
  const replyLength = Math.floor(progress(time, T.reply, T.replyEnd - T.reply) * HERO_REPLY.length);
  return {
    phase: time < T.homeIn ? "agent" : time < T.homeOut ? "home" : "returning",
    typing: time >= T.typing && time < T.user,
    typed: HERO_PROMPT.slice(0, Math.max(0, Math.floor((time - T.typing) / .17))),
    reply: HERO_REPLY.slice(0, replyLength),
    streaming: time >= T.reply && replyLength < HERO_REPLY.length,
    thinking: time >= T.thinking && time < T.reply,
    replyStarted: time >= T.reply,
    agentHidden: time >= T.agentOut + T.agentFade && time < T.agentIn,
    welcomeHidden: time >= T.user + T.welcomeFade && time < T.agentIn,
    conversationHidden: time < T.user || time >= T.agentIn,
    homeHidden: time < T.homeIn || time >= T.homeOut + T.homeFade,
    brightness: Math.round(80 - 60 * easeProgress(time, T.bedroom, T.bedroomFade)),
    airOn: time >= T.air + T.airFade,
    livingOff: time >= T.living + T.livingFade,
  };
}

export type HeroFrame = ReturnType<typeof getHeroFrame>;
