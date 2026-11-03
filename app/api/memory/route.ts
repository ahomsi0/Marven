import { NextRequest, NextResponse } from "next/server";
import {
  MAX_MEMORY_TEXT,
  MEMORY_ID_RE,
  appendScopedMemory,
  buildScopedMemoryBlock,
  clearScopedMemory,
  deleteScopedMemoryEntry,
  editScopedMemoryEntry,
  readAllMemoryEntries,
  readAllMemoryScopes,
  type MemoryContext,
  type MemoryScope,
} from "@/lib/memoryClient";

// GET     ?workspaceRoot&conversationId  → { scopes, entries, combined }
// POST    { content, scope?, ... }        → append; returns the new `entry`
// PATCH   { scope, id, text, ... }        → edit one entry's text
// DELETE  { scope, id, ... }              → delete one entry
// DELETE  { scope? , ... }                → clear a whole scope (or all scopes)
// Context (workspaceRoot / conversationId) comes from the body or the query.

function getContext(req: NextRequest, body?: Record<string, unknown>): MemoryContext {
  const qs = req.nextUrl.searchParams;
  const workspaceRoot =
    typeof body?.workspaceRoot === "string"
      ? body.workspaceRoot
      : qs.get("workspaceRoot");
  const conversationId =
    typeof body?.conversationId === "string"
      ? body.conversationId
      : qs.get("conversationId");
  return {
    workspaceRoot: workspaceRoot?.trim() || undefined,
    conversationId: conversationId?.trim() || undefined,
  };
}

function getScope(body?: Record<string, unknown>, req?: NextRequest): MemoryScope | null {
  const raw =
    typeof body?.scope === "string"
      ? body.scope
      : req?.nextUrl.searchParams.get("scope");
  if (raw === "global" || raw === "project" || raw === "conversation") return raw;
  return null;
}

function getId(body?: Record<string, unknown>, req?: NextRequest): string | null {
  const raw = typeof body?.id === "string" ? body.id : req?.nextUrl.searchParams.get("id");
  return raw ?? null;
}

/** Missing context for a scope ("workspaceRoot is required…") is the caller's fault. */
function isContextError(err: unknown): boolean {
  return err instanceof Error && /is required|Invalid conversationId/.test(err.message);
}

function snapshot(context: MemoryContext) {
  const scopes = readAllMemoryScopes(context);
  return { scopes, entries: readAllMemoryEntries(context), combined: buildScopedMemoryBlock(scopes) };
}

function failure(err: unknown, fallback: string) {
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : fallback },
    { status: isContextError(err) ? 400 : 500 },
  );
}

export async function GET(req: NextRequest) {
  try {
    const context = getContext(req);
    return NextResponse.json(snapshot(context));
  } catch (err) {
    return NextResponse.json(
      {
        scopes: { global: [], project: [], conversation: [] },
        entries: { global: [], project: [], conversation: [] },
        combined: "",
        error: err instanceof Error ? err.message : "Read failed",
      },
      { status: isContextError(err) ? 400 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.length > MAX_MEMORY_TEXT) {
    return NextResponse.json({ error: `content is longer than ${MAX_MEMORY_TEXT} characters` }, { status: 400 });
  }

  const context = getContext(req, body);
  const scope = getScope(body) ?? "global";

  try {
    const entry = appendScopedMemory(content, scope, context);
    return NextResponse.json({ ok: true, scope, entry, ...snapshot(context) });
  } catch (err) {
    return failure(err, "Write failed");
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope = getScope(body);
  if (!scope) return NextResponse.json({ error: "scope must be global, project or conversation" }, { status: 400 });
  const id = getId(body);
  if (!id || !MEMORY_ID_RE.test(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > MAX_MEMORY_TEXT) {
    return NextResponse.json({ error: `text is longer than ${MAX_MEMORY_TEXT} characters` }, { status: 400 });
  }

  const context = getContext(req, body);
  try {
    const entry = editScopedMemoryEntry(id, text, scope, context);
    if (!entry) return NextResponse.json({ ok: false, error: "Memory entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true, scope, entry, ...snapshot(context) });
  } catch (err) {
    return failure(err, "Edit failed");
  }
}

export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const context = getContext(req, body);
  const scope = getScope(body, req);
  const id = getId(body, req);

  // One entry.
  if (id !== null) {
    if (!scope) return NextResponse.json({ error: "scope is required to delete an entry" }, { status: 400 });
    if (!MEMORY_ID_RE.test(id)) return NextResponse.json({ error: "A valid id is required" }, { status: 400 });
    try {
      if (!deleteScopedMemoryEntry(id, scope, context)) {
        return NextResponse.json({ ok: false, error: "Memory entry not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, scope, ...snapshot(context) });
    } catch (err) {
      return failure(err, "Delete failed");
    }
  }

  // Whole scope ("Clear all"), or every scope in this context.
  try {
    if (scope) {
      clearScopedMemory(scope, context);
    } else {
      clearScopedMemory("global", context);
      if (context.workspaceRoot) clearScopedMemory("project", context);
      if (context.conversationId) clearScopedMemory("conversation", context);
    }
    return NextResponse.json({ ok: true, ...snapshot(context) });
  } catch (err) {
    return failure(err, "Clear failed");
  }
}
