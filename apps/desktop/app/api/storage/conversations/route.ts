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
 * PUT  → body { conversations, tombstones? }
 *          full sync (upsert + deletion propagation). `tombstones` lists
 *          client-side deletions ({ id, deletedAt }[]): those ids are removed
 *          and never re-inserted from a stale payload.
 *        body { tombstones } (no conversations)
 *          delete-only request, used when a full payload is too large to send
 *          while the page is unloading.
 */

function tombstoneIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const t of raw) {
    const id = typeof t === "string" ? t : (t as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

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

  let body: { conversations?: unknown; tombstones?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = body.conversations;
  const deletedIds = tombstoneIds(body.tombstones);
  if (!Array.isArray(incoming)) {
    if (deletedIds.length === 0) {
      return NextResponse.json({ error: "conversations array required" }, { status: 400 });
    }
    try {
      getConversationStore().deleteMany(deletedIds);
      return NextResponse.json({ ok: true, deleted: deletedIds.length });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not delete conversations" },
        { status: 500 },
      );
    }
  }

  try {
    getConversationStore().replaceAll(incoming as ConversationDoc[], deletedIds);
    return NextResponse.json({ ok: true, count: incoming.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save conversations" },
      { status: 500 },
    );
  }
}
