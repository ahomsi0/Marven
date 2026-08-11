import { NextRequest, NextResponse } from "next/server";
import { crossOriginRejection } from "@/lib/apiGuards";

// The desktop app's API is intentionally local, but it still handles files,
// shell commands, provider keys, and git operations. Apply the origin guard to
// every API route so newly added endpoints do not silently become CSRF sinks.
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const rejection = crossOriginRejection(req);
    if (rejection) {
      return NextResponse.json({ error: rejection }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
