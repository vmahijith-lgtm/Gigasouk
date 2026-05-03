// ════════════════════════════════════════════════════════════════
// app/customer/page.tsx — Customer dashboard (location + orders + catalog)
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { getCatalogDesigns, updatePreferredDelivery, createPayment, verifyPayment } from "../../lib/api";
import { loadRazorpayCheckout } from "../../lib/razorpay-checkout";
import { AddressAutocomplete, type DeliveryAddress } from "../../components/MapComponents";
import DesignMediaGallery from "../../components/DesignMediaGallery";

const T = {
  bg: "#060810", card: "#0C1018", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

export default function CustomerDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [loadOrders, setLoadOrders] = useState(true);
  const [locMsg, setLocMsg] = useState("");
  const [savingLoc, setSavingLoc] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  /** Expand inline full-quality gallery for one order (lazy: single GET /media when opened). */
  const [orderPhotosFor, setOrderPhotosFor] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/login?next=/customer");
      return;
    }
    if (user.role !== "customer") {
      router.replace("/");
      return;
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user?.profileId) return;
    (async () => {
      const [{ data: od }, catRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, design_id, order_ref, status, payment_status, created_at, negotiation_room_id, designs(title), locked_price, committed_price")
          .eq("customer_id", user.profileId)
          .order("created_at", { ascending: false })
          .limit(25),
        getCatalogDesigns().catch(() => ({ data: [] })),
      ]);
      setOrders(od || []);
      setCatalog(catRes?.data || []);
      setLoadOrders(false);
    })();
  }, [user?.profileId]);

  function paymentLabel(o: { payment_status?: string; locked_price?: number | null }) {
    const ps = o.payment_status || "pending";
    if (ps === "refunded") return { text: "Refunded", color: "#F87171" };
    if (ps === "released") return { text: "Paid · released", color: T.green };
    if (ps === "in_escrow") return { text: "Paid · in escrow", color: T.green };
    if (ps === "pending" && o.locked_price != null && Number(o.locked_price) > 0) {
      return { text: "Pay now", color: T.gold };
    }
    return { text: "Awaiting price lock", color: T.t3 };
  }

  async function payOrder(o: { id: string; order_ref: string; designs?: { title?: string } }) {
    setPayMsg("");
    setPayingId(o.id);
    try {
      const { data: payData } = await createPayment({ order_id: o.id });
      const Razorpay = await loadRazorpayCheckout();
      const options = {
        key: payData.razorpay_key,
        amount: payData.amount,
        currency: "INR",
        order_id: payData.razorpay_order_id,
        name: "GigaSouk",
        description: o.designs?.title || o.order_ref,
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await verifyPayment({
              order_id: o.id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            setPayMsg(`Payment received for ${o.order_ref}.`);
            const { data: od } = await supabase
              .from("orders")
              .select("id, design_id, order_ref, status, payment_status, created_at, negotiation_room_id, designs(title), locked_price, committed_price")
              .eq("customer_id", user!.profileId)
              .order("created_at", { ascending: false })
              .limit(25);
            setOrders(od || []);
          } catch (e: unknown) {
            const detail = e && typeof e === "object" && "response" in e
              ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
              : undefined;
            setPayMsg(detail || "Verification failed. If money was debited, contact support with your order ref.");
          }
        },
        theme: { color: T.green },
      };
      const rzp = new Razorpay(options);
      rzp.open();
    } catch (e: unknown) {
      const detail = e && typeof e === "object" && "response" in e
        ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : undefined;
      setPayMsg(detail || "Could not start payment. If Razorpay is not configured on the server, add keys to the backend environment.");
    } finally {
      setPayingId(null);
    }
  }

  async function savePreferred(addr: DeliveryAddress) {
    if (!user) return;
    setSavingLoc(true);
    setLocMsg("");
    try {
      await updatePreferredDelivery({
        line1: addr.line1,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
        lat: addr.lat,
        lng: addr.lng,
      });
      setLocMsg("Saved. We will use this to find the nearest committed factory when you order.");
    } catch {
      setLocMsg("Could not save. Try again.");
    } finally {
      setSavingLoc(false);
    }
  }

  if (loading || !user || user.role !== "customer") {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: T.t3 }}>
        Loading…
      </div>
    );
  }

  const pd = user.preferredDelivery;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.t1, fontFamily: "Inter, sans-serif", padding: "24px clamp(16px,4vw,40px)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>My GigaSouk</h1>
            <p style={{ fontSize: 13, color: T.t3 }}>Saved location, orders, and designs with factory supply.</p>
          </div>
          <Link href="/" style={{ color: T.green, fontSize: 14, fontWeight: 600 }}>
            ← Shop catalog
          </Link>
        </div>

        {/* Preferred location */}
        <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 22, marginBottom: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Delivery location</h2>
          <p style={{ fontSize: 13, color: T.t3, marginBottom: 16, lineHeight: 1.5 }}>
            Add your current or preferred address. Checkout uses it to pick the <strong style={{ color: T.t2 }}>nearest committed factory</strong> automatically (you can still change factory on the map before paying).
          </p>
          {pd?.city && (
            <p style={{ fontSize: 12, color: T.t2, marginBottom: 12 }}>
              Saved: {pd.line1 ? `${pd.line1}, ` : ""}{pd.city}, {pd.state} {pd.pincode}
            </p>
          )}
          <AddressAutocomplete
            placeholder="Search address or pincode to save…"
            onPlace={savePreferred}
          />
          {savingLoc && <p style={{ fontSize: 12, color: T.gold, marginTop: 10 }}>Saving…</p>}
          {locMsg && (
            <p style={{ fontSize: 13, color: locMsg.startsWith("Saved") ? T.green : "#F87171", marginTop: 12 }}>
              {locMsg}
            </p>
          )}
        </section>

        {/* Orders */}
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Your orders and payments</h2>
          <p style={{ fontSize: 12, color: T.t3, marginBottom: 12, lineHeight: 1.5 }}>
            Pay with UPI or card via Razorpay after your price is locked in negotiation. The publishable key comes from the server; secrets never appear in the browser.
          </p>
          {payMsg && (
            <p style={{ fontSize: 13, color: payMsg.startsWith("Payment received") ? T.green : "#F87171", marginBottom: 12 }}>
              {payMsg}
            </p>
          )}
          {loadOrders && <p style={{ color: T.t3 }}>Loading orders…</p>}
          {!loadOrders && orders.length === 0 && (
            <p style={{ color: T.t3, fontSize: 14 }}>No orders yet. Browse the catalog on the home page.</p>
          )}
          {!loadOrders && orders.map((o) => {
            const pl = paymentLabel(o);
            const canPay =
              o.payment_status === "pending" &&
              o.locked_price != null &&
              Number(o.locked_price) > 0;
            const photosOpen = orderPhotosFor === o.id;
            return (
              <div
                key={o.id}
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 700 }}>{o.order_ref}</p>
                    <p style={{ fontSize: 12, color: T.t3 }}>{o.designs?.title}</p>
                    <p style={{ fontSize: 11, color: pl.color, marginTop: 4 }}>{pl.text}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: T.gold }}>{o.status}</span>
                    {o.design_id && (
                      <button
                        type="button"
                        onClick={() =>
                          setOrderPhotosFor(photosOpen ? null : o.id)
                        }
                        style={{
                          background: "transparent",
                          border: `1px solid ${T.border}`,
                          borderRadius: 8,
                          padding: "6px 12px",
                          fontWeight: 600,
                          fontSize: 12,
                          color: T.green,
                          cursor: "pointer",
                        }}
                      >
                        {photosOpen ? "Hide photos" : "Photos"}
                      </button>
                    )}
                    {canPay && (
                      <button
                        type="button"
                        disabled={payingId === o.id}
                        onClick={() => payOrder(o)}
                        style={{
                          background: T.green,
                          color: "#060810",
                          border: "none",
                          borderRadius: 8,
                          padding: "8px 14px",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: payingId === o.id ? "wait" : "pointer",
                        }}
                      >
                        {payingId === o.id ? "Opening…" : "Pay now"}
                      </button>
                    )}
                    {o.negotiation_room_id && o.status === "negotiating" && (
                      <Link
                        href={`/negotiate/${o.negotiation_room_id}`}
                        style={{ fontSize: 12, color: T.green, fontWeight: 600 }}
                      >
                        Negotiate
                      </Link>
                    )}
                  </div>
                </div>
                {photosOpen && o.design_id && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                    <DesignMediaGallery designId={o.design_id} title={o.designs?.title} />
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Designs with supply */}
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Designs you can order</h2>
          <p style={{ fontSize: 13, color: T.t3, marginBottom: 16 }}>
            Shown when at least one factory has committed, or the listing is live.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {catalog.map((d) => (
              <Link
                key={d.id}
                href="/"
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ height: 120, background: "#111826" }}>
                  {d.preview_image_url ? (
                    <img src={d.preview_image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>⚙️</div>
                  )}
                </div>
                <div style={{ padding: 14 }}>
                  <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{d.title}</p>
                  <p style={{ fontSize: 18, fontWeight: 800, color: T.green }}>
                    ₹{Number(d.base_price).toLocaleString("en-IN")}
                  </p>
                  <p style={{ fontSize: 11, color: d.status === "live" ? T.green : T.gold, marginTop: 6 }}>
                    {d.status === "live" ? "● Live" : "● Available (supply secured)"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          {catalog.length === 0 && !loadOrders && (
            <p style={{ color: T.t3, fontSize: 14 }}>Nothing listed yet. Check back after factories commit to designs.</p>
          )}
        </section>
      </div>
    </div>
  );
}
