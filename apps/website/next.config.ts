import type { NextConfig } from "next";

// A fully static site: `next build` writes plain HTML/CSS/JS to out/, which
// Vercel (or any static host) serves as-is. Release data is fetched once at
// build time, so a redeploy picks up a new Marven release.
const nextConfig: NextConfig = {
  output: "export",
  // This app lives in apps/website; keep Next from treating the repo root
  // (which has its own package.json) as the project root.
  outputFileTracingRoot: __dirname,
  images: { unoptimized: true },
};

export default nextConfig;
