// ════════════════════════════════════════════════════════════════
// DesignMediaGallery.tsx — Full-quality preview, designer gallery,
// and manufacturer showcase images (backend-signed URLs; no resizing).
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useState } from "react";
import { getDesignMedia } from "../lib/api";

const C = {
  border: "#1A2230",
  card2: "#111826",
  green: "#00E5A0",
  t1: "#F4F6FC",
  t3: "#5A6A80",
};

type Img = { url: string; filename: string; sourceBucket?: string };

export default function DesignMediaGallery({
  designId,
  title,
  /** When set (e.g. manufacturer row), only that workshop’s showcase strip is shown (still loads designer gallery + preview). */
  onlyCommitmentId,
  /** Card chrome for modals (only applied when there is at least one image). */
  panel,
}: {
  designId: string;
  title?: string;
  onlyCommitmentId?: string;
  panel?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Img | null>(null);
  const [gallery, setGallery] = useState<Img[]>([]);
  const [showcases, setShowcases] = useState<
    { commitment_id: string; images: Img[] }[]
  >([]);

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

  function tile(img: Img, key: string) {
    return (
      <div
        key={key}
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: `1px solid ${C.border}`,
          background: C.card2,
        }}
      >
        <a href={img.url} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img
            src={img.url}
            alt={title || ""}
            style={{
              width: "100%",
              height: 180,
              objectFit: "contain",
              display: "block",
              background: "#080c14",
            }}
          />
        </a>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 10, color: C.t3, overflow: "hidden", textOverflow: "ellipsis" }}>
            {img.filename}
          </span>
          <a
            href={img.url}
            download={img.filename}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 700, color: C.green, flexShrink: 0 }}
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  const gridStyle = {
    display: "grid" as const,
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: 12,
  };

  const inner = (
    <div style={{ marginBottom: panel ? 0 : 20 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: C.t1, marginBottom: 12 }}>
        Photos {title ? `· ${title}` : ""}
      </p>

      {preview?.url ? (
        <div style={{ marginBottom: 18 }}>
          <p style={subLabel}>Shop listing image · full resolution</p>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
            Same listing preview as the catalog (design-previews). Open or download below.
          </p>
          <div style={gridStyle}>{tile(preview, "pv")}</div>
        </div>
      ) : null}

      {gallery.length > 0 ? (
        <div style={{ marginBottom: 18 }}>
          <p style={subLabel}>Designer product photos · full resolution</p>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
            Extra shots from the designer (product-images). Same quality as makers and designers see.
          </p>
          <div style={gridStyle}>{gallery.map((g, i) => tile(g, `g-${i}`))}</div>
        </div>
      ) : null}

      {showcases.some((s) => (s.images?.length || 0) > 0) ? (
        <div style={{ marginBottom: 8 }}>
          <p style={subLabel}>Workshop photos · full resolution</p>
          <p style={{ fontSize: 11, color: C.t3, marginBottom: 10, lineHeight: 1.45 }}>
            Photos from manufacturers who committed on this design (product-images).
          </p>
          <div style={gridStyle}>
            {showcases.flatMap((s, si) =>
              (s.images || []).map((im, ii) => tile(im, `s-${si}-${ii}`))
            )}
          </div>
        </div>
      ) : null}

      <p style={{ fontSize: 10, color: C.t3, marginTop: 10, lineHeight: 1.45 }}>
        Files open in a new tab; use Download to save. Signed links expire after about two hours — refresh if needed.
      </p>
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
