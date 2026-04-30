"use client";
// ════════════════════════════════════════════════════════════════
// components/LocationPicker.tsx
//
// Reusable location picker used by:
//   - Manufacturer profile  → set factory location
//   - Customer order flow   → set delivery location
//
// PRIVACY DESIGN:
//   - Browser GPS is used only within this session.
//   - Manufacturer: coordinates stored in DB but never exposed
//     to frontend beyond city name + distance. Customers never
//     see the exact factory address.
//   - Customer: only city/pincode is stored in the order record,
//     not raw GPS. Full address only shared with the manufacturer
//     after payment confirmation.
//   - We show users exactly what will be stored before they confirm.
// ════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from "react";

const C = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF",
  t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80", red:"#F87171",
};

export interface PickedLocation {
  lat:     number;
  lng:     number;
  city:    string;
  state:   string;
  pincode: string;
  line1:   string;
  /** Precision level stored. Manufacturer=city, Customer=address */
  precision: "city" | "address";
}

interface Props {
  /** "manufacturer" rounds coordinates to city precision (~1km grid).
   *  "customer" stores address-level precision for shipping. */
  mode: "manufacturer" | "customer";
  currentCity?:  string;
  currentState?: string;
  hasLocation?:  boolean;
  onSave: (loc: PickedLocation) => Promise<void>;
}

// Round to ~1km grid (3 decimal places ≈ 111m, 2 places ≈ 1.1km)
const toManufacturerPrecision = (n: number) => Math.round(n * 100) / 100;

