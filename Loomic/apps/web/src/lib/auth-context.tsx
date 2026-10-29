"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
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
  /**
   * Non-null when the last session lookup failed in a way that leaves the sign-in
   * state *unknown* (offline, timeout, 5xx). Callers must render a retryable
   * "cannot reach the workspace" state for it instead of the sign-in screen.
   */
  sessionError: Error | null;
  refreshSession: () => Promise<void>;
  /** Same lookup as `refreshSession`, named for the retry UI. */
  retrySession: () => Promise<void>;
  acceptSession: (next: LocalSession) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * A rejected session lookup means two very different things.
 *
 * 401/403 *is* an answer — the caller is not signed in, so the login path is correct.
 * Anything else (offline, timeout, 5xx) leaves the sign-in state unknown. Reporting
 * that as "not signed in" hides a network fault behind a login page and, because the
 * sign-in screen owns no socket, the connectivity banner can never speak up there.
 */
function isUnauthenticatedAnswer(error: Error): boolean {
  const { status, statusCode, code } = error as Error & {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  if (status === 401 || status === 403 || statusCode === 401 || statusCode === 403) return true;
  return code === "unauthorized" || code === "unauthenticated" || code === "invalid_token";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<Error | null>(null);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const { session: localSession } = await fetchLocalSession();
      setSession(localSession);
      setUser(localSession?.user ?? null);
      setSessionError(null);
    } catch (cause) {
      const error = toError(cause);
      console.error("[auth] Session lookup failed:", error);
      if (isUnauthenticatedAnswer(error)) {
        // A real answer: nobody is signed in.
        setSession(null);
        setUser(null);
        setSessionError(null);
      } else {
        // Sign-in state unknown. Keep the last known user so a transient blip does
        // not sign anybody out; a cold load simply stays "unknown" (user null).
        setSessionError(error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const acceptSession = useCallback((next: LocalSession) => {
    setSession(next);
    setUser(next.user);
    setSessionError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  async function signOut() {
    await signOutLocal();
    setSession(null);
    setUser(null);
    setSessionError(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        sessionError,
        refreshSession,
        retrySession: refreshSession,
        acceptSession,
        signOut,
      }}
    >
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

/**
 * Optional read of the auth state, for chrome (e.g. the shell connectivity banner)
 * that also has to render outside the provider — in tests and on bare routes.
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
