import { NextRequest, NextResponse } from "next/server";
import { getCurrentRun, getStats, isEnabled, getExcludePatterns } from "../_state";

export async function GET(req: NextRequest) {
  const ws = req.nextUrl.searchParams.get("workspaceRoot");
  const run = getCurrentRun(ws);
  return NextResponse.json({
    enabled: isEnabled(),
    running: !!run,
    workspaceRoot: run?.workspaceRoot ?? ws ?? null,
    progress: run?.progress ?? null,
    stats: getStats(ws),
    lastError: run?.lastError ?? null,
    excludePatterns: getExcludePatterns(),
  });
}
