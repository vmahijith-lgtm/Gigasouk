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

export default function DesignerPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user)                   { router.replace("/auth/login"); return; }
    if (user.role !== "designer"){ router.replace("/"); return; }
  }, [user, loading, router]);

  if (loading || !user) return <Loading />;

  return (
    <div style={{ position: "relative" }}>
      {/* Sign-out button floating in top-right */}
      <button onClick={signOut}
        style={{ position: "fixed", top: 16, right: 16, zIndex: 100,
          padding: "7px 14px", borderRadius: 8, border: "1px solid #1A2230",
          background: "transparent", color: "#5A6A80", fontSize: 12,
          cursor: "pointer", fontFamily: "Inter,sans-serif" }}>
        Sign Out
      </button>
      <GigaSoukDesignerDashboard designerId={user.profileId} />
    </div>
  );
}

function Loading() {
  return (
    <div style={{ background: "#060810", minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes gs-pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "Inter,sans-serif" }}>
        GIGA<span style={{ color: "#00E5A0" }}>SOUK</span>
      </div>
      <div style={{ width: 32, height: 3, borderRadius: 2, background: "#00E5A0",
        animation: "gs-pulse 1.2s ease infinite" }}/>
    </div>
  );
}
