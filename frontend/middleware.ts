// ════════════════════════════════════════════════════════════════
// middleware.ts — GigaSouk Server-Side Route Protection
// Runs at the Next.js Edge BEFORE any page renders.
// This is the PRIMARY auth guard — client-side guards in pages
// are a secondary fallback only.
//
// Protected routes → redirect to /auth/login if not authenticated.
// Auth routes → redirect to dashboard if already logged in.
// ════════════════════════════════════════════════════════════════

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ── Routes that require authentication ──────────────────────────
const PROTECTED_PREFIXES = ["/designer", "/manufacturer", "/admin", "/negotiate"];

// ── Routes only accessible when NOT logged in ───────────────────
const AUTH_ONLY_ROUTES = ["/auth/login", "/auth/signup"];

// ── Routes needed while session exists but profile is incomplete ─
const ONBOARDING_ALLOWED_PREFIXES = ["/auth/signup", "/auth/callback"];

// ── Role → home dashboard mapping ───────────────────────────────
const ROLE_HOME: Record<string, string> = {
  designer: "/designer",
  manufacturer: "/manufacturer",
  admin: "/admin",
  customer: "/",
};

// ── Role → allowed prefixes ──────────────────────────────────────
const ROLE_ALLOWED: Record<string, string[]> = {
  designer: ["/designer", "/negotiate"],
  manufacturer: ["/manufacturer", "/negotiate"],
  admin: ["/admin", "/designer", "/manufacturer", "/negotiate"],
  customer: ["/"],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Build a mutable response to forward cookies
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // ── Create Supabase SSR client that can read cookies ───────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // ── Get session ─────────────────────────────────────────────────
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthenticated = !!session?.user;

  // ── Check if this is a protected route ──────────────────────────
  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  const isAuthRoute = AUTH_ONLY_ROUTES.includes(pathname);

  // Fetch profile once for all authenticated routing branches.
  let profile: { role?: string } | null = null;
  if (isAuthenticated) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("auth_id", session!.user.id)
      .single();
    profile = data;
  }

  // ── Not logged in → trying to access protected route ────────────
  if (!isAuthenticated && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    // Preserve where they were going so we can redirect back after login
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Logged in but profile not created yet: force onboarding flow.
  if (isAuthenticated && !profile?.role) {
    const isOnboardingRoute = ONBOARDING_ALLOWED_PREFIXES.some(p => pathname.startsWith(p));
    if (!isOnboardingRoute) {
      const signupUrl = request.nextUrl.clone();
      signupUrl.pathname = "/auth/signup";
      signupUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(signupUrl);
    }
    return response;
  }

  // ── Logged in → trying to access login/signup ───────────────────
  if (isAuthenticated && isAuthRoute) {
    const home = ROLE_HOME[profile?.role ?? "customer"] ?? "/";
    return NextResponse.redirect(new URL(home, request.url));
  }

  // ── Logged in → wrong dashboard for their role ──────────────────
  if (isAuthenticated && isProtected) {
    const role = profile?.role ?? "customer";
    const allowed = ROLE_ALLOWED[role] ?? ["/"];
    const hasAccess = allowed.some(prefix => pathname.startsWith(prefix));

    if (!hasAccess) {
      const home = ROLE_HOME[role] ?? "/";
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  return response;
}

// ── Tell Next.js which paths this middleware runs on ────────────
export const config = {
  matcher: [
    // Run on all paths EXCEPT static files, images, and Next internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
