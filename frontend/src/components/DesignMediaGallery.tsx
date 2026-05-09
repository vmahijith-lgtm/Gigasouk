// ════════════════════════════════════════════════════════════════
// DesignMediaGallery.tsx — Full-quality preview, designer gallery,
// and manufacturer showcase images (backend-signed URLs).
// storefront: large hero + crisp thumbnails, lightbox, downloads.
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getDesignMedia } from "../lib/api";

const C = {
  border: "#1A2230",
  card2: "#111826",
  green: "#00E5A0",
  t1: "#F4F6FC",
  t3: "#5A6A80",
};

type Img = { url: string; filename: string; sourceBucket?: string };

async function downloadImageFile(url: string, filename: string): Promise<void> {
  const safeName = filename.replace(/[^\w.\- ]/g, "_") || "image.jpg";
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function DesignMediaGallery({
  designId,
  title,
  onlyCommitmentId,
  panel,
  emphasizePhotos,
  /** Larger hero, sharp thumbnails (cover), lightbox — shop / customer / designer */
  storefront = false,
}: {
  designId: string;
  title?: string;
  onlyCommitmentId?: string;
  panel?: boolean;
  emphasizePhotos?: boolean;
  storefront?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Img | null>(null);
  const [gallery, setGallery] = useState<Img[]>([]);
  const [showcases, setShowcases] = useState<{ commitment_id: string; images: Img[] }[]>([]);
  /** Index into orderedImages; null = closed */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  /** In-panel single-slide viewer index (used across all pages). */
  const [activeIndex, setActiveIndex] = useState(0);

  const sf = storefront || emphasizePhotos;

  const orderedImages = useMemo(() => {
    const list: Img[] = [];
    if (preview?.url) list.push(preview);
    list.push(...gallery);
    for (const s of showcases) list.push(...(s.images || []));
    return list;
  }, [preview, gallery, showcases]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const max = orderedImages.length - 1;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowLeft") setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
      else if (e.key === "ArrowRight")
        setLightboxIndex((i) => (i !== null && i < max ? i + 1 : i));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, orderedImages.length]);

  useEffect(() => {
    document.body.style.overflow = lightboxIndex !== null ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightboxIndex]);

  const subLabel = {
    fontSize: 11,
    fontWeight: 700 as const,
    color: C.t3,
    marginBottom: 8,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const { data } = await getDesignMedia(designId);
        if (cancelled) return;
        const pv = data?.preview;
        setPreview(
          pv?.url
            ? {
                url: pv.url,
                filename: pv.filename || "preview",
                sourceBucket: (pv as { source_bucket?: string }).source_bucket,
              }
            : null
        );
        setGallery(
          (data?.gallery || []).map(
            (g: { url: string; filename?: string; source_bucket?: string }) => ({
              url: g.url,
              filename: g.filename || "image",
              sourceBucket: g.source_bucket,
            })
          )
        );
        let blocks = data?.commitment_showcases || [];
        if (onlyCommitmentId) {
          blocks = blocks.filter(
            (b: { commitment_id?: string }) => b.commitment_id === onlyCommitmentId
          );
        }
        setShowcases(
          blocks.map(
            (b: {
              commitment_id: string;
              images?: Array<{ url: string; filename?: string; source_bucket?: string }>;
            }) => ({
              commitment_id: b.commitment_id,
              images: (b.images || []).map((im) => ({
                url: im.url,
                filename: im.filename || "image",
                sourceBucket: im.source_bucket,
              })),
            })
          )
        );
      } catch (e: unknown) {
        const detail =
          e && typeof e === "object" && "response" in e
            ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : undefined;
        if (!cancelled) setErr(detail || "Could not load images.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [designId, onlyCommitmentId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [designId, onlyCommitmentId]);

  const openLightbox = useCallback(
    (img: Img) => {
      const idx = orderedImages.findIndex((x) => x.url === img.url && x.filename === img.filename);
      setLightboxIndex(idx >= 0 ? idx : 0);
    },
    [orderedImages]
  );

  useEffect(() => {
    if (lightboxIndex === null) return;
    if (orderedImages.length === 0) setLightboxIndex(null);
    else if (lightboxIndex >= orderedImages.length)
      setLightboxIndex(orderedImages.length - 1);
  }, [lightboxIndex, orderedImages.length]);

  useEffect(() => {
    if (orderedImages.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= orderedImages.length) {
      setActiveIndex(orderedImages.length - 1);
    }
  }, [activeIndex, orderedImages.length]);

  if (loading) {
    return (
      <p style={{ fontSize: 13, color: C.t3, marginBottom: 16 }}>Loading images…</p>
    );
  }
  if (err) {
    return (
      <p style={{ fontSize: 13, color: "#F87171", marginBottom: 16 }}>{err}</p>
    );
  }

  const hasAny =
    (preview?.url && preview.url.length > 0) ||
    gallery.length > 0 ||
    showcases.some((s: { images?: Img[] }) => (s.images?.length || 0) > 0);

  if (!hasAny) {
    return null;
  }

  const copy = sf
    ? {
        listingTitle: "Main product photo",
        listingHelp:
          "What you see in the catalog. Tap to enlarge — download keeps full resolution.",
        featuredTitle: "Featured product photo",
        featuredHelp:
          "Primary angle from the designer when no separate listing thumbnail exists.",
        designerTitle: "More views from the designer",
        designerHelp: "Extra angles and detail shots from the creator.",
        workshopTitle: "Photos from makers",
        workshopHelp:
          "Certified workshops building this design may share facility or sample shots.",
        expiryHint:
          "Image links refresh every couple of hours — reload if something stops loading.",
        panelHeading: "All photos",
      }
    : {
        listingTitle: "Shop listing image · full resolution",
        listingHelp:
          "Same preview as the catalog. Click to enlarge; download saves the full file.",
        featuredTitle: "Featured image · full resolution",
        featuredHelp: "",
        designerTitle: "Designer product photos · full resolution",
        designerHelp: "Extra shots from the designer. Click any photo to view large.",
        workshopTitle: "Workshop photos · full resolution",
        workshopHelp: "Photos from manufacturers who committed on this design.",
        expiryHint:
          "Signed links expire after about two hours — refresh the page if images fail to load.",
        panelHeading: "Photos",
      };

  const showListingHero = !!(preview?.url);
  const showGalleryHeroFallback = sf && !showListingHero && gallery.length > 0;
  const galleryGridItems = showGalleryHeroFallback ? gallery.slice(1) : gallery;

  const thumbMin = sf ? "minmax(120px, 1fr)" : "minmax(140px, 1fr)";
  const thumbH = emphasizePhotos ? 240 : sf ? 200 : 180;
  const gridStyle = {
    display: "grid" as const,
    gridTemplateColumns: sf
      ? `repeat(auto-fill, ${thumbMin})`
      : emphasizePhotos
        ? "repeat(auto-fill, minmax(200px, 1fr))"
        : "repeat(auto-fill, minmax(160px, 1fr))",
    gap: sf ? 14 : 12,
  };

  function tile(img: Img, key: string) {
    return (
      <div
        key={key}
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${C.border}`,
          background: C.card2,
          boxShadow: sf ? "0 8px 24px rgba(0,0,0,.35)" : undefined,
          transition: "transform .15s ease, box-shadow .15s ease",
        }}
      >
        <button
          type="button"
          onClick={() => openLightbox(img)}
          style={{
            display: "block",
            width: "100%",
            padding: 0,
            border: "none",
            cursor: "zoom-in",
            background: "#080c14",
          }}
          aria-label={`Enlarge ${img.filename}`}
        >
          <img
            src={img.url}
            alt={title || img.filename}
            style={{
              width: "100%",
              height: thumbH,
              objectFit: sf ? "cover" : "contain",
              display: "block",
            }}
          />
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            gap: 8,
            background: "#0a0e16",
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: C.t3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
            title={img.filename}
          >
            {img.filename}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadImageFile(img.url, img.filename);
            }}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: C.green,
              flexShrink: 0,
              background: "transparent",
              border: `1px solid ${C.green}44`,
              borderRadius: 8,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            Download
          </button>
        </div>
      </div>
    );
  }

  /** Listing hero — full width, sharp and clickable */
  function heroTile(img: Img, key: string) {
    const maxH = sf ? 420 : 320;
    return (
      <div
        key={key}
        style={{
          marginBottom: 18,
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${C.border}`,
          background: "#060910",
          boxShadow: sf ? "0 12px 40px rgba(0,0,0,.45)" : undefined,
        }}
      >
        <button
          type="button"
          onClick={() => openLightbox(img)}
          style={{
            display: "block",
            width: "100%",
            padding: 0,
            border: "none",
            cursor: "zoom-in",
            background: "#080c14",
          }}
          aria-label="Enlarge product photo"
        >
          <img
            src={img.url}
            alt={title || "Listing"}
            style={{
              width: "100%",
              maxHeight: maxH,
              height: "auto",
              objectFit: "contain",
              display: "block",
            }}
          />
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 14px",
            gap: 10,
            background: "#0c1018",
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <span style={{ fontSize: 12, color: C.t3 }}>{img.filename}</span>
          <button
            type="button"
            onClick={() => downloadImageFile(img.url, img.filename)}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.green,
              background: `${C.green}18`,
              border: `1px solid ${C.green}55`,
              borderRadius: 8,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            Download
          </button>
        </div>
      </div>
    );
  }

  const lightboxImg =
    lightboxIndex !== null ? orderedImages[lightboxIndex] ?? null : null;
  const lightboxTotal = orderedImages.length;
  const activeImg = orderedImages[activeIndex] ?? null;
  const canSlide = lightboxTotal > 1;

  const moveSlide = useCallback(
    (delta: number) => {
      if (!orderedImages.length) return;
      setActiveIndex((i) => {
        const next = i + delta;
        if (next < 0) return 0;
        if (next >= orderedImages.length) return orderedImages.length - 1;
        return next;
      });
    },
    [orderedImages.length]
  );

  const inner = (
    <div style={{ marginBottom: panel ? 0 : 20 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
        {copy.panelHeading} {title ? `· ${title}` : ""}
      </p>

      {activeImg ? (
        <div
          style={{
            marginBottom: 18,
            borderRadius: 16,
            overflow: "hidden",
            border: `1px solid ${C.border}`,
            background: "#070b12",
            boxShadow: sf ? "0 12px 32px rgba(0,0,0,.35)" : undefined,
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              background: "#0c1018",
            }}
          >
            <span style={{ fontSize: 11, color: C.t3 }}>
              {lightboxTotal} image{lightboxTotal === 1 ? "" : "s"} · slide view
            </span>
            <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>
              {activeIndex + 1} / {lightboxTotal}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: canSlide ? "56px 1fr 56px" : "1fr",
              alignItems: "center",
              gap: 0,
            }}
          >
            {canSlide ? (
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => moveSlide(-1)}
                disabled={activeIndex <= 0}
                style={{
                  height: "100%",
                  minHeight: sf ? 360 : 300,
                  border: "none",
                  borderRight: `1px solid ${C.border}`,
                  background: "#111826",
                  color: activeIndex > 0 ? C.t1 : C.t3,
                  fontSize: 18,
                  fontWeight: 800,
                  cursor: activeIndex > 0 ? "pointer" : "not-allowed",
                }}
              >
                ‹
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openLightbox(activeImg)}
              style={{
                border: "none",
                padding: 0,
                margin: 0,
                background: "#070b12",
                cursor: "zoom-in",
              }}
              aria-label="Open image viewer"
            >
              <img
                src={activeImg.url}
                alt={activeImg.filename}
                style={{
                  width: "100%",
                  maxHeight: sf ? 420 : 340,
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </button>

            {canSlide ? (
              <button
                type="button"
                aria-label="Next image"
                onClick={() => moveSlide(1)}
                disabled={activeIndex >= lightboxTotal - 1}
                style={{
                  height: "100%",
                  minHeight: sf ? 360 : 300,
                  border: "none",
                  borderLeft: `1px solid ${C.border}`,
                  background: "#111826",
                  color: activeIndex < lightboxTotal - 1 ? C.t1 : C.t3,
                  fontSize: 18,
                  fontWeight: 800,
                  cursor: activeIndex < lightboxTotal - 1 ? "pointer" : "not-allowed",
                }}
              >
                ›
              </button>
            ) : null}
          </div>

          {canSlide ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                padding: "10px 12px",
                borderTop: `1px solid ${C.border}`,
                background: "#0c1018",
              }}
            >
              {orderedImages.map((im, idx) => (
                <button
                  key={`${im.url}-${idx}`}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  style={{
                    flex: "0 0 auto",
                    width: 64,
                    height: 64,
                    padding: 0,
                    borderRadius: 8,
                    overflow: "hidden",
                    border: `1px solid ${idx === activeIndex ? C.green : C.border}`,
                    background: "#111826",
                    cursor: "pointer",
                  }}
                  aria-label={`Go to image ${idx + 1}`}
                >
                  <img
                    src={im.url}
                    alt={im.filename}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showListingHero ? (
        <div style={{ marginBottom: 18 }}>
          <p style={subLabel}>{copy.listingTitle}</p>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
            {copy.listingHelp}
          </p>
          {heroTile(preview!, "pv")}
        </div>
      ) : null}

      {showGalleryHeroFallback && gallery[0] ? (
        <div style={{ marginBottom: 18 }}>
          <p style={subLabel}>{copy.featuredTitle}</p>
          {copy.featuredHelp ? (
            <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
              {copy.featuredHelp}
            </p>
          ) : null}
          {heroTile(gallery[0], "g-hero")}
        </div>
      ) : null}

      {galleryGridItems.length > 0 ? (
        <div style={{ marginBottom: 18 }}>
          <p style={subLabel}>{copy.designerTitle}</p>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
            {copy.designerHelp}
          </p>
          <div style={gridStyle}>
            {galleryGridItems.map((g, i) => tile(g, `g-${i}`))}
          </div>
        </div>
      ) : null}

      {showcases.some((s) => (s.images?.length || 0) > 0) ? (
        <div style={{ marginBottom: 8 }}>
          <p style={subLabel}>{copy.workshopTitle}</p>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
            {copy.workshopHelp}
          </p>
          <div style={gridStyle}>
            {showcases.flatMap((s, si) =>
              (s.images || []).map((im, ii) => tile(im, `s-${si}-${ii}`))
            )}
          </div>
        </div>
      ) : null}

      <p style={{ fontSize: 10, color: C.t3, marginTop: 10, lineHeight: 1.45 }}>
        {copy.expiryHint}
      </p>

      {lightboxImg ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightboxIndex(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            background: "rgba(0,0,0,.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "min(96vw, 1200px)",
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                justifyContent: "center",
              }}
            >
              {lightboxTotal > 1 ? (
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() =>
                    setLightboxIndex((i) =>
                      i !== null && i > 0 ? i - 1 : i
                    )
                  }
                  disabled={lightboxIndex === null || lightboxIndex <= 0}
                  style={{
                    flexShrink: 0,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: "#1a2230",
                    color: lightboxIndex !== null && lightboxIndex > 0 ? C.t1 : C.t3,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor:
                      lightboxIndex !== null && lightboxIndex > 0
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  ←
                </button>
              ) : null}
              <img
                src={lightboxImg.url}
                alt={lightboxImg.filename}
                style={{
                  flex: 1,
                  maxWidth: "min(100%, 920px)",
                  maxHeight: "min(78vh, 900px)",
                  width: "auto",
                  height: "auto",
                  objectFit: "contain",
                  borderRadius: 8,
                  boxShadow: "0 20px 60px rgba(0,0,0,.6)",
                }}
              />
              {lightboxTotal > 1 ? (
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() =>
                    setLightboxIndex((i) =>
                      i !== null && i < lightboxTotal - 1 ? i + 1 : i
                    )
                  }
                  disabled={
                    lightboxIndex === null || lightboxIndex >= lightboxTotal - 1
                  }
                  style={{
                    flexShrink: 0,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    background: "#1a2230",
                    color:
                      lightboxIndex !== null && lightboxIndex < lightboxTotal - 1
                        ? C.t1
                        : C.t3,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor:
                      lightboxIndex !== null && lightboxIndex < lightboxTotal - 1
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  →
                </button>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {lightboxTotal > 1 ? (
                <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>
                  {(lightboxIndex ?? 0) + 1} / {lightboxTotal}
                </span>
              ) : null}
              <span style={{ color: "#94a3b8", fontSize: 13 }}>{lightboxImg.filename}</span>
              <button
                type="button"
                onClick={() =>
                  downloadImageFile(lightboxImg.url, lightboxImg.filename)
                }
                style={{
                  padding: "8px 18px",
                  borderRadius: 10,
                  border: `1px solid ${C.green}`,
                  background: `${C.green}22`,
                  color: C.green,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Download full image
              </button>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: "#1a2230",
                  color: C.t1,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
              {lightboxTotal > 1 ? "← → arrow keys · " : ""}
              Esc to close
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (panel) {
    return (
      <div
        style={{
          background: "#0C1018",
          borderRadius: 16,
          padding: 20,
          border: `1px solid ${C.border}`,
          marginBottom: 12,
        }}
      >
        {inner}
      </div>
    );
  }

  return inner;
}
