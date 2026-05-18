import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep heavy native deps out of the SSR bundle. transformers.js drags in
  // onnxruntime-node + sharp which can't run in the edge runtime and bloat
  // the standalone Next server. lib/localStt.ts is "use client" and imports
  // them dynamically, so externalizing here is purely defensive.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
  ],
};

export default nextConfig;
