/**
 * The signed-in growth partner, in the browser.
 *
 * A third context, beside the staff session and the client session, for the reason
 * src/lib/client-auth.tsx gives: a partner screen reaching for `useSession` would
 * compile, run, and make decisions about a partner's pipeline from whoever happens to be
 * signed in as staff on the same browser.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PartnerSelf } from "@shared/types";
import { api } from "./api";

interface PartnerSession {
  partner: PartnerSelf | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<PartnerSession | null>(null);

export function PartnerSessionProvider({ children }: { children: React.ReactNode }) {
  const [partner, setPartner] = useState<PartnerSelf | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { partner: fresh } = await api.partnerSession();
      setPartner(fresh);
    } catch {
      // Not signed in, which is the ordinary state of this page before somebody does.
      setPartner(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.partnerLogout();
    } finally {
      setPartner(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ partner, loading, refresh, signOut }),
    [partner, loading, refresh, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePartnerSession(): PartnerSession {
  const value = useContext(Context);
  if (!value) throw new Error("usePartnerSession used outside the partner portal.");
  return value;
}
