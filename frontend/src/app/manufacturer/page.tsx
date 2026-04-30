// ════════════════════════════════════════════════════════════════
// app/manufacturer/page.tsx — Manufacturer Dashboard Page
// Guards: must be logged in + role = "manufacturer"
// Passes manufacturerId (manufacturers.id from profile join) to component.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import GigaSoukManufacturerDashboard from "../../components/GigaSoukManufacturerDashboard";

const C = { bg: "#060810", t3: "#5A6A80", border: "#1A2230" };

export default function ManufacturerPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user)                        { router.replace("/auth/login"); return; }
    if (user.role !== "manufacturer") { router.replace("/"); return; }
  }, [user, loading, router]);

  if (loading || !user) return <Loading />;

  // manufacturerId is set in auth-context via the manufacturers join
  if (!user.manufacturerId) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12,
        fontFamily: "Inter,sans-serif", padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#F4F6FC" }}>
          Your manufacturer profile is being set up.
        </p>
        <p style={{ fontSize: 13, color: C.t3, maxWidth: 380 }}>
          It may take a moment for your workshop record to be created.
          Please refresh the page in a few seconds.
        </p>
        <button onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#00E5A0", color: "#060810", fontWeight: 700, cursor: "pointer" }}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={signOut}
        style={{ position: "fixed", top: 16, right: 16, zIndex: 100,
          padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
          background: "transparent", color: C.t3, fontSize: 12,
          cursor: "pointer", fontFamily: "Inter,sans-serif" }}>
        Sign Out
      </button>
      <GigaSoukManufacturerDashboard manufacturerId={user.manufacturerId} />
    </div>
  );
}

function Loading() {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex",
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
