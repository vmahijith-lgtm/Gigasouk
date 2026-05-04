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
const PROTECTED_PREFIXES = ["/designer", "/manufacturer", "/admin", "/negotiate", "/customer"];

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

/** Paths a role may open (prefix match). "/" is public — not listed here. */
function roleMayAccessRoute(role: string, pathname: string): boolean {
  if (role === "admin") return true;
  const rules: Record<string, string[]> = {
    designer: ["/designer", "/negotiate"],
    manufacturer: ["/manufacturer", "/negotiate"],
    customer: ["/customer", "/negotiate"],
  };
  const prefixes = rules[role] ?? [];
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnon) {
    console.error(
      "[middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — set them in Vercel and redeploy.",
    );
    return new NextResponse(
      "Configuration error: Supabase environment variables are not set. Check Vercel → Settings → Environment Variables.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Build a mutable response to forward cookies
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // ── Create Supabase SSR client that can read cookies ───────────
  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnon,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
          });
          // Update the response so downstream handlers can read the new cookies
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
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
    if (!roleMayAccessRoute(role, pathname)) {
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
