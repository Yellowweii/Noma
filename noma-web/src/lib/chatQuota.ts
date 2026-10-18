export type ChatQuota = {
  limit: number;
  guest_limit?: number;
  user_limit?: number;
  used: number;
  remaining: number;
  reset_at: string;
  guest: boolean;
};
