// ════════════════════════════════════════════════════════════════
// GigaSoukManufacturerDashboard.jsx — Manufacturer Dashboard
// Tabs: Commitment Board | Active Jobs | … — Workshop Profile opens from top bar (landscape panel).
// TO ADD A TAB: add entry to TABS array + add a section below.
// TO REMOVE A TAB: remove from TABS array + delete its section.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { submitQC, updateOrderStatus } from "../lib/api";
import { MACHINE_OPTIONS, MATERIAL_OPTIONS } from "../lib/workshop-tags";
import GigaSoukCommitmentBoard from "./GigaSoukCommitmentBoard";
import { ManufacturerOrderMap } from "./MapComponents";
import LocationPicker from "./LocationPicker";
import NegotiationList from "./NegotiationList";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// Fetch a 60-minute signed URL for a design's CAD file
async function fetchCadUrl(designId) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/v1/designs/${designId}/cad-url`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${res.status}`);
  }
  const { signed_url } = await res.json();
  return signed_url;
}

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", blue: "#4A9EFF", purple: "#A78BFA",
  red: "#F87171", teal: "#2DD4BF", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

// ── Tab list (Workshop Profile is only in the header — not duplicated here) ──
const TABS = [
  { key: "board", label: "Commitment Board" },
  { key: "jobs", label: "Active Jobs" },
  { key: "chat", label: "Chat" },
  { key: "qc", label: "QC Upload" },
  { key: "map", label: "🗺️ Map View" },
  { key: "earnings", label: "Earnings" },
];

const STATUS_COLOR = {
  routing: "#5A6A80", negotiating: "#F5A623", confirmed: "#4A9EFF",
  cutting: "#A78BFA", qc_review: "#2DD4BF", shipped: "#00E5A0",
  delivered: "#00E5A0", cancelled: "#F87171",
};

