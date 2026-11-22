import type { NextConfig } from "next";

// This app lives in apps/desktop of a repo that also holds the website. Pin
// file tracing to this folder so the standalone server keeps its layout
// (.next/standalone/server.js) even if a lockfile ever appears higher up.
// (Next compiles this file to CommonJS, so __dirname is this folder.)
const appRoot = __dirname;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: appRoot,
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
