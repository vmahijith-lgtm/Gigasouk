// supabase.ts — Supabase Browser Client
// Uses @supabase/ssr's createBrowserClient so the session is mirrored
// into cookies. This is REQUIRED for middleware.ts (which uses
// createServerClient) to be able to read the session and authorise
// protected routes. Using @supabase/supabase-js' createClient stores
// the session only in localStorage — middleware then sees no session
// and bounces every authenticated user back to /auth/login, which is
// exactly the "stuck on the same page after login" symptom.
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
}

export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON);

// ── Auth helpers ──────────────────────────────────────────────────
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_id", userId)
    .single();
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "/";
}
