// ════════════════════════════════════════════════════════════════
// app/negotiate/[roomId]/page.tsx — Negotiation Room Page
// Dynamic route: /negotiate/<room-uuid>
// Accessible by the designer or manufacturer involved in the room.
// Reads roomId from URL params, userId + role from auth context.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import GigaSoukNegotiationRoom from "../../../components/GigaSoukNegotiationRoom";

const C = { bg: "#060810", t3: "#5A6A80", border: "#1A2230" };

export default function NegotiationRoomPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const params = useParams();
  const roomId = params?.roomId as string;

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/auth/login"); return; }
    // Only designers and manufacturers access negotiation rooms
    if (user.role !== "designer" && user.role !== "manufacturer") {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading || !user) return <Loading />;
  if (!roomId) return <p style={{ color: C.t3, padding: 40 }}>Invalid room.</p>;

  const userRole = user.role as "designer" | "manufacturer";

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "20px 16px",
      fontFamily: "Inter,sans-serif", position: "relative" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 20 }}>
        <div>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#F4F6FC" }}>GIGA</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#00E5A0" }}>SOUK</span>
          <span style={{ fontSize: 12, color: C.t3, marginLeft: 10 }}>Negotiation Room</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Back to dashboard */}
          <a href={userRole === "designer" ? "/designer" : "/manufacturer"}
            style={{ fontSize: 12, color: C.t3, textDecoration: "none",
              padding: "7px 14px", border: `1px solid ${C.border}`, borderRadius: 8 }}>
            ← Dashboard
          </a>
          <button onClick={signOut}
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "transparent", color: C.t3, fontSize: 12, cursor: "pointer" }}>
            Sign Out
          </button>
        </div>
      </div>

      {/* Negotiation Room component */}
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <GigaSoukNegotiationRoom
          roomId={roomId}
          userId={user.profileId}
          userRole={userRole}
          manufacturerId={user.manufacturerId ?? undefined}
        />
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: C.t3, fontFamily: "Inter,sans-serif" }}>Loading room…</p>
    </div>
  );
}
