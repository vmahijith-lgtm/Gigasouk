"use client";
// ════════════════════════════════════════════════════════════════
// app/track/[orderId]/page.tsx — Order Tracking Page
// Customer sees: order status timeline + live shipment info
// ════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useParams }           from "next/navigation";
import { supabase }            from "../../../lib/supabase";
import { BACKEND_URL }         from "../../../lib/api";
import { TrackingMap }         from "../../../components/MapComponents";

const C = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF", red:"#F87171",
  t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80",
};

// Full order lifecycle stages
const STAGES = [
  { key:"negotiating", label:"Negotiating",  icon:"💬" },
  { key:"confirmed",   label:"Confirmed",    icon:"✅" },
  { key:"cutting",     label:"Making",       icon:"🔧" },
  { key:"qc_review",   label:"QC Check",     icon:"🔬" },
  { key:"shipped",     label:"Shipped",      icon:"🚚" },
  { key:"delivered",   label:"Delivered",    icon:"🎉" },
];

const STATUS_COLOR: Record<string, string> = {
  routing:     C.gold,
  negotiating: C.blue,
  confirmed:   C.green,
  cutting:     C.gold,
  qc_review:   C.gold,
  qc_failed:   C.red,
  shipped:     C.blue,
  delivered:   C.green,
  cancelled:   C.red,
  refunded:    C.red,
};

