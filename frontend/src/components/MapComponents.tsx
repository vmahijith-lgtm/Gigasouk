"use client";
// ════════════════════════════════════════════════════════════════
// components/MapComponents.tsx — Shared Google Maps UI
//
// Exports:
//   AddressAutocomplete  — smart address input → returns lat/lng
//   OrderMap             — 2-pin map: customer + factory after ordering
//   TrackingMap          — live shipment tracking map
//   ManufacturerOrderMap — manufacturer sees all delivery pins
//
// All components are client-only (use Google Maps JS SDK).
// Maps script is loaded once in layout.tsx.
// ════════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────
export interface DeliveryAddress {
  line1:   string;
  city:    string;
  state:   string;
  pincode: string;
  lat:     number;
  lng:     number;
}

export interface MapPin {
  lat:   number;
  lng:   number;
  label: string;
  color: "green" | "blue" | "red" | "yellow";
}

// ── Dark map style matching GigaSouk theme ────────────────────────
const DARK_MAP_STYLE = [
  { elementType: "geometry",            stylers: [{ color: "#0C1018" }] },
  { elementType: "labels.text.stroke",  stylers: [{ color: "#060810" }] },
  { elementType: "labels.text.fill",    stylers: [{ color: "#B8C4D8" }] },
  { featureType: "road",              elementType: "geometry",      stylers: [{ color: "#1A2230" }] },
  { featureType: "road",              elementType: "labels.text.fill", stylers: [{ color: "#5A6A80" }] },
  { featureType: "water",             elementType: "geometry",      stylers: [{ color: "#060810" }] },
  { featureType: "poi",               elementType: "geometry",      stylers: [{ color: "#0C1018" }] },
  { featureType: "transit",           elementType: "geometry",      stylers: [{ color: "#111826" }] },
  { featureType: "administrative",    elementType: "geometry.stroke", stylers: [{ color: "#1A2230" }] },
];

// ── Colour to Maps icon URL ───────────────────────────────────────
const PIN_ICONS: Record<string, string> = {
  green:  "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
  blue:   "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
  red:    "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
  yellow: "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png",
};

// ════════════════════════════════════════════════════════════════
// 1. ADDRESS AUTOCOMPLETE
//    Replace every address form with this. Returns full address + lat/lng.
// ════════════════════════════════════════════════════════════════

export function AddressAutocomplete({
  onPlace,
  placeholder = "Search your delivery address…",
}: {
  onPlace: (addr: DeliveryAddress) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let attempts = 0;
    const init = () => {
      const G = (window as any).google;
      if (!G || !inputRef.current) {
        // Google Maps script may still be loading — retry up to 20x
        if (attempts++ < 20) setTimeout(init, 300);
        return;
      }
      const ac = new G.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "in" },
        fields: ["address_components", "geometry", "formatted_address"],
        types: ["address"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (!place.geometry) return;
        const comps: any[] = place.address_components || [];
        const get = (type: string) =>
          comps.find((c: any) => c.types.includes(type))?.long_name || "";
        onPlace({
          line1:   get("route") || get("premise") || get("sublocality_level_1"),
          city:    get("locality") || get("administrative_area_level_2"),
          state:   get("administrative_area_level_1"),
          pincode: get("postal_code"),
          lat:     place.geometry!.location!.lat(),
          lng:     place.geometry!.location!.lng(),
        });
      });
    };
    init();
  }, [onPlace]);

  return (
    <div style={{ position: "relative" }}>
      <span style={{
        position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
        fontSize: 16, pointerEvents: "none",
      }}>📍</span>
      <input
        ref={inputRef}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "12px 14px 12px 36px", boxSizing: "border-box",
          borderRadius: 8, background: "#111826", border: "1px solid #1A2230",
          color: "#F4F6FC", fontSize: 14, outline: "none",
          fontFamily: "Inter, sans-serif",
        }}
        onFocus={e => (e.target.style.borderColor = "#00E5A0")}
        onBlur={e  => (e.target.style.borderColor = "#1A2230")}
      />
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// 2. ORDER MAP
//    Shows after order placement — customer pin + factory pin + route line.
// ════════════════════════════════════════════════════════════════

