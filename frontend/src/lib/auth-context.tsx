// ════════════════════════════════════════════════════════════════
// lib/auth-context.tsx — GigaSouk Auth Context
// Provides: userId, role, profileId, loading state.
// Wraps the whole app so every page can call useAuth().
// ════════════════════════════════════════════════════════════════
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

type UserRole = "designer" | "manufacturer" | "admin" | "customer" | null;

interface AuthUser {
  authId: string;          // Supabase auth.users.id
  profileId: string;          // profiles.id (same as auth.users.id via trigger)
  role: UserRole;
  fullName: string;
  email: string;
  manufacturerId: string | null; // set only if role === "manufacturer"
  /** Customer saved address for routing / map prefill (from /api/auth/me) */
  preferredDelivery: {
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
    lat?: number;
    lng?: number;
  } | null;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({ user: null, loading: true, signOut: async () => { } });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadUser(authId: string, accessToken: string | null) {
    // If the auth user was deleted, getUser will fail; clear session immediately.
    if (accessToken) {
      const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(accessToken);
      if (authErr || !authUser) {
        await supabase.auth.signOut();
        setUser(null);
        return;
      }
    }
    // Prefer the backend /auth/me endpoint — it uses the service role and
    // returns profile + manufacturer_id / designer_id without needing
    // per-table SELECT policies on the Supabase side. This avoids the
    // "manufacturer profile being set up" loop when RLS is restrictive.
    if (accessToken && API_BASE) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.profile) {
            setUser({
              authId,
              profileId: data.profile.id,
              role: data.profile.role as UserRole,
              fullName: data.profile.full_name || "",
              email: data.profile.email || "",
              manufacturerId: data.manufacturer_id || null,
              preferredDelivery: data.profile.preferred_delivery || null,
            });
            return;
          }
          // No profile → user has signed up via OAuth but never completed
          // onboarding. Leave user as null so middleware/signup flow handles it.
          setUser(null);
          return;
        }
      } catch (e) {
        // Network error — fall back to client-side query below.
        console.warn("/auth/me failed, falling back to direct supabase query", e);
      }
    }

    // Fallback: direct Supabase query (works only if RLS allows it).
    // Avoid joins here because manufacturers/designers tables may be locked
    // down by RLS in some projects, which would null out the entire response.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("auth_id", authId)
      .single();

    if (profileErr || !profile) { setUser(null); return; }

    let manufacturerId: string | null = null;
    if (profile.role === "manufacturer") {
      const { data: mfr } = await supabase
        .from("manufacturers")
        .select("id")
        .eq("profile_id", profile.id)
        .single();
      manufacturerId = mfr?.id || null;
    }

    const pd = profile.preferred_delivery as AuthUser["preferredDelivery"];
    setUser({
      authId,
      profileId: profile.id,
      role: profile.role as UserRole,
      fullName: profile.full_name || "",
      email: profile.email || "",
      manufacturerId,
      preferredDelivery: pd && typeof pd === "object" ? pd : null,
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
          return loadUser(session.user.id, session.access_token).finally(() => {
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
        loadUser(session.user.id, session.access_token).finally(() => {
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
