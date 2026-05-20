import { NextRequest, NextResponse } from "next/server";
import { runGit } from "@/lib/agent/git";
import { parsePorcelain } from "@/lib/gitUtils";

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceRoot, action } = body;
  if (!workspaceRoot) {
    return NextResponse.json({ error: "workspaceRoot required" }, { status: 400 });
  }

  try {
    switch (action) {
      case "status": {
        const [porcelain, branch] = await Promise.all([
          runGit(["status", "--porcelain"], workspaceRoot),
          runGit(["branch", "--show-current"], workspaceRoot),
        ]);
        const { staged, unstaged, untracked } = parsePorcelain(porcelain);
        return NextResponse.json({ branch: branch.trim(), staged, unstaged, untracked });
      }

      case "stage": {
        const { path } = body;
        if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
        await runGit(["add", "--", path], workspaceRoot);
        return NextResponse.json({ ok: true });
      }

      case "unstage": {
        const { path } = body;
        if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
        await runGit(["restore", "--staged", "--", path], workspaceRoot);
        return NextResponse.json({ ok: true });
      }

      case "stage_all": {
        await runGit(["add", "-A"], workspaceRoot);
        return NextResponse.json({ ok: true });
      }

      case "commit": {
        const { message } = body;
        if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
        const output = await runGit(["commit", "-m", message], workspaceRoot);
        return NextResponse.json({ ok: true, output });
      }

      case "push": {
        const output = await runGit(["push"], workspaceRoot);
        return NextResponse.json({ ok: true, output });
      }

      case "diff": {
        const { path, staged: isStagedStr } = body;
        if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
        const isStaged = isStagedStr === "true";
        const args = isStaged
          ? ["diff", "--cached", "--", path]
          : ["diff", "HEAD", "--", path];
        const diff = await runGit(args, workspaceRoot);
        return NextResponse.json({ diff });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
