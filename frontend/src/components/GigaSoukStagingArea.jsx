// ════════════════════════════════════════════════════════════════
// GigaSoukStagingArea.jsx — Designer Staging Area
// Tabs: Pipeline | Variants
//
// NEW: "New Design +" button opens a modal where the designer:
//   1. Fills in title, description, category, base price, royalty %
//   2. Selects required machine types and materials
//   3. Uploads CAD file → Supabase Storage cad-files/{auth.uid()}/{uuid}
//   4. Uploads preview image → design-previews/{auth.uid()}/{uuid}
//      (first path segment is the Supabase Auth user id so default Storage
//      RLS policies allow the upload; designer_id in DB remains profiles.id)
//   5. Submits → backend POST /api/v1/designs → design appears in pipeline
//
// After creation the designer can:
//   • Seek Commitments  (draft → seeking)
//   • Publish to Shop   (committed → live, once ≥1 active commit)
//   • Pause / Resume    (live ↔ paused)
// ════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  seekCommitments,
  reviewVariant,
  publishDesign,
  createDesign,
  getDesignerDesigns,
  updateDesignGallery,
} from "../lib/api";
import { MACHINE_OPTIONS, MATERIAL_OPTIONS } from "../lib/workshop-tags";
import DesignMediaGallery from "./DesignMediaGallery";

