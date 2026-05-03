// api.ts — All Backend API Calls
// Every call to the FastAPI backend is a named function here.
// TO CHANGE THE API URL: update NEXT_PUBLIC_API_URL in .env.local
import axios from "axios";
import { supabase } from "./supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

// Attach the current user's JWT on every outbound request.
// Endpoints that don't verify the token simply ignore the header.
api.interceptors.request.use(async (config) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // Continue without a token — unauthenticated endpoints still work.
  }
  return config;
});

// ── Public catalog (service role on server; no auth required) ────
export const getCatalogDesigns = () => api.get("/api/v1/catalog/designs");

// ── Customer profile (preferred delivery) ────────────────────────
export const updatePreferredDelivery = (data: object) =>
  api.patch("/api/auth/me/preferred-delivery", data);

export const getWalletTransactions = (limit = 100) =>
  api.get("/api/auth/me/wallet-transactions", { params: { limit } });

// ── Orders ────────────────────────────────────────────────────────
export const placeOrder        = (data: object)         => api.post("/api/v1/orders", data);
export const getOrder          = (orderId: string)      => api.get(`/api/v1/orders/${orderId}`);
export const updateOrderStatus = (orderId: string, status: string) =>
  api.patch(`/api/v1/orders/${orderId}/status`, { status });
export const adminListOrders   = (status?: string)      => api.get("/api/v1/admin/orders", { params: { status } });

// ── Bids / Negotiation ────────────────────────────────────────────
export const submitBid      = (data: object)            => api.post("/api/v1/bids", data);
export const acceptBid      = (data: object)            => api.post("/api/v1/bids/accept", data);
export const getMessages    = (roomId: string)          => api.get(`/api/v1/messages/${roomId}`);
export const sendMessage    = (data: object)            => api.post("/api/v1/messages", data);
export const markRead       = (data: object)            => api.post("/api/v1/messages/read", data);
export const getUnreadCount = (userId: string)          => api.get(`/api/v1/messages/unread/${userId}`);

// ── Commitment Pipeline ───────────────────────────────────────────
export const seekCommitments      = (data: object)      => api.post("/api/v1/designs/seek", data);
export const createCommitment     = (data: object)      => api.post("/api/v1/commitments", data);
export const reviewVariant        = (data: object)      => api.post("/api/v1/commitments/variants/review", data);
export const getAvailableDesigns  = (mfrId: string)     => api.get("/api/v1/commitments/available", { params: { manufacturer_id: mfrId } });
/** Requires manufacturer JWT; server resolves manufacturer row — do not pass spoofable ids */
export const getMyCommitments = () => api.get("/api/v1/commitments/mine");
/** Designer-only: backend requires role=designer + JWT. Manufacturers cannot publish. */
export const publishDesign        = (designId: string, designerId: string) =>
  api.post(`/api/v1/designs/${designId}/publish`, { designer_id: designerId });
export const pauseDesign          = (designId: string, data: object) =>
  api.post(`/api/v1/designs/${designId}/pause`, data);
export const adminPendingVariants = ()                  => api.get("/api/v1/admin/variants/pending");

// ── Designs (Designer CRUD) ───────────────────────────────────────
export const getDesignerDesigns = (designerId: string)  =>
  api.get("/api/v1/designs", { params: { designer_id: designerId } });
export const createDesign       = (data: object)        => api.post("/api/v1/designs", data);
export const updateDesign       = (designId: string, data: object) =>
  api.patch(`/api/v1/designs/${designId}`, data);
/** Signed URLs for preview + designer gallery + manufacturer showcases (full quality). */
export const getDesignMedia = (designId: string) =>
  api.get(`/api/v1/designs/${designId}/media`);
export const updateDesignGallery = (
  designId: string,
  designerId: string,
  gallery_image_urls: string[],
) =>
  api.patch(`/api/v1/designs/${designId}/gallery`, { designer_id: designerId, gallery_image_urls });
export const updateCommitmentShowcase = (
  commitmentId: string,
  showcase_image_urls: string[],
) =>
  api.patch(`/api/v1/commitments/${commitmentId}/showcase`, { showcase_image_urls });
export const deleteDesign       = (designId: string, designerId: string) =>
  api.delete(`/api/v1/designs/${designId}`, { params: { designer_id: designerId } });

// ── Payments (JWT identifies customer/admin — never send spoofable ids) ──
export const createPayment = (data: { order_id: string }) =>
  api.post("/api/v1/payments/create", data);
export const verifyPayment = (data: {
  order_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) => api.post("/api/v1/payments/verify", data);
export const releaseEscrow = (data: { order_id: string }) =>
  api.post("/api/v1/payments/release", data);
export const refundPayment = (data: { order_id: string; reason?: string }) =>
  api.post("/api/v1/payments/refund", data);

// ── QC ────────────────────────────────────────────────────────────
export const submitQC       = (data: object)            => api.post("/api/v1/qc/submit", data);
export const manualQCReview = (data: object)            => api.post("/api/v1/qc/manual-review", data);
export const getQCHistory   = (orderId: string)         => api.get(`/api/v1/qc/${orderId}`);

// ── Tracking ──────────────────────────────────────────────────────
export const trackShipment  = (awb: string)             => api.get(`/api/v1/track/${awb}`);

// ── Emergency Broadcast ───────────────────────────────────────────
export const triggerEmergencyScan = ()                  => api.post("/api/v1/admin/emergency-scan");
export const getBroadcastHistory  = (designId?: string) =>
  api.get("/api/v1/admin/broadcasts", { params: { design_id: designId } });
