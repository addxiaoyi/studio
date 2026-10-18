"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { fetchLocalSession, signOutLocal } from "./local-auth";

export type LocalUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

export type LocalSession = {
  access_token: string;
  user: LocalUser;
};

interface AuthContextValue {
  user: LocalUser | null;
  session: LocalSession | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchLocalSession().then(({ session: localSession }) => {
      setSession(localSession);
      setUser(localSession?.user ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function signOut() {
    await signOutLocal();
    setSession(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
