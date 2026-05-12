// ════════════════════════════════════════════════════════════════
// GigaSoukCommitmentBoard.jsx — Manufacturer Jobs Board (NEW)
// Shows all designs seeking manufacturer commitments.
// Manufacturer reviews specs + price, clicks Commit to opt in.
//
// TO REMOVE THIS FEATURE:
//   Delete this file + remove its tab from GigaSoukManufacturerDashboard.jsx
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { getAvailableDesigns, createCommitment, BACKEND_URL } from "../lib/api";
import DesignMediaGallery from "./DesignMediaGallery";

// ── Design Tokens ─────────────────────────────────────────────────
const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", blue: "#4A9EFF", red: "#F87171",
  t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukCommitmentBoard({
  manufacturerId,
  /** From Workshop Profile / manufacturers row — used as commitment region (no manual entry). */
  workshopCity = "",
  workshopState = "",
  onOpenWorkshopProfile,
  /** Called after a successful commit — e.g. switch dashboard tab to Active Jobs. */
  onCommitted,
  refreshKey = 0,
}) {
// ════════════════════════════════════════════════════════════════

  const [designs,        setDesigns]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [selected,       setSelected]       = useState(null);
  const [commitPrice,    setCommitPrice]    = useState("");
  const [variantReason,  setVariantReason]  = useState("");
  const [committing,     setCommitting]     = useState(false);
  const [successId,      setSuccessId]      = useState(null);
  const [error,          setError]          = useState("");
  const [filter,         setFilter]         = useState("all");
  const [cadLoading,     setCadLoading]     = useState(false);

  // ── Load available designs ──────────────────────────────────────
  useEffect(() => {
    if (!manufacturerId) return;
    setLoading(true);
    getAvailableDesigns(manufacturerId)
      .then(r => setDesigns(r.data || []))
      .catch(() => setError("Could not load designs. Check your connection."))
      .finally(() => setLoading(false));
  }, [manufacturerId, refreshKey]);

  // ── Open detail panel ───────────────────────────────────────────
  function openDesign(design) {
    setSelected(design);
    setCommitPrice(String(design.base_price));
    setVariantReason("");
    setError("");
  }

  // ── Submit commitment ───────────────────────────────────────────
  async function handleCommit() {
    const city = (workshopCity || "").trim();
    const state = (workshopState || "").trim();
    if (!city || !state) {
      setError(
        "Your workshop city and state are missing. Set them under Workshop Profile → Location, then try again.",
      );
      return;
    }
    const price = parseFloat(commitPrice);
    if (isNaN(price) || price <= 0) {
      setError("Please enter a valid price.");
      return;
    }
    const isVariant = Math.abs(price - selected.base_price) > 0.01;
    if (isVariant && !variantReason.trim()) {
      setError("Please explain why your price differs from the base price.");
      return;
    }
    setCommitting(true);
    setError("");
    try {
      // region_city / region_state are resolved on the server from manufacturers.city/state
      await createCommitment({
        design_id:       selected.id,
        manufacturer_id: manufacturerId,
        committed_price: price,
        notes:           variantReason,
      });
      setSuccessId(selected.id);
      setSelected(null);
      setDesigns(prev => prev.filter(d => d.id !== selected.id));
      if (typeof onCommitted === "function") {
        window.setTimeout(() => onCommitted(), 700);
      }
    } catch (e) {
      setError(e?.response?.data?.detail || "Commit failed. Please try again.");
    } finally {
      setCommitting(false);
    }
  }

  // ── Open CAD file in new tab via backend signed URL ─────────────
  async function handleViewCad(designId) {
    setCadLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setError("You must be signed in to view CAD files."); return; }

      const res = await fetch(`${BACKEND_URL}/api/v1/designs/${designId}/cad-url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      const { signed_url } = await res.json();
      if (signed_url) window.open(signed_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e.message || "Could not open CAD file.");
    } finally {
      setCadLoading(false);
    }
  }

  // ── Filter designs ──────────────────────────────────────────────
  const filtered = designs.filter(d => {
    if (filter === "all") return true;
    return d.category === filter;
  });
  const categories = ["all", ...new Set(designs.map(d => d.category).filter(Boolean))];

  // ── UI ──────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: C.t1 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.t1 }}>Commitment Board</h2>
          <p style={{ fontSize: 13, color: C.t3, marginTop: 3, lineHeight: 1.5 }}>
            Designs seeking manufacturers. You only see jobs whose required machine and material tags are all listed on
            your{" "}
            {typeof onOpenWorkshopProfile === "function" ? (
              <button type="button" onClick={() => onOpenWorkshopProfile()}
                style={{
                  background: "none", border: "none", padding: 0, color: C.green,
                  fontWeight: 700, cursor: "pointer", fontSize: 13, textDecoration: "underline",
                }}>
                Workshop Profile
              </button>
            ) : (
              "Workshop Profile"
            )}
            .
          </p>
        </div>
        <span style={{ background: C.green + "22", border: `1px solid ${C.green}`, borderRadius: 20,
          padding: "4px 14px", fontSize: 12, fontWeight: 700, color: C.green }}>
          {designs.length} available
        </span>
      </div>

      {!loading && designs.length > 0 && (
        <p style={{ fontSize: 12, color: C.t3, marginBottom: 14, lineHeight: 1.5 }}>
          Not seeing a design you expected? Your{" "}
          {typeof onOpenWorkshopProfile === "function" ? (
            <button type="button" onClick={() => onOpenWorkshopProfile()}
              style={{
                background: "none", border: "none", padding: 0, color: C.green,
                fontWeight: 700, cursor: "pointer", fontSize: 12, textDecoration: "underline",
              }}>
              Workshop Profile
            </button>
          ) : (
            "Workshop Profile"
          )}{" "}
          must list every machine and material tag that design requires.
        </p>
      )}

      {/* Category filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => setFilter(cat)}
            style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${filter === cat ? C.green : C.border}`,
              background: filter === cat ? C.green + "22" : C.card2, color: filter === cat ? C.green : C.t3,
              fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>
            {cat}
          </button>
        ))}
      </div>

      {/* Success banner */}
      {successId && (
        <div style={{ background: C.green + "18", border: `1px solid ${C.green}`, borderRadius: 8,
          padding: "12px 16px", marginBottom: 20, fontSize: 13, color: C.green }}>
          ✓ Commitment submitted! You will be notified when a local order triggers.
        </div>
      )}

      {loading && (
        <p style={{ color: C.t3, fontSize: 14, textAlign: "center", padding: 40 }}>Loading designs...</p>
      )}

      {/* Design cards grid */}
      {!loading && filtered.length === 0 && (
        <div style={{
          textAlign: "left", padding: "28px 24px", color: C.t3,
          background: C.card2, border: `1px solid ${C.border}`, borderRadius: 12, maxWidth: 560,
        }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
            Nothing on the board yet
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
            Designs only appear here when all of the following are true:
          </p>
          <ul style={{ fontSize: 13, lineHeight: 1.75, margin: 0, paddingLeft: 20 }}>
            <li>The designer clicked <strong style={{ color: C.gold }}>Seek Commitments</strong> (draft designs stay private).</li>
            <li>Your profile lists every <strong style={{ color: C.blue }}>machine</strong> and <strong style={{ color: C.green }}>material</strong> tag required on that design.</li>
          </ul>
          <p style={{ fontSize: 12, marginTop: 16, color: C.t3, marginBottom: 14 }}>
            Update <strong style={{ color: C.t2 }}>Machines</strong> and <strong style={{ color: C.t2 }}>Materials</strong>{" "}
            on your Workshop Profile tab if you expect to match more jobs.
          </p>
          {typeof onOpenWorkshopProfile === "function" && (
            <button type="button" onClick={() => onOpenWorkshopProfile()}
              style={{
                padding: "11px 22px", borderRadius: 10, border: `1px solid ${C.green}`,
                background: C.green + "22", color: C.green, fontWeight: 700, fontSize: 13,
                cursor: "pointer",
              }}>
              Open Workshop Profile →
            </button>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {filtered.map(design => (
          <DesignCard key={design.id} design={design} onOpen={openDesign} colors={C} />
        ))}
      </div>

      {/* Detail panel (slide-in overlay) */}
      {selected && (
        <CommitPanel
          design={selected}
          commitPrice={commitPrice}
          setCommitPrice={setCommitPrice}
          workshopCity={workshopCity}
          workshopState={workshopState}
          variantReason={variantReason}
          setVariantReason={setVariantReason}
          committing={committing}
          cadLoading={cadLoading}
          error={error}
          onCommit={handleCommit}
          onViewCad={() => handleViewCad(selected.id)}
          onClose={() => setSelected(null)}
          onOpenWorkshopProfile={onOpenWorkshopProfile}
          colors={C}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// DESIGN CARD
// ════════════════════════════════════════════════════════════════
function DesignCard({ design, onOpen, colors: C }) {
  const daysSeeking = design.days_seeking ?? 0;
  const urgent      = daysSeeking >= 2;
  const preview     = design.preview_image_url;

  return (
    <div onClick={() => onOpen(design)} style={{ background: C.card, border: `1px solid ${urgent ? C.gold + "88" : C.border}`,
      borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color .2s" }}>

      {/* Preview image — large enough to judge the part */}
      <div style={{
        width: "100%", height: 160, background: C.card2,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderBottom: `1px solid ${C.border}`,
      }}>
        {preview ? (
          <img
            src={preview}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 13, color: C.t3, padding: 16, textAlign: "center" }}>
            No preview image — open card for full spec & CAD
          </span>
        )}
      </div>

      <div style={{ padding: 18 }}>

      {/* Top: title + urgent badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: C.t1, flex: 1, lineHeight: 1.3 }}>{design.title}</p>
        {urgent && (
          <span style={{ background: C.gold + "22", border: `1px solid ${C.gold}`, borderRadius: 12,
            padding: "2px 8px", fontSize: 10, fontWeight: 700, color: C.gold, marginLeft: 8, whiteSpace: "nowrap" }}>
            {daysSeeking}d seeking
          </span>
        )}
      </div>

      {/* Base price */}
      <p style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 12 }}>
        ₹{Number(design.base_price).toLocaleString("en-IN")}
        <span style={{ fontSize: 12, fontWeight: 400, color: C.t3, marginLeft: 4 }}>base price</span>
      </p>

      {/* Machine + material tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
        {(design.required_machines || []).map(m => (
          <span key={m} style={{ background: C.blue + "22", border: `1px solid ${C.blue}55`, borderRadius: 4,
            padding: "2px 8px", fontSize: 11, color: C.blue }}>{m}</span>
        ))}
        {(design.required_materials || []).map(m => (
          <span key={m} style={{ background: C.t3 + "22", border: `1px solid ${C.border}`, borderRadius: 4,
            padding: "2px 8px", fontSize: 11, color: C.t3 }}>{m}</span>
        ))}
      </div>

      {design.designer_name && (
        <p style={{ fontSize: 11, color: C.t3, marginBottom: 8 }}>Designer: {design.designer_name}</p>
      )}
      <p style={{ fontSize: 12, color: C.t3 }}>Tap to view specs and commit →</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// COMMIT PANEL (overlay)
// ════════════════════════════════════════════════════════════════
function CommitPanel({ design, commitPrice, setCommitPrice, workshopCity, workshopState,
  variantReason, setVariantReason,
  committing, cadLoading, error, onCommit, onViewCad, onClose, onOpenWorkshopProfile, colors: C }) {

  const isVariant   = Math.abs(parseFloat(commitPrice) - design.base_price) > 0.01;
  const priceDiff   = parseFloat(commitPrice) - design.base_price;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 50,
      display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ width: "min(480px, 100%)", maxWidth: "100%", boxSizing: "border-box",
        background: C.card, height: "100%",
        overflowY: "auto", padding: 28, borderLeft: `1px solid ${C.border}` }}
        onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} style={{ float: "right", background: "none", border: "none",
          color: C.t3, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>

        <h3 style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{design.title}</h3>
        {design.designer_name && (
          <p style={{ fontSize: 12, color: C.t3, marginBottom: 8 }}>Designer: {design.designer_name}</p>
        )}
        <p style={{ fontSize: 13, color: C.t3, marginBottom: 12 }}>
          Review the spec, set your committed price, enter your region.
        </p>
        <p style={{
          fontSize: 12, color: C.gold, marginBottom: 16, lineHeight: 1.55,
          background: C.gold + "12", border: `1px solid ${C.gold}44`, borderRadius: 8, padding: "10px 12px",
        }}>
          Required tags below must already be on your{" "}
          {typeof onOpenWorkshopProfile === "function" ? (
            <button type="button" onClick={() => { onClose(); onOpenWorkshopProfile(); }}
              style={{
                background: "none", border: "none", padding: 0, color: C.green,
                fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontSize: 12,
              }}>
              Workshop Profile
            </button>
          ) : (
            "Workshop Profile"
          )}{" "}
          for this design to appear on your board.
        </p>

        {(((design.required_machines || []).length > 0) || ((design.required_materials || []).length > 0)) && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.t3, letterSpacing: ".06em", marginBottom: 8 }}>
              REQUIRED ON THIS DESIGN
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(design.required_machines || []).map(m => (
                <span key={`m-${m}`} style={{
                  background: C.blue + "22", border: `1px solid ${C.blue}55`, borderRadius: 4,
                  padding: "4px 10px", fontSize: 11, color: C.blue,
                }}>{m}</span>
              ))}
              {(design.required_materials || []).map(m => (
                <span key={`mat-${m}`} style={{
                  background: C.t3 + "22", border: `1px solid ${C.border}`, borderRadius: 4,
                  padding: "4px 10px", fontSize: 11, color: C.t3,
                }}>{m}</span>
              ))}
            </div>
          </div>
        )}

        {design.id && (
          <div style={{ marginBottom: 20 }}>
            <DesignMediaGallery designId={design.id} title={design.title} storefront />
          </div>
        )}

        {/* Spec */}
        {design.description && (
          <p style={{ fontSize: 13, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>{design.description}</p>
        )}

        {/* Base price reference */}
        <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "12px 16px", marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 4 }}>DESIGNER'S BASE PRICE</p>
          <p style={{ fontSize: 24, fontWeight: 800, color: C.green }}>
            ₹{Number(design.base_price).toLocaleString("en-IN")}
          </p>
          <p style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
            Match this price to get instant approval. Enter a different price to request a regional variant.
          </p>
        </div>

        {/* CAD file download */}
        {design.cad_file_url && (
          <button
            type="button"
            onClick={onViewCad}
            disabled={cadLoading}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 8, marginBottom: 20,
              border: `1px solid ${C.blue}`, background: C.blue + "18",
              color: cadLoading ? C.t3 : C.blue, fontWeight: 600, fontSize: 13,
              cursor: cadLoading ? "not-allowed" : "pointer", letterSpacing: ".02em",
            }}
          >
            {cadLoading ? "Opening file…" : "📎 View / Download CAD File"}
          </button>
        )}

        {/* Your price */}
        <label style={{ fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase",
          letterSpacing: ".06em", display: "block", marginBottom: 6 }}>
          Your Committed Price (₹)
        </label>
        <input type="number" value={commitPrice} onChange={e => setCommitPrice(e.target.value)}
          style={{ background: C.card2, border: `1px solid ${isVariant ? C.gold : C.border}`,
            borderRadius: 8, padding: "10px 14px", color: C.t1, fontSize: 16, width: "100%",
            outline: "none", marginBottom: 8 }} />
        {isVariant && (
          <p style={{ fontSize: 12, color: C.gold, marginBottom: 12 }}>
            {priceDiff > 0 ? `+₹${priceDiff.toFixed(0)} above` : `₹${Math.abs(priceDiff).toFixed(0)} below`} base price.
            Designer must approve this regional variant before you go active.
          </p>
        )}

        {/* Region — from workshop profile (manufacturer credentials) */}
        <div style={{
          background: C.card2,
          border: `1px solid ${(workshopCity || "").trim() && (workshopState || "").trim() ? C.green + "44" : C.gold + "55"}`,
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 16,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase",
            letterSpacing: ".06em", marginBottom: 8 }}>Commitment region</p>
          {(workshopCity || "").trim() && (workshopState || "").trim() ? (
            <p style={{ fontSize: 14, fontWeight: 600, color: C.t1 }}>
              {(workshopCity || "").trim()}, {(workshopState || "").trim()}
              <span style={{ fontSize: 12, fontWeight: 400, color: C.t3, display: "block", marginTop: 6 }}>
                Taken from your workshop location. To change it, update{" "}
                {typeof onOpenWorkshopProfile === "function" ? (
                  <button type="button" onClick={() => { onClose(); onOpenWorkshopProfile(); }}
                    style={{
                      background: "none", border: "none", padding: 0, color: C.green,
                      fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontSize: 12,
                    }}>
                    Workshop Profile
                  </button>
                ) : (
                  "Workshop Profile"
                )}{" "}
                → Location.
              </span>
            </p>
          ) : (
            <p style={{ fontSize: 13, color: C.gold, lineHeight: 1.5 }}>
              City and state are not set on your profile.{" "}
              {typeof onOpenWorkshopProfile === "function" && (
                <button type="button" onClick={() => { onClose(); onOpenWorkshopProfile(); }}
                  style={{
                    background: "none", border: "none", padding: 0, color: C.green,
                    fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontSize: 13,
                  }}>
                  Open Workshop Profile
                </button>
              )}{" "}
              and save your workshop location first.
            </p>
          )}
        </div>

        {/* Reason (only if variant) */}
        {isVariant && (
          <>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase",
              letterSpacing: ".06em", display: "block", marginBottom: 6 }}>
              Reason for Different Price
            </label>
            <textarea value={variantReason} onChange={e => setVariantReason(e.target.value)}
              placeholder="e.g. Higher raw material cost in this region, electricity tariff difference..."
              rows={3}
              style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 14px", color: C.t1, fontSize: 13, width: "100%", outline: "none",
                resize: "vertical", marginBottom: 16 }} />
          </>
        )}

        {error && (
          <p style={{ color: C.red, fontSize: 13, marginBottom: 12, background: C.red + "18",
            padding: "8px 12px", borderRadius: 6 }}>{error}</p>
        )}

        {/* CTA */}
        <button onClick={handleCommit} disabled={committing}
          style={{ width: "100%", padding: "13px 0", borderRadius: 8, border: "none",
            background: committing ? C.t3 : C.green, color: "#060810", fontWeight: 700,
            fontSize: 15, cursor: committing ? "not-allowed" : "pointer" }}>
          {committing ? "Submitting..." : isVariant ? "Submit Regional Variant" : "Commit to This Design"}
        </button>

        <p style={{ fontSize: 11, color: C.t3, marginTop: 12, textAlign: "center", lineHeight: 1.5 }}>
          By committing you agree to fulfill orders in your region at the committed price.
          You can withdraw a commitment if no orders have been placed yet.
          {" "}The designer decides when the listing goes live in the shop — not the manufacturer.
        </p>
      </div>
    </div>
  );

  async function handleCommit() { onCommit(); }
}
