// ════════════════════════════════════════════════════════════════
// app/auth/callback/complete/page.tsx — Profile Creation After Email Verification
// After user confirms email and lands on /auth/callback, they're redirected here.
// This page:
// 1. Fetches the current session (just established)
// 2. Checks sessionStorage for pending_profile payload
// 3. Calls backend to create the profile
// 4. Redirects to the appropriate dashboard
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { postCreateProfile, type FormState } from "@/lib/auth-utils";
import { BACKEND_URL } from "@/lib/api";
import BrandLogo from "@/components/BrandLogo";

const ROLE_HOME: Record<string, string> = {
    designer: "/designer",
    manufacturer: "/manufacturer",
    admin: "/admin",
    customer: "/",
};

const C = {
    bg: "#060810",
    card: "#0C1018",
    t1: "#F4F6FC",
    t2: "#B8C4D8",
    green: "#00E5A0",
    red: "#F87171",
};

function CompleteContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next") ?? "/";
    const roleParam = searchParams.get("role") ?? "";

    const [status, setStatus] = useState("Completing your signup...");
    const [error, setError] = useState("");
    const [showError, setShowError] = useState(false);
    const [isProcessing, setIsProcessing] = useState(true);

    useEffect(() => {
        let redirectTimer: ReturnType<typeof setTimeout> | null = null;

        async function complete() {
            try {
                // 1. Get current session (should exist from the auth exchange)
                const {
                    data: { session },
                    error: sessionErr,
                } = await supabase.auth.getSession();

                if (sessionErr || !session) {
                    throw new Error("Session not found. Please try signing up again.");
                }

                // 2. Get pending profile from sessionStorage
                const pendingProfileJson = sessionStorage.getItem("pending_profile");
                if (!pendingProfileJson) {
                    // No pending profile — this might be a page refresh.
                    // Check if profile already exists and just redirect.
                    let existingRole = "";
                    try {
                        const meRes = await fetch(`${BACKEND_URL}/api/auth/me`, {
                            headers: { Authorization: `Bearer ${session.access_token}` },
                        });
                        if (meRes.ok) {
                            const mePayload = await meRes.json();
                            existingRole = mePayload?.profile?.role || "";
                        }
                    } catch {
                        // Fall back to direct profile lookup if backend is unreachable.
                    }
                    if (!existingRole) {
                        const user = session.user;
                        const { data: profile } = await supabase
                            .from("profiles")
                            .select("role")
                            .eq("auth_id", user.id)
                            .single();
                        existingRole = profile?.role || "";
                    }

                    if (existingRole) {
                        // Profile exists — redirect to dashboard
                        const destination = ROLE_HOME[existingRole] ?? next;
                        window.location.assign(destination);
                        setIsProcessing(false);
                        return;
                    }

                    // OAuth first login without pending_profile: send user to
                    // onboarding, forwarding the role they selected before OAuth.
                    const roleQs = roleParam ? `role=${encodeURIComponent(roleParam)}&` : "";
                    router.replace(`/auth/signup?${roleQs}next=${encodeURIComponent(next)}`);
                    setIsProcessing(false);
                    return;
                }

                const pendingProfile = JSON.parse(pendingProfileJson) as FormState;

                // 3. Call backend to create profile
                setStatus("Creating your profile...");
                await postCreateProfile(session.access_token, pendingProfile);

                // 4. Remove from sessionStorage
                sessionStorage.removeItem("pending_profile");

                // 5. Redirect to dashboard based on role (full nav so middleware sees cookies)
                const destination = ROLE_HOME[pendingProfile.role] ?? next;
                window.location.assign(destination);
                setIsProcessing(false);
            } catch (err: any) {
                const errorMsg =
                    err.message || err.detail || "An unexpected error occurred";
                console.error("Profile completion error:", errorMsg);
                setError(errorMsg);
                setShowError(true);
                setIsProcessing(false);

                // Auto-redirect after 3 seconds to allow user to see error
                redirectTimer = setTimeout(() => {
                    router.replace(next);
                }, 3000);
            }
        }

        complete();

        return () => {
            if (redirectTimer) clearTimeout(redirectTimer);
        };
    }, [router, next]);

    return (
        <div
            style={{
                background: C.bg,
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
                fontFamily: "Inter, sans-serif",
            }}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 400,
                    background: C.card,
                    border: `1px solid #1A2230`,
                    borderRadius: 16,
                    padding: "48px 32px",
                    textAlign: "center",
                }}
            >
                {/* Logo */}
                <div style={{ marginBottom: 28, display: "flex", justifyContent: "center" }}>
                    <BrandLogo />
                </div>

                {/* Spinner — Always show until redirect happens */}
                {isProcessing && !showError && (
                    <>
                        <div
                            style={{
                                width: 48,
                                height: 48,
                                margin: "0 auto 24px",
                                border: `2px solid #1A2230`,
                                borderTop: `2px solid ${C.green}`,
                                borderRadius: "50%",
                                animation: "spin 0.8s linear infinite",
                            }}
                        />
                        <p style={{ fontSize: 14, color: C.t2, marginTop: 16 }}>
                            {status}
                        </p>
                    </>
                )}

                {/* Error State */}
                {showError && (
                    <>
                        <div
                            style={{
                                background: C.red + "18",
                                border: `1px solid ${C.red}`,
                                borderRadius: 8,
                                padding: "16px",
                                marginBottom: 16,
                            }}
                        >
                            <p style={{ fontSize: 13, color: C.red, margin: 0 }}>
                                {error}
                            </p>
                        </div>
                        <p style={{ fontSize: 12, color: C.t2 }}>
                            Redirecting in 3 seconds...
                        </p>
                    </>
                )}
            </div>

            {/* CSS for spinner animation */}
            <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}

export default function CompletePage() {
    return (
        <Suspense fallback={
            <div style={{
                background: C.bg,
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
                fontFamily: "Inter, sans-serif",
                color: C.t2,
            }}>
                <p>Loading…</p>
            </div>
        }>
            <CompleteContent />
        </Suspense>
    );
}
