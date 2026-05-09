// ════════════════════════════════════════════════════════════════
// app/auth/verify/page.tsx — Email Verification Holding Page
// Shown immediately after signup. Tells the user to check their
// email and click the confirmation link.
// ════════════════════════════════════════════════════════════════
"use client";

import { useState } from "react";
import { supabase } from "../../../lib/supabase";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

export default function VerifyPage() {
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email) { setError("Enter your email address."); return; }
    setResending(true);
    setError("");
    const { error: err } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) setError(err.message);
    else setResent(true);
    setResending(false);
  }

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "Inter,sans-serif"
    }}>

      <div style={{
        width: "100%", maxWidth: 420, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 14, padding: "32px 28px",
        textAlign: "center"
      }}>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.t1, marginBottom: 10 }}>
          Check your email
        </h1>
        <p style={{ fontSize: 13, color: C.t2, lineHeight: 1.5, marginBottom: 20 }}>
          We sent a confirmation link to your email address.
          Click the link to activate your account and get started.
        </p>

        <div style={{
          marginTop: 18, paddingTop: 18,
          borderTop: `1px solid ${C.border}`
        }}>
          <p style={{ fontSize: 12, color: C.t3, marginBottom: 16 }}>
            {`Didn't receive the email? Check spam, or resend it below.`}
          </p>

          {resent ? (
            <div style={{
              background: C.green + "18", border: `1px solid ${C.green}`,
              borderRadius: 8, padding: "10px 16px", fontSize: 13, color: C.green
            }}>
              ✓ Confirmation email resent!
            </div>
          ) : (
            <form onSubmit={handleResend} style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="gs-input"
                style={{ flex: 1, minWidth: 0, fontSize: 13 }}
                suppressHydrationWarning
              />
              <button type="submit" disabled={resending}
                style={{
                  padding: "10px 16px", borderRadius: 8, border: "none",
                  background: resending ? C.t3 : C.green, color: "#060810",
                  fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap"
                }}>
                {resending ? "..." : "Resend"}
              </button>
            </form>
          )}

          {error && (
            <p style={{ fontSize: 12, color: "#F87171", marginTop: 10 }}>{error}</p>
          )}
        </div>

        <a href="/auth/login" style={{
          display: "block", marginTop: 20,
          fontSize: 12, color: C.t3, textDecoration: "none"
        }}>
          ← Back to login
        </a>
      </div>
    </div>
  );
}
