import { NextRequest, NextResponse } from "next/server";
import { mcpClient } from "@/lib/mcpClient";
import type { MCPServer } from "@/types";
import { crossOriginRejection } from "@/lib/apiGuards";

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
  const rejection = crossOriginRejection(req);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 403 });
  let body: {
    action: "start" | "stop" | "restart";
    server: MCPServer;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.server || typeof body.server.id !== "string" || typeof body.server.command !== "string" || body.server.command.length > 2000) {
    return NextResponse.json({ ok: false, error: "Invalid MCP server configuration" }, { status: 400 });
  }
  if (body.action !== "stop" && body.server.trusted === false) {
    return NextResponse.json({ ok: false, error: "MCP server is not trusted. Review and trust it before connecting." }, { status: 403 });
  }

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
