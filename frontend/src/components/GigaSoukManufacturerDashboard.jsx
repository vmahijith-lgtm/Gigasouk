// ════════════════════════════════════════════════════════════════
// GigaSoukManufacturerDashboard.jsx — Manufacturer Dashboard
// Tabs: Commitment Board | Active Jobs | … — Workshop Profile opens from top bar (landscape panel).
// TO ADD A TAB: add entry to TABS array + add a section below.
// TO REMOVE A TAB: remove from TABS array + delete its section.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  submitQC,
  updateOrderStatus,
  getMyCommitments,
  updateCommitmentShowcase,
  withdrawCommitment,
  BACKEND_URL,
} from "../lib/api";
import { MACHINE_OPTIONS, MATERIAL_OPTIONS } from "../lib/workshop-tags";
import GigaSoukCommitmentBoard from "./GigaSoukCommitmentBoard";
import { ManufacturerOrderMap } from "./MapComponents";
import LocationPicker from "./LocationPicker";
import NegotiationList from "./NegotiationList";
import DesignMediaGallery from "./DesignMediaGallery";
import BrandLogo from "./BrandLogo";

// Fetch a 60-minute signed URL for a design's CAD file
async function fetchCadUrl(designId) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${BACKEND_URL}/api/v1/designs/${designId}/cad-url`, {
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

function apiErrorDetail(e) {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.message || "";
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d
      .map((x) => (typeof x === "object" && x && "msg" in x ? x.msg : JSON.stringify(x)))
      .filter(Boolean)
      .join("; ");
  return String(d);
}

/** Workshop panel banner: green for capability save ("Saved…") and showcase upload ("Workshop photos saved…"). */
function profileFlashIsSuccess(msg) {
  if (!msg || typeof msg !== "string") return false;
  const t = msg.trim();
  return t.startsWith("Saved") || t.startsWith("Workshop photos saved");
}

/** Only after saving machine/material tags — not after showcase uploads. */
function profileFlashShowBoardShortcut(msg) {
  return typeof msg === "string" && msg.includes("Commitment Board list updates");
}

/** Signed view URLs for product-images paths (workshop folder). */
async function signProductImagePaths(paths) {
  const urls = [];
  for (const p of paths || []) {
    const raw = (p || "").trim();
    if (!raw) continue;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      urls.push(raw);
      continue;
    }
    const { data, error } = await supabase.storage.from("product-images").createSignedUrl(raw, 7200);
    const u = data?.signedUrl || data?.signedURL;
    if (error) {
      console.warn("[signProductImagePaths] createSignedUrl failed for", raw, error.message);
    } else if (u) {
      urls.push(u);
    }
  }
  return urls;
}

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
  cutting: "#A78BFA", qc_review: "#2DD4BF", qc_failed: "#F87171",
  shipped: "#00E5A0", delivered: "#00E5A0", cancelled: "#F87171",
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
  const [showcaseBusy, setShowcaseBusy] = useState(null);
  const [removingCommitmentId, setRemovingCommitmentId] = useState(null);
  /** commitment id → signed URLs for immediate thumbnails (storage paths are not viewable in <img> alone). */
  const [showcaseThumbs, setShowcaseThumbs] = useState({});
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

        const [meRes, jRes, commList, oIdsRes] = await Promise.all([
          token
            ? fetch(`${BACKEND_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
            : Promise.resolve(null),
          supabase.from("orders").select("id, design_id, order_ref, status, payment_status, commitment_id, locked_price, committed_price, shiprocket_awb, tracking_url, created_at, delivery_address, designs(title, cad_file_url, preview_image_url), qc_records(*)")
            .eq("manufacturer_id", manufacturerId)
            .not("status", "in", "(delivered,cancelled,refunded)")
            .order("created_at", { ascending: false }),
          token ? getMyCommitments().then(r => r.data).catch(() => []) : Promise.resolve([]),
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
        setCommitments(Array.isArray(commList) ? commList : []);
        setPayouts(payoutRows);
      } finally {
        setLoading(false);
      }
    })();
  }, [manufacturerId, jobsRefreshKey]);

  // Resolve workshop photo paths to signed URLs so previews render.
  // Uses merge (not replace) so optimistically-set thumbs are never wiped
  // if a subset of signing calls fail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const c of commitments) {
        const paths = c.showcase_image_urls;
        if (!Array.isArray(paths) || !paths.length) continue;
        const urls = await signProductImagePaths(paths);
        if (urls.length) next[c.id] = urls;
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setShowcaseThumbs(prev => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commitments]);

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

  async function handleShowcaseUpload(commitment, fileList) {
    if (!fileList?.length) return;
    setShowcaseBusy(commitment.id);
    setProfileFlash("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setProfileFlash("Sign in to upload.");
        return;
      }
      const newPaths = [];
      for (const file of Array.from(fileList)) {
        const raw = file.name.split(".").pop() || "jpg";
        const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
        const path = `${user.id}/showcase/${commitment.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, {
          cacheControl: "31536000",
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
        if (upErr) throw upErr;
        newPaths.push(path);
      }
      const prevPaths = Array.isArray(commitment.showcase_image_urls)
        ? commitment.showcase_image_urls
        : [];
      const merged = [...prevPaths, ...newPaths];
      await updateCommitmentShowcase(commitment.id, merged);

      // Update local commitments state immediately so the "N photo(s) saved"
      // count text appears without waiting for a full reload.
      setCommitments(prev =>
        prev.map(c => c.id === commitment.id ? { ...c, showcase_image_urls: merged } : c)
      );

      // Sign the newly uploaded paths and show thumbnails immediately.
      const signedNew = await signProductImagePaths(newPaths);
      if (signedNew.length) {
        setShowcaseThumbs((prev) => ({
          ...prev,
          [commitment.id]: [...(prev[commitment.id] || []), ...signedNew],
        }));
      }

      setJobsRefreshKey((k) => k + 1);
      setProfileFlash("Workshop photos saved. Previews update below.");
    } catch (e) {
      const msg = apiErrorDetail(e);
      setProfileFlash(
        msg ||
          "Upload failed. Check Storage bucket product-images exists, RLS allows your uid prefix, and API /commitments/…/showcase is reachable.",
      );
    } finally {
      setShowcaseBusy(null);
    }
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

  async function handleWithdrawCommitment(commitment) {
    const ok = window.confirm(
      `Remove your commitment for "${commitment.designs?.title || "this design"}"?\n\nThis is blocked if active orders already use it.`,
    );
    if (!ok) return;
    setRemovingCommitmentId(commitment.id);
    try {
      await withdrawCommitment(commitment.id);
      setJobsRefreshKey((k) => k + 1);
      setBoardRefreshKey((k) => k + 1);
      setProfileFlash("Commitment removed.");
    } catch (e) {
      setProfileFlash(apiErrorDetail(e) || "Could not remove commitment.");
    } finally {
      setRemovingCommitmentId(null);
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

  // ── QC: upload to qc-photos/{auth.uid()}/qc/{orderId}/… then signed URL for backend AI ──
  async function handlePhotoUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !qcOrder) return;
    const room = 5 - photos.length;
    if (room <= 0) return;
    setUploading(true);
    setQcMsg({ text: "", type: "" });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setQcMsg({ text: "Sign in to upload.", type: "error" });
        return;
      }
      const batch = files.slice(0, room);
      const added = [];
      for (const file of batch) {
        const raw = file.name.split(".").pop() || "jpg";
        const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
        const path = `${user.id}/qc/${qcOrder.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("qc-photos").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
        if (upErr) {
          setQcMsg({
            text: upErr.message || "Upload failed. Ensure qc-photos bucket exists and RLS allows paths under your user id.",
            type: "error",
          });
          break;
        }
        const { data: signed, error: signErr } = await supabase.storage
          .from("qc-photos")
          .createSignedUrl(path, 7200);
        const signedUrl = signed?.signedUrl || signed?.signedURL;
        if (signErr || !signedUrl) {
          setQcMsg({ text: signErr?.message || "Could not sign image URL for QC.", type: "error" });
          break;
        }
        added.push(signedUrl);
      }
      if (added.length) setPhotos(prev => [...prev, ...added].slice(0, 5));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeQCPhoto(index) {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  }

  // ── QC: submit for AI check (JWT identifies manufacturer — not spoofable) ──
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
        photo_urls: photos,
      });
      if (data.passed) {
        setQcMsg({ text: "QC passed! Shipping is being arranged automatically.", type: "success" });
      } else {
        setQcMsg({ text: `QC failed: ${data.reason || data.message || "Try again"}. Re-make the part and resubmit.`, type: "error" });
      }
      setQcOrder(null);
      setPhotos([]);
      setJobsRefreshKey(k => k + 1);
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
  const qcReadyJobs = jobs.filter(j => j.status === "cutting" || j.status === "qc_failed");

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
          <BrandLogo width={112} height={28} />
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
            borderRadius: 12,
            border: `1px solid ${C.green}44`,
            background: C.card,
            overflow: "hidden",
            boxShadow: `0 10px 28px rgba(0,0,0,.24)`,
          }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 12,
            padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.card2,
          }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: C.t1, margin: 0 }}>Workshop Profile</h2>
              <p style={{ fontSize: 12, color: C.t3, margin: "6px 0 0", maxWidth: 560 }}>
                Configure capabilities and location used for routing.
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
              <p style={{ fontSize: 12, color: C.t3, lineHeight: 1.5, marginBottom: 14 }}>
                Each design lists required <strong style={{ color: C.blue }}>machine</strong> and{" "}
                <strong style={{ color: C.green }}>material</strong> tags. You only see a job when your workshop includes{" "}
                <em>every</em> tag on that design.
              </p>

              {profileFlash && (
                <div style={{
                  background: profileFlashIsSuccess(profileFlash) ? C.green + "18" : C.red + "18",
                  border: `1px solid ${profileFlashIsSuccess(profileFlash) ? C.green : C.red}`,
                  borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: 13,
                  color: profileFlashIsSuccess(profileFlash) ? C.green : C.red, lineHeight: 1.5,
                }}>
                  {profileFlash}
                  {profileFlashShowBoardShortcut(profileFlash) && (
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
              <p style={{ fontSize: 12, color: C.t3, marginBottom: 12, lineHeight: 1.45 }}>
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
            { label: "Active Jobs", val: workQueue.length, color: C.blue },
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
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 6,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Active Jobs</h3>
            <button
              type="button"
              onClick={() => setTab("chat")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${C.green}66`,
                background: `${C.green}18`,
                color: C.green,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Go to chats
            </button>
          </div>
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
                        {["pending_approval", "active", "paused"].includes(st) && (
                          <button
                            type="button"
                            disabled={removingCommitmentId === c.id}
                            onClick={() => handleWithdrawCommitment(c)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 20,
                              border: `1px solid ${C.red}66`,
                              background: C.red + "16",
                              color: C.red,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: removingCommitmentId === c.id ? "wait" : "pointer",
                            }}
                          >
                            {removingCommitmentId === c.id ? "Removing…" : "Remove"}
                          </button>
                        )}
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
                      <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 6 }}>
                          Workshop / product photos
                        </p>
                        <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
                          Add photos of your facility or sample parts. Stored under your account; same full-quality viewing as the designer gallery.
                        </p>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          id={`showcase-${c.id}`}
                          style={{ display: "none" }}
                          onChange={e => {
                            handleShowcaseUpload(c, e.target.files);
                            e.target.value = "";
                          }}
                        />
                        <button
                          type="button"
                          disabled={showcaseBusy === c.id}
                          onClick={() => document.getElementById(`showcase-${c.id}`)?.click()}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 8,
                            border: `1px solid ${C.green}66`,
                            background: C.green + "18",
                            color: C.green,
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: showcaseBusy === c.id ? "wait" : "pointer",
                          }}
                        >
                          {showcaseBusy === c.id ? "Uploading…" : "Add photos"}
                        </button>
                        {(c.showcase_image_urls || []).length > 0 && (
                          <p style={{ fontSize: 11, color: C.t3, marginTop: 8 }}>
                            {(c.showcase_image_urls || []).length} workshop photo(s) saved
                          </p>
                        )}
                        {showcaseThumbs[c.id]?.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              marginTop: 10,
                              alignItems: "center",
                            }}
                          >
                            {showcaseThumbs[c.id].map((url, idx) => (
                              <a
                                key={`${url}-${idx}`}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: "block",
                                  width: 76,
                                  height: 76,
                                  borderRadius: 10,
                                  overflow: "hidden",
                                  border: `1px solid ${C.border}`,
                                  flexShrink: 0,
                                  background: "#060910",
                                }}
                                title="Open full size"
                              >
                                <img
                                  src={url}
                                  alt=""
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block",
                                  }}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {c.design_id ? (
                          <div style={{ marginTop: 12 }}>
                            <DesignMediaGallery
                              designId={c.design_id}
                              title={c.designs?.title}
                              onlyCommitmentId={c.id}
                              storefront
                            />
                          </div>
                        ) : null}
                      </div>
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
                  {(job.status === "confirmed" || job.status === "cutting" || job.status === "qc_failed") &&
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
                  {(job.status === "cutting" || job.status === "qc_failed") && (
                    <button onClick={() => { setQcOrder(job); setTab("qc"); setPhotos([]); setQcMsg({ text: "", type: "" }); }}
                      style={{
                        padding: "8px 16px", borderRadius: 8, border: "none",
                        background: job.status === "qc_failed" ? C.red + "33" : C.gold,
                        color: "#060810", fontWeight: 700, fontSize: 12, cursor: "pointer"
                      }}>
                      {job.status === "qc_failed" ? "Resubmit QC" : "Submit QC Photos"}
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
              {job.design_id && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <DesignMediaGallery
                    designId={job.design_id}
                    title={job.designs?.title}
                    storefront
                  />
                </div>
              )}
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
        <div style={{ maxWidth: 560 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>QC photo upload</h3>
          <p style={{ fontSize: 13, color: C.t3, marginBottom: 8, lineHeight: 1.5 }}>
            Upload <strong style={{ color: C.t2 }}>five</strong> clear photos of the finished part (top, front, side, detail, scale/context).
            Files are stored under your account in <code style={{ fontSize: 11, color: C.gold }}>qc-photos</code>; the AI receives time-limited links.
          </p>
          <p style={{ fontSize: 12, color: C.t3, marginBottom: 20 }}>
            AI compares against the design CAD reference (±0.5&nbsp;mm tolerance by default). Use good lighting and keep the part in frame.
          </p>

          {/* Select order */}
          {!qcOrder && (
            <>
              <p style={{ fontSize: 12, color: C.t3, marginBottom: 10 }}>Orders in manufacturing or waiting for QC retry:</p>
              {qcReadyJobs.length === 0 && (
                <p style={{ color: C.t3, padding: 20 }}>No orders need QC right now (requires status &quot;cutting&quot; or &quot;qc_failed&quot;).</p>
              )}
              {qcReadyJobs.map(j => (
                <div key={j.id} onClick={() => { setQcOrder(j); setPhotos([]); setQcMsg({ text: "", type: "" }); }}
                  style={{
                    background: C.card,
                    border: `1px solid ${j.status === "qc_failed" ? C.red + "66" : C.gold + "88"}`,
                    borderRadius: 10,
                    padding: "14px 18px", marginBottom: 10, cursor: "pointer"
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <p style={{ fontWeight: 700, color: C.t1, margin: 0 }}>{j.order_ref}</p>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: j.status === "qc_failed" ? C.red : C.purple,
                      background: (j.status === "qc_failed" ? C.red : C.purple) + "22",
                      padding: "2px 8px", borderRadius: 20,
                    }}>{j.status === "qc_failed" ? "Retry QC" : "Cutting"}</span>
                  </div>
                  <p style={{ fontSize: 12, color: C.t3, marginTop: 6 }}>{j.designs?.title}</p>
                </div>
              ))}
            </>
          )}

          {/* Upload area */}
          {qcOrder && (
            <>
              <div style={{
                background: C.card, border: `1px solid ${qcOrder.status === "qc_failed" ? C.red + "55" : C.gold}`,
                borderRadius: 10,
                padding: "14px 18px", marginBottom: 16
              }}>
                <p style={{ fontSize: 12, color: C.t3 }}>QC for</p>
                <p style={{ fontWeight: 700, color: C.t1, marginBottom: 6 }}>{qcOrder.order_ref} — {qcOrder.designs?.title}</p>
                {Array.isArray(qcOrder.qc_records) && qcOrder.qc_records.length > 0 && (
                  <p style={{ fontSize: 11, color: C.t3, margin: 0 }}>
                    Previous QC attempt{qcOrder.qc_records.length > 1 ? "s" : ""}: {qcOrder.qc_records.length}
                  </p>
                )}
              </div>

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

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 10,
                marginBottom: 12,
              }}>
                {[0, 1, 2, 3, 4].map((idx) => {
                  const url = photos[idx];
                  return (
                    <div key={idx} style={{
                      position: "relative",
                      minHeight: 88,
                      aspectRatio: "1",
                      background: C.card2,
                      border: `1px solid ${url ? C.green : C.border}`,
                      borderRadius: 10,
                      overflow: "hidden",
                    }}>
                      {url ? (
                        <>
                          <img src={url} alt={`QC ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <button
                            type="button"
                            onClick={() => removeQCPhoto(idx)}
                            style={{
                              position: "absolute", top: 4, right: 4,
                              width: 22, height: 22, borderRadius: 6,
                              border: "none", background: "#000000aa", color: "#fff",
                              fontSize: 14, lineHeight: 1, cursor: "pointer", padding: 0,
                            }}
                            aria-label="Remove photo"
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <div style={{
                          height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, color: C.t3, textAlign: "center", padding: 6,
                        }}>
                          Photo {idx + 1}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p style={{ fontSize: 11, color: C.t3, marginBottom: 12 }}>
                {photos.length}/5 photos · {photos.length < 5 ? `Add ${5 - photos.length} more.` : "Ready to submit."}
              </p>

              <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoUpload} style={{ display: "none" }} />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || photos.length >= 5}
                  style={{
                    flex: 1, minWidth: 140, padding: "11px 0", borderRadius: 8, border: `1px solid ${C.border}`,
                    background: C.card2, color: C.t2, fontWeight: 600, fontSize: 14,
                    cursor: uploading || photos.length >= 5 ? "not-allowed" : "pointer"
                  }}>
                  {uploading ? "Working…" : "Add photos"}
                </button>
                <button type="button" onClick={handleQCSubmit} disabled={uploading || photos.length < 5}
                  style={{
                    flex: 1, minWidth: 140, padding: "11px 0", borderRadius: 8, border: "none",
                    background: photos.length >= 5 ? C.green : C.t3, color: "#060810",
                    fontWeight: 700, fontSize: 14, cursor: photos.length >= 5 && !uploading ? "pointer" : "not-allowed"
                  }}>
                  Submit for AI QC
                </button>
              </div>

              <button type="button" onClick={() => { setQcOrder(null); setPhotos([]); setQcMsg({ text: "", type: "" }); }}
                style={{
                  marginTop: 12, background: "none", border: "none", color: C.t3,
                  fontSize: 12, cursor: "pointer"
                }}>
                ← Choose another order
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
            <p style={{ fontSize: 12, color: C.t3 }}>TOTAL EARNED (released payouts)</p>
            <p style={{ fontSize: 32, fontWeight: 800, color: C.green }}>
              ₹{totalEarnings.toLocaleString("en-IN")}
            </p>
            <p style={{ fontSize: 11, color: C.t3, marginTop: 10, lineHeight: 1.45 }}>
              Customer payments run through Razorpay (escrow). You receive net amounts here after delivery triggers release. Shiprocket keys stay on the server only.
            </p>
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: C.t2, marginBottom: 12 }}>Active jobs · payment status</h3>
          <p style={{ fontSize: 12, color: C.t3, marginBottom: 10 }}>
            in_escrow = customer paid, funds held. pending = not paid yet. released = payout recorded below.
          </p>
          {jobs.length === 0 && <p style={{ color: C.t3, fontSize: 13, marginBottom: 16 }}>No active jobs.</p>}
          {jobs.slice(0, 20).map(j => (
            <div key={j.id} style={{
              background: C.card2, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "10px 14px", marginBottom: 8,
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
            }}>
              <span style={{ fontSize: 13 }}>{j.order_ref}</span>
              <span style={{ fontSize: 11, color: C.t3 }}>{j.payment_status || "pending"}</span>
            </div>
          ))}
          <h3 style={{ fontSize: 14, fontWeight: 700, color: C.t2, marginBottom: 12, marginTop: 20 }}>Payout history</h3>
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
