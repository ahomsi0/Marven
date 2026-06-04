import { NextRequest, NextResponse } from "next/server";
import {
  appendScopedMemory,
  buildScopedMemoryBlock,
  clearScopedMemory,
  readAllMemoryScopes,
  type MemoryContext,
  type MemoryScope,
} from "@/lib/memoryClient";

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

export async function GET(req: NextRequest) {
  try {
    const context = getContext(req);
    const scopes = readAllMemoryScopes(context);
    return NextResponse.json({
      scopes,
      combined: buildScopedMemoryBlock(scopes),
    });
  } catch (err) {
    return NextResponse.json(
      {
        scopes: { global: [], project: [], conversation: [] },
        combined: "",
        error: err instanceof Error ? err.message : "Read failed",
      },
      { status: 500 },
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

  const context = getContext(req, body);
  const scope = getScope(body) ?? "global";

  try {
    appendScopedMemory(content, scope, context);
    const scopes = readAllMemoryScopes(context);
    return NextResponse.json({ ok: true, scope, scopes, combined: buildScopedMemoryBlock(scopes) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Write failed" },
      { status: 500 },
    );
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

  try {
    if (scope) {
      clearScopedMemory(scope, context);
    } else {
      clearScopedMemory("global", context);
      if (context.workspaceRoot) clearScopedMemory("project", context);
      if (context.conversationId) clearScopedMemory("conversation", context);
    }
    const scopes = readAllMemoryScopes(context);
    return NextResponse.json({ ok: true, scopes, combined: buildScopedMemoryBlock(scopes) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Clear failed" },
      { status: 500 },
    );
  }
}
