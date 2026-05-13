import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Server-side code can use Node.js built-ins (child_process, etc.)
  serverExternalPackages: [],
};

export default nextConfig;
