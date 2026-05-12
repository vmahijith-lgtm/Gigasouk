// ════════════════════════════════════════════════════════════════
// GigaSoukProductPage.jsx — Customer Shop
// Shows only LIVE designs (committed supply guaranteed).
// Customer browses, views specs, places order.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { placeOrder, createPayment, verifyPayment } from "../lib/api";
import { loadRazorpayCheckout } from "../lib/razorpay-checkout";
import BrandLogo from "./BrandLogo";

const C = {
  bg: "#060810", card: "#0C1018", card2: "#111826", border: "#1A2230",
  green: "#00E5A0", gold: "#F5A623", blue: "#4A9EFF",
  t1: "#F4F6FC", t2: "#B8C4D8", t3: "#5A6A80",
};

// ════════════════════════════════════════════════════════════════
export default function GigaSoukProductPage({ customerId }) {
// ════════════════════════════════════════════════════════════════

  const [designs,  setDesigns]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("all");
  const [ordering, setOrdering] = useState(false);
  const [orderMsg, setOrderMsg] = useState("");

  // Delivery address form state
  const [addr, setAddr] = useState({
    name: "", phone: "", email: "", line1: "", city: "", state: "", pincode: "", lat: 0, lng: 0
  });

  // ── Fetch live designs ──────────────────────────────────────────
  useEffect(() => {
    supabase.from("designs").select("*, profiles(full_name)")
      .eq("status", "live")
      .order("published_at", { ascending: false })
      .then(({ data }) => setDesigns(data || []))
      .finally(() => setLoading(false));
  }, []);

  // ── Filter ──────────────────────────────────────────────────────
  const categories = ["all", ...new Set(designs.map(d => d.category).filter(Boolean))];
  const filtered   = designs.filter(d => {
    const matchCat  = category === "all" || d.category === category;
    const matchText = !search || d.title.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchText;
  });

  // ── Place order ─────────────────────────────────────────────────
  async function handleOrder() {
    if (!addr.line1 || !addr.city || !addr.pincode) {
      setOrderMsg("Please fill in your delivery address.");
      return;
    }
    setOrdering(true);
    setOrderMsg("");
    try {
      const { data: orderData } = await placeOrder({
        design_id:        selected.id,
        quantity:         1,
        delivery_address: addr,
      });

      const { data: payData } = await createPayment({
        order_id: orderData.order_id,
      });

      const Razorpay = await loadRazorpayCheckout();
      const options = {
        key:         payData.razorpay_key,
        amount:      payData.amount,
        currency:    "INR",
        order_id:    payData.razorpay_order_id,
        name:        "GigaSouk",
        description: selected.title,
        handler: async (response) => {
          try {
            await verifyPayment({
              order_id:            orderData.order_id,
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            });
            setSelected(null);
            setOrderMsg(`Order ${orderData.order_ref} placed! Your product is being made ${orderData.distance_km}km away.`);
          } catch (verErr) {
            const detail = verErr?.response?.data?.detail;
            setOrderMsg(
              detail ||
                "Payment could not be verified. If money was debited, contact support with your order ref.",
            );
          }
        },
        theme: { color: C.green },
      };
      const rzp = new Razorpay(options);
      rzp.open();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setOrderMsg(detail || "Order failed. Please try again.");
    } finally {
      setOrdering(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "24px clamp(14px, 4vw, 20px)", fontFamily: "Inter, sans-serif", width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>

      {/* Topbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <BrandLogo />
        <span style={{ fontSize: 12, color: C.t3 }}>Made near you · AI-verified quality</span>
      </div>

      {/* Search + filter */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search products..."
          style={{ flex: 1, minWidth: 0, maxWidth: "100%", background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 14px", color: C.t1, fontSize: 14, outline: "none" }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              style={{ padding: "8px 14px", borderRadius: 8,
                border: `1px solid ${category === cat ? C.green : C.border}`,
                background: category === cat ? C.green + "22" : C.card2,
                color: category === cat ? C.green : C.t3,
                fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Order success message */}
      {orderMsg && !selected && (
        <div style={{ background: C.green + "18", border: `1px solid ${C.green}`, borderRadius: 8,
          padding: "14px 18px", marginBottom: 20, fontSize: 14, color: C.green }}>
          ✓ {orderMsg}
        </div>
      )}

      {loading && <p style={{ color: C.t3, textAlign: "center", padding: 60 }}>Loading products...</p>}

      {/* Product grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: 16, width: "100%", minWidth: 0 }}>
        {filtered.map(design => (
          <div key={design.id} onClick={() => setSelected(design)}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
              cursor: "pointer", overflow: "hidden", transition: "border-color .2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.green + "88"}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>

            {/* Preview image */}
            <div style={{ height: 160, background: C.card2, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 40 }}>
              {design.preview_image_url
                ? <img src={design.preview_image_url} alt={design.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : "⚙️"}
            </div>

            <div style={{ padding: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.t3, textTransform: "uppercase",
                letterSpacing: ".06em" }}>{design.category || "Product"}</span>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: C.t1, marginTop: 4, marginBottom: 8 }}>
                {design.title}
              </h3>
              <p style={{ fontSize: 22, fontWeight: 800, color: C.green }}>
                From ₹{Number(design.base_price).toLocaleString("en-IN")}
              </p>
              <p style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>+ shipping based on your location</p>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "inline-block" }} />
                <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Committed supply · AI-QC verified</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: C.t3 }}>
          <p style={{ fontSize: 16 }}>No products found.</p>
        </div>
      )}

      {/* Order modal */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setSelected(null)}>
          <div style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 480,
            maxHeight: "90vh", overflowY: "auto", padding: 28, border: `1px solid ${C.border}` }}
            onClick={e => e.stopPropagation()}>

            <button onClick={() => setSelected(null)}
              style={{ float: "right", background: "none", border: "none", color: C.t3, fontSize: 24, cursor: "pointer" }}>×</button>

            <p style={{ fontSize: 12, color: C.t3, textTransform: "uppercase", letterSpacing: ".06em" }}>Order</p>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 4 }}>{selected.title}</h2>
            <p style={{ fontSize: 28, fontWeight: 800, color: C.green, marginBottom: 20 }}>
              From ₹{Number(selected.base_price).toLocaleString("en-IN")}
            </p>

            <p style={{ fontSize: 12, fontWeight: 700, color: C.t3, textTransform: "uppercase",
              letterSpacing: ".06em", marginBottom: 12 }}>Delivery Address</p>

            {/* Address form */}
            {[
              { key: "name",    label: "Full Name",    ph: "Your name" },
              { key: "phone",   label: "Phone",        ph: "+91 XXXXX XXXXX" },
              { key: "email",   label: "Email",        ph: "you@email.com" },
              { key: "line1",   label: "Address",      ph: "Building, street, area" },
              { key: "city",    label: "City",         ph: "Your city" },
              { key: "state",   label: "State",        ph: "Your state" },
              { key: "pincode", label: "Pincode",      ph: "6-digit pincode" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.t3, display: "block", marginBottom: 4 }}>{f.label}</label>
                <input value={addr[f.key]} onChange={e => setAddr(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.ph}
                  style={{ width: "100%", background: C.card2, border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: "10px 12px", color: C.t1, fontSize: 14, outline: "none" }} />
              </div>
            ))}

            {orderMsg && (
              <p style={{ color: C.gold, fontSize: 13, marginBottom: 12 }}>{orderMsg}</p>
            )}

            <button onClick={handleOrder} disabled={ordering}
              style={{ width: "100%", padding: "14px 0", borderRadius: 10, border: "none",
                background: ordering ? C.t3 : C.green, color: "#060810", fontWeight: 800,
                fontSize: 16, cursor: ordering ? "not-allowed" : "pointer", marginTop: 8 }}>
              {ordering ? "Processing..." : "Pay & Order Now"}
            </button>
            <p style={{ fontSize: 11, color: C.t3, textAlign: "center", marginTop: 10 }}>
              Secured by Razorpay escrow · Money released only on delivery
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
