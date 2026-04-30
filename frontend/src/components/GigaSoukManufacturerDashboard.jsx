// ════════════════════════════════════════════════════════════════
// GigaSoukManufacturerDashboard.jsx — Manufacturer Dashboard
// Tabs: Commitment Board | Active Jobs | QC Upload | Earnings | Profile
// TO ADD A TAB: add entry to TABS array + add a section below.
// TO REMOVE A TAB: remove from TABS array + delete its section.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { submitQC, updateOrderStatus } from "../lib/api";
import GigaSoukCommitmentBoard from "./GigaSoukCommitmentBoard";
import { ManufacturerOrderMap } from "./MapComponents";
import LocationPicker from "./LocationPicker";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const C = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF", purple:"#A78BFA",
  red:"#F87171", teal:"#2DD4BF", t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80",
};

// ── Tab list ──────────────────────────────────────────────────────
const TABS = [
  { key:"board",    label:"Commitment Board" },
  { key:"jobs",     label:"Active Jobs" },
  { key:"qc",       label:"QC Upload" },
  { key:"map",      label:"🗺️ Map View" },
  { key:"earnings", label:"Earnings" },
  { key:"profile",  label:"Profile" },
];

const STATUS_COLOR = {
  routing:"#5A6A80", negotiating:"#F5A623", confirmed:"#4A9EFF",
  cutting:"#A78BFA", qc_review:"#2DD4BF", shipped:"#00E5A0",
  delivered:"#00E5A0", cancelled:"#F87171",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukManufacturerDashboard({ manufacturerId }) {
// ════════════════════════════════════════════════════════════════

  const [tab,       setTab]       = useState("board");
  const [profile,   setProfile]   = useState({});
  const [mfr,       setMfr]       = useState({});
  const [jobs,      setJobs]      = useState([]);
  const [payouts,   setPayouts]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [qcOrder,   setQcOrder]   = useState(null);
  const [photos,    setPhotos]    = useState([]);
  const [uploading, setUploading] = useState(false);
  const [qcMsg,     setQcMsg]     = useState({ text:"", type:"" });
  const fileRef = useRef();

  // ── Load data ───────────────────────────────────────────────────
  useEffect(() => {
    if (!manufacturerId) return;
    setLoading(true);

    // Sensitive owner data (bank info, email, phone, full manufacturer
    // record) is now fetched through the backend /api/auth/me — RLS
    // hides those columns from the frontend role on purpose.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const [meRes, jRes, oIdsRes] = await Promise.all([
          token
            ? fetch(`${API_BASE}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
              }).then(r => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          supabase.from("orders").select("*, designs(title), qc_records(*)")
            .eq("manufacturer_id", manufacturerId)
            .not("status", "in", '("delivered","cancelled","refunded")')
            .order("created_at", { ascending: false }),
          supabase.from("orders").select("id").eq("manufacturer_id", manufacturerId),
        ]);

        // Payouts: query payouts only for the manufacturer's orders
        let payoutRows = [];
        if (oIdsRes.data?.length) {
          const ids = oIdsRes.data.map(r => r.id);
          const { data: payouts } = await supabase
            .from("payouts")
            .select("*, orders(order_ref)")
            .in("order_id", ids)
            .order("released_at", { ascending: false })
            .limit(30);
          payoutRows = payouts || [];
        }

        setMfr(meRes?.manufacturer || {});
        setProfile(meRes?.profile || {});
        setJobs(jRes.data || []);
        setPayouts(payoutRows);
      } finally {
        setLoading(false);
      }
    })();
  }, [manufacturerId]);

  // ── Realtime: refresh jobs on order update ──────────────────────
  useEffect(() => {
    const ch = supabase.channel("mfr_orders")
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"orders",
        filter:`manufacturer_id=eq.${manufacturerId}` },
        payload => setJobs(prev => prev.map(j => j.id === payload.new.id ? { ...j, ...payload.new } : j))
      ).subscribe();
    return () => supabase.removeChannel(ch);
  }, [manufacturerId]);

  // ── QC: upload photos to Supabase Storage ──────────────────────
  async function handlePhotoUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const urls = [];
    for (const file of files) {
      const path = `qc/${qcOrder.id}/${Date.now()}_${file.name}`;
      const { data, error } = await supabase.storage.from("qc-photos").upload(path, file);
      if (!error) {
        const { data: pub } = supabase.storage.from("qc-photos").getPublicUrl(path);
        urls.push(pub.publicUrl);
      }
    }
    setPhotos(prev => [...prev, ...urls]);
    setUploading(false);
  }

  // ── QC: submit for AI check ─────────────────────────────────────
  async function handleQCSubmit() {
    if (photos.length < 5) {
      setQcMsg({ text:"Please upload all 5 required photos.", type:"error" });
      return;
    }
    setUploading(true);
    setQcMsg({ text:"", type:"" });
    try {
      const { data } = await submitQC({
        order_id:        qcOrder.id,
        manufacturer_id: manufacturerId,
        photo_urls:      photos,
      });
      if (data.passed) {
        setQcMsg({ text:"QC passed! Shipping is being arranged automatically.", type:"success" });
        setJobs(prev => prev.map(j => j.id === qcOrder.id ? { ...j, status:"shipped" } : j));
      } else {
        setQcMsg({ text:`QC failed: ${data.reason}. Please re-make the part and resubmit.`, type:"error" });
      }
      setQcOrder(null);
      setPhotos([]);
    } catch (e) {
      setQcMsg({ text: e?.response?.data?.detail || "QC submission failed.", type:"error" });
    } finally {
      setUploading(false);
    }
  }

  // ── Mark order as cutting ───────────────────────────────────────
  async function markCutting(orderId) {
    await updateOrderStatus(orderId, "cutting");
    setJobs(prev => prev.map(j => j.id === orderId ? { ...j, status:"cutting" } : j));
  }

  const totalEarnings = payouts.reduce((s, p) => s + Number(p.manufacturer_amount || 0), 0);
  const qcReadyJobs   = jobs.filter(j => j.status === "cutting");

  // ── UI ──────────────────────────────────────────────────────────
  return (
    <div style={{ background:C.bg, minHeight:"100vh", padding:"20px 16px",
      fontFamily:"Inter,sans-serif", color:C.t1 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <div>
          <span style={{ fontSize:18, fontWeight:800, color:C.t1 }}>GIGA</span>
          <span style={{ fontSize:18, fontWeight:800, color:C.green }}>SOUK</span>
          <span style={{ fontSize:12, color:C.t3, marginLeft:10 }}>Manufacturer</span>
        </div>
        <div style={{ textAlign:"right" }}>
          <p style={{ fontSize:13, color:C.t2 }}>{mfr.shop_name || profile.full_name}</p>
          <p style={{ fontSize:11, color:C.t3 }}>{mfr.city}</p>
        </div>
      </div>

      {/* Stats row */}
      {!loading && (
        <div style={{ display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",
          gap:10, marginBottom:24 }}>
          {[
            { label:"Active Jobs",       val: jobs.length,                          color:C.blue   },
            { label:"QC Ready",          val: qcReadyJobs.length,                   color:C.gold   },
            { label:"Rating",            val: `${mfr.rating || "—"} ★`,            color:C.green  },
            { label:"Total Earned",      val:`₹${totalEarnings.toLocaleString("en-IN")}`, color:C.purple },
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
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:24,
        overflowX:"auto" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding:"10px 20px", border:"none", background:"none", cursor:"pointer",
              color: tab===t.key ? C.green : C.t3, fontWeight: tab===t.key ? 700 : 400,
              fontSize:14, borderBottom:`2px solid ${tab===t.key ? C.green : "transparent"}`,
              whiteSpace:"nowrap" }}>
            {t.label}
            {t.key==="qc" && qcReadyJobs.length > 0 &&
              <span style={{ marginLeft:6, background:C.gold, color:"#060810", borderRadius:10,
                padding:"1px 7px", fontSize:10, fontWeight:800 }}>{qcReadyJobs.length}</span>}
          </button>
        ))}
      </div>

      {/* ── COMMITMENT BOARD TAB ─────────────────────────────────── */}
      {tab === "board" && <GigaSoukCommitmentBoard manufacturerId={manufacturerId} />}

      {/* ── ACTIVE JOBS TAB ──────────────────────────────────────── */}
      {tab === "jobs" && (
        <div>
          <h3 style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>Active Jobs</h3>
          {jobs.length === 0 && (
            <div style={{ textAlign:"center", padding:60, color:C.t3 }}>
              <p>No active jobs right now.</p>
              <p style={{ fontSize:12, marginTop:6 }}>Visit the Commitment Board to commit to designs.</p>
            </div>
          )}
          {jobs.map(job => (
            <div key={job.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:10, padding:18, marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:STATUS_COLOR[job.status]||C.t3,
                      background:(STATUS_COLOR[job.status]||C.t3)+"22",
                      border:`1px solid ${STATUS_COLOR[job.status]||C.t3}55`,
                      borderRadius:20, padding:"2px 10px" }}>{job.status}</span>
                    <span style={{ fontSize:14, fontWeight:700, color:C.t1 }}>{job.order_ref}</span>
                  </div>
                  <p style={{ fontSize:13, color:C.t2, marginBottom:4 }}>{job.designs?.title}</p>
                  <p style={{ fontSize:20, fontWeight:800, color:C.green }}>
                    ₹{Number(job.locked_price || job.committed_price).toLocaleString("en-IN")}
                  </p>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginLeft:16 }}>
                  {job.status === "confirmed" && (
                    <button onClick={() => markCutting(job.id)}
                      style={{ padding:"8px 16px", borderRadius:8, border:"none",
                        background:C.purple, color:C.t1, fontWeight:700, fontSize:12, cursor:"pointer" }}>
                      Start Manufacturing
                    </button>
                  )}
                  {job.status === "cutting" && (
                    <button onClick={() => { setQcOrder(job); setTab("qc"); setPhotos([]); }}
                      style={{ padding:"8px 16px", borderRadius:8, border:"none",
                        background:C.gold, color:"#060810", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                      Submit QC Photos
                    </button>
                  )}
                  {job.shiprocket_awb && (
                    <a href={job.tracking_url} target="_blank" rel="noreferrer"
                      style={{ padding:"8px 16px", borderRadius:8, border:`1px solid ${C.teal}`,
                        background:"none", color:C.teal, fontWeight:700, fontSize:12,
                        textDecoration:"none", textAlign:"center" }}>
                      Track
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── QC UPLOAD TAB ────────────────────────────────────────── */}
      {tab === "qc" && (
        <div style={{ maxWidth:520 }}>
          <h3 style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>QC Photo Upload</h3>
          <p style={{ fontSize:13, color:C.t3, marginBottom:20 }}>
            Upload 5 photos of the finished part. AI checks dimensions to ±0.5mm.
          </p>

          {/* Select order */}
          {!qcOrder && (
            <>
              <p style={{ fontSize:12, color:C.t3, marginBottom:10 }}>Select an order ready for QC:</p>
              {qcReadyJobs.length === 0 && (
                <p style={{ color:C.t3, padding:20 }}>No orders in "cutting" state yet.</p>
              )}
              {qcReadyJobs.map(j => (
                <div key={j.id} onClick={() => { setQcOrder(j); setPhotos([]); setQcMsg({text:"",type:""}); }}
                  style={{ background:C.card, border:`1px solid ${C.gold}88`, borderRadius:10,
                    padding:"14px 18px", marginBottom:10, cursor:"pointer" }}>
                  <p style={{ fontWeight:700, color:C.t1 }}>{j.order_ref}</p>
                  <p style={{ fontSize:12, color:C.t3, marginTop:2 }}>{j.designs?.title}</p>
                </div>
              ))}
            </>
          )}

          {/* Upload area */}
          {qcOrder && (
            <>
              <div style={{ background:C.card, border:`1px solid ${C.gold}`, borderRadius:10,
                padding:"14px 18px", marginBottom:20 }}>
                <p style={{ fontSize:12, color:C.t3 }}>Submitting QC for:</p>
                <p style={{ fontWeight:700, color:C.t1 }}>{qcOrder.order_ref} — {qcOrder.designs?.title}</p>
              </div>

              {/* Flash */}
              {qcMsg.text && (
                <div style={{ background:(qcMsg.type==="success"?C.green:C.red)+"18",
                  border:`1px solid ${qcMsg.type==="success"?C.green:C.red}`,
                  borderRadius:8, padding:"12px 16px", marginBottom:16,
                  fontSize:13, color:qcMsg.type==="success"?C.green:C.red }}>
                  {qcMsg.text}
                </div>
              )}

              {/* Photo slots */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:16 }}>
                {[1,2,3,4,5].map(n => {
                  const url = photos[n-1];
                  return (
                    <div key={n} style={{ aspectRatio:"1", background:C.card2,
                      border:`1px solid ${url?C.green:C.border}`, borderRadius:8,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, color:url?C.green:C.t3, overflow:"hidden" }}>
                      {url
                        ? <img src={url} alt={`Photo ${n}`} style={{ width:"100%",height:"100%",objectFit:"cover" }} />
                        : `Photo ${n}`}
                    </div>
                  );
                })}
              </div>

              <p style={{ fontSize:11, color:C.t3, marginBottom:12 }}>
                {photos.length}/5 photos uploaded. {photos.length < 5 ? `Need ${5-photos.length} more.` : "All photos ready."}
              </p>

              <input ref={fileRef} type="file" multiple accept="image/*"
                onChange={handlePhotoUpload} style={{ display:"none" }} />

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={() => fileRef.current?.click()} disabled={uploading||photos.length>=5}
                  style={{ flex:1, padding:"11px 0", borderRadius:8, border:`1px solid ${C.border}`,
                    background:C.card2, color:C.t2, fontWeight:600, fontSize:14,
                    cursor:uploading||photos.length>=5?"not-allowed":"pointer" }}>
                  {uploading ? "Uploading..." : "Add Photos"}
                </button>
                <button onClick={handleQCSubmit} disabled={uploading || photos.length < 5}
                  style={{ flex:1, padding:"11px 0", borderRadius:8, border:"none",
                    background:photos.length>=5?C.green:C.t3, color:"#060810",
                    fontWeight:700, fontSize:14, cursor:photos.length>=5?"pointer":"not-allowed" }}>
                  Submit for QC
                </button>
              </div>

              <button onClick={() => { setQcOrder(null); setPhotos([]); }}
                style={{ marginTop:12, background:"none", border:"none", color:C.t3,
                  fontSize:12, cursor:"pointer" }}>
                ← Back
              </button>
            </>
          )}
        </div>
      )}

      {/* ── MAP VIEW TAB ──────────────────────────────────────────── */}
      {tab === "map" && (
        <div>
          <p style={{ color:C.t3, fontSize:13, marginBottom:16 }}>
            Your factory location (🔴) and all active delivery addresses. Colour = order status.
          </p>
          {mfr?.lat && mfr?.lng ? (
            <ManufacturerOrderMap
              manufacturerLat={mfr.lat}
              manufacturerLng={mfr.lng}
              orders={jobs.map(j => ({
                order_ref:        j.order_ref,
                status:           j.status,
                delivery_address: j.delivery_address || {},
              }))}
            />
          ) : (
            <div style={{ background:C.card, borderRadius:12, padding:32, textAlign:"center",
              border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:32, marginBottom:12 }}>📍</div>
              <p style={{ color:C.t2, fontSize:14 }}>
                Add your factory's coordinates in the Profile tab to enable the map view.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── EARNINGS TAB ─────────────────────────────────────────── */}
      {tab === "earnings" && (
        <div>
          <div style={{ background:C.card, border:`1px solid ${C.green}`, borderRadius:10,
            padding:"20px 24px", marginBottom:20 }}>
            <p style={{ fontSize:12, color:C.t3 }}>TOTAL EARNED</p>
            <p style={{ fontSize:32, fontWeight:800, color:C.green }}>
              ₹{totalEarnings.toLocaleString("en-IN")}
            </p>
          </div>
          <h3 style={{ fontSize:14, fontWeight:700, color:C.t2, marginBottom:12 }}>Payout History</h3>
          {payouts.length === 0 && <p style={{ color:C.t3 }}>No payouts yet.</p>}
          {payouts.map(p => (
            <div key={p.id} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:8, padding:"12px 16px", marginBottom:8,
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <p style={{ fontSize:13, color:C.t1 }}>{p.orders?.order_ref || p.order_id?.slice(0,8)}</p>
                <p style={{ fontSize:11, color:C.t3 }}>
                  {new Date(p.released_at).toLocaleDateString("en-IN")}
                </p>
              </div>
              <p style={{ fontWeight:700, color:C.green }}>
                +₹{Number(p.manufacturer_amount).toLocaleString("en-IN")}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── PROFILE TAB ──────────────────────────────────────────── */}
      {tab === "profile" && (
        <div style={{ maxWidth:500 }}>
          <h3 style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>Workshop Profile</h3>

          {/* Factory location picker — with privacy design */}
          <div style={{ marginBottom:20 }}>
            <LocationPicker
              mode="manufacturer"
              currentCity={mfr.city}
              currentState={mfr.state}
              hasLocation={!!(mfr.lat && mfr.lng)}
              onSave={async (loc) => {
                await supabase.from("manufacturers").update({
                  lat:   loc.lat,
                  lng:   loc.lng,
                  city:  loc.city,
                  state: loc.state,
                }).eq("id", manufacturerId);
                // Refresh local state
                setMfr(prev => ({ ...prev,
                  lat: loc.lat, lng: loc.lng,
                  city: loc.city, state: loc.state,
                }));
              }}
            />
          </div>

          {/* Profile details */}
          {[
            { label:"Shop Name",   val:mfr.shop_name },
            { label:"City",        val:mfr.city },
            { label:"State",       val:mfr.state },
            { label:"Machines",    val:(mfr.machine_types||[]).join(", ") || "—" },
            { label:"Materials",   val:(mfr.materials||[]).join(", ") || "—" },
            { label:"Rating",      val:`${mfr.rating || 0} / 5.0` },
            { label:"QC Pass Rate",val:`${mfr.qc_pass_rate || 0}%` },
            { label:"Total Jobs",  val:mfr.total_jobs || 0 },
            { label:"Premium",     val:mfr.is_premium ? "Yes ✓" : "No" },
          ].map(f => (
            <div key={f.label} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:8, padding:"12px 16px", marginBottom:10,
              display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:12, color:C.t3 }}>{f.label}</span>
              <span style={{ fontSize:13, color:C.t1 }}>{f.val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
