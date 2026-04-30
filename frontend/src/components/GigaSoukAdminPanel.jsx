// ════════════════════════════════════════════════════════════════
// GigaSoukAdminPanel.jsx — Admin Control Panel
// Tabs: Overview | Orders | Factories | Variants | Notifications | Payments
//
// TO ADD A NEW ADMIN TAB: add to TABS array + add a section below.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase }            from "../lib/supabase";
import { adminListOrders, adminPendingVariants,
         releaseEscrow, refundPayment,
         triggerEmergencyScan } from "../lib/api";

const C = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF", purple:"#A78BFA",
  red:"#F87171", teal:"#2DD4BF", t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80",
};

const TABS = [
  { key:"overview",  label:"Overview"       },
  { key:"orders",    label:"Orders"         },
  { key:"factories", label:"Factories"      },
  { key:"variants",  label:"Variants"       },
  { key:"notifs",    label:"Notifications"  },
  { key:"payments",  label:"Payments"       },
];

const STATUS_COLOR = {
  routing:"#5A6A80", negotiating:"#4A9EFF", confirmed:"#A78BFA",
  cutting:"#F5A623", qc_review:"#A78BFA", shipped:"#2DD4BF",
  delivered:"#00E5A0", cancelled:"#F87171",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukAdminPanel({ adminId }) {
// ════════════════════════════════════════════════════════════════

  const [tab,       setTab]      = useState("overview");
  const [orders,    setOrders]   = useState([]);
  const [factories, setFactories] = useState([]);
  const [variants,  setVariants] = useState([]);
  const [notifs,    setNotifs]   = useState([]);
  const [overview,  setOverview] = useState({});
  const [loading,   setLoading]  = useState(true);
  const [scanResult, setScanResult] = useState(null);
  const [actionMsg, setActionMsg] = useState({ text:"", type:"" });

  function flash(text, type="success") {
    setActionMsg({ text, type });
    setTimeout(() => setActionMsg({ text:"", type:"" }), 4000);
  }

  // ── Load data for current tab ────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    if (tab === "overview") loadOverview();
    else if (tab === "orders")    loadOrders();
    else if (tab === "factories") loadFactories();
    else if (tab === "variants")  loadVariants();
    else if (tab === "notifs")    loadNotifs();
    else if (tab === "payments")  loadOrders("in_escrow");
  }, [tab]);

  async function loadOverview() {
    const [oRes, fRes, gmvRes] = await Promise.all([
      supabase.from("orders").select("status, payment_status"),
      supabase.from("manufacturers").select("id, is_active"),
      supabase.from("payouts").select("total_amount"),
    ]);
    const orders_data = oRes.data || [];
    setOverview({
      total_orders:    orders_data.length,
      active_orders:   orders_data.filter(o => !["delivered","cancelled"].includes(o.status)).length,
      in_escrow:       orders_data.filter(o => o.payment_status === "in_escrow").length,
      delivered_today: orders_data.filter(o => o.status === "delivered").length,
      total_factories: (fRes.data||[]).length,
      active_factories:(fRes.data||[]).filter(f => f.is_active).length,
      total_gmv:       (gmvRes.data||[]).reduce((s,r) => s + Number(r.total_amount), 0),
    });
    setLoading(false);
  }

  async function loadOrders(paymentStatus = null) {
    const { data } = await adminListOrders(null);
    let filtered = data || [];
    if (paymentStatus) filtered = filtered.filter(o => o.payment_status === paymentStatus);
    setOrders(filtered);
    setLoading(false);
  }

  async function loadFactories() {
    const { data } = await supabase.from("manufacturers")
      .select("*, profiles(full_name, email, phone)")
      .order("joined_at", { ascending: false });
    setFactories(data || []);
    setLoading(false);
  }

  async function loadVariants() {
    const { data } = await adminPendingVariants();
    setVariants(data || []);
    setLoading(false);
  }

  async function loadNotifs() {
    const { data } = await supabase.from("notification_log")
      .select("*").order("sent_at", { ascending: false }).limit(60);
    setNotifs(data || []);
    setLoading(false);
  }

  // ── Actions ──────────────────────────────────────────────────────
  async function handleRelease(orderId) {
    try {
      await releaseEscrow({ order_id: orderId, admin_id: adminId });
      flash("Escrow released successfully.");
      loadOrders("in_escrow");
    } catch (e) { flash(e?.response?.data?.detail || "Release failed.", "error"); }
  }

  async function handleRefund(orderId) {
    if (!window.confirm("Refund this order? This cannot be undone.")) return;
    try {
      await refundPayment({ order_id: orderId, admin_id: adminId, reason: "Admin refund" });
      flash("Refund issued.");
      loadOrders();
    } catch (e) { flash(e?.response?.data?.detail || "Refund failed.", "error"); }
  }

  async function handleSuspendFactory(mfrId, current) {
    await supabase.from("manufacturers").update({ is_active: !current }).eq("id", mfrId);
    setFactories(prev => prev.map(f => f.id === mfrId ? { ...f, is_active: !current } : f));
    flash(current ? "Factory suspended." : "Factory reactivated.");
  }

  async function handleEmergencyScan() {
    try {
      const { data } = await triggerEmergencyScan();
      setScanResult(data);
      flash(`Emergency scan done. ${data.broadcasts_sent} broadcasts sent.`);
    } catch { flash("Scan failed.", "error"); }
  }

  const msgColor = { success:C.green, error:C.red, info:C.gold };

  return (
    <div style={{ background:C.bg, minHeight:"100vh", padding:"20px 16px",
      fontFamily:"Inter,sans-serif", color:C.t1 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <div>
          <span style={{ fontSize:18, fontWeight:800, color:C.t1 }}>GIGA</span>
          <span style={{ fontSize:18, fontWeight:800, color:C.green }}>SOUK</span>
          <span style={{ fontSize:12, color:C.red, marginLeft:10, fontWeight:700 }}>ADMIN</span>
        </div>
        <button onClick={handleEmergencyScan}
          style={{ padding:"7px 14px", borderRadius:8, border:`1px solid ${C.gold}`,
            background:C.gold+"18", color:C.gold, fontWeight:600, fontSize:12, cursor:"pointer" }}>
          ⚡ Emergency Scan
        </button>
      </div>

      {/* Flash */}
      {actionMsg.text && (
        <div style={{ background:(msgColor[actionMsg.type]||C.green)+"18",
          border:`1px solid ${msgColor[actionMsg.type]||C.green}`,
          borderRadius:8, padding:"11px 16px", marginBottom:20,
          fontSize:13, color:msgColor[actionMsg.type]||C.green }}>
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:24,
        overflowX:"auto" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding:"10px 18px", border:"none", background:"none", cursor:"pointer",
              color: tab===t.key ? C.green : C.t3, fontWeight: tab===t.key ? 700 : 400,
              fontSize:13, borderBottom:`2px solid ${tab===t.key ? C.green : "transparent"}`,
              whiteSpace:"nowrap" }}>
            {t.label}
            {t.key==="variants" && variants.length>0 &&
              <span style={{ marginLeft:5, background:C.gold+"33", color:C.gold,
                borderRadius:10, padding:"1px 6px", fontSize:10 }}>{variants.length}</span>}
          </button>
        ))}
      </div>

      {loading && <p style={{ color:C.t3, textAlign:"center", padding:40 }}>Loading...</p>}

      {/* ── OVERVIEW ─────────────────────────────────────────────── */}
      {!loading && tab==="overview" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",
            gap:12, marginBottom:28 }}>
            {[
              { label:"Total Orders",    val:overview.total_orders||0,   color:C.t1  },
              { label:"Active Orders",   val:overview.active_orders||0,  color:C.gold},
              { label:"In Escrow",       val:overview.in_escrow||0,      color:C.blue},
              { label:"Delivered",       val:overview.delivered_today||0,color:C.green},
              { label:"Factories",       val:overview.active_factories||0,color:C.teal},
              { label:"Total GMV",       val:`₹${Number(overview.total_gmv||0).toLocaleString("en-IN")}`, color:C.purple},
            ].map(s => (
              <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`,
                borderRadius:10, padding:"16px 18px" }}>
                <p style={{ fontSize:24, fontWeight:800, color:s.color }}>{s.val}</p>
                <p style={{ fontSize:11, color:C.t3, marginTop:3 }}>{s.label}</p>
              </div>
            ))}
          </div>
          {scanResult && (
            <div style={{ background:C.gold+"18", border:`1px solid ${C.gold}`,
              borderRadius:8, padding:"12px 16px", fontSize:13, color:C.gold }}>
              Last scan: {scanResult.scanned} designs checked · {scanResult.broadcasts_sent} emergency broadcasts sent
            </div>
          )}
        </div>
      )}

      {/* ── ORDERS ───────────────────────────────────────────────── */}
      {!loading && tab==="orders" && (
        <div>
          <h3 style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>All Orders</h3>
          {orders.map(o => (
            <div key={o.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:10, padding:"14px 18px", marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:4 }}>
                    <span style={{ background:(STATUS_COLOR[o.status]||C.t3)+"22",
                      border:`1px solid ${STATUS_COLOR[o.status]||C.t3}`,
                      borderRadius:20, padding:"2px 8px", fontSize:10, fontWeight:700,
                      color:STATUS_COLOR[o.status]||C.t3 }}>
                      {o.status}
                    </span>
                    <span style={{ fontSize:13, fontWeight:700, color:C.t1 }}>{o.order_ref}</span>
                  </div>
                  <p style={{ fontSize:12, color:C.t3 }}>
                    ₹{Number(o.locked_price||o.committed_price||0).toLocaleString("en-IN")} ·{" "}
                    {new Date(o.created_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {o.payment_status === "in_escrow" && (
                    <button onClick={() => handleRelease(o.id)}
                      style={{ padding:"6px 12px", borderRadius:6, border:"none",
                        background:C.green, color:"#060810", fontWeight:700,
                        fontSize:12, cursor:"pointer" }}>
                      Release
                    </button>
                  )}
                  {["in_escrow"].includes(o.payment_status) && (
                    <button onClick={() => handleRefund(o.id)}
                      style={{ padding:"6px 12px", borderRadius:6,
                        border:`1px solid ${C.red}`, background:"none",
                        color:C.red, fontWeight:600, fontSize:12, cursor:"pointer" }}>
                      Refund
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── FACTORIES ────────────────────────────────────────────── */}
      {!loading && tab==="factories" && (
        <div>
          <h3 style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>
            All Manufacturers ({factories.length})
          </h3>
          {factories.map(f => (
            <div key={f.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:10, padding:"14px 18px", marginBottom:10,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <p style={{ fontSize:14, fontWeight:700, color:C.t1 }}>{f.shop_name}</p>
                <p style={{ fontSize:12, color:C.t3 }}>
                  {f.city} · ⭐{Number(f.rating||0).toFixed(1)} ·{" "}
                  {f.total_jobs||0} jobs · QC {f.qc_pass_rate||0}%
                </p>
                <p style={{ fontSize:11, color:C.t3 }}>{f.profiles?.email}</p>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {f.is_premium && (
                  <span style={{ background:C.gold+"22", border:`1px solid ${C.gold}`,
                    borderRadius:12, padding:"2px 8px", fontSize:10, color:C.gold }}>
                    PREMIUM
                  </span>
                )}
                <button onClick={() => handleSuspendFactory(f.id, f.is_active)}
                  style={{ padding:"6px 12px", borderRadius:6,
                    border:`1px solid ${f.is_active ? C.red : C.green}`,
                    background:"none", color: f.is_active ? C.red : C.green,
                    fontWeight:600, fontSize:12, cursor:"pointer" }}>
                  {f.is_active ? "Suspend" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── VARIANTS ─────────────────────────────────────────────── */}
      {!loading && tab==="variants" && (
        <div>
          <h3 style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>
            Pending Regional Variants ({variants.length})
          </h3>
          {variants.length === 0 && <p style={{ color:C.t3 }}>No pending variants.</p>}
          {variants.map(v => (
            <div key={v.id} style={{ background:C.card, border:`1px solid ${C.gold}44`,
              borderRadius:10, padding:"14px 18px", marginBottom:10 }}>
              <p style={{ fontSize:13, fontWeight:700, color:C.t1 }}>{v.designs?.title}</p>
              <p style={{ fontSize:12, color:C.t3, marginTop:3 }}>
                {v.manufacturers?.shop_name} · {v.region_city} ·{" "}
                Base ₹{Number(v.base_price).toLocaleString("en-IN")} →{" "}
                Proposed ₹{Number(v.proposed_price).toLocaleString("en-IN")}{" "}
                ({v.price_diff_percent > 0 ? "+" : ""}{v.price_diff_percent}%)
              </p>
              <p style={{ fontSize:11, color:C.t3, marginTop:3, fontStyle:"italic" }}>{v.reason}</p>
              <p style={{ fontSize:11, color:C.gold, marginTop:4 }}>Awaiting designer approval</p>
            </div>
          ))}
        </div>
      )}

      {/* ── NOTIFICATIONS ────────────────────────────────────────── */}
      {!loading && tab==="notifs" && (
        <div>
          <h3 style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Notification Log</h3>
          {notifs.map(n => (
            <div key={n.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:8, padding:"10px 14px", marginBottom:8,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ display:"flex", gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:10, fontWeight:700,
                    color: n.channel==="whatsapp" ? C.green : C.blue }}>
                    {n.channel.toUpperCase()}
                  </span>
                  <span style={{ fontSize:11, color:C.t3 }}>{n.event_type}</span>
                </div>
                <p style={{ fontSize:11, color:C.t2 }}>
                  {n.recipient_phone || n.recipient_email}
                </p>
              </div>
              <div style={{ textAlign:"right" }}>
                <span style={{ fontSize:10, fontWeight:700,
                  color: n.status==="sent" ? C.green : n.status==="failed" ? C.red : C.gold }}>
                  {n.status.toUpperCase()}
                </span>
                <p style={{ fontSize:10, color:C.t3, marginTop:2 }}>
                  {new Date(n.sent_at).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"})}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PAYMENTS ─────────────────────────────────────────────── */}
      {!loading && tab==="payments" && (
        <div>
          <h3 style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Escrow — Pending Release</h3>
          {orders.filter(o => o.payment_status==="in_escrow").length === 0 && (
            <p style={{ color:C.t3 }}>No payments pending release.</p>
          )}
          {orders.filter(o => o.payment_status==="in_escrow").map(o => (
            <div key={o.id} style={{ background:C.card, border:`1px solid ${C.blue}44`,
              borderRadius:10, padding:"14px 18px", marginBottom:10,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <p style={{ fontSize:14, fontWeight:700, color:C.t1 }}>{o.order_ref}</p>
                <p style={{ fontSize:18, fontWeight:800, color:C.green }}>
                  ₹{Number(o.locked_price||0).toLocaleString("en-IN")}
                </p>
                <p style={{ fontSize:11, color:C.t3 }}>
                  Status: {o.status} · Paid: {o.paid_at ? new Date(o.paid_at).toLocaleDateString("en-IN") : "-"}
                </p>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => handleRelease(o.id)}
                  style={{ padding:"8px 16px", borderRadius:8, border:"none",
                    background:C.green, color:"#060810", fontWeight:700,
                    fontSize:13, cursor:"pointer" }}>
                  Release Escrow
                </button>
                <button onClick={() => handleRefund(o.id)}
                  style={{ padding:"8px 16px", borderRadius:8,
                    border:`1px solid ${C.red}`, background:"none",
                    color:C.red, fontWeight:600, fontSize:13, cursor:"pointer" }}>
                  Refund
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
