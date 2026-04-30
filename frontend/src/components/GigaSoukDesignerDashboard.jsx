// ════════════════════════════════════════════════════════════════
// GigaSoukDesignerDashboard.jsx — Designer Dashboard
// Tabs: Staging Area | Active Orders | Earnings | Profile
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import GigaSoukStagingArea from "./GigaSoukStagingArea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const C = {
  bg:"#060810",card:"#0C1018",card2:"#111826",border:"#1A2230",
  green:"#00E5A0",gold:"#F5A623",blue:"#4A9EFF",purple:"#A78BFA",
  red:"#F87171",t1:"#F4F6FC",t2:"#B8C4D8",t3:"#5A6A80",
};

// ── Tab list — to add a new tab: add an entry here + a section below
const TABS = [
  { key:"staging",  label:"Staging Area" },
  { key:"orders",   label:"Orders" },
  { key:"earnings", label:"Earnings" },
  { key:"profile",  label:"Profile" },
];

export default function GigaSoukDesignerDashboard({ designerId }) {
  const [tab,      setTab]      = useState("staging");
  const [stats,    setStats]    = useState({});
  const [orders,   setOrders]   = useState([]);
  const [wallet,   setWallet]   = useState(0);
  const [txns,     setTxns]     = useState([]);
  const [profile,  setProfile]  = useState({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!designerId) return;
    setLoading(true);

    // Fetch sensitive owner data (wallet_balance, email, phone) through
    // the backend /api/auth/me — Supabase RLS hides those columns from
    // the frontend role on purpose. Other (non-sensitive) data still
    // comes from Supabase directly.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const [meRes, sRes, oRes, wRes] = await Promise.all([
          token
            ? fetch(`${API_BASE}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
              }).then(r => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          supabase.rpc("get_designer_stats", { p_designer_id: designerId }),
          // Orders for designs owned by this designer
          supabase.from("orders")
            .select("*, designs!inner(title, designer_id)")
            .eq("designs.designer_id", designerId)
            .order("created_at", { ascending: false }).limit(20),
          supabase.from("wallet_txns").select("*").eq("profile_id", designerId)
            .order("created_at", { ascending: false }).limit(30),
        ]);

        const me = meRes?.profile || {};
        setProfile(me);
        setStats(sRes.data?.[0] || {});
        setOrders(oRes.data || []);
        setTxns(wRes.data || []);
        setWallet(me.wallet_balance || 0);
      } finally {
        setLoading(false);
      }
    })();
  }, [designerId]);

  const statusColor = { live:"#00E5A0", seeking:"#F5A623", committed:"#4A9EFF", draft:"#5A6A80", paused:"#F87171" };

  return (
    <div style={{ background:C.bg, minHeight:"100vh", padding:"20px 16px", fontFamily:"Inter,sans-serif", color:C.t1 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <div>
          <span style={{ fontSize:18, fontWeight:800, color:C.t1 }}>GIGA</span>
          <span style={{ fontSize:18, fontWeight:800, color:C.green }}>SOUK</span>
          <span style={{ fontSize:12, color:C.t3, marginLeft:10 }}>Designer Dashboard</span>
        </div>
        <span style={{ fontSize:13, color:C.t2 }}>{profile.full_name || ""}</span>
      </div>

      {/* Stats row */}
      {!loading && (
        <div style={{ display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",
          gap:10, marginBottom:24 }}>
          {[
            { label:"Live Designs",  val: stats.live_designs || 0,   color:C.green },
            { label:"Seeking",       val: stats.seeking_designs || 0, color:C.gold },
            { label:"Total Orders",  val: stats.total_orders || 0,   color:C.blue },
            { label:"Wallet",        val:`₹${Number(wallet).toLocaleString("en-IN")}`, color:C.purple },
          ].map(s => (
            <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:10, padding:"14px 16px" }}>
              <p style={{ fontSize:22, fontWeight:800, color:s.color }}>{s.val}</p>
              <p style={{ fontSize:11, color:C.t3, marginTop:3 }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:24 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding:"10px 20px", border:"none", background:"none", cursor:"pointer",
              color: tab===t.key ? C.green : C.t3, fontWeight: tab===t.key ? 700 : 400,
              fontSize:14, borderBottom:`2px solid ${tab===t.key ? C.green : "transparent"}` }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── STAGING AREA TAB ─────────────────────────────────────── */}
      {tab === "staging" && <GigaSoukStagingArea designerId={designerId} />}

      {/* ── ORDERS TAB ───────────────────────────────────────────── */}
      {tab === "orders" && (
        <div>
          <h3 style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>Orders for Your Designs</h3>
          {orders.length === 0 && <p style={{ color:C.t3 }}>No orders yet.</p>}
          {orders.map(o => (
            <div key={o.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:10, padding:"14px 18px", marginBottom:10,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <p style={{ fontWeight:700, color:C.t1 }}>{o.order_ref}</p>
                <p style={{ fontSize:12, color:C.t3, marginTop:2 }}>{o.designs?.title}</p>
              </div>
              <div style={{ textAlign:"right" }}>
                <p style={{ fontWeight:700, color:C.green }}>₹{Number(o.locked_price||o.committed_price).toLocaleString("en-IN")}</p>
                <span style={{ fontSize:11, color:statusColor[o.status]||C.t3 }}>{o.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── EARNINGS TAB ─────────────────────────────────────────── */}
      {tab === "earnings" && (
        <div>
          <div style={{ background:C.card, border:`1px solid ${C.green}`, borderRadius:10,
            padding:"20px 24px", marginBottom:20 }}>
            <p style={{ fontSize:12, color:C.t3 }}>WALLET BALANCE</p>
            <p style={{ fontSize:32, fontWeight:800, color:C.green }}>
              ₹{Number(wallet).toLocaleString("en-IN")}
            </p>
          </div>
          <h3 style={{ fontSize:14, fontWeight:700, color:C.t2, marginBottom:12 }}>Transaction History</h3>
          {txns.map(t => (
            <div key={t.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:8, padding:"12px 16px", marginBottom:8,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <p style={{ fontSize:13, color:C.t1 }}>{t.source_ref || t.txn_type}</p>
                <p style={{ fontSize:11, color:C.t3 }}>{new Date(t.created_at).toLocaleDateString("en-IN")}</p>
              </div>
              <p style={{ fontWeight:700, color:t.amount>0?C.green:C.red }}>
                {t.amount > 0 ? "+" : ""}₹{Math.abs(t.amount).toLocaleString("en-IN")}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── PROFILE TAB ──────────────────────────────────────────── */}
      {tab === "profile" && (
        <div style={{ maxWidth:480 }}>
          <h3 style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>Your Profile</h3>
          {[
            { label:"Name",    val:profile.full_name },
            { label:"Email",   val:profile.email },
            { label:"Phone",   val:profile.phone || "Not set" },
            { label:"Role",    val:"Designer" },
          ].map(f => (
            <div key={f.label} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:8, padding:"12px 16px", marginBottom:10,
              display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:C.t3 }}>{f.label}</span>
              <span style={{ fontSize:13, color:C.t1 }}>{f.val}</span>
            </div>
          ))}
          {/* Wallet balance in profile */}
          <div style={{ background:C.card, border:`1px solid ${C.green}`,
            borderRadius:10, padding:"16px 20px", marginTop:16 }}>
            <p style={{ fontSize:11, color:C.t3, textTransform:"uppercase",
              letterSpacing:".08em", marginBottom:6 }}>Wallet Balance</p>
            <p style={{ fontSize:28, fontWeight:800, color:C.green }}>
              ₹{Number(wallet).toLocaleString("en-IN")}
            </p>
            <p style={{ fontSize:11, color:C.t3, marginTop:6 }}>
              Paid out on successful deliveries
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
