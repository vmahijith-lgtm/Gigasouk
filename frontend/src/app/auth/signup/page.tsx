// ════════════════════════════════════════════════════════════════
// app/auth/signup/page.tsx — GigaSouk Sign Up
// Three role paths: Designer | Manufacturer | Customer
// Creates Supabase auth user, then backend creates profiles row.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { buildProfilePayload, postCreateProfile, type FormState } from "../../../lib/auth-utils";
import BrandLogo from "../../../components/BrandLogo";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", blue: "#4A9EFF", purple: "#A78BFA",
  t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80", red: "#F87171",
};

type Role = "customer" | "designer" | "manufacturer";

const ROLE_OPTIONS: { key: Role; label: string; icon: string; desc: string }[] = [
  { key: "customer", icon: "🛍️", label: "Customer", desc: "Browse & buy manufactured products" },
  { key: "designer", icon: "✏️", label: "Designer", desc: "Upload CAD designs & earn royalties" },
  { key: "manufacturer", icon: "🏭", label: "Manufacturer", desc: "Commit to designs & receive jobs" },
];

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role");
  const [role, setRole] = useState<Role>("customer");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  // Manufacturer extra fields
  const [shopName, setShopName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  // sessionToken is intentionally NOT cached — always fetched fresh on submit
  const [sessionEmail, setSessionEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  /** Once the user taps a role card, never overwrite from URL or async profile prep (avoids races). */
  const roleEditedByUserRef = useRef(false);

  /** Same browser profile shares one Supabase session across tabs — required for a truly new account. */
  async function signOutForDifferentAccount() {
    setSigningOut(true);
    setError("");
    try {
      await supabase.auth.signOut();
      sessionStorage.removeItem("pending_profile");
      const qs = new URLSearchParams(searchParams.toString());
      qs.delete("next");
      const roleKeep = qs.get("role");
      const tail =
        roleKeep && ["customer", "designer", "manufacturer"].includes(roleKeep)
          ? `?role=${encodeURIComponent(roleKeep)}`
          : "";
      window.location.href = `/auth/signup${tail}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not sign out.";
      setError(msg);
      setSigningOut(false);
    }
  }

  function handleRoleSelect(nextRole: Role) {
    roleEditedByUserRef.current = true;
    setRole(nextRole);
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("role", nextRole);
    router.replace(`/auth/signup?${qs.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (roleEditedByUserRef.current) return;
    if (roleParam === "designer" || roleParam === "manufacturer" || roleParam === "customer") {
      setRole(roleParam);
    }
  }, [roleParam]);

  useEffect(() => {
    let mounted = true;

    async function prepareSignupMode() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session?.user) {
        setHasSession(false);
        setSessionChecked(true);
        return;
      }

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("auth_id", session.user.id)
        .single();

      if (!mounted) return;

      if (existingProfile?.role) {
        const wantsUpgrade =
          (roleParam === "designer" || roleParam === "manufacturer") &&
          existingProfile.role === "customer";

        if (wantsUpgrade) {
          const metadata = session.user.user_metadata ?? {};
          const inferredName =
            metadata.full_name || metadata.name || metadata.user_name || "";
          const inferredEmail = session.user.email || "";

          setHasSession(true);
          setSessionEmail(inferredEmail);
          if (inferredName) setFullName(inferredName);
          if (inferredEmail) setEmail(inferredEmail);
          if (
            !roleEditedByUserRef.current &&
            (roleParam === "designer" || roleParam === "manufacturer")
          ) {
            setRole(roleParam);
          }
          setSessionChecked(true);
          return;
        }

        const roleHome =
          existingProfile.role === "designer"
            ? "/designer"
            : existingProfile.role === "manufacturer"
              ? "/manufacturer"
              : existingProfile.role === "admin"
                ? "/admin"
                : "/";
        router.replace(roleHome);
        return;
      }

      const metadata = session.user.user_metadata ?? {};
      const inferredName =
        metadata.full_name || metadata.name || metadata.user_name || "";
      const inferredEmail = session.user.email || "";

      setHasSession(true);
      setSessionEmail(inferredEmail);
      if (inferredName) setFullName(inferredName);
      if (inferredEmail) setEmail(inferredEmail);
      setSessionChecked(true);
    }

    prepareSignupMode();
    return () => {
      mounted = false;
    };
  }, [router, roleParam]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!hasSession && password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (role === "manufacturer" && (!shopName || !city || !state || !pincode)) {
      setError("Manufacturer must provide: shop name, city, state, pincode.");
      return;
    }
    setLoading(true);
    setError("");

    const next = searchParams.get("next") ?? "/";

    if (hasSession) {
      try {
        // Always fetch a FRESH session token — never rely on a cached value.
        // Supabase may have silently refreshed the token after page load.
        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (!freshSession?.access_token) {
          throw new Error("Session expired. Please sign in again.");
        }
        await postCreateProfile(freshSession.access_token, {
          fullName,
          email: sessionEmail || email,
          role,
          phone,
          shopName,
          city,
          state,
          pincode,
        });
        const ROLE_HOME: Record<string, string> = {
          designer: "/designer", manufacturer: "/manufacturer",
          admin: "/admin", customer: "/",
        };
        const explicitNext = next && next !== "/" ? next : "";
        window.location.assign(explicitNext || ROLE_HOME[role] || "/");
      } catch (err: any) {
        setError(err.message || "Profile completion failed");
        setLoading(false);
      }
      return;
    }

    // 1. Create Supabase auth user
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Use NEXT_PUBLIC_SITE_URL so the link always points to the production
        // domain (https://gigasouk.com) which is allowlisted in Supabase Auth.
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });
    if (authErr || !authData.user) {
      setError(authErr?.message || "Sign-up failed.");
      setLoading(false);
      return;
    }

    // 2. If session exists (email confirm disabled), create profile immediately
    if (authData.session) {
      try {
        await postCreateProfile(authData.session.access_token, {
          fullName, email, role, phone, shopName, city, state, pincode
        });
        // Success — full page nav so middleware sees the freshly-set cookie.
        const ROLE_HOME: Record<string, string> = {
          designer: "/designer", manufacturer: "/manufacturer",
          admin: "/admin", customer: "/",
        };
        window.location.assign(ROLE_HOME[role] || "/");
      } catch (err: any) {
        setError(err.message || "Profile creation failed");
        setLoading(false);
      }
      return;
    }

    // 3. Email confirm enabled — store camelCase FormState directly so
    //    callback/complete/page.tsx can pass it straight to postCreateProfile()
    //    without a second buildProfilePayload() call losing field names.
    sessionStorage.setItem("pending_profile", JSON.stringify({
      fullName, email, role, phone, shopName, city, state, pincode,
    }));
    router.replace("/auth/verify");
  }

  async function handleGoogleSignup() {
    setError("");
    setOauthLoading(true);

    const next = searchParams.get("next") ?? "/";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    // Pass `role` so callback/complete can forward it to /auth/signup if the
    // user has no profile yet (Google OAuth first-time signup).
    const redirectTo =
      `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}&role=${encodeURIComponent(role)}`;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (oauthError) {
      setError(oauthError.message || "Google sign-up failed.");
      setOauthLoading(false);
    }
  }

  if (!sessionChecked) {
    return (
      <div style={{
        background: C.bg, minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20,
        fontFamily: "Inter,sans-serif"
      }}>
        <p style={{ color: C.t3 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "Inter,sans-serif"
    }}>

      <div style={{
        width: "100%", maxWidth: 460, background: C.card,
        border: `1px solid ${C.border}`, borderRadius: 14, padding: "30px 26px"
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <BrandLogo />
          </div>
          <p style={{ fontSize: 12, color: C.t3, marginTop: 4 }}>
            {hasSession ? "Complete your profile" : "Create your account"}
          </p>
        </div>

        {hasSession && (
          <div style={{
            marginBottom: 20, padding: "12px 14px", borderRadius: 10,
            border: `1px solid ${C.border}`, background: C.card2, fontSize: 12, color: C.t2, lineHeight: 1.45,
          }}>
            <p style={{ margin: "0 0 10px" }}>
              You’re signed in as{" "}
              <strong style={{ color: C.t1 }}>{sessionEmail || email || "this account"}</strong>.
              New tabs use the same browser session, so “create account” continues this login unless you sign out.
            </p>
            <button
              type="button"
              disabled={signingOut}
              onClick={signOutForDifferentAccount}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8, cursor: signingOut ? "wait" : "pointer",
                border: `1px solid ${C.green}`, background: "transparent", color: C.green,
                fontWeight: 700, fontSize: 13,
              }}
            >
              {signingOut ? "Signing out…" : "Sign out & create a different account"}
            </button>
          </div>
        )}

        {/* Role picker */}
        <p style={{
          fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase",
          letterSpacing: ".06em", marginBottom: 10
        }}>I am a…</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 8, marginBottom: 24 }}>
          {ROLE_OPTIONS.map(r => (
            <button key={r.key} id={`role-${r.key}`} type="button" onClick={() => handleRoleSelect(r.key)}
              style={{
                padding: "12px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center",
                border: `1px solid ${role === r.key ? C.green : C.border}`,
                background: role === r.key ? C.green + "18" : C.card2, transition: "all .15s",
                minWidth: 0, overflow: "hidden",
              }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{r.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: role === r.key ? C.green : C.t2 }}>{r.label}</div>
              <div style={{ fontSize: 10, color: C.t3, marginTop: 2, lineHeight: 1.3, overflowWrap: "break-word", wordBreak: "break-word" }}>{r.desc}</div>
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: C.red + "18", border: `1px solid ${C.red}`,
            borderRadius: 8, padding: "11px 14px", marginBottom: 16, fontSize: 13, color: C.red
          }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSignup}>
          <Field label="Full Name" type="text" value={fullName} onChange={setFullName} placeholder="Your name" />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            readOnly={hasSession && !!sessionEmail}
          />
          {!hasSession && (
            <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Min 8 characters" />
          )}
          <Field label="Phone" type="tel" value={phone} onChange={setPhone} placeholder="+91 XXXXX XXXXX (optional)" />

          {role === "manufacturer" && (
            <>
              <hr style={{ border: `1px solid ${C.border}`, margin: "16px 0" }} />
              <p style={{
                fontSize: 11, fontWeight: 700, color: C.t3,
                textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12
              }}>
                Workshop Details
              </p>
              <Field label="Workshop / Shop Name" type="text" value={shopName} onChange={setShopName} placeholder="e.g. Sharma Fab Works" />
              <Field label="City" type="text" value={city} onChange={setCity} placeholder="e.g. Mumbai" />
              <Field label="State" type="text" value={state} onChange={setState} placeholder="e.g. Maharashtra" />
              <Field label="Pincode" type="text" value={pincode} onChange={setPincode} placeholder="e.g. 560001" />
            </>
          )}

          <button type="submit" disabled={loading} id="signup-submit-btn"
            style={{
              width: "100%", padding: "13px 0", marginTop: 12, borderRadius: 10,
              border: "none", background: loading ? C.t3 : C.green, color: "#060810",
              fontWeight: 800, fontSize: 15, cursor: loading ? "not-allowed" : "pointer"
            }}>
            {loading ? (hasSession ? "Saving profile..." : "Creating account...") : (hasSession ? "Complete Profile" : "Create Account")}
          </button>
        </form>

        {!hasSession && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, color: C.t3, textTransform: "uppercase", letterSpacing: ".08em" }}>or</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignup}
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
          </>
        )}

        <p style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: C.t3 }}>
          {hasSession ? (
            <>
              Wrong account? Use{" "}
              <button
                type="button"
                onClick={signOutForDifferentAccount}
                disabled={signingOut}
                style={{
                  background: "none", border: "none", padding: 0, cursor: signingOut ? "wait" : "pointer",
                  color: C.green, fontWeight: 600, fontSize: 13, textDecoration: "underline",
                }}
              >
                Sign out
              </button>
              {" "}first, then register.
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a href="/auth/login" style={{ color: C.green, textDecoration: "none", fontWeight: 600 }}>
                Sign in
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div style={{
        background: C.bg, minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20,
        fontFamily: "Inter,sans-serif"
      }}>
        <p style={{ color: C.t3 }}>Loading…</p>
      </div>
    }>
      <SignupForm />
    </Suspense>
  );
}

