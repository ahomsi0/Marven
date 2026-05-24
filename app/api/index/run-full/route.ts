import { NextRequest, NextResponse } from "next/server";
import { startRun, subscribe, isEnabled, type IndexEvent } from "../_state";

interface Body {
  workspaceRoot?: string;
  // When true (default), the response is an SSE stream of progress events. When
  // false, the route kicks off the run and returns immediately — callers can
  // poll /api/index/status for progress.
  stream?: boolean;
}

export async function POST(req: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ error: "Codebase indexing is disabled" }, { status: 400 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceRoot = body.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return NextResponse.json({ error: "workspaceRoot is required" }, { status: 400 });
  }

  const { handle, started } = startRun(workspaceRoot);

  if (body.stream === false) {
    return NextResponse.json({ ok: true, started });
  }

  // SSE response — stream every event from the run until donePromise resolves.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: IndexEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`),
        );
      };
      const unsubscribe = subscribe(handle, send);
      handle.donePromise.finally(() => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      // Replay last known progress so a late subscriber sees something.
      send({ type: "progress", data: handle.progress });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
