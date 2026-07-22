import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

interface AuthValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** True until the first session + profile lookup settles. */
  loading: boolean;
  /**
   * Set when the profile could not be loaded for a recoverable reason
   * (network, RLS, missing row). Expired sessions are not reported here —
   * those sign the user out so the guards route them to /login.
   */
  profileError: string | null;
  isAdmin: boolean;
  /** Admins are implicitly approved — role outranks status. */
  isApproved: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * True when a failed query is the session's fault rather than the data's.
 * PostgREST reports an expired/invalid JWT as PGRST301 / 401.
 */
const isAuthError = (error: { code?: string; message?: string }): boolean =>
  error.code === "PGRST301" ||
  error.code === "401" ||
  /jwt|token|expired/i.test(error.message ?? "");

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Starts true so server-rendered output and the first client paint agree:
  // both show the loading state, then the browser resolves the real session.
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    const fetchProfile = () => supabase.from("profiles").select("*").eq("id", userId).single();

    let { data, error } = await fetchProfile();

    // A stored session can be restored with an already-expired access token,
    // so the very first query fails with "JWT expired". Refresh once and retry
    // before treating it as a real failure.
    if (error && isAuthError(error)) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr && refreshed.session) {
        ({ data, error } = await fetchProfile());
      }
    }

    if (!error) {
      setProfile(data as Profile);
      setProfileError(null);
      return;
    }

    setProfile(null);
    if (isAuthError(error)) {
      // The session cannot be revived — drop it so the guards route to /login
      // instead of waiting for a profile that will never arrive.
      console.warn("Session expired, signing out:", error.message);
      setProfileError(null);
      await supabase.auth.signOut();
    } else {
      // Network/RLS/missing-row: recoverable, so surface it and let the user retry.
      console.error("Failed to load profile:", error.message);
      setProfileError(error.message);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session?.user?.id);
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      await loadProfile(newSession?.user?.id);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setProfileError(null);
  }, []);

  const value: AuthValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    profileError,
    isAdmin: profile?.role === "admin",
    isApproved: profile?.status === "approved" || profile?.role === "admin",
    refreshProfile,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
