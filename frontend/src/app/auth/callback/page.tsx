// ════════════════════════════════════════════════════════════════
// app/auth/callback/page.tsx — OAuth Callback Handler (Client-Side)
// Handles both PKCE (code= in query) and implicit (#access_token in hash).
// The server-side route.ts can't see hash fragments, so this must be
// a client component. Supabase auto-detects the hash via onAuthStateChange.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const C = { bg: "#060810", t3: "#5A6A80" };

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get("code");
    const next = params.get("next") ?? "/";
    const nextEncoded = encodeURIComponent(next);

    if (code) {
      // ── PKCE flow: exchange authorization code for session ─────
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error || !data.session) {
          router.replace("/auth/login?error=session_failed");
          return;
        }
        router.replace(`/auth/callback/complete?next=${nextEncoded}`);
      });
    } else {
      // ── Implicit flow: token arrives in URL hash ───────────────
      // Supabase JS automatically parses #access_token and fires SIGNED_IN.
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          if (event === "SIGNED_IN" && session) {
            subscription.unsubscribe();
            router.replace(`/auth/callback/complete?next=${nextEncoded}`);
          } else if (event === "SIGNED_OUT") {
            subscription.unsubscribe();
            router.replace("/auth/login?error=session_failed");
          }
        }
      );

      // Safety net: if neither event fires in 10s, bail out
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        router.replace("/auth/login?error=session_failed");
      }, 10_000);

      return () => {
        subscription.unsubscribe();
        clearTimeout(timeout);
      };
    }
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
