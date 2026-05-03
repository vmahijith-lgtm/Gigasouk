// next.config.mjs — GigaSouk Next.js Configuration
// To add a new allowed image domain: add it to the domains array below.

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silence monorepo lockfile warning by setting tracing root explicitly.
  outputFileTracingRoot: path.join(__dirname, ".."),
  images: {
    domains: [
      "gigasouk.com",
      "your-project-id.supabase.co",   // Replace with your actual Supabase project ID
    ],
  },
  // Redirect www to non-www
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gigasouk.com" }],
        destination: "https://gigasouk.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
