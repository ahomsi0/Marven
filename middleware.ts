import { NextRequest, NextResponse } from "next/server";
import { crossOriginRejection, hostHeaderRejection } from "@/lib/apiGuards";

// The desktop app's API is intentionally local, but it still handles files,
// shell commands, provider keys, and git operations. Apply the origin guard to
// every API route so newly added endpoints do not silently become CSRF sinks.
// The Host guard additionally blocks DNS-rebinding, which the Origin check
// alone can't see (a rebound domain makes Origin and Host match exactly).
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const rejection = hostHeaderRejection(req) ?? crossOriginRejection(req);
    if (rejection) {
      return NextResponse.json({ error: rejection }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
