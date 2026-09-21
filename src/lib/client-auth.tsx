/**
 * The signed-in client, in the browser.
 *
 * Deliberately not `useSession`. That hook is the staff session, and a client screen
 * reaching for it would compile, run, and be wrong in the way that matters: it would
 * make decisions about a client's page from whoever happens to be signed in as staff on
 * the same browser - which, for a Partner testing the client portal, is themselves.
 *
 * Two contexts rather than one for the same reason the Worker has two session tables.
 * Nothing here can produce a staff user, and nothing in useSession can produce a client.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ClientPortalUser } from "@shared/types";
import { api } from "./api";

interface ClientSession {
  user: ClientPortalUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<ClientSession | null>(null);

export function ClientSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ClientPortalUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: fresh } = await api.clientSession();
      setUser(fresh);
    } catch {
      // Not signed in, which is not an error - it is the ordinary state of this page
      // before somebody signs in.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.clientLogout();
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, refresh, signOut }),
    [user, loading, refresh, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useClientSession(): ClientSession {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useClientSession used outside the client portal.");
  }
  return value;
}
