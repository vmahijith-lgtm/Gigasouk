// ════════════════════════════════════════════════════════════════
// app/auth/login/page.tsx — GigaSouk Sign In
// Supports email + password via Supabase Auth.
// Redirects to correct dashboard based on role after login.
// ════════════════════════════════════════════════════════════════
"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
  red: "#F87171",
};

// ── Inner component that uses useSearchParams (must be inside Suspense) ──
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Handle error/info params from auth callback or redirects
  useEffect(() => {
    const err = params.get("error");
    const msg = params.get("message");
    if (err === "invalid_link") setError("That verification link is invalid or has expired. Request a new one.");
    if (err === "session_failed") setError("Could not start your session. Please try again.");
    if (msg === "signed_out") setInfo("You've been signed out successfully.");
  }, [params]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password });

    if (authErr || !data.user) {
      setError(authErr?.message || "Login failed. Please check your credentials.");
      setLoading(false);
      return;
    }

    // Fetch role from profiles table
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("auth_id", data.user.id)
      .single();

    const role = profile?.role;

    // Respect ?next= redirect param (set by middleware when blocking an unauthenticated visit)
    // Treat "/" as "no explicit destination" so role homes win for non-customers.
    const rawNext = params.get("next");
    const explicitNext = rawNext && rawNext !== "/" ? rawNext : "";

    if (!role) {
      router.replace(`/auth/signup?next=${encodeURIComponent(rawNext || "/")}`);
      return;
    }

    const ROLE_HOME: Record<string, string> = {
      designer: "/designer",
      manufacturer: "/manufacturer",
      admin: "/admin",
      customer: "/",
    };

    // Hard navigation so the middleware re-runs with the new session cookie.
    const dest = explicitNext || ROLE_HOME[role] || "/";
    window.location.assign(dest);
  }

  async function handleGoogleLogin() {
    setError("");
    setOauthLoading(true);

    const next = params.get("next") ?? "/";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (oauthError) {
      setError(oauthError.message || "Google sign-in failed.");
      setOauthLoading(false);
    }
  }

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "Inter,sans-serif"
    }}>

      {/* Card */}
      <div style={{
        width: "100%", maxWidth: 420, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 16, padding: "36px 32px"
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.t1 }}>GIGA</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.green }}>SOUK</span>
          </div>
          <p style={{ fontSize: 13, color: C.t3 }}>Sign in to your account</p>
        </div>

        {/* Info / Error banners */}
        {info && (
          <div style={{
            background: C.green + "18", border: `1px solid ${C.green}`,
            borderRadius: 8, padding: "11px 14px", marginBottom: 16,
            fontSize: 13, color: C.green
          }}>
            {info}
          </div>
        )}
        {error && (
          <div style={{
            background: C.red + "18", border: `1px solid ${C.red}`,
            borderRadius: 8, padding: "11px 14px", marginBottom: 16,
            fontSize: 13, color: C.red
          }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin}>
          <Field label="Email" type="email" value={email}
            onChange={setEmail} placeholder="you@example.com" />
          <Field label="Password" type="password" value={password}
            onChange={setPassword} placeholder="••••••••" />

          {/* Forgot password link */}
          <div style={{ textAlign: "right", marginTop: -8, marginBottom: 16 }}>
            <a href="/auth/forgot-password"
              style={{ fontSize: 12, color: C.t3, textDecoration: "none" }}>
              Forgot password?
            </a>
          </div>

          <button type="submit" disabled={loading} id="login-submit-btn"
            style={{
              width: "100%", padding: "13px 0", marginTop: 8, borderRadius: 10,
              border: "none", background: loading ? C.t3 : C.green, color: "#060810",
              fontWeight: 800, fontSize: 15, cursor: loading ? "not-allowed" : "pointer"
            }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ fontSize: 11, color: C.t3, textTransform: "uppercase", letterSpacing: ".08em" }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={oauthLoading}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.card2,
            color: C.t1,
            fontWeight: 700,
            fontSize: 14,
            cursor: oauthLoading ? "not-allowed" : "pointer",
          }}
        >
          {oauthLoading ? "Redirecting to Google..." : "Continue with Google"}
        </button>

        {/* Footer links */}
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: C.t3 }}>
            Don't have an account?{" "}
            <a href="/auth/signup" style={{ color: C.green, textDecoration: "none", fontWeight: 600 }}>
              Sign up
            </a>
          </p>
          <a href="/" style={{
            display: "block", marginTop: 12, fontSize: 12, color: C.t3,
            textDecoration: "none"
          }}>
            ← Back to shop
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Page export: wrap in Suspense (required by Next.js for useSearchParams) ──
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        background: "#060810", minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center"
      }}>
        <p style={{ color: "#5A6A80", fontFamily: "Inter,sans-serif" }}>Loading…</p>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

// ── Shared field component ────────────────────────────────────────
function Field({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: C.t3,
        textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6
      }}>
        {label}
      </label>
      <input
        name={type === "email" ? "email" : "password"}
        type={type}
        autoComplete={type === "email" ? "email" : "current-password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        autoCapitalize={type === "email" ? "none" : undefined}
        autoCorrect="off"
        className="gs-input"
        suppressHydrationWarning
      />
    </div>
  );
}