const COMMITMENT_STATUS_COLOR = {
  pending_approval: "#F5A623",
  active: "#00E5A0",
  paused: "#5A6A80",
  withdrawn: "#5A6A80",
  rejected: "#F87171",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukManufacturerDashboard({ manufacturerId, profileId, onSignOut }) {
  // ════════════════════════════════════════════════════════════════

  const [tab, setTab] = useState("board");
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const workshopPanelRef = useRef(null);
  const [profile, setProfile] = useState({});
  const [mfr, setMfr] = useState({});
  const [machinesDraft, setMachinesDraft] = useState([]);
  const [materialsDraft, setMaterialsDraft] = useState([]);
  const [tagSaving, setTagSaving] = useState(false);
  const [profileFlash, setProfileFlash] = useState("");
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [jobsRefreshKey, setJobsRefreshKey] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qcOrder, setQcOrder] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [qcMsg, setQcMsg] = useState({ text: "", type: "" });
  const [cadFetching, setCadFetching] = useState({});  // { [jobId]: true }
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

        const [meRes, jRes, commRes, oIdsRes] = await Promise.all([
          token
            ? fetch(`${API_BASE}/api/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(r => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          supabase.from("orders").select("*, designs(title, cad_file_url, preview_image_url), qc_records(*)")
            .eq("manufacturer_id", manufacturerId)
            .not("status", "in", '("delivered","cancelled","refunded")')
            .order("created_at", { ascending: false }),
          supabase
            .from("manufacturer_commitments")
            .select(
              "id, design_id, committed_price, base_price, region_city, region_state, status, committed_at, notes, designs(title, preview_image_url, cad_file_url)"
            )
            .eq("manufacturer_id", manufacturerId)
            .order("committed_at", { ascending: false }),
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

        const m = meRes?.manufacturer || {};
        setMfr(m);
        setProfile(meRes?.profile || {});
        setMachinesDraft([...(m.machine_types || [])]);
        setMaterialsDraft([...(m.materials || [])]);
        setJobs(jRes.data || []);
        setCommitments(commRes.data || []);
        setPayouts(payoutRows);
      } finally {
        setLoading(false);
      }
    })();
  }, [manufacturerId, jobsRefreshKey]);

  useEffect(() => {
    if (workshopOpen && workshopPanelRef.current) {
      workshopPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [workshopOpen]);

  function toggleMachineTag(m) {
    setMachinesDraft(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]));
  }
  function toggleMaterialTag(m) {
    setMaterialsDraft(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]));
  }

  async function saveWorkshopCapabilities() {
    setTagSaving(true);
    setProfileFlash("");
    try {
      const { error } = await supabase.from("manufacturers").update({
        machine_types: machinesDraft,
        materials: materialsDraft,
      }).eq("id", manufacturerId);
      if (error) throw error;
      setMfr(prev => ({ ...prev, machine_types: machinesDraft, materials: materialsDraft }));
      setBoardRefreshKey(k => k + 1);
      setProfileFlash("Saved. Your Commitment Board list updates to match these tags — open the board to see new jobs.");
    } catch (e) {
      const msg = typeof e === "object" && e && "message" in e ? String(e.message) : "";
      setProfileFlash(msg || "Could not save. Try again.");
    } finally {
      setTagSaving(false);
    }
  }

  // ── Realtime: job list + commitments (orders INSERT may add commitment-linked rows)
  useEffect(() => {
    const bump = () => setJobsRefreshKey(k => k + 1);
    const ch = supabase.channel("mfr_orders")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "orders",
        filter: `manufacturer_id=eq.${manufacturerId}`
      },
        payload => setJobs(prev => prev.map(j => j.id === payload.new.id ? { ...j, ...payload.new } : j))
      )
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "orders",
        filter: `manufacturer_id=eq.${manufacturerId}`,
      }, bump)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [manufacturerId]);

  // ── Realtime: new/updated design commitments ─────────────────
  useEffect(() => {
    const ch = supabase
      .channel("mfr_commitments")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "manufacturer_commitments",
          filter: `manufacturer_id=eq.${manufacturerId}`,
        },
        () => setJobsRefreshKey(k => k + 1)
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [manufacturerId]);

  const workQueue = useMemo(() => {
    const orderCommitmentIds = new Set(
      (jobs || []).map(j => j.commitment_id).filter(Boolean)
    );
    const rows = [
      ...(jobs || []).map(job => ({
        key: `order-${job.id}`,
        sortAt: job.created_at,
        kind: "order",
        job,
      })),
      ...(commitments || [])
        .filter(c => !orderCommitmentIds.has(c.id))
        .map(c => ({
          key: `commitment-${c.id}`,
          sortAt: c.committed_at,
          kind: "commitment",
          commitment: c,
        })),
    ];
    rows.sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));
    return rows;
  }, [jobs, commitments]);

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
      setQcMsg({ text: "Please upload all 5 required photos.", type: "error" });
      return;
    }
    setUploading(true);
    setQcMsg({ text: "", type: "" });
    try {
      const { data } = await submitQC({
        order_id: qcOrder.id,
        manufacturer_id: manufacturerId,
        photo_urls: photos,
      });
      if (data.passed) {
        setQcMsg({ text: "QC passed! Shipping is being arranged automatically.", type: "success" });
        setJobs(prev => prev.map(j => j.id === qcOrder.id ? { ...j, status: "shipped" } : j));
      } else {
        setQcMsg({ text: `QC failed: ${data.reason}. Please re-make the part and resubmit.`, type: "error" });
      }
      setQcOrder(null);
      setPhotos([]);
    } catch (e) {
      setQcMsg({ text: e?.response?.data?.detail || "QC submission failed.", type: "error" });
    } finally {
      setUploading(false);
    }
  }

  // ── Mark order as cutting ───────────────────────────────────────
  async function markCutting(orderId) {
    await updateOrderStatus(orderId, "cutting");
    setJobs(prev => prev.map(j => j.id === orderId ? { ...j, status: "cutting" } : j));
  }

  // ── Download CAD file for a job ─────────────────────────────────
  async function handleDownloadCad(job) {
    if (!job.designs?.cad_file_url) return;
    setCadFetching(prev => ({ ...prev, [job.id]: true }));
    try {
      const url = await fetchCadUrl(job.design_id);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert(`Could not open CAD file: ${e.message}`);
    } finally {
      setCadFetching(prev => ({ ...prev, [job.id]: false }));
    }
  }

  const totalEarnings = payouts.reduce((s, p) => s + Number(p.manufacturer_amount || 0), 0);
  const qcReadyJobs = jobs.filter(j => j.status === "cutting");

  const actions = [
    {
      key: "map",
      label: "Map",
      desc: "View active orders on the map",
      cta: "Open map",
      onClick: () => setTab("map"),
    },
    {
      key: "upload",
      label: "Upload",
      desc: "Upload QC photos for cutting orders",
      cta: "Upload QC",
      onClick: () => setTab("qc"),
    },
    {
      key: "chat",
      label: "Chat",
      desc: "Open negotiation rooms",
      cta: "View chats",
      onClick: () => setTab("chat"),
    },
  ];

  // ── UI ──────────────────────────────────────────────────────────
  return (
    <div style={{
      background: C.bg, minHeight: "100vh", padding: "20px 16px",
      fontFamily: "Inter,sans-serif", color: C.t1
    }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.t1 }}>GIGA</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.green }}>SOUK</span>
          <span style={{ fontSize: 12, color: C.t3, marginLeft: 10 }}>Manufacturer</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" title="Machines, materials & location"
            onClick={() => setWorkshopOpen(o => !o)}
            style={{
              padding: "8px 16px", borderRadius: 10,
              border: `1px solid ${workshopOpen ? C.green : C.border}`,
              background: workshopOpen ? C.green + "22" : C.card2,
              color: workshopOpen ? C.green : C.t1,
              fontSize: 12, fontWeight: 800, cursor: "pointer",
              letterSpacing: "0.02em",
            }}>
            Workshop
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {actions.map(a => (
              <button key={a.key} type="button" onClick={a.onClick}
                style={{
                  padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.card2,
                  color: C.t1, fontSize: 11, cursor: "pointer",
                }}>
                {a.label}
              </button>
            ))}
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 13, color: C.t2 }}>{mfr.shop_name || profile.full_name}</p>
            <p style={{ fontSize: 11, color: C.t3 }}>{mfr.city}</p>
          </div>
          {onSignOut && (
            <button onClick={onSignOut}
              style={{
                padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
                background: "transparent", color: C.t2, fontSize: 12, cursor: "pointer"
              }}>
              Sign Out
            </button>
          )}
        </div>
      </div>

      <style>{`
        .gs-workshop-landscape {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          align-items: stretch;
        }
        .gs-workshop-col-left {
          border-right: 1px solid #1A2230;
        }
        @media (max-width: 900px) {
          .gs-workshop-landscape {
            grid-template-columns: 1fr;
          }
          .gs-workshop-col-left {
            border-right: none;
            border-bottom: 1px solid #1A2230;
          }
        }
      `}</style>

      {/* Workshop Profile — landscape panel (opened from top bar Workshop button) */}
      {workshopOpen && (
        <div ref={workshopPanelRef}
          style={{
            marginBottom: 24,
            borderRadius: 14,
            border: `1px solid ${C.green}44`,
            background: C.card,
            overflow: "hidden",
            boxShadow: `0 16px 48px rgba(0,0,0,.35)`,
          }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 12,
            padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.card2,
          }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: C.t1, margin: 0 }}>Workshop Profile</h2>
              <p style={{ fontSize: 12, color: C.t3, margin: "6px 0 0", maxWidth: 560 }}>
                Landscape layout — tags & save on the left; location & shop summary on the right (stacks on narrow screens).
              </p>
            </div>
            <button type="button" onClick={() => setWorkshopOpen(false)}
              style={{
                padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`,
                background: C.card, color: C.t2, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
              Close
            </button>
          </div>

          <div className="gs-workshop-landscape">
            {/* Left column — tags */}
            <div className="gs-workshop-col-left" style={{
              padding: "20px 22px",
              minWidth: 0,
            }}>
              <p style={{ fontSize: 13, color: C.t3, lineHeight: 1.65, marginBottom: 18 }}>
                Each design lists required <strong style={{ color: C.blue }}>machine</strong> and{" "}
                <strong style={{ color: C.green }}>material</strong> tags. You only see a job when your workshop includes{" "}
                <em>every</em> tag on that design.
              </p>

              {profileFlash && (
                <div style={{
                  background: profileFlash.startsWith("Saved") ? C.green + "18" : C.red + "18",
                  border: `1px solid ${profileFlash.startsWith("Saved") ? C.green : C.red}`,
                  borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13,
                  color: profileFlash.startsWith("Saved") ? C.green : C.red, lineHeight: 1.5,
                }}>
                  {profileFlash}
                  {profileFlash.startsWith("Saved") && (
                    <button type="button" onClick={() => { setProfileFlash(""); setWorkshopOpen(false); setTab("board"); }}
                      style={{
                        display: "block", marginTop: 12, padding: "8px 14px", borderRadius: 8,
                        border: `1px solid ${C.green}`, background: C.card2, color: C.green,
                        fontWeight: 700, fontSize: 12, cursor: "pointer",
                      }}>
                      Go to Commitment Board →
                    </button>
                  )}
                </div>
              )}

              <div style={{
                background: C.card2, border: `1px solid ${C.border}`, borderRadius: 12,
                padding: "16px 18px", marginBottom: 16,
              }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.t3, letterSpacing: ".08em", marginBottom: 12 }}>
                  MACHINE TYPES YOU RUN
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {MACHINE_OPTIONS.map(m => {
                    const on = machinesDraft.includes(m);
                    return (
                      <button key={m} type="button" onClick={() => toggleMachineTag(m)}
                        style={{
                          padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                          border: `1px solid ${on ? C.blue : C.border}`,
                          background: on ? C.blue + "22" : C.card,
                          color: on ? C.blue : C.t3, fontWeight: on ? 700 : 400,
                        }}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{
                background: C.card2, border: `1px solid ${C.border}`, borderRadius: 12,
                padding: "16px 18px", marginBottom: 18,
              }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.t3, letterSpacing: ".08em", marginBottom: 12 }}>
                  MATERIALS YOU WORK WITH
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {MATERIAL_OPTIONS.map(m => {
                    const on = materialsDraft.includes(m);
                    return (
                      <button key={m} type="button" onClick={() => toggleMaterialTag(m)}
                        style={{
                          padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                          border: `1px solid ${on ? C.green : C.border}`,
                          background: on ? C.green + "22" : C.card,
                          color: on ? C.green : C.t3, fontWeight: on ? 700 : 400,
                        }}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button type="button" onClick={saveWorkshopCapabilities} disabled={tagSaving}
                style={{
                  width: "100%", padding: "13px 20px", borderRadius: 10, border: "none",
                  background: tagSaving ? C.t3 : C.green, color: "#060810", fontWeight: 800, fontSize: 14,
                  cursor: tagSaving ? "not-allowed" : "pointer",
                }}>
                {tagSaving ? "Saving…" : "Save machines & materials"}
              </button>
            </div>

            {/* Right column — location & summary */}
            <div style={{ padding: "20px 22px", minWidth: 0, background: C.bg }}>
              <p style={{ fontSize: 12, color: C.t3, marginBottom: 14, lineHeight: 1.55 }}>
                <strong style={{ color: C.t2 }}>Location</strong> — routing & map. City-level is fine; exact pins stay private until an order exists.
              </p>
              <div style={{ marginBottom: 20 }}>
                <LocationPicker
                  mode="manufacturer"
                  currentCity={mfr.city}
                  currentState={mfr.state}
                  hasLocation={!!(mfr.lat && mfr.lng)}
                  onSave={async (loc) => {
                    await supabase.from("manufacturers").update({
                      lat: loc.lat,
                      lng: loc.lng,
                      city: loc.city,
                      state: loc.state,
                    }).eq("id", manufacturerId);
                    setMfr(prev => ({
                      ...prev,
                      lat: loc.lat, lng: loc.lng,
                      city: loc.city, state: loc.state,
                    }));
                  }}
                />
              </div>

              <p style={{ fontSize: 11, fontWeight: 700, color: C.t3, letterSpacing: ".06em", marginBottom: 10 }}>
                SHOP SUMMARY (READ-ONLY)
              </p>
              {[
                { label: "Shop Name", val: mfr.shop_name },
                { label: "City", val: mfr.city },
                { label: "State", val: mfr.state },
                { label: "Rating", val: `${mfr.rating || 0} / 5.0` },
                { label: "QC Pass Rate", val: `${mfr.qc_pass_rate || 0}%` },
                { label: "Total Jobs", val: mfr.total_jobs || 0 },
                { label: "Premium", val: mfr.is_premium ? "Yes ✓" : "No" },
              ].map(f => (
                <div key={f.label} style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: "10px 14px", marginBottom: 8,
                  display: "flex", justifyContent: "space-between", gap: 12,
                }}>
                  <span style={{ fontSize: 12, color: C.t3 }}>{f.label}</span>
                  <span style={{ fontSize: 13, color: C.t1, textAlign: "right" }}>{f.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      {!loading && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
          gap: 10, marginBottom: 24
        }}>
          {[
            { label: "Active Jobs", val: jobs.length, color: C.blue },
            { label: "QC Ready", val: qcReadyJobs.length, color: C.gold },
            { label: "Rating", val: `${mfr.rating || "—"} ★`, color: C.green },
            { label: "Total Earned", val: `₹${totalEarnings.toLocaleString("en-IN")}`, color: C.purple },
          ].map(s => (
            <div key={s.label} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "14px 16px"
            }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</p>
              <p style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        gap: 10,
        marginBottom: 24,
      }}>
        {actions.map(a => (
          <button key={a.key} onClick={a.onClick}
            style={{
              textAlign: "left",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: "14px 16px",
              cursor: "pointer",
            }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{a.label}</div>
            <div style={{ fontSize: 12, color: C.t3, marginBottom: 8 }}>{a.desc}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.green }}>{a.cta}</div>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 24,
        overflowX: "auto"
      }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
              color: tab === t.key ? C.green : C.t3, fontWeight: tab === t.key ? 700 : 400,
              fontSize: 14, borderBottom: `2px solid ${tab === t.key ? C.green : "transparent"}`,
              whiteSpace: "nowrap"
            }}>
            {t.label}
            {t.key === "qc" && qcReadyJobs.length > 0 &&
              <span style={{
                marginLeft: 6, background: C.gold, color: "#060810", borderRadius: 10,
                padding: "1px 7px", fontSize: 10, fontWeight: 800
              }}>{qcReadyJobs.length}</span>}
          </button>
        ))}
      </div>

      {/* ── COMMITMENT BOARD TAB ─────────────────────────────────── */}
      {tab === "board" && (
        <GigaSoukCommitmentBoard
          manufacturerId={manufacturerId}
          workshopCity={mfr.city || ""}
          workshopState={mfr.state || ""}
          refreshKey={boardRefreshKey}
          onOpenWorkshopProfile={() => setWorkshopOpen(true)}
          onCommitted={() => {
            setJobsRefreshKey(k => k + 1);
            setTab("jobs");
          }}
        />
      )}

      {/* ── ACTIVE JOBS TAB ──────────────────────────────────────── */}
      {tab === "jobs" && (
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Active Jobs</h3>
          <p style={{ fontSize: 13, color: C.t3, marginBottom: 18, lineHeight: 1.5, maxWidth: 640 }}>
            Customer orders you are fulfilling, plus <strong style={{ color: C.t2 }}>design commitments</strong> that do
            not yet have a buyer order (you will see the full order workflow here once a customer checks out).
          </p>
          {workQueue.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
              <p>No orders or commitments yet.</p>
              <p style={{ fontSize: 12, marginTop: 6 }}>
                Commit to designs on the Commitment Board — they will appear here. After your{" "}
                <button type="button" onClick={() => setWorkshopOpen(true)}
                  style={{ background: "none", border: "none", color: C.green, cursor: "pointer", fontWeight: 700, padding: 0 }}>
                  Workshop Profile
                </button>{" "}
                matches required tags, use the board to opt in.
              </p>
            </div>
          )}
          {workQueue.map(row => {
            if (row.kind === "commitment") {
              const c = row.commitment;
              const st = c.status || "active";
              const col = COMMITMENT_STATUS_COLOR[st] || C.t3;
              const statusLabel = st.replace(/_/g, " ");
              return (
                <div key={row.key} style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: 18, marginBottom: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                    {c.designs?.preview_image_url ? (
                      <div style={{
                        width: 88, height: 88, flexShrink: 0, borderRadius: 10,
                        overflow: "hidden", border: `1px solid ${C.border}`, background: C.card2,
                      }}>
                        <img
                          src={c.designs.preview_image_url}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </div>
                    ) : (
                      <div style={{
                        width: 88, height: 88, flexShrink: 0, borderRadius: 10,
                        border: `1px dashed ${C.border}`, background: C.card2,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, color: C.t3, textAlign: "center", padding: 6,
                      }}>
                        No preview
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
                          color: C.blue,
                        }}>Design commitment</span>
                        <span style={{
                          fontSize: 12, fontWeight: 700, color: col,
                          background: col + "22",
                          border: `1px solid ${col}55`,
                          borderRadius: 20, padding: "2px 10px",
                        }}>{statusLabel}</span>
                      </div>
                      <p style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{c.designs?.title}</p>
                      <p style={{ fontSize: 13, color: C.t2, marginBottom: 4 }}>
                        Your offer ₹{Number(c.committed_price).toLocaleString("en-IN")}
                        <span style={{ color: C.t3, fontSize: 12 }}> · {c.region_city}, {c.region_state}</span>
                      </p>
                      <p style={{ fontSize: 11, color: C.t3 }}>
                        Committed {new Date(c.committed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                      <p style={{ fontSize: 12, color: C.t3, marginTop: 10, lineHeight: 1.45 }}>
                        When a customer orders this design routed to you, the full job (CAD, manufacturing steps) appears
                        as a <strong style={{ color: C.t2 }}>customer order</strong> above or replaces this card.
                      </p>
                    </div>
                  </div>
                </div>
              );
            }
            const job = row.job;
            return (
            <div key={row.key} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: 18, marginBottom: 12
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                {job.designs?.preview_image_url ? (
                  <div style={{
                    width: 88, height: 88, flexShrink: 0, borderRadius: 10,
                    overflow: "hidden", border: `1px solid ${C.border}`, background: C.card2,
                  }}>
                    <img
                      src={job.designs.preview_image_url}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                ) : (
                  <div style={{
                    width: 88, height: 88, flexShrink: 0, borderRadius: 10,
                    border: `1px dashed ${C.border}`, background: C.card2,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color: C.t3, textAlign: "center", padding: 6,
                  }}>
                    No preview
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: STATUS_COLOR[job.status] || C.t3,
                      background: (STATUS_COLOR[job.status] || C.t3) + "22",
                      border: `1px solid ${STATUS_COLOR[job.status] || C.t3}55`,
                      borderRadius: 20, padding: "2px 10px"
                    }}>{job.status}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>{job.order_ref}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: C.green, textTransform: "uppercase", letterSpacing: "0.06em" }}>Customer order</span>
                  </div>
                  <p style={{ fontSize: 13, color: C.t2, marginBottom: 4 }}>{job.designs?.title}</p>
                  <p style={{ fontSize: 20, fontWeight: 800, color: C.green }}>
                    ₹{Number(job.locked_price || job.committed_price).toLocaleString("en-IN")}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: 16 }}>
                  {(job.status === "confirmed" || job.status === "cutting") &&
                    job.designs?.cad_file_url && (
                    <button
                      onClick={() => handleDownloadCad(job)}
                      disabled={cadFetching[job.id]}
                      style={{
                        padding: "8px 16px", borderRadius: 8,
                        border: `1px solid ${C.blue}`, background: C.blue + "18",
                        color: cadFetching[job.id] ? C.t3 : C.blue,
                        fontWeight: 600, fontSize: 12,
                        cursor: cadFetching[job.id] ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}>
                      {cadFetching[job.id] ? "Opening…" : "📎 CAD File"}
                    </button>
                  )}
                  {job.status === "confirmed" && (
                    <button onClick={() => markCutting(job.id)}
                      style={{
                        padding: "8px 16px", borderRadius: 8, border: "none",
                        background: C.purple, color: C.t1, fontWeight: 700, fontSize: 12, cursor: "pointer"
                      }}>
                      Start Manufacturing
                    </button>
                  )}
                  {job.status === "cutting" && (
                    <button onClick={() => { setQcOrder(job); setTab("qc"); setPhotos([]); }}
                      style={{
                        padding: "8px 16px", borderRadius: 8, border: "none",
                        background: C.gold, color: "#060810", fontWeight: 700, fontSize: 12, cursor: "pointer"
                      }}>
                      Submit QC Photos
                    </button>
                  )}
                  {job.shiprocket_awb && (
                    <a href={job.tracking_url} target="_blank" rel="noreferrer"
                      style={{
                        padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.teal}`,
                        background: "none", color: C.teal, fontWeight: 700, fontSize: 12,
                        textDecoration: "none", textAlign: "center"
                      }}>
                      Track
                    </a>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* ── CHAT TAB ───────────────────────────────────────────── */}
      {tab === "chat" && (
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Negotiation Rooms</h3>
          <NegotiationList
            role="manufacturer"
            manufacturerId={manufacturerId}
            profileId={profileId}
          />
        </div>
      )}

      {/* ── QC UPLOAD TAB ────────────────────────────────────────── */}
      {tab === "qc" && (
        <div style={{ maxWidth: 520 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>QC Photo Upload</h3>
          <p style={{ fontSize: 13, color: C.t3, marginBottom: 20 }}>
            Upload 5 photos of the finished part. AI checks dimensions to ±0.5mm.
          </p>

          {/* Select order */}
          {!qcOrder && (
            <>
              <p style={{ fontSize: 12, color: C.t3, marginBottom: 10 }}>Select an order ready for QC:</p>
              {qcReadyJobs.length === 0 && (
                <p style={{ color: C.t3, padding: 20 }}>No orders in "cutting" state yet.</p>
              )}
              {qcReadyJobs.map(j => (
                <div key={j.id} onClick={() => { setQcOrder(j); setPhotos([]); setQcMsg({ text: "", type: "" }); }}
                  style={{
                    background: C.card, border: `1px solid ${C.gold}88`, borderRadius: 10,
                    padding: "14px 18px", marginBottom: 10, cursor: "pointer"
                  }}>
                  <p style={{ fontWeight: 700, color: C.t1 }}>{j.order_ref}</p>
                  <p style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>{j.designs?.title}</p>
                </div>
              ))}
            </>
          )}

          {/* Upload area */}
          {qcOrder && (
            <>
              <div style={{
                background: C.card, border: `1px solid ${C.gold}`, borderRadius: 10,
                padding: "14px 18px", marginBottom: 20
              }}>
                <p style={{ fontSize: 12, color: C.t3 }}>Submitting QC for:</p>
                <p style={{ fontWeight: 700, color: C.t1 }}>{qcOrder.order_ref} — {qcOrder.designs?.title}</p>
              </div>

              {/* Flash */}
              {qcMsg.text && (
                <div style={{
                  background: (qcMsg.type === "success" ? C.green : C.red) + "18",
                  border: `1px solid ${qcMsg.type === "success" ? C.green : C.red}`,
                  borderRadius: 8, padding: "12px 16px", marginBottom: 16,
                  fontSize: 13, color: qcMsg.type === "success" ? C.green : C.red
                }}>
                  {qcMsg.text}
                </div>
              )}

              {/* Photo slots */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}>
                {[1, 2, 3, 4, 5].map(n => {
                  const url = photos[n - 1];
                  return (
                    <div key={n} style={{
                      minHeight: 96,
                      aspectRatio: "1",
                      background: C.card2,
                      border: `1px solid ${url ? C.green : C.border}`,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      color: url ? C.green : C.t3,
                      overflow: "hidden",
                    }}>
                      {url
                        ? <img src={url} alt={`QC ${n}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : `Slot ${n}`}
                    </div>
                  );
                })}
              </div>

              <p style={{ fontSize: 11, color: C.t3, marginBottom: 12 }}>
                {photos.length}/5 photos uploaded. {photos.length < 5 ? `Need ${5 - photos.length} more.` : "All photos ready."}
              </p>

              <input ref={fileRef} type="file" multiple accept="image/*"
                onChange={handlePhotoUpload} style={{ display: "none" }} />

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => fileRef.current?.click()} disabled={uploading || photos.length >= 5}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 8, border: `1px solid ${C.border}`,
                    background: C.card2, color: C.t2, fontWeight: 600, fontSize: 14,
                    cursor: uploading || photos.length >= 5 ? "not-allowed" : "pointer"
                  }}>
                  {uploading ? "Uploading..." : "Add Photos"}
                </button>
                <button onClick={handleQCSubmit} disabled={uploading || photos.length < 5}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 8, border: "none",
                    background: photos.length >= 5 ? C.green : C.t3, color: "#060810",
                    fontWeight: 700, fontSize: 14, cursor: photos.length >= 5 ? "pointer" : "not-allowed"
                  }}>
                  Submit for QC
                </button>
              </div>

              <button onClick={() => { setQcOrder(null); setPhotos([]); }}
                style={{
                  marginTop: 12, background: "none", border: "none", color: C.t3,
                  fontSize: 12, cursor: "pointer"
                }}>
                ← Back
              </button>
            </>
          )}
        </div>
      )}

      {/* ── MAP VIEW TAB ──────────────────────────────────────────── */}
          {tab === "map" && (
        <div>
          <p style={{ color: C.t3, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
            Your factory (red pin) and each delivery address. Pin colours reflect order status. Zoom and pan the map for detail.
          </p>
          {mfr?.lat && mfr?.lng ? (
            <ManufacturerOrderMap
              manufacturerLat={mfr.lat}
              manufacturerLng={mfr.lng}
              mapHeight={440}
              orders={jobs.map(j => ({
                order_ref: j.order_ref,
                status: j.status,
                delivery_address: j.delivery_address || {},
              }))}
            />
          ) : (
            <div style={{
              background: C.card, borderRadius: 12, padding: 32, textAlign: "center",
              border: `1px solid ${C.border}`
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📍</div>
              <p style={{ color: C.t2, fontSize: 14 }}>
                Add your factory's coordinates in the Workshop Profile tab to enable the map view.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── EARNINGS TAB ─────────────────────────────────────────── */}
      {tab === "earnings" && (
        <div>
          <div style={{
            background: C.card, border: `1px solid ${C.green}`, borderRadius: 10,
            padding: "20px 24px", marginBottom: 20
          }}>
            <p style={{ fontSize: 12, color: C.t3 }}>TOTAL EARNED</p>
            <p style={{ fontSize: 32, fontWeight: 800, color: C.green }}>
              ₹{totalEarnings.toLocaleString("en-IN")}
            </p>
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: C.t2, marginBottom: 12 }}>Payout History</h3>
          {payouts.length === 0 && <p style={{ color: C.t3 }}>No payouts yet.</p>}
          {payouts.map(p => (
            <div key={p.id} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "12px 16px", marginBottom: 8,
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <div>
                <p style={{ fontSize: 13, color: C.t1 }}>{p.orders?.order_ref || p.order_id?.slice(0, 8)}</p>
                <p style={{ fontSize: 11, color: C.t3 }}>
                  {new Date(p.released_at).toLocaleDateString("en-IN")}
                </p>
              </div>
              <p style={{ fontWeight: 700, color: C.green }}>
                +₹{Number(p.manufacturer_amount).toLocaleString("en-IN")}
              </p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
