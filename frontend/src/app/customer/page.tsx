// ════════════════════════════════════════════════════════════════
// app/customer/page.tsx — Customer dashboard (location + orders + catalog)
// ════════════════════════════════════════════════════════════════
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { getCatalogDesigns, updatePreferredDelivery } from "../../lib/api";
import { AddressAutocomplete, type DeliveryAddress } from "../../components/MapComponents";

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
          .select("id, order_ref, status, created_at, designs(title), locked_price, committed_price")
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
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Your orders</h2>
          {loadOrders && <p style={{ color: T.t3 }}>Loading orders…</p>}
          {!loadOrders && orders.length === 0 && (
            <p style={{ color: T.t3, fontSize: 14 }}>No orders yet. Browse the catalog on the home page.</p>
          )}
          {!loadOrders && orders.map((o) => (
            <div
              key={o.id}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                padding: "14px 18px",
                marginBottom: 10,
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
              </div>
              <span style={{ fontSize: 12, color: T.gold }}>{o.status}</span>
            </div>
          ))}
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
