import { NextRequest, NextResponse } from "next/server";
import { modelSupportsVision } from "@/lib/modelCapabilities";

/** GET /api/models/capabilities?provider=&model= → { vision: boolean } */
export async function GET(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get("provider") ?? "").trim().toLowerCase().slice(0, 32);
  const model = (req.nextUrl.searchParams.get("model") ?? "").trim().slice(0, 256);
  const vision = await modelSupportsVision(provider, model).catch(() => false);
  return NextResponse.json({ vision });
}
