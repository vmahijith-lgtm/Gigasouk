// ════════════════════════════════════════════════════════════════
// app/auth/forgot-password/page.tsx — Password Reset Request
// User enters their email → Supabase sends a reset link.
// ════════════════════════════════════════════════════════════════
"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import BrandLogo from "../../../components/BrandLogo";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
  red: "#F87171",
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (err) setError(err.message);
    else setSent(true);
    setLoading(false);
  }

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "Inter,sans-serif"
    }}>

      <div style={{
        width: "100%", maxWidth: 400, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 14, padding: "30px 26px"
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 24, display: "flex", justifyContent: "center" }}>
          <BrandLogo width={136} height={34} />
        </div>

        {sent ? (
          /* ── Success state ──────────────────────────────────── */
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 10 }}>
              Reset link sent
            </h1>
            <p style={{ fontSize: 13, color: C.t2, lineHeight: 1.6, marginBottom: 24 }}>
              Check your inbox at <strong style={{ color: C.t1 }}>{email}</strong>.
              Click the link in the email to set a new password.
            </p>
            <p style={{ fontSize: 12, color: C.t3 }}>
              The link expires in <strong style={{ color: C.gold }}>1 hour</strong>.
            </p>
            <a href="/auth/login" style={{
              display: "block", marginTop: 24,
              fontSize: 13, color: C.green, textDecoration: "none", fontWeight: 600
            }}>
              ← Back to login
            </a>
          </div>
        ) : (
          /* ── Form ────────────────────────────────────────────── */
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 6 }}>
              Forgot your password?
            </h1>
            <p style={{ fontSize: 13, color: C.t3, marginBottom: 24 }}>
              Enter your email address and we'll send you a link to reset it.
            </p>

            {error && (
              <div style={{
                background: C.red + "18", border: `1px solid ${C.red}`,
                borderRadius: 8, padding: "10px 14px", marginBottom: 16,
                fontSize: 13, color: C.red
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <label style={{
                display: "block", fontSize: 11, fontWeight: 700,
                color: C.t3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6
              }}>
                Email address
              </label>
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="gs-input"
                style={{ marginBottom: 16 }}
                suppressHydrationWarning
              />

              <button type="submit" disabled={loading}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                  background: loading ? C.t3 : C.green, color: "#060810", fontWeight: 800,
                  fontSize: 15, cursor: loading ? "not-allowed" : "pointer"
                }}>
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
            </form>

            <a href="/auth/login" style={{
              display: "block", marginTop: 20,
              textAlign: "center", fontSize: 13, color: C.t3, textDecoration: "none"
            }}>
              ← Back to login
            </a>
          </>
        )}
      </div>
    </div>
  );
}
