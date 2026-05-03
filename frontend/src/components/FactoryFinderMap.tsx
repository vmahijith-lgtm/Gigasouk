"use client";
// ════════════════════════════════════════════════════════════════
// components/FactoryFinderMap.tsx
//
// Customer sees all available factories on a map BEFORE ordering.
// Shows: city, distance, rating, queue — NOT the exact address.
// Customer selects a factory (or accepts the AI recommendation).
// This replaces the silent "route to best factory" with a
// transparent, interactive process.
//
// PRIVACY:
//   The backend /available-factories endpoint returns ONLY:
//     city, distance_km, rating, queue_depth, commitment_id
//   Never: exact lat/lng, address, or manufacturer name.
//   The map pins are placed at city centroid level, not the
//   exact factory GPS.
// ════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from "react";
import { AddressAutocomplete, type DeliveryAddress } from "./MapComponents";

export type { DeliveryAddress };

const C = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF", purple:"#A78BFA",
  t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80", red:"#F87171",
};

export interface FactoryOption {
  commitment_id:  string;
  manufacturer_id:string;
  city:           string;
  state:          string;
  distance_km:    number;
  rating:         number;
  queue_depth:    number;
  committed_price:number;
  score:          number;
  city_lat:       number;  // city centroid — NOT exact factory GPS
  city_lng:       number;
}

interface Props {
  designId:   string;
  designTitle:string;
  onSelect:   (factory: FactoryOption, address: DeliveryAddress) => void;
  onCancel:   () => void;
  /** Prefill delivery & load factories (e.g. saved customer preferred location). */
  initialAddress?: DeliveryAddress | null;
}

// Score bar width: score is 0–1 (lower = better), so invert for display
const scoreBar = (score: number) => `${Math.round((1 - score) * 100)}%`;

