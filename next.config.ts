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
    // sqlite-vec's ESM build uses `import.meta.resolve`, which Next.js's
    // bundler turns into `{}.resolve()` (TypeError at runtime). Keeping it
    // (and its peer better-sqlite3) external lets Node load them natively.
    "sqlite-vec",
    "better-sqlite3",
  ],
};

export default nextConfig;