export default function TrackOrderPage() {
  const params               = useParams();
  const orderId              = params?.orderId as string;
  const [order,  setOrder]   = useState<any>(null);
  const [track,  setTrack]   = useState<any>(null);
  const [loading,setLoading] = useState(true);
  const [error,  setError]   = useState("");

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: ord, error: oErr } = await supabase
          .from("orders")
          .select("*, designs(title, thumbnail_url), manufacturers(city, lat, lng)")
          .eq("id", orderId)
          .single();
        if (oErr || !ord) throw new Error("Order not found or you don't have access.");
        setOrder(ord);

        if (ord.shiprocket_awb) {
          const res = await fetch(
            `${BACKEND_URL}/api/v1/track/${ord.shiprocket_awb}`
          );
          if (res.ok) setTrack(await res.json());
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"Inter,sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:28, fontWeight:900, marginBottom:16 }}>
          GIGA<span style={{ color:C.green }}>SOUK</span>
        </div>
        <div style={{ width:32, height:3, borderRadius:2, background:C.green,
          margin:"0 auto", animation:"pulse 1.2s ease infinite" }}/>
        <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      </div>
    </div>
  );

  if (error || !order) return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex",
      alignItems:"center", justifyContent:"center", fontFamily:"Inter,sans-serif",
      padding:24, textAlign:"center" }}>
      <div>
        <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
        <p style={{ color:C.red, fontSize:16, fontWeight:600, marginBottom:8 }}>
          {error || "Order not found"}
        </p>
        <a href="/" style={{ color:C.green, fontSize:13, textDecoration:"none" }}>
          ← Back to GigaSouk
        </a>
      </div>
    </div>
  );

  const currentStageIdx = STAGES.findIndex(s => s.key === order.status);
  const addr            = order.delivery_address || {};
  const mfr             = order.manufacturers    || {};
  const isShipped       = ["shipped","delivered"].includes(order.status);
  const statusColor     = STATUS_COLOR[order.status] || C.t3;

  // Parse tracking location from Shiprocket response
  const trackCity  = track?.tracking_data?.shipment_track?.[0]?.current_city  || mfr.city || "";
  const trackState = track?.tracking_data?.shipment_track?.[0]?.current_state || "";
  const trackStatus= track?.tracking_data?.shipment_track?.[0]?.current_status || order.status.toUpperCase();

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:"Inter, sans-serif",
      padding:"40px 20px", color:C.t1 }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes glow{0%,100%{box-shadow:0 0 8px #00E5A040}50%{box-shadow:0 0 16px #00E5A080}}
      `}</style>
      <div style={{ maxWidth:720, margin:"0 auto" }}>

        {/* ── Header ───────────────────────────────────────────── */}
        <div style={{ marginBottom:28 }}>
          <a href="/" style={{ color:C.t3, fontSize:13, textDecoration:"none",
            display:"inline-flex", alignItems:"center", gap:6 }}>
            ← GigaSouk
          </a>
          <div style={{ display:"flex", alignItems:"flex-start",
            justifyContent:"space-between", flexWrap:"wrap", gap:12, marginTop:14 }}>
            <div>
              <h1 style={{ color:C.t1, fontSize:24, fontWeight:800,
                letterSpacing:"-0.5px", marginBottom:4 }}>
                Track Order
              </h1>
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ color:C.green, fontWeight:700, fontSize:15 }}>
                  {order.order_ref}
                </span>
                <span style={{ color:C.t3, fontSize:13 }}>
                  {order.designs?.title || "Custom Part"}
                </span>
              </div>
            </div>
            {/* Status badge */}
            <div style={{ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:700,
              background: statusColor + "18", border:`1px solid ${statusColor}50`,
              color: statusColor, textTransform:"capitalize" }}>
              {order.status.replace("_"," ")}
            </div>
          </div>
        </div>

        {/* ── Status Timeline ───────────────────────────────────── */}
        <div style={{ background:C.card, borderRadius:16, padding:"24px 20px",
          marginBottom:20, border:`1px solid ${C.border}` }}>
          <div style={{ color:C.t2, fontSize:13, fontWeight:600, marginBottom:24 }}>
            Order Progress
          </div>

          {/* Horizontal stepper — correct positioning */}
          <div style={{ display:"flex", alignItems:"flex-start" }}>
            {STAGES.map((stage, i) => {
              const done    = currentStageIdx >= 0 && i <= currentStageIdx;
              const current = i === currentStageIdx;
              const last    = i === STAGES.length - 1;
              return (
                <div key={stage.key}
                  style={{ flex:1, display:"flex", flexDirection:"column",
                    alignItems:"center", position:"relative" }}>

                  {/* Connector line (rendered before the dot, spans to next dot) */}
                  {!last && (
                    <div style={{
                      position:"absolute",
                      top:18, left:"50%", right:"-50%",
                      height:2,
                      background: i < currentStageIdx ? C.green : C.border,
                      transition:"background .4s",
                      zIndex:0,
                    }}/>
                  )}

                  {/* Step dot */}
                  <div style={{
                    position:"relative", zIndex:1,
                    width:36, height:36, borderRadius:"50%",
                    background: current ? C.green : done ? C.green + "25" : C.card2,
                    border: `2px solid ${done ? C.green : C.border}`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:15,
                    animation: current ? "glow 2s ease infinite" : "none",
                    transition:"all .3s",
                  }}>
                    {done && !current
                      ? <span style={{ color:C.green, fontSize:14, fontWeight:800 }}>✓</span>
                      : stage.icon}
                  </div>

                  {/* Label */}
                  <div style={{
                    marginTop:8, fontSize:10, fontWeight: current ? 700 : 500,
                    color: current ? C.green : done ? C.t2 : C.t3,
                    textAlign:"center", lineHeight:1.3,
                  }}>
                    {stage.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Live Tracking Map ─────────────────────────────────── */}
        {isShipped && addr.lat && trackCity && (
          <div style={{ marginBottom:20, borderRadius:16, overflow:"hidden",
            border:`1px solid ${C.border}` }}>
            <TrackingMap
              customerLat={addr.lat}
              customerLng={addr.lng}
              currentCity={trackCity}
              currentState={trackState}
              status={trackStatus}
            />
          </div>
        )}

        {/* ── Order Details Card ────────────────────────────────── */}
        <div style={{ background:C.card, borderRadius:16, padding:24,
          border:`1px solid ${C.border}`, marginBottom:20 }}>
          <div style={{ color:C.t2, fontSize:13, fontWeight:600, marginBottom:16 }}>
            Order Details
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {[
              { label:"Design",        value: order.designs?.title || "—" },
              { label:"Factory City",  value: mfr.city || "—" },
              { label:"Distance",      value: order.distance_km ? `${order.distance_km} km` : "—" },
              { label:"Quantity",      value: order.quantity ?? 1 },
              { label:"Locked Price",  value: order.locked_price ? `₹${Number(order.locked_price).toLocaleString("en-IN")}` : "Negotiating…" },
              { label:"Payment",       value: order.payment_status || "pending" },
              { label:"AWB",           value: order.shiprocket_awb || "Not yet shipped" },
              { label:"Placed",        value: new Date(order.created_at).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }) },
            ].map(({ label, value }) => (
              <div key={label} style={{ background:C.card2, borderRadius:10, padding:"12px 14px",
                border:`1px solid ${C.border}` }}>
                <div style={{ color:C.t3, fontSize:11, fontWeight:600, textTransform:"uppercase",
                  letterSpacing:".06em", marginBottom:5 }}>
                  {label}
                </div>
                <div style={{ color:C.t1, fontSize:14, fontWeight:600 }}>
                  {String(value)}
                </div>
              </div>
            ))}
          </div>

          {/* Shiprocket tracking link */}
          {order.tracking_url && (
            <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                marginTop:16, padding:"12px 0", background:C.green+"15",
                borderRadius:10, border:`1px solid ${C.green}40`,
                color:C.green, fontSize:13, fontWeight:600, textDecoration:"none",
                transition:"background .15s" }}>
              🚚 Open Live Shipment Tracker →
            </a>
          )}
        </div>

        {/* ── Delivery Address ──────────────────────────────────── */}
        {addr.line1 && (
          <div style={{ background:C.card, borderRadius:16, padding:24,
            border:`1px solid ${C.border}` }}>
            <div style={{ color:C.t2, fontSize:13, fontWeight:600, marginBottom:12 }}>
              Delivery Address
            </div>
            <p style={{ color:C.t1, fontSize:14, lineHeight:1.8 }}>
              {addr.name && <><strong>{addr.name}</strong><br/></>}
              {addr.line1}<br/>
              {addr.city}{addr.state ? `, ${addr.state}` : ""} — {addr.pincode}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
