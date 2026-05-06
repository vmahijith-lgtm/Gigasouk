// layout.tsx — GigaSouk Root Layout
// Wraps every page with AuthProvider for session + role management.
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth-context";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#060810",
};

export const metadata: Metadata = {
  title:       "GigaSouk — Cloud Factory Infrastructure for India",
  description: "Order custom-manufactured products made locally. AI-routed, escrow-secured, quality-verified.",
  metadataBase: new URL("https://gigasouk.com"),
  icons: {
    icon: "/brand/logo.svg",
    shortcut: "/brand/logo.svg",
    apple: "/brand/logo.svg",
  },
  openGraph: {
    title:       "GigaSouk",
    description: "India's Manufacturing OS",
    url:         "https://gigasouk.com",
    siteName:    "GigaSouk",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        {/* Razorpay checkout SDK */}
        <script src="https://checkout.razorpay.com/v1/checkout.js" async />
        {/* Google Maps JS API — only load when key is set (avoids broken requests / console noise) */}
        {process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ? (
          <script
            src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}&libraries=places&loading=async`}
            async
          />
        ) : null}
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