function fieldMeta(label: string, type: string): { name: string; autoComplete: string } {
  switch (label) {
    case "Full Name":
      return { name: "full_name", autoComplete: "name" };
    case "Email":
      return { name: "email", autoComplete: "email" };
    case "Password":
      return { name: "password", autoComplete: "new-password" };
    case "Phone":
      return { name: "phone", autoComplete: "tel" };
    case "Workshop / Shop Name":
      return { name: "organization", autoComplete: "organization" };
    case "City":
      return { name: "city", autoComplete: "address-level2" };
    case "State":
      return { name: "state", autoComplete: "address-level1" };
    case "Pincode":
      return { name: "pincode", autoComplete: "postal-code" };
    default:
      return { name: label.toLowerCase().replace(/\s+/g, "_"), autoComplete: "on" };
  }
}

function Field({ label, type, value, onChange, placeholder, readOnly }: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder: string; readOnly?: boolean;
}) {
  const id = `signup-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const { name, autoComplete } = fieldMeta(label, type);

  return (
    <div style={{ marginBottom: 14, position: "relative", isolation: "isolate" }}>
      <label htmlFor={id} style={{
        display: "block", fontSize: 11, fontWeight: 700, color: C.t3,
        textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5
      }}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={type === "email" ? false : undefined}
        autoCapitalize={type === "email" ? "none" : undefined}
        autoCorrect="off"
        className="gs-input"
        suppressHydrationWarning
      />
    </div>
  );
}
