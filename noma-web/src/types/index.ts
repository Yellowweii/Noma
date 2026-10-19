export type MemoryOSType = "profile" | "fact" | "preference" | "skill";

export interface MemoryOSItem {
  source_time?: string;
  id: string;
  summary: string;
  type: MemoryOSType;
  confidence: number;
  importance: number;
  is_pinned: boolean;
  create_time: string;
}

export interface HomeBehaviorMemoryItem {
  timezone?: string;
  id: string;
  summary: string;
  scene?: string;
  room?: string;
  create_time: string;
  evidence_times?: string[];
  source?: "explicit_preference" | "behavior_habit";
  formation?: {
    mode: "explicit_preference" | "behavior_habit";
    status: "pending" | "processing" | "completed" | "failed";
    nodes?: { time: string; end_time?: string; text: string; evidence_ids: number[] }[];
  };
}

export interface MemoryTopic {
  id: string;
  name: string;
  memory_count: number;
  created_at: string;
}

export interface RecentUnderstandingTopic {
  id: string;
  topic: string;
  summary: string;
  created_at: string;
  updated_at: string;
  conversation_refs: string[];
  needs_rebuild?: boolean;
}

export interface RecentUnderstandingDetail {
  topic: RecentUnderstandingTopic;
  conversations: {
    session_id: string;
    message: { message_id: string; content: string; created_at: string };
    replies: { message_id: string; content: string; created_at: string }[];
  }[];
}

export interface MemoryOverview {
  total_memories: number;
  recorded_days: number;
  profile_summary?: string;
  profile_updated_at?: string;
  profile?: Record<string, unknown>;
}

export interface User {
  phone?: string;
  user_id: string;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: string;
}

export interface ChatSession {
  session_id: string;
  user_id: string;
  title: string;
  is_pinned: boolean;
  pinned_at?: string;
  created_at: string;
  updated_at: string;
}

export type MessageFeedback = "up" | "down";

export interface ChatMessage {
  message_id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  feedback?: MessageFeedback;
  tool_calls?: ToolCall[];
  created_at: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export interface Device {
  id: string;
  entity_id: string;
  name: string;
  domain: string;
  room?: string;
  area_id?: string;
  device_id?: string;
  supported_actions?: string[];
  action_params?: Record<string, string[]>;
  home_visible?: boolean;
  state: string;
  attributes?: Record<string, unknown>;
  last_updated: string;
}

export interface PresenceEntry {
  entity_id: string;
  name: string;
  domain: string;
  state: string;
  at_home: boolean;
  display_state: string;
}

export interface HomeStatus {
  temperature?: number;
  humidity?: number;
  air_quality?: string;
  occupancy?: number;
  presence?: PresenceEntry[];
  at_home_count?: number;
  device_summary?: DeviceSummary[];
  updated_at?: string;
  configured?: boolean;
  ha_reachable?: boolean;
  last_at_home_time?: string;
  message?: string;
}

export interface DeviceSummary {
  name: string;
  room?: string;
  state: string;
  domain: string;
}

export interface UserSettings {
  user_id: string;
  home_assistant_configured?: boolean;
  allowed_device_ids?: string[];
  blocked_device_ids?: string[];
  require_confirm_high_risk: boolean;
  auto_memory_enabled: boolean;
}

export interface HAConnectionStatus {
  available: boolean;
  prepared: boolean;
  connection_id?: string;
  local_url?: string;
  command?: string;
  tunnel_connected?: boolean;
  frpc_online?: boolean;
  ha_reachable?: boolean;
  can_authorize?: boolean;
  status?: "not_started" | "connected" | "error";
  diagnostic?: string;
  authorized?: boolean;
  home_name?: string;
}

export interface AgentStreamEvent {
  type: "token" | "done" | "error" | "tool" | "meta";
  content?: string;
  data?: Record<string, string>;
}

export interface TurnTraceEvent {
  id: string;
  user_id: string;
  message_id: string;
  stage: string;
  decision: string;
  detail: unknown;
  created_at: string;
}

export interface TurnTraceResponse {
  message_id: string;
  events: TurnTraceEvent[];
  agent_events: TurnTraceEvent[];
  memory_events: TurnTraceEvent[];
  agent_count: number;
  total_count: number;
}

export const MEMORY_OS_TYPE_LABELS: Record<MemoryOSType, string> = {
  profile: "用户信息",
  fact: "事实",
  preference: "偏好",
  skill: "技能",
};

export const MEMORY_OS_TYPE_ORDER: MemoryOSType[] = [
  "profile",
  "preference",
  "fact",
  "skill",
];