/** Must match backend MIN_COMMITS_TO_GO_LIVE */
const MIN_COMMITMENTS_TO_PUBLISH = 1;

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

  const [designs,   setDesigns]   = useState([]);
  const [variants,  setVariants]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState("pipeline");
  const [msg,       setMsg]       = useState({ text: "", type: "" });
  const [galleryBusy, setGalleryBusy] = useState(null);
  const [showForm,  setShowForm]  = useState(false);
  const designsRef = useRef([]);
  useEffect(() => {
    designsRef.current = designs;
  }, [designs]);

  // Pipeline + commitments come from the backend (service role) so RLS/embed quirks
  // cannot hide rows. Variants list avoids joining manufacturers() — RLS blocks designers
  // from reading other workshops' manufacturer rows, which broke the whole query for some DBs.
  const loadPipeline = useCallback(async () => {
    if (!designerId) return;
    setLoading(true);
    try {
      const { data: designRows } = await getDesignerDesigns(designerId);
      const rows = Array.isArray(designRows) ? designRows : [];
      setDesigns(rows);

      const designIds = rows.map(d => d.id);
      let variantRows = [];
      if (designIds.length > 0) {
        const { data: variantsData } = await supabase
          .from("regional_price_variants")
          .select(
            "id, design_id, commitment_id, manufacturer_id, proposed_price, base_price, price_diff_percent, region_city, region_state, reason, status, submitted_at"
          )
          .eq("status", "pending")
          .in("design_id", designIds);
        variantRows = variantsData || [];
      }
      setVariants(variantRows);
    } catch (e) {
      setDesigns([]);
      setVariants([]);
      flash(e?.response?.data?.detail || e?.message || "Could not load your designs.", "error");
    } finally {
      setLoading(false);
    }
  }, [designerId]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  // When a manufacturer commits, the design row updates (seeking → committed); refetch so
  // Publish appears without a manual reload.
  useEffect(() => {
    if (!designerId) return;
    const ch = supabase
      .channel(`designer_pipeline_${designerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "designs",
          filter: `designer_id=eq.${designerId}`,
        },
        () => {
          loadPipeline();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [designerId, loadPipeline]);

  // New regional variants do not change the designs row; refresh pipeline when a variant
  // appears for one of our design IDs.
  useEffect(() => {
    if (!designerId) return;
    const ch = supabase
      .channel(`designer_variant_ins_${designerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "regional_price_variants" },
        (payload) => {
          const did = payload.new?.design_id;
          if (did && designsRef.current.some((d) => d.id === did)) loadPipeline();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [designerId, loadPipeline]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") loadPipeline();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadPipeline]);

  useEffect(() => {
    if (tab === "variants") loadPipeline();
  }, [tab, loadPipeline]);

  function flash(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "" }), 5000);
  }

  // ── Seek commitments ─────────────────────────────────────────────
  async function handleSeek(designId) {
    try {
      await seekCommitments({ design_id: designId, designer_id: designerId });
      await loadPipeline();
      flash("Manufacturers have been alerted. Waiting for commitments.");
    } catch (e) {
      flash(e?.response?.data?.detail || "Failed to seek commitments.", "error");
    }
  }

  // ── Publish to shop ──────────────────────────────────────────────
  async function handlePublish(designId) {
    try {
      await publishDesign(designId, designerId);
      await loadPipeline();
      flash("Design is now live in the shop!");
    } catch (e) {
      flash(e?.response?.data?.detail || "Could not publish design.", "error");
    }
  }

  async function handleGalleryFiles(design, fileList) {
    if (!fileList?.length) return;
    setGalleryBusy(design.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        flash("Sign in to upload images.", "error");
        return;
      }
      const newPaths = [];
      for (const file of Array.from(fileList)) {
        const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "jpg";
        const path = `${user.id}/designs/${design.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file, {
          cacheControl: "31536000",
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
        if (error) throw error;
        newPaths.push(path);
      }
      const merged = [...(design.gallery_image_urls || []), ...newPaths];
      await updateDesignGallery(design.id, designerId, merged);
      await loadPipeline();
      flash("Images added to your product gallery.");
    } catch (e) {
      flash(e?.response?.data?.detail || e?.message || "Upload failed.", "error");
    } finally {
      setGalleryBusy(null);
    }
  }

  // ── Approve / reject regional variant ───────────────────────────
  async function handleVariantReview(variantId, approved) {
    try {
      await reviewVariant({ variant_id: variantId, designer_id: designerId, approved, notes: "" });
      await loadPipeline();
      flash(approved ? "Regional variant approved." : "Regional variant rejected.", approved ? "success" : "info");
    } catch {
      flash("Review failed. Try again.", "error");
    }
  }

  // ── Design created from form ─────────────────────────────────────
  function handleDesignCreated() {
    setShowForm(false);
    flash("Design created! Click 'Seek Commitments' when ready.");
    loadPipeline();
  }

  const msgColor = { success: C.green, error: C.red, info: C.gold };

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
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {variants.length > 0 && (
            <span style={{
              background: C.gold + "22", border: `1px solid ${C.gold}`,
              borderRadius: 20, padding: "4px 14px", fontSize: 12, fontWeight: 700, color: C.gold
            }}>
              {variants.length} variant{variants.length > 1 ? "s" : ""} need review
            </span>
          )}
          <button onClick={() => setShowForm(true)}
            style={{
              padding: "9px 18px", borderRadius: 8, border: "none",
              background: C.green, color: "#060810", fontWeight: 700, fontSize: 13, cursor: "pointer"
            }}>
            + New Design
          </button>
        </div>
      </div>

      {/* Flash message */}
      {msg.text && (
        <div style={{
          background: (msgColor[msg.type] || C.green) + "18",
          border: `1px solid ${msgColor[msg.type] || C.green}`,
          borderRadius: 8, padding: "12px 16px", marginBottom: 20,
          fontSize: 13, color: msgColor[msg.type] || C.green
        }}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
        {[
          { key: "pipeline", label: "Pipeline" },
          { key: "variants", label: `Variants${variants.length > 0 ? ` (${variants.length})` : ""}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
              color: tab === t.key ? C.green : C.t3, fontWeight: tab === t.key ? 700 : 400,
              fontSize: 14, borderBottom: `2px solid ${tab === t.key ? C.green : "transparent"}`
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: C.t3, textAlign: "center", padding: 40 }}>Loading...</p>}

      {/* ── PIPELINE TAB ──────────────────────────────────────────── */}
      {!loading && tab === "pipeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {designs.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
              <p style={{ fontSize: 32, marginBottom: 14 }}>📐</p>
              <p style={{ fontSize: 15, marginBottom: 8 }}>No designs yet.</p>
              <p style={{ fontSize: 13 }}>Click <strong style={{ color: C.green }}>+ New Design</strong> to upload your first CAD file.</p>
            </div>
          )}
          {designs.map(design => {
            const meta         = STATUS_META[design.status] || STATUS_META.draft;
            const activeCommits = (design.manufacturer_commitments || []).filter(c => c.status === "active");
            const canPublish   = activeCommits.length >= MIN_COMMITMENTS_TO_PUBLISH && design.status === "committed";

            return (
              <div key={design.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 20
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>

                  {/* Left: info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{
                        background: meta.color + "22", border: `1px solid ${meta.color}`,
                        borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, color: meta.color
                      }}>
                        {meta.label}
                      </span>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: C.t1 }}>{design.title}</h3>
                    </div>

                    <p style={{ fontSize: 22, fontWeight: 800, color: C.green, marginBottom: 8 }}>
                      ₹{Number(design.base_price).toLocaleString("en-IN")}
                    </p>

                    {/* Machine / material tags */}
                    {((design.required_machines || []).length > 0 || (design.required_materials || []).length > 0) && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                        {(design.required_machines || []).map(m => (
                          <span key={m} style={{
                            background: C.blue + "22", border: `1px solid ${C.blue}55`,
                            borderRadius: 4, padding: "2px 8px", fontSize: 11, color: C.blue
                          }}>{m}</span>
                        ))}
                        {(design.required_materials || []).map(m => (
                          <span key={m} style={{
                            background: C.t3 + "22", border: `1px solid ${C.border}`,
                            borderRadius: 4, padding: "2px 8px", fontSize: 11, color: C.t3
                          }}>{m}</span>
                        ))}
                      </div>
                    )}

                    {/* Commits progress */}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: C.t3 }}>Commitments:</span>
                      {activeCommits.length === 0 && <span style={{ fontSize: 12, color: C.t3 }}>None yet</span>}
                      {activeCommits.map((c, i) => (
                        <span key={i} style={{
                          background: C.green + "18", border: `1px solid ${C.green}44`,
                          borderRadius: 4, padding: "2px 8px", fontSize: 11, color: C.green
                        }}>
                          {c.region_city} — ₹{Number(c.committed_price).toLocaleString("en-IN")}
                        </span>
                      ))}
                    </div>

                    {design.status === "seeking" && activeCommits.length < MIN_COMMITMENTS_TO_PUBLISH && (
                      <p style={{ fontSize: 12, color: C.gold }}>
                        Need {MIN_COMMITMENTS_TO_PUBLISH - activeCommits.length} more commitment
                        {MIN_COMMITMENTS_TO_PUBLISH - activeCommits.length === 1 ? "" : "s"} to unlock publishing.
                      </p>
                    )}
                    {canPublish && (
                      <p style={{ fontSize: 12, color: C.green }}>
                        ✓ Enough commitments! Ready to publish to the live shop.
                      </p>
                    )}

                    {/* CAD file indicator */}
                    {design.cad_file_url && (
                      <p style={{ fontSize: 11, color: C.t3, marginTop: 6 }}>
                        📎 CAD file attached
                      </p>
                    )}

                    <div style={{
                      marginTop: 14,
                      borderTop: `1px solid ${C.border}`,
                      paddingTop: 12,
                    }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: C.t2, marginBottom: 6 }}>
                        Product & reference photos
                      </p>
                      <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
                        Upload high-resolution JPEG, PNG, or WebP. Files go to your secure folder; buyers and makers see signed full-quality links.
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        id={`gal-${design.id}`}
                        style={{ display: "none" }}
                        onChange={e => {
                          handleGalleryFiles(design, e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        disabled={galleryBusy === design.id}
                        onClick={() => document.getElementById(`gal-${design.id}`)?.click()}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 8,
                          border: `1px solid ${C.green}66`,
                          background: C.green + "18",
                          color: C.green,
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: galleryBusy === design.id ? "wait" : "pointer",
                        }}
                      >
                        {galleryBusy === design.id ? "Uploading…" : "Add images"}
                      </button>
                      {(design.gallery_image_urls || []).length > 0 && (
                        <p style={{ fontSize: 11, color: C.t3, marginTop: 8 }}>
                          {(design.gallery_image_urls || []).length} image(s) saved
                        </p>
                      )}
                      <div style={{ marginTop: 12 }}>
                        <DesignMediaGallery designId={design.id} title={design.title} storefront />
                      </div>
                    </div>
                  </div>

                  {/* Right: action */}
                  <div style={{ marginLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                    {design.status === "draft" && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                        <button onClick={() => handleSeek(design.id)}
                          style={{
                            padding: "9px 18px", borderRadius: 8, border: "none",
                            background: C.gold, color: "#060810", fontWeight: 700, fontSize: 13,
                            cursor: "pointer", whiteSpace: "nowrap"
                          }}>
                          Seek Commitments
                        </button>
                        <p style={{ fontSize: 10, color: C.t3, maxWidth: 260, textAlign: "right", lineHeight: 1.45, margin: 0 }}>
                          Manufacturers only see this on their Commitment Board after you seek. Their workshop must list every machine & material tag above.
                        </p>
                      </div>
                    )}
                    {design.status === "seeking" && (
                      <span style={{ fontSize: 12, color: C.t3, fontStyle: "italic", whiteSpace: "nowrap" }}>
                        Waiting for manufacturers…
                      </span>
                    )}
                    {canPublish && (
                      <button onClick={() => handlePublish(design.id)}
                        style={{
                          padding: "9px 18px", borderRadius: 8, border: "none",
                          background: C.green, color: "#060810", fontWeight: 700, fontSize: 13,
                          cursor: "pointer", whiteSpace: "nowrap"
                        }}>
                        Publish to Shop
                      </button>
                    )}
                    {design.status === "live" && (
                      <span style={{ fontSize: 12, color: C.green, fontWeight: 700, whiteSpace: "nowrap" }}>
                        🟢 Live
                      </span>
                    )}
                    {design.status === "committed" && !canPublish && (
                      <span style={{ fontSize: 12, color: C.blue, whiteSpace: "nowrap" }}>
                        Awaiting approval…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── VARIANTS TAB ──────────────────────────────────────────── */}
      {!loading && tab === "variants" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {variants.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
              <p>No pending regional variants.</p>
            </div>
          )}
          {variants.map(v => (
            <div key={v.id} style={{
              background: C.card, border: `1px solid ${C.gold}55`,
              borderRadius: 10, padding: 20
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <p style={{ fontSize: 12, color: C.t3, marginBottom: 4 }}>REGIONAL PRICE VARIANT</p>
                  <p style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginBottom: 4 }}>
                    {v.region_city}
                    {v.region_state ? `, ${v.region_state}` : ""}
                  </p>
                  <p style={{ fontSize: 11, color: C.t3, marginBottom: 8 }}>
                    Workshop ref · {(v.manufacturer_id || "").slice(0, 8)}…
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
                  <button onClick={() => handleVariantReview(v.id, false)}
                    style={{
                      padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.red}`,
                      background: "none", color: C.red, fontWeight: 600, fontSize: 13, cursor: "pointer"
                    }}>
                    Reject
                  </button>
                  <button onClick={() => handleVariantReview(v.id, true)}
                    style={{
                      padding: "8px 16px", borderRadius: 8, border: "none",
                      background: C.green, color: "#060810", fontWeight: 700, fontSize: 13, cursor: "pointer"
                    }}>
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── NEW DESIGN FORM MODAL ──────────────────────────────────── */}
      {showForm && (
        <NewDesignModal
          designerId={designerId}
          onCreated={() => handleDesignCreated()}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// NEW DESIGN MODAL
// Full-screen slide-in panel. The designer fills in metadata,
// uploads CAD + preview files, then submits to the backend.
// ════════════════════════════════════════════════════════════════

function NewDesignModal({ designerId, onCreated, onClose }) {
  const [form, setForm] = useState({
    title: "", description: "", category: "",
    base_price: "", royalty_percent: "15",
  });
  const [machines,  setMachines]  = useState([]);
  const [materials, setMaterials] = useState([]);
  const [cadFile,   setCadFile]   = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [cadProgress, setCadProgress]     = useState("");
  const [previewProgress, setPreviewProgress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const cadRef     = useRef();
  const previewRef = useRef();

  const previewObjectUrl = useMemo(() => {
    if (!previewFile) return null;
    return URL.createObjectURL(previewFile);
  }, [previewFile]);

  useEffect(() => {
    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    };
  }, [previewObjectUrl]);

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  function toggleMachine(m) {
    setMachines(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }
  function toggleMaterial(m) {
    setMaterials(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }

  // Upload a single file to Supabase Storage, return the path
  async function uploadFile(file, bucket, folder) {
    const ext  = file.name.split(".").pop();
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600", upsert: false,
    });
    if (error) throw new Error(error.message);
    return path;   // store path, not public URL, so backend can sign it
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.title.trim())                      return setError("Title is required.");
    if (!form.base_price || Number(form.base_price) <= 0) return setError("Enter a valid base price.");
    if (machines.length === 0)                   return setError("Select at least one machine type.");
    if (materials.length === 0)                  return setError("Select at least one material.");
    if (!cadFile)                                return setError("Please upload the CAD file.");

    setSubmitting(true);

    // Track paths so we can roll back Storage uploads if the backend call fails.
    let cadPath    = null;
    let previewPath = null;
    let succeeded  = false;

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.id) {
        setError("You must be signed in to upload files.");
        setSubmitting(false);
        return;
      }
      const storagePrefix = authUser.id; // must match auth.uid() for Storage RLS

      // 1. Upload CAD file → private bucket, store path
      setCadProgress("Uploading CAD file…");
      cadPath = await uploadFile(cadFile, "cad-files", storagePrefix);
      setCadProgress("✓ CAD file uploaded");

      // 2. Upload preview image → public bucket, store public URL
      let previewUrl = "";
      if (previewFile) {
        setPreviewProgress("Uploading preview image…");
        previewPath = await uploadFile(previewFile, "design-previews", storagePrefix);
        const { data: pub } = supabase.storage.from("design-previews").getPublicUrl(previewPath);
        previewUrl = pub.publicUrl;
        setPreviewProgress("✓ Preview uploaded");
      }

      // 3. Create design in backend (JWT attached automatically via api.ts interceptor)
      const { data } = await createDesign({
        designer_id:        designerId,
        title:              form.title.trim(),
        description:        form.description.trim(),
        category:           form.category.trim(),
        base_price:         parseFloat(form.base_price),
        royalty_percent:    parseFloat(form.royalty_percent) || 15,
        required_machines:  machines,
        required_materials: materials,
        cad_file_url:       cadPath,
        preview_image_url:  previewUrl,
      });

      succeeded = true;
      onCreated();
    } catch (e) {
      // Remove any already-uploaded files to prevent orphans in Storage.
      if (!succeeded) {
        const toRemove = [
          cadPath     ? { bucket: "cad-files",       path: cadPath }     : null,
          previewPath ? { bucket: "design-previews",  path: previewPath } : null,
        ].filter(Boolean);
        for (const { bucket, path } of toRemove) {
          supabase.storage.from(bucket).remove([path]).catch(() => {});
        }
        setCadProgress("");
        setPreviewProgress("");
      }
      setError(e?.response?.data?.detail || e?.message || "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "#00000090", zIndex: 200,
        display: "flex", justifyContent: "flex-end"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(560px, 100vw)", background: C.card, height: "100%",
          overflowY: "auto", padding: "28px 28px 48px",
          borderLeft: `1px solid ${C.border}`, fontFamily: "Inter, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.t1 }}>New Design</h2>
            <p style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>Upload a CAD file and set your pricing</p>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: C.t3, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        {error && (
          <div style={{
            background: C.red + "18", border: `1px solid ${C.red}`, borderRadius: 8,
            padding: "12px 16px", marginBottom: 20, fontSize: 13, color: C.red
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>

          {/* Title */}
          <Field label="Design Title *">
            <input value={form.title} onChange={set("title")}
              placeholder="e.g. CNC Aluminium Bracket – 50mm"
              style={inputStyle} />
          </Field>

          {/* Description */}
          <Field label="Description">
            <textarea value={form.description} onChange={set("description")}
              placeholder="Specs, use case, tolerances, dimensions…"
              rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </Field>

          {/* Category */}
          <Field label="Category">
            <input value={form.category} onChange={set("category")}
              placeholder="e.g. Brackets, Gears, Enclosures"
              style={inputStyle} />
          </Field>

          {/* Base Price + Royalty — side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
            <Field label="Base Price (₹) *" noMargin>
              <input type="number" value={form.base_price} onChange={set("base_price")}
                placeholder="0" min="1"
                style={inputStyle} />
            </Field>
            <Field label="Royalty %" noMargin>
              <input type="number" value={form.royalty_percent} onChange={set("royalty_percent")}
                placeholder="15" min="0" max="50"
                style={inputStyle} />
            </Field>
          </div>

          {/* Machine Types */}
          <Field label="Required Machine Types *">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {MACHINE_OPTIONS.map(m => {
                const on = machines.includes(m);
                return (
                  <button key={m} type="button" onClick={() => toggleMachine(m)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${on ? C.blue : C.border}`,
                      background: on ? C.blue + "22" : C.card2,
                      color: on ? C.blue : C.t3, fontWeight: on ? 700 : 400,
                    }}>
                    {m}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Materials */}
          <Field label="Required Materials *">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {MATERIAL_OPTIONS.map(m => {
                const on = materials.includes(m);
                return (
                  <button key={m} type="button" onClick={() => toggleMaterial(m)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${on ? C.green : C.border}`,
                      background: on ? C.green + "22" : C.card2,
                      color: on ? C.green : C.t3, fontWeight: on ? 700 : 400,
                    }}>
                    {m}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* CAD File Upload */}
          <Field label="CAD File * (.stl, .step, .stp, .dxf, .obj, .3mf)">
            <input ref={cadRef} type="file"
              accept=".stl,.step,.stp,.dxf,.obj,.3mf,.iges,.igs,.f3d,.sat"
              onChange={e => { setCadFile(e.target.files[0] || null); setCadProgress(""); }}
              style={{ display: "none" }} />
            <div
              onClick={() => cadRef.current?.click()}
              style={{
                border: `2px dashed ${cadFile ? C.green : C.border}`,
                borderRadius: 10, padding: "20px 16px", cursor: "pointer",
                textAlign: "center", background: C.card2,
                transition: "border-color .2s"
              }}
            >
              {cadFile ? (
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: C.green }}>📎 {cadFile.name}</p>
                  <p style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>
                    {(cadFile.size / 1024).toFixed(0)} KB — click to replace
                  </p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>📂</p>
                  <p style={{ fontSize: 13, color: C.t2 }}>Click to select CAD file</p>
                  <p style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>STL, STEP, DXF, OBJ, 3MF, IGES</p>
                </div>
              )}
            </div>
            {cadProgress && (
              <p style={{ fontSize: 11, color: cadProgress.startsWith("✓") ? C.green : C.gold, marginTop: 6 }}>
                {cadProgress}
              </p>
            )}
          </Field>

          {/* Preview Image Upload */}
          <Field label="Preview Image (optional — .jpg, .png, .webp)">
            <input ref={previewRef} type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={e => { setPreviewFile(e.target.files[0] || null); setPreviewProgress(""); }}
              style={{ display: "none" }} />
            <div
              onClick={() => previewRef.current?.click()}
              style={{
                border: `2px dashed ${previewFile ? C.purple : C.border}`,
                borderRadius: 12, padding: previewObjectUrl ? 12 : "16px", cursor: "pointer",
                textAlign: "center", background: C.card2,
                transition: "border-color .2s",
                overflow: "hidden",
              }}
            >
              {previewObjectUrl ? (
                <div>
                  <img
                    src={previewObjectUrl}
                    alt="Listing preview"
                    style={{
                      width: "100%",
                      maxHeight: 280,
                      objectFit: "contain",
                      borderRadius: 8,
                      background: "#060910",
                      display: "block",
                      margin: "0 auto 10px",
                    }}
                  />
                  <p style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 4 }}>
                    {previewFile?.name}
                  </p>
                  <p style={{ fontSize: 11, color: C.t3 }}>
                    {(previewFile?.size / 1024).toFixed(0)} KB · click to replace
                  </p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>🖼</p>
                  <p style={{ fontSize: 13, color: C.t2 }}>Click to add your shop listing photo</p>
                  <p style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>Shown in catalog — use a clear product shot</p>
                </div>
              )}
            </div>
            {previewProgress && (
              <p style={{ fontSize: 11, color: previewProgress.startsWith("✓") ? C.green : C.gold, marginTop: 6 }}>
                {previewProgress}
              </p>
            )}
          </Field>

          {/* Info box */}
          <div style={{
            background: C.card2, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "12px 16px", marginBottom: 24
          }}>
            <p style={{ fontSize: 12, color: C.t3, lineHeight: 1.6 }}>
              The design starts as a <strong style={{ color: C.t2 }}>Draft</strong> — invisible to customers.
              After creation, click <strong style={{ color: C.gold }}>Seek Commitments</strong> to alert
              manufacturers. Once at least one factory commits, you can <strong style={{ color: C.green }}>Publish to Shop</strong>.
            </p>
          </div>

          {/* Submit */}
          <button type="submit" disabled={submitting}
            style={{
              width: "100%", padding: "13px 0", borderRadius: 8, border: "none",
              background: submitting ? C.t3 : C.green, color: "#060810",
              fontWeight: 700, fontSize: 15, cursor: submitting ? "not-allowed" : "pointer"
            }}>
            {submitting ? "Creating Design…" : "Create Design"}
          </button>

          <button type="button" onClick={onClose}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
              background: "none", color: C.t3, fontSize: 13, cursor: "pointer", marginTop: 10
            }}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────

function Field({ label, children, noMargin = false }) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 20 }}>
      <label style={{
        fontSize: 11, fontWeight: 700, color: C.t3,
        textTransform: "uppercase", letterSpacing: ".06em",
        display: "block", marginBottom: 8
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  background: "#111826", border: `1px solid #1A2230`, borderRadius: 8,
  padding: "10px 14px", color: "#F4F6FC", fontSize: 14, width: "100%",
  outline: "none", boxSizing: "border-box",
};
