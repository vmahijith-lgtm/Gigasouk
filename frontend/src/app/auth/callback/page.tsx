// ════════════════════════════════════════════════════════════════
// app/auth/callback/page.tsx — OAuth Callback Handler (Client-Side)
// Handles both PKCE (code= in query) and implicit (#access_token in hash).
// The server-side route.ts can't see hash fragments, so this must be
// a client component. Supabase auto-detects the hash via onAuthStateChange.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const C = { bg: "#060810", t3: "#5A6A80" };

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  // React 18 Strict Mode re-runs useEffect twice in dev.  PKCE codes
  // are one-shot — the second exchange of the same code throws
  // `flow_state_already_used` and wipes the successful first run.
  // This ref guarantees we only run the flow once per mount.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const next = params.get("next") ?? "/";
    const role = params.get("role") ?? "";
    const nextEncoded = encodeURIComponent(next);
    const roleQs = role ? `&role=${encodeURIComponent(role)}` : "";

    // Belt-and-braces: if the browser already has a session (e.g. the
    // first useEffect invocation finished before cleanup), skip the
    // exchange entirely and go straight to the completion page.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace(`/auth/callback/complete?next=${nextEncoded}${roleQs}`);
        return;
      }

      if (code) {
        // ── PKCE flow: exchange authorization code for session ─────
        supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
          if (error || !data.session) {
            // One more chance — maybe a concurrent exchange already
            // created the session. Check once before giving up.
            supabase.auth.getSession().then(({ data: { session: retry } }) => {
              if (retry) {
                router.replace(`/auth/callback/complete?next=${nextEncoded}${roleQs}`);
              } else {
                console.error("OAuth exchange failed:", error);
                router.replace("/auth/login?error=session_failed");
              }
            });
            return;
          }
          router.replace(`/auth/callback/complete?next=${nextEncoded}${roleQs}`);
        });
      } else {
        // ── Implicit flow: token arrives in URL hash ───────────────
        // Supabase JS automatically parses #access_token and fires SIGNED_IN.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (event, sess) => {
            if (event === "SIGNED_IN" && sess) {
              subscription.unsubscribe();
              router.replace(`/auth/callback/complete?next=${nextEncoded}${roleQs}`);
            } else if (event === "SIGNED_OUT") {
              subscription.unsubscribe();
              router.replace("/auth/login?error=session_failed");
            }
          }
        );

        // Safety net: if neither event fires in 10s, bail out
        setTimeout(() => {
          subscription.unsubscribe();
          router.replace("/auth/login?error=session_failed");
        }, 10_000);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, sans-serif"
    }}>
      <p style={{ color: C.t3 }}>Completing sign in…</p>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ background: "#060810", minHeight: "100vh" }} />
    }>
      <CallbackHandler />
    </Suspense>
  );
}
