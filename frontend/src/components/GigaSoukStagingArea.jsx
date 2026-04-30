// ════════════════════════════════════════════════════════════════
// GigaSoukStagingArea.jsx — Designer Staging Area (NEW)
// Shows designer's designs moving through:
//   Draft → Seeking → Committed → Live
// Designer can seek commitments, approve regional variants,
// and publish when ready.
//
// TO REMOVE: delete this file + remove its tab from
//            GigaSoukDesignerDashboard.jsx
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { seekCommitments, reviewVariant, publishDesign } from "../lib/api";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", blue: "#4A9EFF", purple: "#A78BFA",
  red: "#F87171", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

const STATUS_META = {
  draft:     { label: "Draft",     color: C.t3,    next: "Seek Commitments" },
  seeking:   { label: "Seeking",   color: C.gold,  next: "Awaiting Manufacturers" },
  committed: { label: "Committed", color: C.blue,  next: "Publish to Shop" },
  live:      { label: "Live",      color: C.green, next: null },
  paused:    { label: "Paused",    color: C.red,   next: "Re-publish" },
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukStagingArea({ designerId }) {
// ════════════════════════════════════════════════════════════════

  const [designs,  setDesigns]  = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState("pipeline");
  const [msg,      setMsg]      = useState({ text: "", type: "" });

  // ── Load designs ────────────────────────────────────────────────
  useEffect(() => {
    if (!designerId) return;
    setLoading(true);

    (async () => {
      try {
        // 1. Fetch designs by this designer (with their commitments)
        const { data: designRows } = await supabase
          .from("designs")
          .select("*, manufacturer_commitments(id,status,region_city,committed_price)")
          .eq("designer_id", designerId)
          .order("created_at", { ascending: false });

        const designIds = (designRows || []).map(d => d.id);

        // 2. Fetch pending regional variants ONLY for those designs.
        //    Supabase .in() needs a concrete array — passing a query builder
        //    triggers `object is not iterable` at runtime.
        let variantRows = [];
        if (designIds.length > 0) {
          const { data: variantsData } = await supabase
            .from("regional_price_variants")
            .select("*, manufacturers(shop_name, city)")
            .eq("status", "pending")
            .in("design_id", designIds);
          variantRows = variantsData || [];
        }

        setDesigns(designRows || []);
        setVariants(variantRows);
      } finally {
        setLoading(false);
      }
    })();
  }, [designerId]);

  function flash(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "" }), 4000);
  }

  // ── Actions ─────────────────────────────────────────────────────
  async function handleSeek(designId) {
    try {
      await seekCommitments({ design_id: designId, designer_id: designerId });
      setDesigns(prev => prev.map(d => d.id === designId ? { ...d, status: "seeking" } : d));
      flash("Manufacturers have been alerted. Waiting for commitments.");
    } catch (e) {
      flash(e?.response?.data?.detail || "Failed to seek commitments.", "error");
    }
  }

  async function handlePublish(designId) {
    try {
      await publishDesign(designId, designerId);
      setDesigns(prev => prev.map(d => d.id === designId ? { ...d, status: "live" } : d));
      flash("Design is now live in the shop! 🎉");
    } catch (e) {
      flash(e?.response?.data?.detail || "Could not publish design.", "error");
    }
  }

  async function handleVariantReview(variantId, approved, designId) {
    try {
      await reviewVariant({ variant_id: variantId, designer_id: designerId, approved });
      setVariants(prev => prev.filter(v => v.id !== variantId));
      if (approved) {
        flash("Regional variant approved. Manufacturer is now active.");
      } else {
        flash("Regional variant rejected.", "info");
      }
    } catch (e) {
      flash("Review failed. Try again.", "error");
    }
  }

  const msgColor = { success: C.green, error: C.red, info: C.gold };

  // ── UI ──────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: C.t1 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Staging Area</h2>
          <p style={{ fontSize: 13, color: C.t3, marginTop: 3 }}>
            Manage your designs through the commitment pipeline
          </p>
        </div>
        {variants.length > 0 && (
          <span style={{ background: C.gold + "22", border: `1px solid ${C.gold}`,
            borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700, color: C.gold }}>
            {variants.length} variant{variants.length > 1 ? "s" : ""} need review
          </span>
        )}
      </div>

      {/* Flash message */}
      {msg.text && (
        <div style={{ background: (msgColor[msg.type] || C.green) + "18",
          border: `1px solid ${msgColor[msg.type] || C.green}`,
          borderRadius: 8, padding: "12px 16px", marginBottom: 20,
          fontSize: 13, color: msgColor[msg.type] || C.green }}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
        {[
          { key: "pipeline", label: "Pipeline" },
          { key: "variants", label: `Variants ${variants.length > 0 ? `(${variants.length})` : ""}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
              color: tab === t.key ? C.green : C.t3, fontWeight: tab === t.key ? 700 : 400,
              fontSize: 14, borderBottom: `2px solid ${tab === t.key ? C.green : "transparent"}` }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: C.t3, textAlign: "center", padding: 40 }}>Loading...</p>}

      {/* ── PIPELINE TAB ─────────────────────────────────────────── */}
      {!loading && tab === "pipeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {designs.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
              <p>No designs yet. Upload your first CAD file to get started.</p>
            </div>
          )}
          {designs.map(design => {
            const meta         = STATUS_META[design.status] || STATUS_META.draft;
            const activeCommits = (design.manufacturer_commitments || []).filter(c => c.status === "active");
            const canPublish   = activeCommits.length >= 2 && design.status === "committed";

            return (
              <div key={design.id} style={{ background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>

                  {/* Left: info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ background: meta.color + "22", border: `1px solid ${meta.color}`,
                        borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, color: meta.color }}>
                        {meta.label}
                      </span>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>{design.title}</h3>
                    </div>
                    <p style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 10 }}>
                      ₹{Number(design.base_price).toLocaleString("en-IN")}
                    </p>

                    {/* Commits progress */}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: C.t3 }}>Commitments:</span>
                      {activeCommits.length === 0 && <span style={{ fontSize: 12, color: C.t3 }}>None yet</span>}
                      {activeCommits.map((c, i) => (
                        <span key={i} style={{ background: C.green + "18", border: `1px solid ${C.green}44`,
                          borderRadius: 4, padding: "2px 8px", fontSize: 11, color: C.green }}>
                          {c.region_city} — ₹{Number(c.committed_price).toLocaleString("en-IN")}
                        </span>
                      ))}
                    </div>

                    {design.status === "seeking" && activeCommits.length < 2 && (
                      <p style={{ fontSize: 12, color: C.gold }}>
                        Need {2 - activeCommits.length} more commitment{activeCommits.length === 0 ? "s" : ""} to unlock publishing.
                      </p>
                    )}
                    {canPublish && (
                      <p style={{ fontSize: 12, color: C.green }}>
                        ✓ Enough commitments! Ready to publish to the live shop.
                      </p>
                    )}
                  </div>

                  {/* Right: action */}
                  <div style={{ marginLeft: 20 }}>
                    {design.status === "draft" && (
                      <button onClick={() => handleSeek(design.id)}
                        style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                          background: C.gold, color: "#060810", fontWeight: 700, fontSize: 13,
                          cursor: "pointer", whiteSpace: "nowrap" }}>
                        Seek Commitments
                      </button>
                    )}
                    {design.status === "seeking" && (
                      <span style={{ fontSize: 12, color: C.t3, fontStyle: "italic" }}>Waiting...</span>
                    )}
                    {canPublish && (
                      <button onClick={() => handlePublish(design.id)}
                        style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                          background: C.green, color: "#060810", fontWeight: 700, fontSize: 13,
                          cursor: "pointer", whiteSpace: "nowrap" }}>
                        Publish to Shop
                      </button>
                    )}
                    {design.status === "live" && (
                      <span style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>🟢 Live</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── VARIANTS TAB ─────────────────────────────────────────── */}
      {!loading && tab === "variants" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {variants.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
              <p>No pending regional variants.</p>
            </div>
          )}
          {variants.map(v => (
            <div key={v.id} style={{ background: C.card, border: `1px solid ${C.gold}55`,
              borderRadius: 10, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p style={{ fontSize: 12, color: C.t3, marginBottom: 4 }}>REGIONAL PRICE VARIANT</p>
                  <p style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 8 }}>
                    {v.manufacturers?.shop_name || "Manufacturer"} — {v.region_city}
                  </p>
                  <div style={{ display: "flex", gap: 20, marginBottom: 8 }}>
                    <div>
                      <p style={{ fontSize: 11, color: C.t3 }}>Base Price</p>
                      <p style={{ fontSize: 16, fontWeight: 700, color: C.t2 }}>₹{Number(v.base_price).toLocaleString("en-IN")}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: C.t3 }}>Proposed</p>
                      <p style={{ fontSize: 16, fontWeight: 700, color: v.proposed_price > v.base_price ? C.gold : C.green }}>
                        ₹{Number(v.proposed_price).toLocaleString("en-IN")}
                        <span style={{ fontSize: 11, marginLeft: 4 }}>
                          ({v.price_diff_percent > 0 ? "+" : ""}{v.price_diff_percent}%)
                        </span>
                      </p>
                    </div>
                  </div>
                  {v.reason && <p style={{ fontSize: 12, color: C.t3, fontStyle: "italic" }}>"{v.reason}"</p>}
                </div>
                <div style={{ display: "flex", gap: 8, marginLeft: 20 }}>
                  <button onClick={() => handleVariantReview(v.id, false, v.design_id)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.red}`,
                      background: "none", color: C.red, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                    Reject
                  </button>
                  <button onClick={() => handleVariantReview(v.id, true, v.design_id)}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "none",
                      background: C.green, color: "#060810", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