export default function LocationPicker({ mode, currentCity, currentState, hasLocation, onSave }: Props) {
  const [step,    setStep]    = useState<"idle"|"requesting"|"picking"|"confirming"|"saving"|"done">("idle");
  const [picked,  setPicked]  = useState<PickedLocation | null>(null);
  const [error,   setError]   = useState("");
  const [method,  setMethod]  = useState<"gps"|"search"|null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef   = useRef<HTMLDivElement>(null);
  const markerRef= useRef<any>(null);

  // ── GPS path ─────────────────────────────────────────────────
  const requestGPS = useCallback(() => {
    setStep("requesting");
    setError("");
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location access. Use address search instead.");
      setStep("idle");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => reverseGeocode(pos.coords.latitude, pos.coords.longitude),
      err => {
        const msgs: Record<number, string> = {
          1: "Location permission denied. Please use address search instead.",
          2: "Location unavailable. Use address search.",
          3: "Location request timed out. Use address search.",
        };
        setError(msgs[err.code] || "Could not get location.");
        setStep("idle");
      },
      { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false }
    );
  }, []);

  // ── Reverse geocode lat/lng → address fields ──────────────────
  const reverseGeocode = useCallback((lat: number, lng: number) => {
    const G = (window as any).google;
    if (!G) { setError("Maps not loaded yet. Try again in a moment."); setStep("idle"); return; }
    new G.maps.Geocoder().geocode(
      { location: { lat, lng } },
      (results: any[], status: string) => {
        if (status !== "OK" || !results[0]) {
          setError("Could not identify this location. Try address search.");
          setStep("idle");
          return;
        }
        const comps: any[] = results[0].address_components;
        const get = (type: string) => comps.find((c: any) => c.types.includes(type))?.long_name || "";
        const city = get("locality") || get("administrative_area_level_2");
        const finalLat = mode === "manufacturer" ? toManufacturerPrecision(lat) : lat;
        const finalLng = mode === "manufacturer" ? toManufacturerPrecision(lng) : lng;
        setPicked({
          lat:       finalLat,
          lng:       finalLng,
          city,
          state:     get("administrative_area_level_1"),
          pincode:   get("postal_code"),
          line1:     get("route") || get("sublocality_level_1") || "",
          precision: mode === "manufacturer" ? "city" : "address",
        });
        setStep("confirming");
      }
    );
  }, [mode]);

  // ── Search path (Places Autocomplete) ────────────────────────
  useEffect(() => {
    if (method !== "search" || step !== "picking" || !inputRef.current) return;
    let attempts = 0;
    const init = () => {
      const G = (window as any).google;
      if (!G) { if (attempts++ < 20) setTimeout(init, 300); return; }
      const ac = new G.maps.places.Autocomplete(inputRef.current!, {
        componentRestrictions: { country: "in" },
        fields: ["address_components", "geometry"],
        types: mode === "manufacturer" ? ["(cities)"] : ["address"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (!place.geometry) return;
        const comps: any[] = place.address_components || [];
        const get = (type: string) => comps.find((c: any) => c.types.includes(type))?.long_name || "";
        const rawLat = place.geometry.location.lat();
        const rawLng = place.geometry.location.lng();
        const city   = get("locality") || get("administrative_area_level_2");
        setPicked({
          lat:       mode === "manufacturer" ? toManufacturerPrecision(rawLat) : rawLat,
          lng:       mode === "manufacturer" ? toManufacturerPrecision(rawLng) : rawLng,
          city,
          state:     get("administrative_area_level_1"),
          pincode:   get("postal_code"),
          line1:     get("route") || get("premise") || "",
          precision: mode === "manufacturer" ? "city" : "address",
        });
        setStep("confirming");
      });
    };
    init();
  }, [method, step, mode]);

  // ── Confirmation mini-map ──────────────────────────────────────
  useEffect(() => {
    if (step !== "confirming" || !picked || !mapRef.current) return;
    const G = (window as any).google;
    if (!G) return;
    const M   = G.maps;
    const pos = { lat: picked.lat, lng: picked.lng };
    const map = new M.Map(mapRef.current, {
      center: pos, zoom: mode === "manufacturer" ? 12 : 15,
      mapTypeId: "roadmap",
      styles: DARK_STYLE,
      disableDefaultUI: true, zoomControl: true,
    });
    if (markerRef.current) markerRef.current.setMap(null);
    markerRef.current = new M.Marker({
      position: pos, map,
      icon: mode === "manufacturer"
        ? { path: M.SymbolPath.CIRCLE, scale: 12, fillColor:"#00E5A0", fillOpacity:1, strokeColor:"#fff", strokeWeight:2 }
        : { path: M.SymbolPath.CIRCLE, scale: 10, fillColor:"#4A9EFF", fillOpacity:1, strokeColor:"#fff", strokeWeight:2 },
      title: mode === "manufacturer" ? "Your factory area" : "Your delivery location",
    });
    // For manufacturer: draw ~1km accuracy circle
    if (mode === "manufacturer") {
      new M.Circle({ center: pos, radius: 1100, strokeColor:"#00E5A050",
        strokeWeight:1, fillColor:"#00E5A010", map });
    }
  }, [step, picked, mode]);

  const handleSave = async () => {
    if (!picked) return;
    setStep("saving");
    try {
      await onSave(picked);
      setStep("done");
    } catch {
      setError("Failed to save. Please try again.");
      setStep("confirming");
    }
  };

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  return (
    <div style={{ background:C.card, borderRadius:14, border:`1px solid ${C.border}`, overflow:"hidden" }}>

      {/* Header */}
      <div style={{ padding:"16px 20px", borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ color:C.t1, fontWeight:700, fontSize:14 }}>
            {mode === "manufacturer" ? "🏭 Factory Location" : "📍 Delivery Location"}
          </div>
          <div style={{ color:C.t3, fontSize:11, marginTop:2 }}>
            {mode === "manufacturer"
              ? hasLocation ? `Currently: ${currentCity}, ${currentState}` : "Not set — required for order assignment"
              : "Where should we deliver your order?"}
          </div>
        </div>
        {step === "done" && <span style={{ color:C.green, fontSize:12, fontWeight:600 }}>✅ Saved</span>}
      </div>

      {/* Privacy notice */}
      <div style={{ background:"#0C1A14", padding:"10px 20px", borderBottom:`1px solid ${C.border}`,
        display:"flex", gap:8, alignItems:"flex-start" }}>
        <span style={{ fontSize:14 }}>🔒</span>
        <p style={{ color:"#6EE7B7", fontSize:11, margin:0 }}>
          {mode === "manufacturer"
            ? "Your exact address is never shown to customers. They only see your city and approximate distance."
            : "Your delivery address is only shared with your assigned factory after payment is confirmed."}
        </p>
      </div>

      <div style={{ padding:20 }}>
        {error && (
          <div style={{ background:"#F8717115", border:"1px solid #F8717130", borderRadius:8,
            padding:"10px 14px", color:C.red, fontSize:12, marginBottom:16 }}>
            {error}
          </div>
        )}

        {/* IDLE — choose method */}
        {(step === "idle" || step === "done") && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <button onClick={() => { setMethod("gps"); requestGPS(); }}
              style={btnStyle(C.green)}>
              📡 Use my current location
              <span style={{ fontSize:10, opacity:0.7, marginLeft:8 }}>Browser GPS</span>
            </button>
            <button onClick={() => { setMethod("search"); setStep("picking"); }}
              style={btnStyle(C.blue)}>
              🔍 Search by {mode === "manufacturer" ? "city" : "address or pincode"}
            </button>
            {hasLocation && step === "idle" && (
              <p style={{ color:C.t3, fontSize:11, textAlign:"center", margin:0 }}>
                Current: {currentCity}, {currentState} · Click above to update
              </p>
            )}
          </div>
        )}

        {/* REQUESTING GPS */}
        {step === "requesting" && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📡</div>
            <p style={{ color:C.t2, fontSize:13 }}>Requesting location permission…</p>
            <p style={{ color:C.t3, fontSize:11 }}>Please allow location access in your browser prompt</p>
          </div>
        )}

        {/* SEARCH INPUT */}
        {step === "picking" && method === "search" && (
          <div>
            <p style={{ color:C.t2, fontSize:13, marginBottom:10 }}>
              {mode === "manufacturer"
                ? "Search for your city or area:"
                : "Search for your delivery address:"}
            </p>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14 }}>
                {mode === "manufacturer" ? "🏙️" : "🏠"}
              </span>
              <input
                ref={inputRef}
                placeholder={mode === "manufacturer" ? "e.g. Ludhiana, Punjab" : "e.g. 12 MG Road, Pune"}
                autoFocus
                style={{ width:"100%", boxSizing:"border-box", padding:"11px 14px 11px 36px",
                  borderRadius:8, background:C.card2, border:`1px solid ${C.border}`,
                  color:C.t1, fontSize:14, outline:"none", fontFamily:"Inter,sans-serif" }}
              />
            </div>
            <button onClick={() => setStep("idle")}
              style={{ marginTop:10, background:"none", border:"none", color:C.t3,
                fontSize:12, cursor:"pointer", padding:0 }}>
              ← Back
            </button>
          </div>
        )}

        {/* CONFIRMING */}
        {step === "confirming" && picked && (
          <div>
            {/* What will be stored notice */}
            <div style={{ background:C.card2, borderRadius:8, padding:"10px 14px",
              marginBottom:12, border:`1px solid ${C.border}` }}>
              <p style={{ color:C.t3, fontSize:10, margin:"0 0 6px", fontWeight:600, textTransform:"uppercase" }}>
                What will be stored
              </p>
              {mode === "manufacturer" ? (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  <Field label="City"  value={picked.city} />
                  <Field label="State" value={picked.state} />
                  <Field label="Precision" value="City-level (~1km)" color={C.green} />
                  <Field label="Exact address shared?" value="Never" color={C.green} />
                </div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  <Field label="City"    value={picked.city} />
                  <Field label="Pincode" value={picked.pincode || "—"} />
                  <Field label="Shared with factory" value="After payment only" color={C.gold} />
                </div>
              )}
            </div>

            {/* Mini confirmation map */}
            <div style={{ borderRadius:10, overflow:"hidden", marginBottom:12, border:`1px solid ${C.border}` }}>
              <div ref={mapRef} style={{ width:"100%", height:180 }} />
              <div style={{ background:C.card2, padding:"6px 12px", fontSize:10, color:C.t3 }}>
                {mode === "manufacturer"
                  ? "📍 The green dot and circle show your approximate area (city-level, ~1km)"
                  : "📍 Your delivery pin — exact address shared with factory after payment"}
              </div>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => { setStep("idle"); setPicked(null); }}
                style={{ flex:1, padding:"10px 0", borderRadius:8, background:"none",
                  border:`1px solid ${C.border}`, color:C.t2, fontSize:13, cursor:"pointer" }}>
                Change
              </button>
              <button onClick={handleSave}
                style={{ flex:2, padding:"10px 0", borderRadius:8,
                  background:C.green, border:"none", color:"#060810",
                  fontSize:13, fontWeight:700, cursor:"pointer" }}>
                ✅ Confirm & Save
              </button>
            </div>
          </div>
        )}

        {/* SAVING */}
        {step === "saving" && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <p style={{ color:C.t2, fontSize:13 }}>Saving location…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────
function Field({ label, value, color }: { label:string; value:string; color?:string }) {
  return (
    <div>
      <div style={{ fontSize:10, color:"#5A6A80", marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:12, fontWeight:600, color:color || "#F4F6FC" }}>{value}</div>
    </div>
  );
}

function btnStyle(accent: string) {
  return {
    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
    padding:"12px 16px", borderRadius:10,
    background:`${accent}15`, border:`1px solid ${accent}40`,
    color:accent, fontSize:13, fontWeight:600, cursor:"pointer",
    fontFamily:"Inter,sans-serif",
  } as const;
}

const DARK_STYLE = [
  { elementType:"geometry",           stylers:[{ color:"#0C1018" }] },
  { elementType:"labels.text.fill",   stylers:[{ color:"#B8C4D8" }] },
  { featureType:"road", elementType:"geometry", stylers:[{ color:"#1A2230" }] },
  { featureType:"water", elementType:"geometry", stylers:[{ color:"#060810" }] },
  { featureType:"poi",   elementType:"geometry", stylers:[{ color:"#0C1018" }] },
];
