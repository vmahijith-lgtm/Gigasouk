// ════════════════════════════════════════════════════════════════
// app/page.tsx — GigaSouk Home / Customer Shop
// Shows the product catalog. Clicking a product opens a modal: product photos
// first, then delivery + factory list (text locations + Google Maps link).
// ════════════════════════════════════════════════════════════════
"use client";
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { getCatalogDesigns } from "../lib/api";
import type { DeliveryAddress } from "../components/MapComponents";
import DesignMediaGallery from "../components/DesignMediaGallery";

// Lazy-load factory picker (loads Google Maps JS for address autocomplete only)
const FactoryFinderMap = lazy(() => import("../components/FactoryFinderMap"));

/* ── Design tokens ─────────────────────────────────────────── */
const T = {
  bg:"#060810", card:"#0C1018", card2:"#111826", border:"#1A2230",
  green:"#00E5A0", gold:"#F5A623", blue:"#4A9EFF", purple:"#A78BFA",
  t1:"#F4F6FC", t2:"#B8C4D8", t3:"#5A6A80",
};

/** Responsive horizontal inset so nav + sections never spill past the viewport on narrow screens */
const padX = "clamp(16px, 5vw, 32px)";

/* ── Types ─────────────────────────────────────────────────── */
interface Design {
  id: string; title: string; base_price: number;
  category?: string; preview_image_url?: string;
  status?: string;
  active_commit_count?: number;
  profiles?: { full_name: string };
}

function preferredToInitialAddress(
  pd: { line1?: string; city?: string; state?: string; pincode?: string; lat?: number; lng?: number } | null | undefined
): DeliveryAddress | null {
  if (!pd || typeof pd.lat !== "number" || typeof pd.lng !== "number") return null;
  return {
    line1: pd.line1 ?? "",
    city: pd.city ?? "",
    state: pd.state ?? "",
    pincode: pd.pincode ?? "",
    lat: pd.lat,
    lng: pd.lng,
  };
}

