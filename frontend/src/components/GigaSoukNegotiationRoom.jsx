// ════════════════════════════════════════════════════════════════
// GigaSoukNegotiationRoom.jsx — Negotiation: chat + bids (designer ↔ manufacturer)
// Real-time via Supabase Realtime. sender_id is always profiles.id.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { submitBid, acceptBid, sendMessage, markRead } from "../lib/api";
import { shortDesignChatLabel } from "../lib/negotiationLabels";

const C = {
  bg: "#060810",
  card: "#0C1018",
  card2: "#111826",
  border: "#1A2230",
  green: "#00E5A0",
  gold: "#F5A623",
  blue: "#4A9EFF",
  red: "#F87171",
  t1: "#F4F6FC",
  t2: "#B8C4D8",
  t3: "#5A6A80",
};

function initials(name) {
  if (!name || typeof name !== "string") return "?";
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((s) => s[0]).join("").toUpperCase() || "?";
}

// ════════════════════════════════════════════════════════════════
export default function GigaSoukNegotiationRoom({
  roomId,
  userId,
  userRole,
  manufacturerId,
  embedded = false,
}) {
  const [room, setRoom] = useState(null);
  const [meta, setMeta] = useState({
    designTitle: "",
    designSummary: "",
    orderRef: "",
    counterpartyName: "",
  });
  const [messages, setMessages] = useState([]);
  const [bids, setBids] = useState([]);
  const [msgText, setMsgText] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  const [roomLoading, setRoomLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  /** Set when PostgREST fails (embed/RLS) so we don't show a vague "Room not found." */
  const [roomFetchError, setRoomFetchError] = useState("");
  const bottomRef = useRef();

  const enrichIncomingMessage = useCallback(async (row) => {
    if (!row?.sender_id) return row;
    const { data } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", row.sender_id)
      .maybeSingle();
    return { ...row, profiles: data };
  }, []);

  // ── Load room + validate participant ────────────────────────────
  useEffect(() => {
    if (!roomId || !userId) return;

    let cancelled = false;
    setRoomLoading(true);
    setAccessDenied(false);
    setRoomFetchError("");

    (async () => {
      // Only embed orders via negotiation_rooms.order_id (two FKs between these tables).
      // Load design title separately — nested designs(embed) often fails RLS for manufacturers.
      const { data: r, error: rErr } = await supabase
        .from("negotiation_rooms")
        .select(
          `
          *,
          commitment_id,
          orders!order_id ( order_ref, design_id )
        `
        )
        .eq("id", roomId)
        .maybeSingle();

      if (cancelled) return;

      if (rErr) {
        setRoom(null);
        setRoomFetchError(rErr.message || "Could not load this room from the database.");
        setRoomLoading(false);
        return;
      }

      if (!r) {
        setRoom(null);
        setRoomLoading(false);
        return;
      }

      const allowed =
        (userRole === "designer" && r.designer_id === userId) ||
        (userRole === "manufacturer" &&
          manufacturerId &&
          r.manufacturer_id === manufacturerId);

      if (!allowed) {
        setAccessDenied(true);
        setRoom(null);
        setRoomLoading(false);
        return;
      }

      setRoom(r);
      setBidAmount(String(r.base_price ?? ""));
      let title = "";
      let designSummary = "";
      let designId = r.orders?.design_id;
      if (!designId && r.commitment_id) {
        const { data: crow } = await supabase
          .from("manufacturer_commitments")
          .select("design_id")
          .eq("id", r.commitment_id)
          .maybeSingle();
        designId = crow?.design_id;
      }
      if (designId) {
        const { data: drow } = await supabase
          .from("designs")
          .select("title, description")
          .eq("id", designId)
          .maybeSingle();
        title = drow?.title || "";
        designSummary = drow ? shortDesignChatLabel(drow) : "";
      }
      const ref = r.orders?.order_ref || "";
      let cp = "";
      if (userRole === "designer") {
        const { data: mrow } = await supabase
          .from("manufacturers")
          .select("shop_name, city")
          .eq("id", r.manufacturer_id)
          .maybeSingle();
        cp = mrow?.shop_name || mrow?.city || "Manufacturer";
      } else {
        const { data: prow } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", r.designer_id)
          .maybeSingle();
        cp = prow?.full_name || "Designer";
      }
      if (!cancelled) {
        setMeta({
          designTitle: title,
          designSummary: designSummary || title,
          orderRef: ref,
          counterpartyName: cp,
        });
      }

      const [mRes, bRes] = await Promise.all([
        supabase
          .from("messages")
          .select("*, profiles(full_name)")
          .eq("room_id", roomId)
          .order("sent_at", { ascending: true }),
        supabase
          .from("bids")
          .select("*, profiles(full_name)")
          .eq("negotiation_room_id", roomId)
          .order("created_at", { ascending: true }),
      ]);

      if (cancelled) return;
      setMessages(mRes.data || []);
      setBids(bRes.data || []);
      setRoomLoading(false);

      markRead({ room_id: roomId, reader_id: userId }).catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, userId, userRole, manufacturerId]);

  // ── Countdown ───────────────────────────────────────────────────
  useEffect(() => {
    if (!room?.expires_at) return;
    const tick = () => {
      const diff = new Date(room.expires_at) - new Date();
      if (diff <= 0) {
        setTimeLeft("Expired");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [room]);

  // ── Realtime: messages + bids + room status ────────────────────
  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`negotiation-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const enriched = await enrichIncomingMessage(payload.new);
          setMessages((prev) => {
            if (prev.some((x) => x.id === enriched.id)) return prev;
            return [...prev, enriched];
          });
          markRead({ room_id: roomId, reader_id: userId }).catch(() => {});
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `negotiation_room_id=eq.${roomId}`,
        },
        async (payload) => {
          const { data: full } = await supabase
            .from("bids")
            .select("*, profiles(full_name)")
            .eq("id", payload.new.id)
            .maybeSingle();
          setBids((prev) => {
            const others = prev.map((b) =>
              b.status === "active" ? { ...b, status: "countered" } : b
            );
            return full ? [...others, full] : [...others, payload.new];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "negotiation_rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          setRoom((prev) => (prev ? { ...prev, ...payload.new } : payload.new));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [roomId, userId, enrichIncomingMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!msgText.trim()) return;
    setSending(true);
    setError("");
    try {
      await sendMessage({
        room_id: roomId,
        sender_id: userId,
        sender_role: userRole,
        content: msgText.trim(),
      });
      setMsgText("");
    } catch {
      setError("Message failed. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleBid() {
    const amount = parseFloat(bidAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBidding(true);
    setError("");
    try {
      await submitBid({
        negotiation_room_id: roomId,
        bidder_id: userId,
        bidder_role: userRole,
        amount,
      });
    } catch (e) {
      setError(e?.response?.data?.detail || "Bid failed.");
    } finally {
      setBidding(false);
    }
  }

  async function handleAccept(bid) {
    setAccepting(true);
    setError("");
    try {
      await acceptBid({
        negotiation_room_id: roomId,
        accepted_by_id: userId,
        bid_id: bid.id,
      });
      setRoom((prev) =>
        prev ? { ...prev, status: "locked", locked_price: bid.amount } : prev
      );
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not accept bid.");
    } finally {
      setAccepting(false);
    }
  }

  const activeBid = bids.find((b) => b.status === "active");
  const isLocked = room?.status === "locked";
  const isExpired = room?.status === "expired" || timeLeft === "Expired";
  const canAccept = activeBid && activeBid.bidder_id !== userId && !isLocked;

  const shellHeight = embedded
    ? { flex: 1, minHeight: 0, height: "100%" }
    : { height: "80vh" };

  if (roomLoading) {
    return (
      <div
        style={{
          background: C.card,
          border: embedded ? "none" : `1px solid ${C.border}`,
          borderRadius: embedded ? 0 : 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          ...shellHeight,
          fontFamily: "Inter,sans-serif",
        }}
      >
        <style>{`@keyframes nr-pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
        <div style={{ fontSize: 22, fontWeight: 900 }}>
          GIGA<span style={{ color: C.green }}>SOUK</span>
        </div>
        <div
          style={{
            width: 28,
            height: 3,
            borderRadius: 2,
            background: C.green,
            animation: "nr-pulse 1.2s ease infinite",
          }}
        />
        <p style={{ color: C.t3, fontSize: 12 }}>Loading conversation…</p>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          fontFamily: "Inter,sans-serif",
          ...shellHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p style={{ color: C.red, fontSize: 14, maxWidth: 360 }}>
          You do not have access to this negotiation. Open it from your dashboard chat list.
        </p>
      </div>
    );
  }

  if (!room) {
    return (
      <div
        style={{
          background: C.card,
          border: embedded ? "none" : `1px solid ${C.border}`,
          borderRadius: embedded ? 0 : 12,
          padding: 40,
          textAlign: "center",
          fontFamily: "Inter,sans-serif",
          ...shellHeight,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <p style={{ color: C.red, fontSize: 14, maxWidth: 420, lineHeight: 1.5 }}>
          {roomFetchError ||
            "No negotiation room with this link, or your account cannot see it (wrong login or RLS). Open the chat from your designer or manufacturer dashboard."}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: C.card,
        border: embedded ? "none" : `1px solid ${C.border}`,
        borderRadius: embedded ? 0 : 12,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter,sans-serif",
        ...shellHeight,
      }}
    >
      {/* Header — counterparty + design */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${C.border}`,
          background: C.card2,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: C.green + "22",
              border: `1px solid ${C.green}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 14,
              color: C.green,
              flexShrink: 0,
            }}
          >
            {initials(meta.counterpartyName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: C.t1,
                marginBottom: 4,
                lineHeight: 1.35,
              }}
            >
              {meta.designSummary || meta.designTitle}
            </p>
            <p style={{ fontSize: 12, color: C.t2, marginBottom: 2 }}>{meta.counterpartyName}</p>
            <p style={{ fontSize: 11, color: C.t3, lineHeight: 1.45 }}>
              {userRole === "designer" ? "Manufacturer" : "Designer"} · 1:1 on this order
            </p>
            {meta.designTitle &&
              meta.designSummary &&
              meta.designTitle.trim() !== meta.designSummary.trim() && (
                <p style={{ fontSize: 12, color: C.blue, fontWeight: 600, marginTop: 6 }}>
                  {meta.designTitle}
                </p>
              )}
            {meta.orderRef && (
              <p style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>Order {meta.orderRef}</p>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {isLocked ? (
              <div>
                <span
                  style={{
                    background: C.green + "22",
                    border: `1px solid ${C.green}`,
                    borderRadius: 20,
                    padding: "3px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.green,
                  }}
                >
                  LOCKED
                </span>
                <p style={{ fontSize: 14, fontWeight: 800, color: C.green, marginTop: 6 }}>
                  ₹{Number(room.locked_price).toLocaleString("en-IN")}
                </p>
              </div>
            ) : isExpired ? (
              <span
                style={{
                  background: C.red + "22",
                  border: `1px solid ${C.red}`,
                  borderRadius: 20,
                  padding: "3px 12px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.red,
                }}
              >
                EXPIRED
              </span>
            ) : (
              <div>
                <p style={{ fontSize: 11, color: C.t3 }}>Time left</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>{timeLeft}</p>
              </div>
            )}
          </div>
        </div>
        <p style={{ fontSize: 11, color: C.t3, marginTop: 10 }}>
          Base reference: ₹{Number(room.base_price).toLocaleString("en-IN")}
        </p>
      </div>

      {activeBid && !isLocked && (
        <div
          style={{
            padding: "12px 18px",
            background: C.gold + "15",
            borderBottom: `1px solid ${C.gold}44`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <p style={{ fontSize: 11, color: C.gold, fontWeight: 700 }}>ACTIVE OFFER</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: C.t1 }}>
              ₹{Number(activeBid.amount).toLocaleString("en-IN")}
            </p>
            <p style={{ fontSize: 11, color: C.t3 }}>
              From{" "}
              {activeBid.bidder_id === userId
                ? "you"
                : activeBid.profiles?.full_name || activeBid.bidder_role}
            </p>
          </div>
          {canAccept && (
            <button
              type="button"
              onClick={() => handleAccept(activeBid)}
              disabled={accepting}
              style={{
                padding: "10px 22px",
                borderRadius: 8,
                border: "none",
                background: accepting ? C.t3 : C.green,
                color: "#060810",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {accepting ? "Accepting…" : "Accept deal"}
            </button>
          )}
        </div>
      )}

      {isLocked && (
        <div
          style={{
            padding: "12px 18px",
            background: C.green + "18",
            borderBottom: `1px solid ${C.green}44`,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
            Deal locked at ₹{Number(room.locked_price).toLocaleString("en-IN")} — chat is read-only.
          </p>
        </div>
      )}

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
        }}
      >
        {messages.length === 0 && (
          <p style={{ fontSize: 13, color: C.t3, textAlign: "center", padding: 24 }}>
            No messages yet. Say hello and propose a price below.
          </p>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === userId;
          const label =
            msg.profiles?.full_name ||
            (msg.sender_role === "designer" ? "Designer" : "Manufacturer");
          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isMe ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: isMe ? "row-reverse" : "row",
                  alignItems: "flex-end",
                  gap: 8,
                  maxWidth: "85%",
                }}
              >
                {!isMe && (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: C.blue + "22",
                      border: `1px solid ${C.blue}44`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                      color: C.blue,
                      flexShrink: 0,
                    }}
                  >
                    {initials(label)}
                  </div>
                )}
                <div>
                  {!isMe && (
                    <p
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: C.t3,
                        marginBottom: 4,
                        marginLeft: 2,
                      }}
                    >
                      {label}
                    </p>
                  )}
                  <div
                    style={{
                      background: isMe ? C.green + "22" : C.card2,
                      border: `1px solid ${isMe ? C.green + "55" : C.border}`,
                      borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      padding: "10px 14px",
                    }}
                  >
                    <p style={{ fontSize: 14, color: C.t1, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {msg.content}
                    </p>
                  </div>
                  <p style={{ fontSize: 10, color: C.t3, marginTop: 4, textAlign: isMe ? "right" : "left" }}>
                    {new Date(msg.sent_at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {!isLocked && !isExpired && (
        <div style={{ padding: "14px 18px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
          {error && (
            <p style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flex: 1,
                minWidth: 160,
                background: C.card2,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "4px 12px",
              }}
            >
              <span style={{ fontSize: 14, color: C.t3, marginRight: 6 }}>₹</span>
              <input
                type="number"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                placeholder="Offer amount"
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: C.t1,
                  fontSize: 16,
                  fontWeight: 700,
                  padding: "8px 0",
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleBid}
              disabled={bidding}
              style={{
                padding: "0 20px",
                borderRadius: 10,
                border: "none",
                background: bidding ? C.t3 : C.gold,
                color: "#060810",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {bidding ? "…" : "Submit offer"}
            </button>
          </div>

          <form onSubmit={handleSend} style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <input
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="Write a message…"
              style={{
                flex: 1,
                background: C.card2,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "12px 14px",
                color: C.t1,
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={sending || !msgText.trim()}
              style={{
                padding: "0 22px",
                borderRadius: 10,
                border: "none",
                background: msgText.trim() ? C.blue : C.t3,
                color: "#060810",
                fontWeight: 700,
                fontSize: 13,
                cursor: msgText.trim() ? "pointer" : "not-allowed",
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      {(isLocked || isExpired) && messages.length > 0 && (
        <div
          style={{
            padding: "10px 18px",
            borderTop: `1px solid ${C.border}`,
            fontSize: 11,
            color: C.t3,
            textAlign: "center",
          }}
        >
          {isExpired ? "This negotiation expired — history above." : "Negotiation closed — history above."}
        </div>
      )}
    </div>
  );
}
