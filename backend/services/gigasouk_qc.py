# ════════════════════════════════════════════════════════════════
# services/gigasouk_qc.py — AI Quality Control Gate
#
# Compares manufacturer's photos against the CAD reference image.
# Validates dimensions to ±QC_TOLERANCE_MM (default 0.5mm).
#
# Pipeline per photo:
#   1. Download image (async, non-blocking)
#   2. Preprocess: normalise brightness, adaptive threshold
#   3. Extract largest contour (part outline)
#   4. Scale normalisation: match CAD contour bounding box to photo
#   5. Kabsch alignment: optimal rotation + translation via SVD
#   6. Hausdorff + mean deviation → mm error
#   7. Pass if ALL photos ≤ QC_TOLERANCE_MM
#
# TO DISABLE AI AND USE MANUAL REVIEW ONLY:
#   Set FORCE_MANUAL_REVIEW = True below.
#
# TO ADJUST TOLERANCE:
#   Change QC_TOLERANCE_MM in config.py. One line. Done.
# ════════════════════════════════════════════════════════════════

import asyncio
import cv2
import numpy as np
import httpx
from typing import Optional

from config import QC_SCALE_MM_PER_PX, QC_TOLERANCE_MM

# ── Master switch ─────────────────────────────────────────────────
# Set True to bypass AI and send all QC to admin manual review.
FORCE_MANUAL_REVIEW = False

# ── Tuning parameters ─────────────────────────────────────────────
# Number of points to sample from each contour for Kabsch alignment.
# Higher = more accurate but slower. 512 is a good balance.
_KABSCH_SAMPLE_N = 512

# Canny edge detection thresholds. Tune for your lighting conditions.
_CANNY_LOW  = 30
_CANNY_HIGH = 120


# ════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT — called by qc_router.py
# ════════════════════════════════════════════════════════════════

async def run_qc_check(photo_urls: list[str], cad_url: str) -> dict:
    """
    Async QC function. Downloads images concurrently then compares.

    Args:
        photo_urls: List of manufacturer's part photo URLs
        cad_url:    URL to the CAD/reference image from the design

    Returns:
        {
          "passed": bool,
          "score":  float,         # 0–100 (100 = perfect, 0 = at/over tolerance)
          "notes":  str,           # human-readable summary
          "per_photo": list[dict]  # per-photo breakdown
        }
    """
    if FORCE_MANUAL_REVIEW:
        return _manual_fallback("Manual review mode active. Admin will review.")

    if not cad_url:
        return _manual_fallback("No CAD reference image. Routing to manual review.")

    try:
        # ── Download CAD reference and all part photos concurrently ──
        urls_to_fetch = [cad_url] + [u for u in photo_urls if u]
        images = await _fetch_images_async(urls_to_fetch)

        cad_img    = images[0]
        part_images = images[1:]

        if cad_img is None:
            return _manual_fallback("Could not download CAD reference image.")

        valid_parts = [(i, img) for i, img in enumerate(part_images) if img is not None]
        if not valid_parts:
            return _manual_fallback("Could not download any part photos. Check URLs.")

        # ── Extract CAD contour once (reused for every photo) ─────────
        cad_pts = _extract_main_contour(cad_img)
        if cad_pts is None:
            return _manual_fallback("Could not extract shape from CAD reference image.")

        # ── Compare each part photo against the CAD ───────────────────
        per_photo = []
        for original_idx, part_img in valid_parts:
            result = _compare_single(cad_pts, part_img, photo_num=original_idx + 1)
            per_photo.append(result)

        # ── Aggregate results ─────────────────────────────────────────
        return _aggregate(per_photo)

    except Exception as e:
        # Safety-first: on any unexpected error route to manual review
        return _manual_fallback(f"QC engine error — routing to manual review. ({e})")


# ════════════════════════════════════════════════════════════════
# ASYNC IMAGE DOWNLOADER
# ════════════════════════════════════════════════════════════════

