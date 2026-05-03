/**
 * Loads Razorpay Checkout once and returns the constructor.
 * API secrets stay on the server — browser only loads checkout.js + publishable key from API.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let loadPromise: Promise<NonNullable<typeof window.Razorpay>> | null = null;

export function loadRazorpayCheckout(): Promise<NonNullable<typeof window.Razorpay>> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay checkout requires a browser"));
  }
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => {
        if (window.Razorpay) resolve(window.Razorpay);
        else reject(new Error("Razorpay global missing after script load"));
      };
      s.onerror = () => reject(new Error("Failed to load Razorpay checkout script"));
      document.head.appendChild(s);
    });
  }
  return loadPromise;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}
