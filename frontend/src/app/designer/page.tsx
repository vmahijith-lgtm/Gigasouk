// ════════════════════════════════════════════════════════════════
// app/designer/page.tsx — Designer Dashboard Page
// Guards: must be logged in + role = "designer"
// Passes designerId (profile.id) to the dashboard component.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import GigaSoukDesignerDashboard from "../../components/GigaSoukDesignerDashboard";
import BrandLogo from "../../components/BrandLogo";

export default function DesignerPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/auth/login"); return; }
    if (user.role !== "designer") { router.replace("/"); return; }
  }, [user, loading, router]);

  if (loading || !user) return <Loading />;

  return (
    <GigaSoukDesignerDashboard
      designerId={user.profileId}
      onSignOut={signOut}
    />
  );
}

function Loading() {
  return (
    <div style={{
      background: "#060810", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16
    }}>
      <style>{`@keyframes gs-pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      <BrandLogo />
      <div style={{
        width: 32, height: 3, borderRadius: 2, background: "#00E5A0",
        animation: "gs-pulse 1.2s ease infinite"
      }} />
    </div>
  );
}
