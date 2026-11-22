import { NextRequest, NextResponse } from "next/server";
import { apiTokenRejection, crossOriginRejection, hostHeaderRejection } from "@/lib/apiGuards";

// The desktop app's API is intentionally local, but it still handles files,
// shell commands, provider keys, and git operations. Apply the guards to every
// API route so newly added endpoints do not silently become open sinks:
// - Host blocks DNS rebinding, which the Origin check alone can't see (a
//   rebound domain makes Origin and Host match exactly).
// - Origin blocks cross-site requests from web pages (CSRF).
// - The per-launch API token blocks every other local program: they can omit
//   Origin and forge Host, but can't know the token the Electron main process
//   generated and only adds to the app renderer's own requests. Skipped when
//   MARVEN_API_TOKEN is unset (dev, where `next dev` is a separate process).
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const rejection = hostHeaderRejection(req) ?? crossOriginRejection(req) ?? apiTokenRejection(req);
    if (rejection) {
      return NextResponse.json({ error: rejection }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
  // Run in Node.js (stable since Next 15.5, no next.config flag) so
  // process.env.MARVEN_API_TOKEN is read from the live server process, which
  // the Electron main process sets per launch before loading the server.
  runtime: "nodejs",
};
