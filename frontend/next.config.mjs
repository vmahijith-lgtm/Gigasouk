// next.config.mjs — GigaSouk Next.js Configuration
// To add a new allowed image domain: add it to the domains array below.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Do not set outputFileTracingRoot to the repo parent when deploying from Vercel with
  // Root Directory = "frontend" — it breaks output paths (ENOENT routes-manifest.json,
  // doubled paths like path1/path1/.next/…).

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