export default function FactoryFinderMap({ designId, designTitle, onSelect, onCancel, initialAddress }: Props) {
  const mapRef    = useRef<HTMLDivElement>(null);
  const mapObj    = useRef<any>(null);
  const markers   = useRef<any[]>([]);
  const infoWins  = useRef<any[]>([]);
  const booted    = useRef(false);

  const [step,       setStep]       = useState<"address"|"loading"|"results"|"selected">("address");
  const [address,    setAddress]    = useState<DeliveryAddress | null>(null);
  const [factories,  setFactories]  = useState<FactoryOption[]>([]);
  const [selected,   setSelected]   = useState<FactoryOption | null>(null);
  const [error,      setError]      = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);

  // ── Fetch available factories from backend ────────────────────
  const fetchFactories = useCallback(async (addr: DeliveryAddress) => {
    setStep("loading");
    setError("");
    try {
      const params = new URLSearchParams({
        design_id: designId,
        lat:       String(addr.lat),
        lng:       String(addr.lng),
        pincode:   addr.pincode,
        city:      addr.city,
      });
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/available-factories?${params}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data: FactoryOption[] = await res.json();
      if (data.length === 0) {
        setError("No committed factories found near your location. Try a different city or check back later.");
        setStep("address");
        return;
      }
      setFactories(data);
      setSelected(data[0]);   // nearest factory (shortest distance_km)
      setStep("results");
    } catch (e: any) {
      setError(e.message || "Could not load factories. Please try again.");
      setStep("address");
    }
  }, [designId]);

  // ── GPS shortcut for address step ────────────────────────────
  const useGPS = useCallback(() => {
    setGpsLoading(true);
    navigator.geolocation?.getCurrentPosition(
      pos => {
        const G = (window as any).google;
        if (!G) { setGpsLoading(false); return; }
        new G.maps.Geocoder().geocode(
          { location: { lat: pos.coords.latitude, lng: pos.coords.longitude } },
          (results: any[], status: string) => {
            setGpsLoading(false);
            if (status !== "OK" || !results[0]) return;
            const comps: any[] = results[0].address_components;
            const get = (t: string) => comps.find((c: any) => c.types.includes(t))?.long_name || "";
            const addr: DeliveryAddress = {
              line1:   get("route") || get("sublocality_level_1"),
              city:    get("locality") || get("administrative_area_level_2"),
              state:   get("administrative_area_level_1"),
              pincode: get("postal_code"),
              lat:     pos.coords.latitude,
              lng:     pos.coords.longitude,
            };
            setAddress(addr);
            fetchFactories(addr);
          }
        );
      },
      () => setGpsLoading(false),
      { timeout: 8000 }
    );
  }, [fetchFactories]);

  // ── Prefill from saved preferred location (once) ──────────────
  useEffect(() => {
    if (booted.current || !initialAddress?.lat || !initialAddress?.lng) return;
    booted.current = true;
    setAddress(initialAddress);
    fetchFactories(initialAddress);
  }, [initialAddress, fetchFactories]);

  // ── Draw factory pins on map ──────────────────────────────────
  useEffect(() => {
    if (step !== "results" || !mapRef.current) return;

    const G = (window as any).google;
    if (!G) return;
    const M = G.maps;

    // Create or reuse map
    if (!mapObj.current) {
      mapObj.current = new M.Map(mapRef.current, {
        center: { lat: address!.lat, lng: address!.lng },
        zoom:   7,
        mapTypeId: "roadmap",
        styles: DARK_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
      });
    }

    // Clear old markers
    markers.current.forEach(m => m.setMap(null));
    infoWins.current.forEach(w => w.close());
    markers.current = [];
    infoWins.current = [];

    const bounds = new M.LatLngBounds();

    // Customer pin (blue)
    if (address) {
      new M.Marker({
        position: { lat: address.lat, lng: address.lng },
        map: mapObj.current,
        icon: { path: M.SymbolPath.CIRCLE, scale:8, fillColor:"#4A9EFF", fillOpacity:1, strokeColor:"#fff", strokeWeight:2 },
        title: "Your location",
        zIndex: 100,
      });
      bounds.extend({ lat: address.lat, lng: address.lng });
    }

    // Factory pins — city centroid (privacy-safe)
    factories.forEach((f, i) => {
      const isNearest = i === 0;
      const isSel = selected?.commitment_id === f.commitment_id;
      const color = isNearest ? "#00E5A0" : isSel ? "#F5A623" : "#A78BFA";
      const scale = isSel ? 14 : 10;

      const marker = new M.Marker({
        position: { lat: f.city_lat, lng: f.city_lng },
        map: mapObj.current,
        icon: {
          path: M.SymbolPath.CIRCLE,
          scale, fillColor: color, fillOpacity: 1,
          strokeColor: "#fff", strokeWeight: 2,
        },
        title: `${f.city} — ${f.distance_km}km`,
        zIndex: isSel ? 50 : 10,
      });

      const iw = new M.InfoWindow({
        content: `
          <div style="font-family:Inter,sans-serif;padding:6px 2px;min-width:160px">
            ${isNearest ? '<div style="color:#059669;font-size:10px;font-weight:700;margin-bottom:4px">⭐ NEAREST</div>' : ""}
            <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:4px">${f.city}, ${f.state}</div>
            <div style="font-size:11px;color:#555;display:grid;grid-template-columns:1fr 1fr;gap:4px">
              <span>📏 ${f.distance_km}km</span>
              <span>⭐ ${f.rating}/5</span>
              <span>⏳ ${f.queue_depth} in queue</span>
              <span>💰 ₹${f.committed_price.toLocaleString("en-IN")}</span>
            </div>
          </div>
        `,
      });

      marker.addListener("click", () => {
        infoWins.current.forEach(w => w.close());
        iw.open(mapObj.current, marker);
        setSelected(f);
      });

      markers.current.push(marker);
      infoWins.current.push(iw);
      bounds.extend({ lat: f.city_lat, lng: f.city_lng });
    });

    mapObj.current.fitBounds(bounds, { top: 60, bottom: 20, left: 20, right: 20 });
  }, [step, factories, selected, address]);

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════

  return (
    <div style={{ background:C.bg, borderRadius:16, overflow:"hidden",
      border:`1px solid ${C.border}`, fontFamily:"Inter,sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ background:C.card, padding:"16px 20px", borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ color:C.t1, fontWeight:700, fontSize:15 }}>🏭 Find Your Factory</div>
          <div style={{ color:C.t3, fontSize:11, marginTop:2 }}>{designTitle}</div>
        </div>
        <button onClick={onCancel} style={{ background:"none", border:"none",
          color:C.t3, fontSize:20, cursor:"pointer", lineHeight:1 }}>×</button>
      </div>

      {/* ── Address Step ────────────────────────────────────────── */}
      {step === "address" && (
        <div style={{ padding:20 }}>
          <p style={{ color:C.t2, fontSize:13, marginBottom:16 }}>
            Enter your delivery location to find available factories near you.
          </p>
          {error && (
            <div style={{ background:"#F8717115", border:"1px solid #F8717130", borderRadius:8,
              padding:"10px 14px", color:C.red, fontSize:12, marginBottom:14 }}>
              {error}
            </div>
          )}
          <div style={{ marginBottom:12 }}>
            <AddressAutocomplete
              placeholder="Search delivery address or pincode…"
              onPlace={addr => { setAddress(addr); fetchFactories(addr); }}
            />
          </div>
          <div style={{ textAlign:"center", margin:"14px 0", color:C.t3, fontSize:12 }}>or</div>
          <button onClick={useGPS} disabled={gpsLoading} style={{
            width:"100%", padding:"11px 0", borderRadius:10,
            background:gpsLoading ? C.card2 : `${C.blue}15`,
            border:`1px solid ${gpsLoading ? C.border : C.blue}40`,
            color:gpsLoading ? C.t3 : C.blue, fontSize:13, fontWeight:600,
            cursor:gpsLoading ? "default" : "pointer",
          }}>
            {gpsLoading ? "📡 Locating…" : "📡 Use my current location"}
          </button>
          <div style={{ marginTop:14, background:"#0C1A14", borderRadius:8, padding:"10px 12px",
            display:"flex", gap:8, alignItems:"flex-start" }}>
            <span style={{ fontSize:13 }}>🔒</span>
            <p style={{ color:"#6EE7B7", fontSize:11, margin:0 }}>
              Factory locations are shown at city level only. Your exact address is
              shared with your assigned factory only after payment is confirmed.
            </p>
          </div>
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────── */}
      {step === "loading" && (
        <div style={{ padding:"40px 20px", textAlign:"center" }}>
          <div style={{ fontSize:36, marginBottom:12 }}>🗺️</div>
          <p style={{ color:C.t2, fontSize:14 }}>Finding factories near {address?.city}…</p>
          <p style={{ color:C.t3, fontSize:11 }}>Ranking factories by shortest distance to you</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────── */}
      {step === "results" && (
        <div>
          {/* Map */}
          <div ref={mapRef} style={{ width:"100%", height:280 }} />

          {/* Legend */}
          <div style={{ background:C.card2, padding:"8px 16px", display:"flex", gap:16, fontSize:11, color:C.t3 }}>
            <span>🔵 You</span>
            <span>🟢 Nearest</span>
            <span>🟡 Selected</span>
            <span>🟣 Other factories</span>
          </div>

          {/* Factory list */}
          <div style={{ padding:16, display:"flex", flexDirection:"column", gap:8, maxHeight:300, overflowY:"auto" }}>
            <p style={{ color:C.t3, fontSize:11, margin:"0 0 4px" }}>
              {factories.length} {factories.length === 1 ? "factory" : "factories"} available · Tap to select
            </p>
            {factories.map((f, i) => {
              const isSel = selected?.commitment_id === f.commitment_id;
              const isNearest = i === 0;
              return (
                <div key={f.commitment_id}
                  onClick={() => setSelected(f)}
                  style={{
                    background: isSel ? `${C.green}10` : C.card,
                    border: `1px solid ${isSel ? C.green : C.border}`,
                    borderRadius:10, padding:"12px 14px", cursor:"pointer",
                    transition:"all 0.15s",
                  }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                    <div>
                      <span style={{ color:C.t1, fontWeight:700, fontSize:13 }}>{f.city}, {f.state}</span>
                      {isNearest && (
                        <span style={{ marginLeft:8, fontSize:10, padding:"2px 7px", borderRadius:20,
                          background:`${C.green}20`, color:C.green, fontWeight:700 }}>
                          ⭐ Nearest
                        </span>
                      )}
                    </div>
                    <span style={{ color:C.green, fontWeight:700, fontSize:14 }}>
                      ₹{f.committed_price.toLocaleString("en-IN")}
                    </span>
                  </div>
                  {/* Score bar */}
                  <div style={{ height:3, background:C.border, borderRadius:3, marginBottom:10 }}>
                    <div style={{ height:"100%", borderRadius:3, background:C.green,
                      width:scoreBar(f.score), transition:"width 0.3s" }} />
                  </div>
                  <div style={{ display:"flex", gap:16, fontSize:11, color:C.t2 }}>
                    <span>📏 {f.distance_km}km away</span>
                    <span>⭐ {f.rating}/5.0</span>
                    <span>⏳ {f.queue_depth} in queue</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Confirm button */}
          <div style={{ padding:"0 16px 16px" }}>
            <button
              onClick={() => selected && address && onSelect(selected, address)}
              disabled={!selected}
              style={{
                width:"100%", padding:"13px 0", borderRadius:10,
                background:C.green, border:"none", color:"#060810",
                fontSize:14, fontWeight:700, cursor:"pointer",
                fontFamily:"Inter,sans-serif",
              }}>
              ✅ Order from {selected?.city} — {selected?.distance_km}km away
            </button>
            <p style={{ color:C.t3, fontSize:10, textAlign:"center", margin:"8px 0 0" }}>
              Factory location shown at city level · Exact address never shared publicly
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const DARK_STYLE = [
  { elementType:"geometry",         stylers:[{ color:"#0C1018" }] },
  { elementType:"labels.text.fill", stylers:[{ color:"#B8C4D8" }] },
  { featureType:"road", elementType:"geometry", stylers:[{ color:"#1A2230" }] },
  { featureType:"water", elementType:"geometry", stylers:[{ color:"#060810" }] },
  { featureType:"poi",  elementType:"geometry", stylers:[{ color:"#0C1018" }] },
];