/* ═══════════════════════════════════════════════════════════ */
export default function HomePage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [fetching, setFetching] = useState(true);
  const [selected, setSelected] = useState<Design | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [orderMsg, setOrderMsg] = useState("");
  const catalogRef = useRef<HTMLDivElement>(null);

  /* Role redirect */
  useEffect(() => {
    if (loading) return;
    if (user?.role === "designer")     router.replace("/designer");
    if (user?.role === "manufacturer") router.replace("/manufacturer");
    if (user?.role === "admin")        router.replace("/admin");
  }, [user, loading, router]);

  /* Catalog: live OR at least one committed factory (backend rules) */
  useEffect(() => {
    (async () => {
      try {
        const { data } = await getCatalogDesigns();
        setDesigns((data as Design[]) || []);
      } catch {
        setDesigns([]);
      } finally {
        setFetching(false);
      }
    })();
  }, []);

  const cats = ["all", ...Array.from(new Set(designs.map(d=>d.category||"").filter(Boolean)))];
  const filtered = designs.filter(d => {
    const mc = cat==="all" || d.category===cat;
    const ms = !search || d.title.toLowerCase().includes(search.toLowerCase());
    return mc && ms;
  });

  // Called by FactoryFinderMap when customer confirms a factory + address
  async function handleOrder(factory: any, address: any) {
    if (!user) { router.push("/auth/login"); return; }
    setOrdering(true);
    try {
      const { placeOrder, createPayment, verifyPayment } = await import("../lib/api");
      const { loadRazorpayCheckout } = await import("../lib/razorpay-checkout");
      const { data: od } = await placeOrder({
        design_id:        selected!.id,
        quantity:         1,
        delivery_address: address,
        commitment_id:    factory.commitment_id,
      });
      const { data: pd } = await createPayment({ order_id: od.order_id });
      const Razorpay = await loadRazorpayCheckout();
      const opts = {
        key: pd.razorpay_key,
        amount: pd.amount,
        currency: "INR",
        order_id: pd.razorpay_order_id,
        name: "GigaSouk",
        description: selected!.title,
        handler: async (r: any) => {
          try {
            await verifyPayment({
              order_id: od.order_id,
              razorpay_order_id: r.razorpay_order_id,
              razorpay_payment_id: r.razorpay_payment_id,
              razorpay_signature: r.razorpay_signature,
            });
            setSelected(null);
            setOrderMsg(`✓ Order ${od.order_ref} placed! Factory in ${factory.city} (${od.distance_km}km away)`);
          } catch (verErr: unknown) {
            const detail =
              verErr && typeof verErr === "object" && "response" in verErr
                ? (verErr as { response?: { data?: { detail?: string } } }).response?.data?.detail
                : undefined;
            setOrderMsg(
              detail ||
                "Payment could not be verified. If money was debited, contact support with your order ref.",
            );
          }
        },
        theme: { color: T.green },
      };
      new Razorpay(opts).open();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setOrderMsg(detail || "Order failed. Try again.");
    } finally {
      setOrdering(false);
    }
  }

  /* Never gate this whole page on auth loading — Supabase latency / dev remounts would
     blank the entire marketing UI. Public hero + catalog render immediately; nav shows a
     tiny placeholder until session + profile are ready (role redirect still waits below). */

  return (
    <div style={{
      background:T.bg,
      minHeight:"100dvh",
      width:"100%",
      maxWidth:"100%",
      boxSizing:"border-box",
      fontFamily:"Inter,sans-serif",
      color:T.t1,
    }}>
      <style>{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
        @keyframes slide-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        .card-hover{transition:transform .2s,border-color .2s,box-shadow .2s}
        .card-hover:hover{transform:translateY(-4px);border-color:#00E5A066!important;box-shadow:0 12px 40px #00E5A010}
        .btn-green{transition:opacity .15s,transform .1s}.btn-green:hover{opacity:.88;transform:scale(1.02)}
        .cat-btn{transition:all .15s}
      `}</style>

      {/* ── Sticky Nav ──────────────────────────────────────────── */}
      <nav style={{position:"sticky",top:0,zIndex:50,backdropFilter:"blur(16px)",
        background:T.bg+"dd",borderBottom:`1px solid ${T.border}`,
        display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",
        rowGap:12,padding:`14px ${padX}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div>
            <span style={{fontSize:20,fontWeight:900,color:T.t1,letterSpacing:"-0.5px"}}>GIGA</span>
            <span style={{fontSize:20,fontWeight:900,color:T.green,letterSpacing:"-0.5px"}}>SOUK</span>
          </div>
          <span style={{fontSize:11,color:T.t3,padding:"3px 10px",border:`1px solid ${T.border}`,
            borderRadius:20,letterSpacing:".06em"}}>BETA</span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",minHeight:36}}>
          {loading ? (
            <span style={{fontSize:12,color:T.t3,letterSpacing:"0.12em"}} aria-busy>
              Session…
            </span>
          ) : user ? (
            <>
              <span style={{fontSize:13,color:T.t2}}>{user.fullName}</span>
              {user.role === "customer" && (
                <NavBtn href="/customer" label="My dashboard" ghost />
              )}
              <button
                type="button"
                onClick={() => signOut()}
                style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
                  cursor:"pointer",background:"transparent",color:T.t2,
                  border:`1px solid ${T.border}`}}>
                Sign Out
              </button>
            </>
          ) : (
            <>
              <NavBtn href="/auth/login"  label="Sign In"  ghost />
              <NavBtn href="/auth/signup" label="Get Started" />
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section style={{position:"relative",overflow:"hidden",padding:`96px ${padX} 80px`,textAlign:"center"}}>
        <div style={{position:"absolute",top:-100,left:"50%",transform:"translateX(-50%)",
          width:600,height:600,borderRadius:"50%",
          background:"radial-gradient(circle,#00E5A018 0%,transparent 70%)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",top:80,left:"10%",width:200,height:200,borderRadius:"50%",
          background:"radial-gradient(circle,#4A9EFF0A 0%,transparent 70%)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",top:40,right:"8%",width:160,height:160,borderRadius:"50%",
          background:"radial-gradient(circle,#A78BFA0A 0%,transparent 70%)",pointerEvents:"none"}}/>

        <div style={{animation:"slide-up .7s ease both"}}>
          <p style={{fontSize:11,fontWeight:700,color:T.green,letterSpacing:".14em",
            textTransform:"uppercase",marginBottom:16}}>
            Manufacturing-as-a-Service · India
          </p>
          <h1 style={{fontSize:"clamp(32px,5vw,60px)",fontWeight:900,lineHeight:1.1,
            maxWidth:680,margin:"0 auto 20px",letterSpacing:"-1px"}}>
            Products made by factories{" "}
            <span style={{color:T.green,position:"relative"}}>near you</span>
          </h1>
          <p style={{fontSize:18,color:T.t2,maxWidth:500,margin:"0 auto 36px",lineHeight:1.7}}>
            Pick your factory on the map. AI scores the nearest options.
            Quality checked by computer vision. Money released only on delivery.
          </p>

          <div style={{display:"flex",gap:14,justifyContent:"center",flexWrap:"wrap",marginBottom:48}}>
            <button className="btn-green"
              onClick={() => catalogRef.current?.scrollIntoView({behavior:"smooth"})}
              style={{padding:"14px 32px",borderRadius:10,border:"none",background:T.green,
                color:T.bg,fontWeight:800,fontSize:15,cursor:"pointer"}}>
              Browse Products ↓
            </button>
            <NavBtn href="/auth/signup" label="Become a Designer →" ghost />
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
            {[
              {icon:"🏭",label:"500+ MSME Factories"},
              {icon:"🗺️",label:"Map-based Routing"},
              {icon:"🤖",label:"AI Quality Gate"},
              {icon:"🔒",label:"Razorpay Escrow"},
              {icon:"♻️",label:"Zero Inventory"},
            ].map(b=>(
              <span key={b.label} style={{fontSize:12,color:T.t3,padding:"6px 14px",
                border:`1px solid ${T.border}`,borderRadius:20,display:"flex",gap:6,alignItems:"center"}}>
                {b.icon} {b.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ───────────────────────────────────────────────── */}
      <section style={{padding:`0 ${padX} 64px`}}>
        <div style={{maxWidth:900,margin:"0 auto",display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:16}}>
          {[
            {val:"500+",label:"Partner Factories",color:T.green},
            {val:"±0.5mm",label:"AI QC Tolerance",color:T.blue},
            {val:"48h",label:"Max Route Time",color:T.gold},
            {val:"100%",label:"Escrow Protected",color:T.purple},
          ].map(s=>(
            <div key={s.label} className="card-hover"
              style={{background:T.card,border:`1px solid ${T.border}`,
                borderRadius:14,padding:"24px 20px",textAlign:"center"}}>
              <p style={{fontSize:32,fontWeight:900,color:s.color,marginBottom:4}}>{s.val}</p>
              <p style={{fontSize:12,color:T.t3}}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────── */}
      <section style={{padding:`0 ${padX} 80px`}}>
        <div style={{maxWidth:900,margin:"0 auto"}}>
          <p style={{fontSize:11,fontWeight:700,color:T.green,letterSpacing:".12em",
            textTransform:"uppercase",textAlign:"center",marginBottom:10}}>The Platform</p>
          <h2 style={{fontSize:30,fontWeight:800,textAlign:"center",marginBottom:48,
            letterSpacing:"-0.5px"}}>How GigaSouk works</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16}}>
            {[
              {n:"01",icon:"✏️",title:"Designer uploads",body:"A designer uploads a CAD file and sets a royalty price."},
              {n:"02",icon:"🏭",title:"Factories commit",body:"Nearby MSME factories commit to manufacture it. The designer then publishes when it goes on sale."},
              {n:"03",icon:"🗺️",title:"Pick your factory",body:"After the designer publishes, enter your pincode and choose a factory on the map."},
              {n:"04",icon:"🤖",title:"AI quality check",body:"Factory uploads 5 photos. OpenCV verifies dimensions to ±0.5mm."},
              {n:"05",icon:"🚚",title:"Ships to you",body:"Pass QC → auto-ship via Shiprocket. Track in real-time."},
              {n:"06",icon:"🔒",title:"Escrow releases",body:"On delivery, Razorpay splits fees to designer, factory & platform."},
            ].map(s=>(
              <div key={s.n} className="card-hover"
                style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:24}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                  <span style={{fontSize:10,fontWeight:800,color:T.green,opacity:.6}}>{s.n}</span>
                  <span style={{fontSize:22}}>{s.icon}</span>
                </div>
                <p style={{fontSize:14,fontWeight:700,color:T.t1,marginBottom:6}}>{s.title}</p>
                <p style={{fontSize:13,color:T.t3,lineHeight:1.6}}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product Catalog ─────────────────────────────────────── */}
      <section ref={catalogRef} style={{padding:`0 ${padX} 80px`}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <p style={{fontSize:11,fontWeight:700,color:T.green,letterSpacing:".12em",
            textTransform:"uppercase",textAlign:"center",marginBottom:10}}>Catalog</p>
          <h2 style={{fontSize:30,fontWeight:800,textAlign:"center",marginBottom:32,
            letterSpacing:"-0.5px"}}>Shop the catalog</h2>

          <div style={{display:"flex",gap:12,marginBottom:24,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{flex:1,minWidth:220,display:"flex",alignItems:"center",gap:8,
              background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"0 14px"}}>
              <span style={{color:T.t3,fontSize:16}}>🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Search products…"
                style={{flex:1,background:"none",border:"none",outline:"none",
                  color:T.t1,fontSize:14,padding:"11px 0"}}/>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {cats.map(c=>(
                <button key={c} className="cat-btn" onClick={()=>setCat(c)}
                  style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,
                    cursor:"pointer",textTransform:"capitalize",
                    border:`1px solid ${c===cat?T.green:T.border}`,
                    background:c===cat?T.green+"22":T.card2,
                    color:c===cat?T.green:T.t3}}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {orderMsg && !selected && (
            <div style={{background:T.green+"18",border:`1px solid ${T.green}`,
              borderRadius:10,padding:"14px 18px",marginBottom:24,fontSize:14,color:T.green}}>
              {orderMsg}
            </div>
          )}

          {fetching && <div style={{textAlign:"center",padding:60,color:T.t3}}>Loading products…</div>}
          {!fetching && filtered.length===0 && (
            <div style={{textAlign:"center",padding:60,color:T.t3}}>
              <p style={{fontSize:32,marginBottom:12}}>⚙️</p>
              <p style={{fontSize:15}}>No products available yet. Listings appear when a design is live or at least one factory has committed.</p>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:20}}>
            {filtered.map(d=>(
              <div key={d.id} className="card-hover"
                onClick={()=>{setSelected(d);setOrderMsg("");}}
                style={{background:T.card,border:`1px solid ${T.border}`,
                  borderRadius:14,overflow:"hidden",cursor:"pointer"}}>
                <div style={{height:180,background:T.card2,display:"flex",
                  alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                  {d.preview_image_url
                    ? <img src={d.preview_image_url} alt={d.title}
                        style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                    : <span style={{fontSize:48}}>⚙️</span>}
                </div>
                <div style={{padding:18}}>
                  <span style={{fontSize:10,fontWeight:700,color:T.t3,
                    textTransform:"uppercase",letterSpacing:".08em"}}>{d.category||"Product"}</span>
                  <p style={{fontSize:15,fontWeight:700,color:T.t1,margin:"6px 0 10px",
                    lineHeight:1.3}}>{d.title}</p>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <p style={{fontSize:22,fontWeight:900,color:T.green}}>
                      ₹{Number(d.base_price).toLocaleString("en-IN")}
                    </p>
                    <span style={{fontSize:11,color:d.status==="live"?T.green:T.gold,display:"flex",gap:5,alignItems:"center"}}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:d.status==="live"?T.green:T.gold,
                        display:"inline-block",animation:d.status==="live"?"pulse 2s ease infinite":"none"}}/>
                      {d.status === "live" ? "Live" : "Available"}
                    </span>
                  </div>
                  <p style={{fontSize:11,color:T.t3,marginTop:6}}>
                    by {d.profiles?.full_name||"Designer"} · AI-QC verified
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ──────────────────────────────────────────── */}
      <section style={{padding:`0 ${padX} 80px`}}>
        <div style={{maxWidth:900,margin:"0 auto",borderRadius:20,
          padding:"clamp(28px, 6vw, 56px) clamp(18px, 4vw, 40px)",
          textAlign:"center",background:`linear-gradient(135deg,#00E5A012 0%,#4A9EFF08 100%)`,
          border:`1px solid ${T.green}33`}}>
          <p style={{fontSize:11,fontWeight:700,color:T.green,letterSpacing:".12em",
            textTransform:"uppercase",marginBottom:12}}>Join the ecosystem</p>
          <h2 style={{fontSize:32,fontWeight:900,marginBottom:16,letterSpacing:"-0.5px"}}>
            Are you a designer or factory owner?
          </h2>
          <p style={{fontSize:16,color:T.t2,maxWidth:480,margin:"0 auto 32px"}}>
            Designers earn royalties on every sale. Manufacturers get a steady stream of AI-routed jobs.
          </p>
          <div style={{display:"flex",gap:14,justifyContent:"center",flexWrap:"wrap"}}>
            <a href="/auth/signup?role=designer"
              style={{padding:"13px 28px",borderRadius:10,background:T.green,
                color:T.bg,fontWeight:800,fontSize:14,textDecoration:"none"}}>
              Start as Designer ✏️
            </a>
            <a href="/auth/signup?role=manufacturer"
              style={{padding:"13px 28px",borderRadius:10,border:`1px solid ${T.border}`,
                color:T.t2,fontWeight:700,fontSize:14,textDecoration:"none",background:T.card}}>
              Register Factory 🏭
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer style={{padding:`24px ${padX}`,borderTop:`1px solid ${T.border}`,
        display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <span style={{fontSize:16,fontWeight:900,color:T.t1}}>GIGA</span>
          <span style={{fontSize:16,fontWeight:900,color:T.green}}>SOUK</span>
          <p style={{fontSize:12,color:T.t3,marginTop:2}}>
            © 2026 · Cloud Factory Infrastructure for India
          </p>
        </div>
        <div style={{display:"flex",gap:20}}>
          {[
            {href:"/auth/login",label:"Designer Login"},
            {href:"/auth/login",label:"Manufacturer Login"},
            {href:"/auth/signup",label:"Register"},
          ].map(l=>(
            <a key={l.label} href={l.href}
              style={{fontSize:12,color:T.t3,textDecoration:"none"}}>{l.label}</a>
          ))}
        </div>
      </footer>

      {/* ── Order Modal: photos first, then factory picker (no embedded map) ─ */}
      {selected && (
        <div onClick={()=>setSelected(null)}
          style={{position:"fixed",inset:0,background:"#00000095",zIndex:100,
            display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 20px",
            overflowY:"auto"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{width:"100%",maxWidth:680,marginTop:12,marginBottom:24}}>

            <DesignMediaGallery
              designId={selected.id}
              title={selected.title}
              panel
              storefront
              emphasizePhotos
            />

            {!user ? (
              /* Not signed in */
              <div style={{background:T.card,borderRadius:16,padding:36,
                border:`1px solid ${T.border}`,textAlign:"center"}}>
                <div style={{fontSize:44,marginBottom:14}}>🔐</div>
                <p style={{color:T.t1,fontWeight:700,fontSize:17,marginBottom:8}}>
                  Sign in to order
                </p>
                <p style={{color:T.t3,fontSize:13,marginBottom:24}}>
                  You need an account to see available factories and place an order.
                </p>
                <a href="/auth/login"
                  style={{display:"inline-block",padding:"12px 28px",borderRadius:10,
                    background:T.green,color:T.bg,fontWeight:800,fontSize:14,
                    textDecoration:"none"}}>
                  Sign In
                </a>
                <button onClick={()=>setSelected(null)}
                  style={{display:"block",margin:"14px auto 0",background:"none",border:"none",
                    color:T.t3,fontSize:13,cursor:"pointer"}}>
                  Cancel
                </button>
              </div>
            ) : (
              /* Signed in → Factory picker map */
              <Suspense fallback={
                <div style={{background:T.card,borderRadius:16,padding:40,textAlign:"center",
                  border:`1px solid ${T.border}`,fontFamily:"Inter,sans-serif"}}>
                  <p style={{color:T.t3}}>Loading map…</p>
                </div>
              }>
                <FactoryFinderMap
                  designId={selected.id}
                  designTitle={selected.title}
                  onSelect={(factory: any, address: any) => handleOrder(factory, address)}
                  onCancel={() => setSelected(null)}
                  initialAddress={preferredToInitialAddress(user.preferredDelivery)}
                />
              </Suspense>
            )}

            {orderMsg && (
              <div style={{marginTop:12,background:T.gold+"18",
                border:`1px solid ${T.gold}`,borderRadius:10,
                padding:"12px 16px",fontSize:13,color:T.gold}}>
                {orderMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────── */
function NavBtn({href,label,ghost}:{href:string;label:string;ghost?:boolean}) {
  return (
    <a href={href} style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
      cursor:"pointer",textDecoration:"none",
      background:ghost?"transparent":T.green,
      color:ghost?T.t2:T.bg,
      border:ghost?`1px solid ${T.border}`:"none"}}>
      {label}
    </a>
  );
}

