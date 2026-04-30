// ════════════════════════════════════════════════════════════════
// GigaSoukNegotiationRoom.jsx — Live Negotiation Room
// Real-time chat + price bidding between designer and manufacturer.
// Supabase Realtime pushes messages instantly — no polling.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { supabase }   from "../lib/supabase";
import { submitBid, acceptBid, sendMessage, markRead } from "../lib/api";

const C = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF",
  red:"#F87171", t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukNegotiationRoom({ roomId, userId, userRole }) {
// roomId   — negotiation_rooms.id
// userId   — profiles.id of the current user
// userRole — "designer" | "manufacturer"
// ════════════════════════════════════════════════════════════════

  const [room,       setRoom]       = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [bids,       setBids]       = useState([]);
  const [msgText,    setMsgText]    = useState("");
  const [bidAmount,  setBidAmount]  = useState("");
  const [sending,    setSending]    = useState(false);
  const [bidding,    setBidding]    = useState(false);
  const [accepting,  setAccepting]  = useState(false);
  const [error,      setError]      = useState("");
  const [timeLeft,   setTimeLeft]   = useState("");
  const [roomLoading, setRoomLoading] = useState(true);
  const bottomRef = useRef();

  // ── Load room + messages + bids ─────────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    Promise.all([
      supabase.from("negotiation_rooms").select("*").eq("id", roomId).single(),
      supabase.from("messages").select("*, profiles(full_name)").eq("room_id", roomId)
        .order("sent_at", { ascending: true }),
      supabase.from("bids").select("*, profiles(full_name)").eq("negotiation_room_id", roomId)
        .order("created_at", { ascending: true }),
    ]).then(([rRes, mRes, bRes]) => {
      setRoom(rRes.data);
      setMessages(mRes.data || []);
      setBids(bRes.data || []);
      setBidAmount(String(rRes.data?.base_price || ""));
    }).finally(() => setRoomLoading(false));

    // Mark messages read
    markRead({ room_id: roomId, reader_id: userId });
  }, [roomId]);

  // ── Countdown timer ─────────────────────────────────────────────
  useEffect(() => {
    if (!room?.expires_at) return;
    const tick = () => {
      const diff = new Date(room.expires_at) - new Date();
      if (diff <= 0) { setTimeLeft("Expired"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [room]);

  // ── Supabase Realtime: live messages ────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase.channel(`room-${roomId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "messages",
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        setMessages(prev => [...prev, payload.new]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior:"smooth" }), 50);
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "bids",
        filter: `negotiation_room_id=eq.${roomId}`,
      }, payload => {
        setBids(prev => prev.map(b => ({ ...b, status:"countered" })).concat(payload.new));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [roomId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages]);

  // ── Send message ─────────────────────────────────────────────────
  async function handleSend(e) {
    e.preventDefault();
    if (!msgText.trim()) return;
    setSending(true);
    try {
      await sendMessage({ room_id:roomId, sender_id:userId, sender_role:userRole, content:msgText });
      setMsgText("");
    } catch { setError("Message failed. Try again."); }
    finally { setSending(false); }
  }

  // ── Submit bid ───────────────────────────────────────────────────
  async function handleBid() {
    const amount = parseFloat(bidAmount);
    if (isNaN(amount) || amount <= 0) { setError("Enter a valid amount."); return; }
    setBidding(true);
    setError("");
    try {
      await submitBid({ negotiation_room_id:roomId, bidder_id:userId, bidder_role:userRole, amount });
    } catch (e) { setError(e?.response?.data?.detail || "Bid failed."); }
    finally { setBidding(false); }
  }

  // ── Accept active bid ────────────────────────────────────────────
  async function handleAccept(bid) {
    setAccepting(true);
    setError("");
    try {
      await acceptBid({ negotiation_room_id:roomId, accepted_by_id:userId, bid_id:bid.id });
      setRoom(prev => ({ ...prev, status:"locked", locked_price:bid.amount }));
    } catch (e) { setError(e?.response?.data?.detail || "Could not accept bid."); }
    finally { setAccepting(false); }
  }

  const activeBid  = bids.find(b => b.status === "active");
  const isLocked   = room?.status === "locked";
  const isExpired  = room?.status === "expired" || timeLeft === "Expired";
  const canAccept  = activeBid && activeBid.bidder_id !== userId && !isLocked;

  if (roomLoading) return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12,
      display:"flex", alignItems:"center", justifyContent:"center",
      flexDirection:"column", gap:16, height:"80vh", fontFamily:"Inter,sans-serif" }}>
      <style>{`@keyframes nr-pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      <div style={{ fontSize:22, fontWeight:900 }}>
        GIGA<span style={{ color:C.green }}>SOUK</span>
      </div>
      <div style={{ width:28, height:3, borderRadius:2, background:C.green,
        animation:"nr-pulse 1.2s ease infinite" }}/>
      <p style={{ color:C.t3, fontSize:12 }}>Loading negotiation room…</p>
    </div>
  );

  if (!room) return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12,
      padding:40, textAlign:"center", fontFamily:"Inter,sans-serif" }}>
      <p style={{ color:"#F87171", fontSize:14 }}>Room not found or access denied.</p>
    </div>
  );

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12,
      display:"flex", flexDirection:"column", height:"80vh", fontFamily:"Inter,sans-serif" }}>

      {/* ── Room Header ────────────────────────────────────────── */}
      <div style={{ padding:"14px 20px", borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <p style={{ fontSize:13, fontWeight:700, color:C.t1 }}>Negotiation Room</p>
          <p style={{ fontSize:11, color:C.t3 }}>Base price: ₹{Number(room.base_price).toLocaleString("en-IN")}</p>
        </div>
        <div style={{ textAlign:"right" }}>
          {isLocked ? (
            <div>
              <span style={{ background:C.green+"22", border:`1px solid ${C.green}`,
                borderRadius:20, padding:"3px 12px", fontSize:11, fontWeight:700, color:C.green }}>
                LOCKED
              </span>
              <p style={{ fontSize:13, fontWeight:800, color:C.green, marginTop:4 }}>
                ₹{Number(room.locked_price).toLocaleString("en-IN")}
              </p>
            </div>
          ) : isExpired ? (
            <span style={{ background:C.red+"22", border:`1px solid ${C.red}`,
              borderRadius:20, padding:"3px 12px", fontSize:11, fontWeight:700, color:C.red }}>
              EXPIRED
            </span>
          ) : (
            <div>
              <p style={{ fontSize:11, color:C.t3 }}>Expires in</p>
              <p style={{ fontSize:13, fontWeight:700, color:C.gold }}>{timeLeft}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Active Bid Banner ───────────────────────────────────── */}
      {activeBid && !isLocked && (
        <div style={{ padding:"12px 20px", background:C.gold+"15",
          borderBottom:`1px solid ${C.gold}44`,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <p style={{ fontSize:11, color:C.gold, fontWeight:700 }}>ACTIVE BID</p>
            <p style={{ fontSize:20, fontWeight:800, color:C.t1 }}>
              ₹{Number(activeBid.amount).toLocaleString("en-IN")}
            </p>
            <p style={{ fontSize:11, color:C.t3 }}>
              by {activeBid.bidder_role === userRole ? "You" : activeBid.profiles?.full_name || activeBid.bidder_role}
            </p>
          </div>
          {canAccept && (
            <button onClick={() => handleAccept(activeBid)} disabled={accepting}
              style={{ padding:"10px 22px", borderRadius:8, border:"none",
                background:accepting ? C.t3 : C.green, color:"#060810",
                fontWeight:700, fontSize:14, cursor:"pointer" }}>
              {accepting ? "Accepting..." : "Accept Deal"}
            </button>
          )}
        </div>
      )}

      {/* Locked confirmation */}
      {isLocked && (
        <div style={{ padding:"12px 20px", background:C.green+"18",
          borderBottom:`1px solid ${C.green}44`, textAlign:"center" }}>
          <p style={{ fontSize:13, fontWeight:700, color:C.green }}>
            ✓ Deal locked at ₹{Number(room.locked_price).toLocaleString("en-IN")} — Customer will be sent payment link
          </p>
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex",
        flexDirection:"column", gap:10 }}>
        {messages.map(msg => {
          const isMe = msg.sender_id === userId;
          return (
            <div key={msg.id} style={{ display:"flex", flexDirection:"column",
              alignItems: isMe ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth:"75%", background: isMe ? C.green+"22" : C.card2,
                border:`1px solid ${isMe ? C.green+"55" : C.border}`,
                borderRadius: isMe ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                padding:"10px 14px" }}>
                {!isMe && (
                  <p style={{ fontSize:10, fontWeight:700, color:C.t3,
                    marginBottom:4, textTransform:"uppercase", letterSpacing:".04em" }}>
                    {msg.sender_role}
                  </p>
                )}
                <p style={{ fontSize:13, color:C.t1, lineHeight:1.5 }}>{msg.content}</p>
              </div>
              <p style={{ fontSize:10, color:C.t3, marginTop:3 }}>
                {new Date(msg.sent_at).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ── Bid + Message Input ─────────────────────────────────── */}
      {!isLocked && !isExpired && (
        <div style={{ padding:"14px 20px", borderTop:`1px solid ${C.border}` }}>
          {error && <p style={{ color:C.red, fontSize:12, marginBottom:8 }}>{error}</p>}

          {/* Bid row */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", flex:1,
              background:C.card2, border:`1px solid ${C.border}`, borderRadius:8,
              padding:"2px 12px" }}>
              <span style={{ fontSize:13, color:C.t3, marginRight:6 }}>₹</span>
              <input type="number" value={bidAmount} onChange={e => setBidAmount(e.target.value)}
                placeholder="Enter price"
                style={{ flex:1, background:"none", border:"none", outline:"none",
                  color:C.t1, fontSize:15, fontWeight:700, padding:"8px 0" }} />
            </div>
            <button onClick={handleBid} disabled={bidding}
              style={{ padding:"0 18px", borderRadius:8, border:"none",
                background:bidding ? C.t3 : C.gold, color:"#060810",
                fontWeight:700, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>
              {bidding ? "..." : "Submit Bid"}
            </button>
          </div>

          {/* Message row */}
          <form onSubmit={handleSend} style={{ display:"flex", gap:8 }}>
            <input value={msgText} onChange={e => setMsgText(e.target.value)}
              placeholder="Type a message..."
              style={{ flex:1, background:C.card2, border:`1px solid ${C.border}`,
                borderRadius:8, padding:"10px 14px", color:C.t1, fontSize:14,
                outline:"none" }} />
            <button type="submit" disabled={sending || !msgText.trim()}
              style={{ padding:"0 18px", borderRadius:8, border:"none",
                background: msgText.trim() ? C.blue : C.t3,
                color:"#060810", fontWeight:700, fontSize:13, cursor:"pointer" }}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
