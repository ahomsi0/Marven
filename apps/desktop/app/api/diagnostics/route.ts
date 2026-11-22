import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import packageJson from "@/package.json";
import { getStats } from "@/app/api/index/_state";

const PROVIDER_ENV = [
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "NIM_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

export function GET(req: NextRequest) {
  const root = req.nextUrl.searchParams.get("workspaceRoot")?.trim() || null;
  return NextResponse.json({
    appVersion: packageJson.version,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    generatedAt: new Date().toISOString(),
    configuredProviders: Object.fromEntries(PROVIDER_ENV.map((key) => [key, !!process.env[key]])),
    workspace: root ? { configured: true, id: crypto.createHash("sha256").update(root).digest("hex").slice(0, 12), index: getStats(root) } : { configured: false },
    privacy: { telemetry: false, secretsIncluded: false, workspacePathIncluded: false },
  });
}
