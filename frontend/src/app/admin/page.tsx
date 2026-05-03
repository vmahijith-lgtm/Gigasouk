// ════════════════════════════════════════════════════════════════
// app/admin/page.tsx — Admin Control Panel Page
// Guards: must be logged in + role = "admin"
// Passes adminId (profile.id) to the admin panel component.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import GigaSoukAdminPanel from "../../components/GigaSoukAdminPanel";

const C = { bg: "#060810", t3: "#5A6A80", border: "#1A2230" };

export default function AdminPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/auth/login"); return; }
    if (user.role !== "admin") { router.replace("/"); return; }
  }, [user, loading, router]);

  if (loading || !user) return <Loading />;

  return (
    <GigaSoukAdminPanel
      adminId={user.profileId}
      onSignOut={signOut}
    />
  );
}

function Loading() {
  return (
    <div style={{
      background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16
    }}>
      <style>{`@keyframes gs-pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "Inter,sans-serif" }}>
        GIGA<span style={{ color: "#00E5A0" }}>SOUK</span>
      </div>
      <div style={{
        width: 32, height: 3, borderRadius: 2, background: "#00E5A0",
        animation: "gs-pulse 1.2s ease infinite"
      }} />
    </div>
  );
}