export function OrderMap({
  customerLat, customerLng,
  factoryLat,  factoryLng,
  factoryCity, distanceKm,
}: {
  customerLat: number; customerLng: number;
  factoryLat:  number; factoryLng:  number;
  factoryCity: string; distanceKm:  number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const G = (window as any).google;
    if (!G || !mapRef.current) return;
    const M = G.maps;

    const center = {
      lat: (customerLat + factoryLat) / 2,
      lng: (customerLng + factoryLng) / 2,
    };

    const map = new M.Map(mapRef.current, {
      center, zoom: 7,
      mapTypeId: "roadmap",
      styles: DARK_MAP_STYLE,
      disableDefaultUI: true,
      zoomControl: true,
    });

    // Customer pin (blue)
    const custMarker = new M.Marker({
      position: { lat: customerLat, lng: customerLng },
      map,
      icon: PIN_ICONS.blue,
      title: "Your delivery address",
    });
    new M.InfoWindow({ content: `<div style="color:#111;font-size:13px">📦 Your delivery location</div>` })
      .open(map, custMarker);

    // Factory pin (green)
    const factMarker = new M.Marker({
      position: { lat: factoryLat, lng: factoryLng },
      map,
      icon: PIN_ICONS.green,
      title: `Factory in ${factoryCity}`,
    });
    new M.InfoWindow({ content: `<div style="color:#111;font-size:13px">🏭 Factory in ${factoryCity}<br/>${distanceKm}km away</div>` })
      .open(map, factMarker);

    // Dashed route line
    new M.Polyline({
      path: [
        { lat: customerLat, lng: customerLng },
        { lat: factoryLat,  lng: factoryLng  },
      ],
      geodesic: true,
      strokeColor: "#00E5A0",
      strokeOpacity: 0,
      icons: [{
        icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3, strokeColor: "#00E5A0" },
        offset: "0", repeat: "20px",
      }],
      map,
    });

    // Fit both pins in view
    const bounds = new M.LatLngBounds();
    bounds.extend({ lat: customerLat, lng: customerLng });
    bounds.extend({ lat: factoryLat,  lng: factoryLng  });
    map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
  }, [customerLat, customerLng, factoryLat, factoryLng, factoryCity, distanceKm]);

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #1A2230" }}>
      <div style={{ background: "#111826", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#F4F6FC", fontSize: 13, fontWeight: 600 }}>🗺️ Your Factory</span>
        <span style={{ color: "#00E5A0", fontSize: 13 }}>🏭 {factoryCity} — {distanceKm}km</span>
      </div>
      <div ref={mapRef} style={{ width: "100%", height: 280 }} />
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// 3. TRACKING MAP
//    Shows current shipment location (geocoded from city name)
//    + customer delivery address pin.
// ════════════════════════════════════════════════════════════════

export function TrackingMap({
  customerLat, customerLng,
  currentCity, currentState,
  status,
}: {
  customerLat:  number; customerLng: number;
  currentCity:  string; currentState: string;
  status:       string;
}) {
  const mapRef  = useRef<HTMLDivElement>(null);
  const shipRef = useRef<any>(null);   // shipment marker

  const geocodeCity = useCallback(async (city: string, state: string) => {
    const G = (window as any).google;
    if (!G) return null;
    return new Promise<{ lat: number; lng: number } | null>(resolve => {
      new G.maps.Geocoder().geocode(
        { address: `${city}, ${state}, India` },
        (results: any, status: string) => {
          if (status === "OK" && results[0]) {
            const loc = results[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else resolve(null);
        }
      );
    });
  }, []);

  useEffect(() => {
    const G = (window as any).google;
    if (!G || !mapRef.current) return;
    const M = G.maps;

    const map = new M.Map(mapRef.current, {
      center:        { lat: customerLat, lng: customerLng },
      zoom:          6,
      mapTypeId:     "roadmap",
      styles:        DARK_MAP_STYLE,
      disableDefaultUI: true,
      zoomControl:   true,
    });

    // Customer / destination pin
    new M.Marker({
      position: { lat: customerLat, lng: customerLng },
      map,
      icon: PIN_ICONS.blue,
      title: "Your delivery address",
    });

    // Geocode the current shipment city and add live pin
    geocodeCity(currentCity, currentState).then(pos => {
      if (!pos) return;
      if (shipRef.current) shipRef.current.setMap(null);
      shipRef.current = new M.Marker({
        position: pos,
        map,
        icon: PIN_ICONS.yellow,
        title: `📦 Package in ${currentCity}`,
        animation: M.Animation.BOUNCE,
      });
      new M.InfoWindow({
        content: `<div style="color:#111;font-size:13px">📦 Package in ${currentCity}, ${currentState}<br/>Status: <b>${status}</b></div>`,
      }).open(map, shipRef.current);

      const bounds = new M.LatLngBounds();
      bounds.extend({ lat: customerLat, lng: customerLng });
      bounds.extend(pos);
      map.fitBounds(bounds, { top: 60, bottom: 40, left: 40, right: 40 });
    });
  }, [customerLat, customerLng, currentCity, currentState, status, geocodeCity]);

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #1A2230" }}>
      <div style={{
        background: "#111826", padding: "10px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ color: "#F4F6FC", fontSize: 13, fontWeight: 600 }}>📦 Live Shipment Tracking</span>
        <span style={{
          fontSize: 11, padding: "3px 8px", borderRadius: 20,
          background: status === "DELIVERED" ? "#00E5A020" : "#F5A62320",
          color:      status === "DELIVERED" ? "#00E5A0"   : "#F5A623",
          fontWeight: 600,
        }}>{status}</span>
      </div>
      <div ref={mapRef} style={{ width: "100%", height: 300 }} />
      <div style={{ background: "#111826", padding: "10px 14px", display: "flex", gap: 16, fontSize: 12, color: "#5A6A80" }}>
        <span>🟡 Package location</span>
        <span>🔵 Your address</span>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════
// 4. MANUFACTURER ORDER MAP
//    Manufacturer sees all active delivery addresses as pins.
//    Helps plan logistics and understand order spread.
// ════════════════════════════════════════════════════════════════

export function ManufacturerOrderMap({
  manufacturerLat, manufacturerLng,
  orders,
}: {
  manufacturerLat: number; manufacturerLng: number;
  orders: Array<{
    order_ref: string;
    status:    string;
    delivery_address: { lat: number; lng: number; city: string };
  }>;
}) {
  const mapRef = useRef<HTMLDivElement>(null);

  const STATUS_PIN: Record<string, string> = {
    confirmed:   "blue",
    cutting:     "yellow",
    qc_review:   "yellow",
    shipped:     "green",
    delivered:   "green",
  };

  useEffect(() => {
    const G = (window as any).google;
    if (!G || !mapRef.current) return;
    const M = G.maps;

    const map = new M.Map(mapRef.current, {
      center:        { lat: manufacturerLat, lng: manufacturerLng },
      zoom:          7,
      mapTypeId:     "roadmap",
      styles:        DARK_MAP_STYLE,
      disableDefaultUI: true,
      zoomControl:   true,
    });

    const bounds = new M.LatLngBounds();

    // Factory location (red star)
    new M.Marker({
      position: { lat: manufacturerLat, lng: manufacturerLng },
      map,
      icon: {
        path: M.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#F87171",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
      title: "Your Factory",
      zIndex: 999,
    });
    bounds.extend({ lat: manufacturerLat, lng: manufacturerLng });

    // Order delivery pins
    orders.forEach(order => {
      const addr = order.delivery_address;
      if (!addr?.lat || !addr?.lng) return;
      const pin  = STATUS_PIN[order.status] || "blue";
      const marker = new M.Marker({
        position: { lat: addr.lat, lng: addr.lng },
        map,
        icon: PIN_ICONS[pin],
        title: `${order.order_ref} — ${order.status}`,
      });
      new M.InfoWindow({
        content: `<div style="color:#111;font-size:12px">
          <b>${order.order_ref}</b><br/>
          📍 ${addr.city || ""}  |  Status: <b>${order.status}</b>
        </div>`,
      }).open(map, marker);
      bounds.extend({ lat: addr.lat, lng: addr.lng });
    });

    if (orders.length > 0) {
      map.fitBounds(bounds, { top: 60, bottom: 40, left: 40, right: 40 });
    }
  }, [manufacturerLat, manufacturerLng, orders]);

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #1A2230" }}>
      <div style={{
        background: "#111826", padding: "10px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ color: "#F4F6FC", fontSize: 13, fontWeight: 600 }}>🗺️ Your Active Orders</span>
        <span style={{ color: "#5A6A80", fontSize: 12 }}>{orders.length} order{orders.length !== 1 ? "s" : ""}</span>
      </div>
      <div ref={mapRef} style={{ width: "100%", height: 340 }} />
      <div style={{
        background: "#111826", padding: "10px 14px",
        display: "flex", gap: 16, fontSize: 12, color: "#5A6A80",
      }}>
        <span>🔴 Your factory</span>
        <span>🔵 Confirmed</span>
        <span>🟡 In production / QC</span>
        <span>🟢 Shipped</span>
      </div>
    </div>
  );
}
