"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { preloadUserAvatar } from "@/components/layout/UserAvatar";
import { api } from "@/lib/api";
import type { User } from "@/types";

interface UserContextValue {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  refreshUser: () => Promise<User | null>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children, isGuest = false }: { children: ReactNode; isGuest?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (isGuest) return null;
    try {
      const me = await api.getMe();
      preloadUserAvatar(me.avatar_url);
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    }
  }, [isGuest]);

  useEffect(() => {
    let cancelled = false;
    refreshUser().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  return (
    <UserContext.Provider value={{ user, loading, isGuest, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within UserProvider");
  }
  return ctx;
}
