import { NextRequest, NextResponse } from "next/server";
import { mcpClient } from "@/lib/mcpClient";
import type { MCPServer } from "@/types";

export async function GET() {
  try {
    return NextResponse.json({ status: mcpClient.getStatus() });
  } catch (err) {
    return NextResponse.json(
      { status: {}, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action: "start" | "stop" | "restart";
    server: MCPServer;
  };

  try {
    if (body.action === "stop") {
      mcpClient.stop(body.server.id);
    } else {
      // "start" or "restart" — start handles both
      await mcpClient.start(body.server);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
