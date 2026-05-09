// ════════════════════════════════════════════════════════════════
// app/auth/reset-password/page.tsx — Set New Password
// User lands here after clicking the reset link in their email.
// Supabase embeds the session token in the URL hash.
// We read it, then let the user set a new password.
// ════════════════════════════════════════════════════════════════
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import BrandLogo from "../../../components/BrandLogo";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
  red: "#F87171",
};

// Password strength helper
function getStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: C.red };
  if (score <= 3) return { score, label: "Fair", color: C.gold };
  return { score, label: "Strong", color: C.green };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  // Supabase embeds the reset token in the URL hash after redirect.
  // onAuthStateChange catches the PASSWORD_RECOVERY event and sets
  // a temporary session so we can call updateUser().
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          setHasSession(true);
        }
        if (event === "SIGNED_IN" && session) {
          setHasSession(true);
        }
      }
    );
    // Also check if we already have a session (e.g. page refresh)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasSession(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const strength = getStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");

    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setDone(true);
    // Redirect to login after 3 seconds
    setTimeout(() => router.replace("/auth/login"), 3000);
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
          <BrandLogo />
        </div>

        {done ? (
          /* ── Success ─────────────────────────────────────────── */
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 10 }}>
              Password updated!
            </h1>
            <p style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>
              Your password has been changed successfully.
              Redirecting you to login...
            </p>
          </div>
        ) : !hasSession ? (
          /* ── Waiting for session from URL hash ──────────────── */
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <p style={{ color: C.t3, fontSize: 13 }}>
              Validating your reset link…
            </p>
            <p style={{ color: C.t3, fontSize: 12, marginTop: 12 }}>
              If this takes too long,{" "}
              <a href="/auth/forgot-password" style={{ color: C.green, textDecoration: "none" }}>
                request a new link
              </a>.
            </p>
          </div>
        ) : (
          /* ── Reset form ──────────────────────────────────────── */
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 6 }}>
              Set a new password
            </h1>
            <p style={{ fontSize: 13, color: C.t3, marginBottom: 24 }}>
              Choose a strong password for your GigaSouk account.
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
              {/* New password */}
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  display: "block", fontSize: 11, fontWeight: 700,
                  color: C.t3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6
                }}>
                  New Password
                </label>
                <input
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  required
                  className="gs-input"
                  suppressHydrationWarning
                />

                {/* Strength meter */}
                {password && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} style={{
                          flex: 1, height: 3, borderRadius: 2,
                          background: i <= strength.score ? strength.color : C.border,
                          transition: "background .2s"
                        }} />
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: strength.color }}>{strength.label} password</p>
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: "block", fontSize: 11, fontWeight: 700,
                  color: C.t3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6
                }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                  className="gs-input"
                  style={{
                    borderColor: confirm && confirm !== password ? C.red : undefined,
                  }}
                  suppressHydrationWarning
                />
                {confirm && confirm !== password && (
                  <p style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Passwords don't match</p>
                )}
              </div>

              <button type="submit" disabled={loading || !hasSession}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                  background: loading ? C.t3 : C.green, color: "#060810", fontWeight: 800,
                  fontSize: 15, cursor: loading ? "not-allowed" : "pointer"
                }}>
                {loading ? "Updating..." : "Update Password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