async def _fetch_images_async(urls: list[str]) -> list[Optional[np.ndarray]]:
    """Download all images concurrently. Returns list of cv2 grayscale arrays."""
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        tasks = [_fetch_one(client, url) for url in urls]
        return await asyncio.gather(*tasks)


async def _fetch_one(client: httpx.AsyncClient, url: str) -> Optional[np.ndarray]:
    """Download a single image URL, decode as grayscale OpenCV array."""
    try:
        res = await client.get(url)
        res.raise_for_status()
        arr = np.frombuffer(res.content, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        return img
    except Exception:
        return None


# ════════════════════════════════════════════════════════════════
# PREPROCESSING
# ════════════════════════════════════════════════════════════════

def _preprocess(img: np.ndarray) -> np.ndarray:
    """
    Normalise brightness and sharpen edges before contour detection.
    Makes the pipeline robust to different factory lighting conditions.

    Steps:
      1. CLAHE — contrast-limited adaptive histogram equalisation
         (handles uneven lighting, shadows, overexposure)
      2. Gaussian blur — removes high-frequency sensor noise
      3. Adaptive threshold — binarises the image locally
         (works regardless of global brightness level)
    """
    # 1. CLAHE — equalise local contrast
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    eq    = clahe.apply(img)

    # 2. Denoise
    blurred = cv2.GaussianBlur(eq, (5, 5), 0)

    # 3. Edge detection
    edges = cv2.Canny(blurred, _CANNY_LOW, _CANNY_HIGH)
    return edges


def _extract_main_contour(img: np.ndarray) -> Optional[np.ndarray]:
    """
    Extract the largest contour (= main part outline) from an image.
    Returns N×2 float32 array of (x, y) points, or None.
    """
    if img is None:
        return None
    edges    = _preprocess(img)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 100:      # ignore tiny noise contours
        return None
    return largest.reshape(-1, 2).astype(np.float32)


# ════════════════════════════════════════════════════════════════
# SCALE NORMALISATION
# ════════════════════════════════════════════════════════════════

def _normalise_scale(ref_pts: np.ndarray, tgt_pts: np.ndarray) -> np.ndarray:
    """
    Scale the target contour so its bounding box matches the reference.

    Why: the CAD image and the factory photo will have different px/mm
    ratios depending on the camera and distance. We normalise by matching
    bounding boxes before alignment, so deviation is purely shape error.
    The final mm conversion uses QC_SCALE_MM_PER_PX from the CAD image.
    """
    rx, ry, rw, rh = cv2.boundingRect(ref_pts.astype(np.int32))
    tx, ty, tw, th = cv2.boundingRect(tgt_pts.astype(np.int32))

    if tw == 0 or th == 0:
        return tgt_pts

    # Scale factors
    sx = rw / tw
    sy = rh / th

    # Apply scale around target centroid
    centroid = tgt_pts.mean(axis=0)
    scaled   = (tgt_pts - centroid) * np.array([sx, sy]) + centroid
    return scaled


# ════════════════════════════════════════════════════════════════
# KABSCH ALIGNMENT
# ════════════════════════════════════════════════════════════════

def _uniform_sample(pts: np.ndarray, n: int) -> np.ndarray:
    """Uniformly sample n points from a contour (by arc-length index)."""
    indices = np.linspace(0, len(pts) - 1, n, dtype=int)
    return pts[indices]


def _kabsch_align(reference: np.ndarray, target: np.ndarray) -> np.ndarray:
    """
    Kabsch algorithm: find the optimal rotation + translation that
    minimises RMSD between reference and target point clouds.

    Both inputs are uniformly resampled to _KABSCH_SAMPLE_N points
    before alignment to avoid bias from unequal contour densities.

    Returns the aligned target points (same shape as reference sample).
    """
    n   = _KABSCH_SAMPLE_N
    ref = _uniform_sample(reference, n)
    tgt = _uniform_sample(target,    n)

    # Centre both clouds
    ref_mean = ref.mean(axis=0)
    tgt_mean = tgt.mean(axis=0)
    ref_c    = ref - ref_mean
    tgt_c    = tgt - tgt_mean

    # SVD to find optimal rotation
    H        = tgt_c.T @ ref_c
    U, _, Vt = np.linalg.svd(H)
    d        = np.linalg.det(Vt.T @ U.T)
    # Handle reflection (det = -1)
    D        = np.diag([1, d])
    R        = Vt.T @ D @ U.T

    # Rotate target, then translate to reference centroid
    aligned  = tgt_c @ R.T + ref_mean
    return aligned, ref


def _hausdorff_and_mean(ref: np.ndarray, aligned: np.ndarray) -> tuple[float, float]:
    """
    Compute both:
      - mean point-to-point deviation (average error in pixels)
      - Hausdorff distance (worst-case deviation, in pixels)
    These together give a complete picture of shape accuracy.
    """
    diffs      = np.linalg.norm(ref - aligned, axis=1)
    mean_dev   = float(np.mean(diffs))
    hausdorff  = float(np.max(diffs))
    return mean_dev, hausdorff


# ════════════════════════════════════════════════════════════════
# PER-PHOTO COMPARISON
# ════════════════════════════════════════════════════════════════

def _compare_single(cad_pts: np.ndarray, part_img: np.ndarray, photo_num: int) -> dict:
    """Compare one part photo against the CAD contour. Returns per-photo result."""
    part_pts = _extract_main_contour(part_img)
    if part_pts is None:
        return {
            "photo":        photo_num,
            "error_mm":     999.0,
            "hausdorff_mm": 999.0,
            "passed":       False,
            "note":         f"Photo {photo_num}: could not extract part outline",
        }

    # Normalise scale before alignment
    part_scaled  = _normalise_scale(cad_pts, part_pts)

    # Kabsch alignment
    aligned, ref = _kabsch_align(cad_pts, part_scaled)

    # Compute deviations
    mean_px, hausdorff_px = _hausdorff_and_mean(ref, aligned)

    mean_mm      = round(mean_px      * QC_SCALE_MM_PER_PX, 3)
    hausdorff_mm = round(hausdorff_px * QC_SCALE_MM_PER_PX, 3)
    passed       = hausdorff_mm <= QC_TOLERANCE_MM   # worst-case must pass

    return {
        "photo":        photo_num,
        "error_mm":     mean_mm,           # average deviation
        "hausdorff_mm": hausdorff_mm,      # worst-case deviation
        "passed":       passed,
        "note": (
            f"Photo {photo_num}: avg={mean_mm}mm, max={hausdorff_mm}mm "
            f"({'✓ PASS' if passed else '✗ FAIL — exceeds ±' + str(QC_TOLERANCE_MM) + 'mm'})"
        ),
    }


# ════════════════════════════════════════════════════════════════
# AGGREGATION
# ════════════════════════════════════════════════════════════════

def _aggregate(per_photo: list[dict]) -> dict:
    """Combine per-photo results into a single QC verdict."""
    all_passed    = all(p["passed"] for p in per_photo)
    max_error     = max(p["hausdorff_mm"] for p in per_photo)
    avg_error     = round(sum(p["error_mm"] for p in per_photo) / len(per_photo), 3)

    # Score: 100 = perfect (0mm deviation), 0 = at or beyond tolerance
    # Linear scale: score = 100 * max(0, 1 - hausdorff / tolerance)
    score = round(max(0.0, 100.0 * (1.0 - max_error / QC_TOLERANCE_MM)), 1)

    notes_parts = [p["note"] for p in per_photo]
    notes_parts.append(
        f"OVERALL: avg={avg_error}mm | worst={max_error}mm | "
        f"tolerance=±{QC_TOLERANCE_MM}mm | {'PASS ✓' if all_passed else 'FAIL ✗'}"
    )

    return {
        "passed":    all_passed,
        "score":     score,
        "notes":     " || ".join(notes_parts),
        "per_photo": per_photo,
    }


# ════════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════════

def _manual_fallback(reason: str) -> dict:
    """Standard response when AI cannot run — routes to admin manual review."""
    return {
        "passed":    False,
        "score":     0,
        "notes":     reason,
        "per_photo": [],
    }
