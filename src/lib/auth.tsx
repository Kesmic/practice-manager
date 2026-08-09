/** Session context: who is signed in, and their unread notification count. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@shared/types";
import { atLeast, type Role } from "@shared/workflow";
import { api } from "./api";

interface SessionState {
  user: User | null;
  loading: boolean;
  unread: number;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUnread: (count: number) => void;
  /** True when the signed-in user holds `minimum` grade or above. */
  can: (minimum: Role) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: current, unread_notifications } = await api.session();
      setUser(current);
      setUnread(unread_notifications ?? 0);
    } catch {
      // A failed session probe means "not signed in" as far as the UI cares.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: signedIn } = await api.login(email, password);
    setUser(signedIn);
    // Pick up the notification count for the newly signed-in user.
    try {
      const session = await api.session();
      setUnread(session.unread_notifications ?? 0);
    } catch {
      setUnread(0);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setUnread(0);
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      user,
      loading,
      unread,
      signIn,
      signOut,
      refresh,
      setUnread,
      can: (minimum: Role) => (user ? atLeast(user.role, minimum) : false),
    }),
    [user, loading, unread, signIn, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside a SessionProvider.");
  }
  return context;
}
