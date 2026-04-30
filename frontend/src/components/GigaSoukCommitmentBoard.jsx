// ════════════════════════════════════════════════════════════════
// GigaSoukCommitmentBoard.jsx — Manufacturer Jobs Board (NEW)
// Shows all designs seeking manufacturer commitments.
// Manufacturer reviews specs + price, clicks Commit to opt in.
//
// TO REMOVE THIS FEATURE:
//   Delete this file + remove its tab from GigaSoukManufacturerDashboard.jsx
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { getAvailableDesigns, createCommitment } from "../lib/api";

// ── Design Tokens ─────────────────────────────────────────────────
const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", blue: "#4A9EFF", red: "#F87171",
  t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukCommitmentBoard({ manufacturerId }) {
// ════════════════════════════════════════════════════════════════

  const [designs,        setDesigns]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [selected,       setSelected]       = useState(null);
  const [commitPrice,    setCommitPrice]    = useState("");
  const [regionCity,     setRegionCity]     = useState("");
  const [regionState,    setRegionState]    = useState("");
  const [variantReason,  setVariantReason]  = useState("");
  const [committing,     setCommitting]     = useState(false);
  const [successId,      setSuccessId]      = useState(null);
  const [error,          setError]          = useState("");
  const [filter,         setFilter]         = useState("all");

  // ── Load available designs ──────────────────────────────────────
  useEffect(() => {
    if (!manufacturerId) return;
    setLoading(true);
    getAvailableDesigns(manufacturerId)
      .then(r => setDesigns(r.data || []))
      .catch(() => setError("Could not load designs. Check your connection."))
      .finally(() => setLoading(false));
  }, [manufacturerId]);

  // ── Open detail panel ───────────────────────────────────────────
  function openDesign(design) {
    setSelected(design);
    setCommitPrice(String(design.base_price));
    setRegionCity("");
    setRegionState("");
    setVariantReason("");
    setError("");
  }

  // ── Submit commitment ───────────────────────────────────────────
  async function handleCommit() {
    if (!regionCity.trim() || !regionState.trim()) {
      setError("Please enter your city and state.");
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
      await createCommitment({
        design_id:       selected.id,
        manufacturer_id: manufacturerId,
        committed_price: price,
        region_city:     regionCity,
        region_state:    regionState,
        notes:           variantReason,
      });
      setSuccessId(selected.id);
      setSelected(null);
      setDesigns(prev => prev.filter(d => d.id !== selected.id));
    } catch (e) {
      setError(e?.response?.data?.detail || "Commit failed. Please try again.");
    } finally {
      setCommitting(false);
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
          <p style={{ fontSize: 13, color: C.t3, marginTop: 3 }}>
            Designs seeking manufacturers — commit to earn steady orders
          </p>
        </div>
        <span style={{ background: C.green + "22", border: `1px solid ${C.green}`, borderRadius: 20,
          padding: "4px 14px", fontSize: 12, fontWeight: 700, color: C.green }}>
          {designs.length} available
        </span>
      </div>

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
        <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
          <p style={{ fontSize: 16 }}>No designs available right now.</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Check back soon — designers upload new products regularly.</p>
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
          regionCity={regionCity}
          setRegionCity={setRegionCity}
          regionState={regionState}
          setRegionState={setRegionState}
          variantReason={variantReason}
          setVariantReason={setVariantReason}
          committing={committing}
          error={error}
          onCommit={handleCommit}
          onClose={() => setSelected(null)}
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
  const daysSeeking = design.days_seeking || 0;
  const urgent      = daysSeeking >= 2;

  return (
    <div onClick={() => onOpen(design)} style={{ background: C.card, border: `1px solid ${urgent ? C.gold + "88" : C.border}`,
      borderRadius: 10, padding: 18, cursor: "pointer", transition: "border-color .2s" }}>

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

      <p style={{ fontSize: 12, color: C.t3 }}>Tap to view specs and commit →</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// COMMIT PANEL (overlay)
// ════════════════════════════════════════════════════════════════
function CommitPanel({ design, commitPrice, setCommitPrice, regionCity, setRegionCity,
  regionState, setRegionState, variantReason, setVariantReason,
  committing, error, onCommit, onClose, colors: C }) {

  const isVariant   = Math.abs(parseFloat(commitPrice) - design.base_price) > 0.01;
  const priceDiff   = parseFloat(commitPrice) - design.base_price;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 50,
      display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ width: "min(480px, 100vw)", background: C.card, height: "100%",
        overflowY: "auto", padding: 28, borderLeft: `1px solid ${C.border}` }}
        onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} style={{ float: "right", background: "none", border: "none",
          color: C.t3, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>

        <h3 style={{ fontSize: 18, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{design.title}</h3>
        <p style={{ fontSize: 13, color: C.t3, marginBottom: 20 }}>
          Review the spec, set your committed price, enter your region.
        </p>

        {/* Spec */}
        {design.description && (
          <p style={{ fontSize: 13, color: C.t2, marginBottom: 16, lineHeight: 1.6 }}>{design.description}</p>
        )}

        {/* Base price reference */}
        <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "12px 16px", marginBottom: 20 }}>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 4 }}>DESIGNER'S BASE PRICE</p>
          <p style={{ fontSize: 24, fontWeight: 800, color: C.green }}>
            ₹{Number(design.base_price).toLocaleString("en-IN")}
          </p>
          <p style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
            Match this price to get instant approval. Enter a different price to request a regional variant.
          </p>
        </div>

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

        {/* Region */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase",
              letterSpacing: ".06em", display: "block", marginBottom: 6 }}>Your City</label>
            <input value={regionCity} onChange={e => setRegionCity(e.target.value)}
              placeholder="e.g. Bengaluru"
              style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 14px", color: C.t1, fontSize: 14, width: "100%", outline: "none" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.t3, textTransform: "uppercase",
              letterSpacing: ".06em", display: "block", marginBottom: 6 }}>State</label>
            <input value={regionState} onChange={e => setRegionState(e.target.value)}
              placeholder="e.g. Karnataka"
              style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 14px", color: C.t1, fontSize: 14, width: "100%", outline: "none" }} />
          </div>
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
        </p>
      </div>
    </div>
  );

  async function handleCommit() { onCommit(); }
}
