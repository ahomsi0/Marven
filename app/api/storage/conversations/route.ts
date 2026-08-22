import { NextRequest, NextResponse } from "next/server";
import { crossOriginRejection } from "@/lib/apiGuards";
import {
  getConversationStore,
  type ConversationDoc,
} from "@/lib/serverConversationStore";

/**
 * SQLite-backed conversation persistence.
 *
 * GET  → { conversations: [...] }   full list in stored order
 * PUT  → body { conversations }     full sync (upsert + deletion propagation)
 */
export async function GET(req: NextRequest) {
  const rejection = crossOriginRejection(req);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 403 });

  try {
    const conversations = getConversationStore().listAll();
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load conversations" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const rejection = crossOriginRejection(req);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 403 });

  let body: { conversations?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = body.conversations;
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "conversations array required" }, { status: 400 });
  }

  try {
    getConversationStore().replaceAll(incoming as ConversationDoc[]);
    return NextResponse.json({ ok: true, count: incoming.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save conversations" },
      { status: 500 },
    );
  }
}
