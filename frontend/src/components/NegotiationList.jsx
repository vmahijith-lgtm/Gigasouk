// NegotiationList.jsx — Split-view negotiation hub: room list + live chat with the counterparty.

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import GigaSoukNegotiationRoom from "./GigaSoukNegotiationRoom";

const C = {
  card: "#0C1018",
  card2: "#111826",
  border: "#1A2230",
  green: "#00E5A0",
  gold: "#F5A623",
  red: "#F87171",
  blue: "#4A9EFF",
  t1: "#F4F6FC",
  t2: "#B8C4D8",
  t3: "#5A6A80",
};

const STATUS_STYLE = {
  open: { bg: C.gold + "22", border: C.gold, label: "Open" },
  locked: { bg: C.green + "22", border: C.green, label: "Deal locked" },
  expired: { bg: C.red + "22", border: C.red, label: "Expired" },
};

/**
 * @param {"designer"|"manufacturer"} role
 * @param {string} [designerId] profiles.id when role is designer
 * @param {string} [manufacturerId] manufacturers.id when role is manufacturer
 * @param {string} [profileId] profiles.id for message sender (both roles — required for manufacturer chat)
 */
export default function NegotiationList({ role, designerId, manufacturerId, profileId }) {
  const senderProfileId =
    profileId ?? (role === "designer" ? designerId : null);

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const loadRooms = useCallback(async () => {
    if (role === "designer" && !designerId) return;
    if (role === "manufacturer" && !manufacturerId) return;

    setLoading(true);
    setError("");

    try {
      let q = supabase
        .from("negotiation_rooms")
        .select(
          `
          id,
          status,
          base_price,
          locked_price,
          expires_at,
          created_at,
          order_id,
          designer_id,
          manufacturer_id,
          orders (
            order_ref,
            designs ( title )
          )
        `
        )
        .order("created_at", { ascending: false });

      if (role === "designer") q = q.eq("designer_id", designerId);
      else if (role === "manufacturer") q = q.eq("manufacturer_id", manufacturerId);

      const { data: rows, error: qErr } = await q;
      if (qErr) throw qErr;

      const list = rows || [];
      const mIds = [...new Set(list.map((r) => r.manufacturer_id).filter(Boolean))];
      const pIds = [...new Set(list.map((r) => r.designer_id).filter(Boolean))];

      const [mfrRes, profRes] = await Promise.all([
        mIds.length
          ? supabase.from("manufacturers").select("id, shop_name, city").in("id", mIds)
          : { data: [] },
        pIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", pIds)
          : { data: [] },
      ]);

      const byMfr = Object.fromEntries((mfrRes.data || []).map((m) => [m.id, m]));
      const byProf = Object.fromEntries((profRes.data || []).map((p) => [p.id, p]));

      setRooms(
        list.map((r) => ({
          ...r,
          _counterparty:
            role === "designer"
              ? byMfr[r.manufacturer_id]
              : byProf[r.designer_id],
          _designerName: byProf[r.designer_id]?.full_name,
          _orderRef: r.orders?.order_ref,
          _designTitle: r.orders?.designs?.title,
        }))
      );
    } catch {
      setError("Could not load negotiation rooms.");
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [role, designerId, manufacturerId]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!rooms.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && rooms.some((r) => r.id === prev)) return prev;
      return rooms[0].id;
    });
  }, [rooms]);

  function counterpartyLabel(room) {
    if (role === "designer") {
      const m = room._counterparty;
      if (!m) return "Manufacturer";
      return m.shop_name || m.city || "Manufacturer";
    }
    const d = room._counterparty;
    return d?.full_name || "Designer";
  }

  if (loading) {
    return (
      <p style={{ color: C.t3, textAlign: "center", padding: 24 }}>
        Loading conversations…
      </p>
    );
  }

  if (error) {
    return (
      <p style={{ color: C.red, textAlign: "center", padding: 24 }}>{error}</p>
    );
  }

  if (!senderProfileId && role === "manufacturer") {
    return (
      <p style={{ color: C.red, textAlign: "center", padding: 24 }}>
        Missing profile — refresh the page or sign in again.
      </p>
    );
  }

  if (!rooms.length) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: C.t3,
          background: C.card2,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          maxWidth: 520,
          margin: "0 auto",
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
          No negotiations yet
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          When a customer places an order that routes to you and the designer, a private chat opens here for price
          discussion until the deal is locked.
        </p>
      </div>
    );
  }

  const selected = rooms.find((r) => r.id === selectedId) || rooms[0];

  return (
    <div>
      <p style={{ fontSize: 13, color: C.t3, marginBottom: 16, lineHeight: 1.55, maxWidth: 720 }}>
        Select a conversation on the left. You are connected <strong style={{ color: C.t2 }}>only</strong> with the
        designer or manufacturer on that order — messages sync in real time.
      </p>

      <style>{`
        .gs-neg-grid {
          display: grid;
          grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
          gap: 0;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid ${C.border};
          min-height: min(72vh, 640px);
          max-height: min(85vh, 900px);
        }
        @media (max-width: 880px) {
          .gs-neg-grid {
            grid-template-columns: 1fr;
            max-height: none;
          }
          .gs-neg-list { max-height: 220px !important; border-right: none !important; border-bottom: 1px solid ${C.border}; }
        }
      `}</style>

      <div className="gs-neg-grid" style={{ background: C.card }}>
        {/* Room list */}
        <aside
          className="gs-neg-list"
          style={{
            borderRight: `1px solid ${C.border}`,
            overflowY: "auto",
            background: C.card2,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 11,
              fontWeight: 800,
              color: C.t3,
              letterSpacing: "0.08em",
            }}
          >
            CONVERSATIONS ({rooms.length})
          </div>
          {rooms.map((room) => {
            const st = STATUS_STYLE[room.status] || STATUS_STYLE.open;
            const active = room.id === selectedId;
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedId(room.id)}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  border: "none",
                  borderBottom: `1px solid ${C.border}`,
                  background: active ? C.card : "transparent",
                  cursor: "pointer",
                  borderLeft: active ? `3px solid ${C.green}` : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "2px 8px",
                      borderRadius: 8,
                      background: st.bg,
                      border: `1px solid ${st.border}55`,
                      color: st.border,
                    }}
                  >
                    {st.label}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: C.t1,
                    marginBottom: 4,
                    lineHeight: 1.3,
                  }}
                >
                  {counterpartyLabel(room)}
                </p>
                {room._designTitle && (
                  <p
                    style={{
                      fontSize: 12,
                      color: C.blue,
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                  >
                    {room._designTitle}
                  </p>
                )}
                {room._orderRef && (
                  <p style={{ fontSize: 11, color: C.t3 }}>Order {room._orderRef}</p>
                )}
              </button>
            );
          })}
        </aside>

        {/* Chat pane */}
        <main style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
          {selected && senderProfileId && (
            <GigaSoukNegotiationRoom
              key={selected.id}
              roomId={selected.id}
              userId={senderProfileId}
              userRole={role}
              manufacturerId={manufacturerId || undefined}
              embedded
            />
          )}
        </main>
      </div>

      <p style={{ fontSize: 12, color: C.t3, marginTop: 14 }}>
        Open this chat in a separate tab:{" "}
        <a
          href={`/negotiate/${selected?.id}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: C.green, fontWeight: 600 }}
        >
          /negotiate/{selected?.id?.slice(0, 8)}…
        </a>
      </p>
    </div>
  );
}
