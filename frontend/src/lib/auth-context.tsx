// ════════════════════════════════════════════════════════════════
// lib/auth-context.tsx — GigaSouk Auth Context
// Provides: userId, role, profileId, loading state.
// Wraps the whole app so every page can call useAuth().
// ════════════════════════════════════════════════════════════════
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";

type UserRole = "designer" | "manufacturer" | "admin" | "customer" | null;

interface AuthUser {
  authId:    string;          // Supabase auth.users.id
  profileId: string;          // profiles.id (same as auth.users.id via trigger)
  role:      UserRole;
  fullName:  string;
  email:     string;
  manufacturerId: string | null; // set only if role === "manufacturer"
}

interface AuthCtx {
  user:    AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({ user: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadUser(authId: string) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, manufacturers(id)")
      .eq("auth_id", authId)
      .single();

    if (!profile) { setUser(null); return; }

    // Pull manufacturerId from the join if it exists
    const mfrRow = Array.isArray(profile.manufacturers)
      ? profile.manufacturers[0]
      : profile.manufacturers;

    setUser({
      authId,
      profileId:      profile.id,
      role:           profile.role as UserRole,
      fullName:       profile.full_name || "",
      email:          profile.email    || "",
      manufacturerId: mfrRow?.id || null,
    });
  }

  useEffect(() => {
    let cancelled = false;

    // Never leave the app on the splash screen if Supabase is slow, blocked, or errors.
    const failSafe = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 12_000);

    const clearFailSafe = () => {
      clearTimeout(failSafe);
    };

    // Initial session check
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        if (session?.user) {
          return loadUser(session.user.id).finally(() => {
            if (!cancelled) setLoading(false);
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      })
      .finally(() => {
        if (!cancelled) clearFailSafe();
      });

    // Listen for login / logout
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUser(session.user.id).finally(() => {
          if (!cancelled) setLoading(false);
        });
      } else {
        setUser(null);
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      clearFailSafe();
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    window.location.href = "/auth/login?message=signed_out";
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
