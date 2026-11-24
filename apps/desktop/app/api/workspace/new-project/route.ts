import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { approveWorkspaceRoot } from "@/lib/workspaceState";
import {
  DEFAULT_PROJECTS_DIR,
  expandHome,
  parentRejection,
  pickUniqueName,
  projectSlug,
} from "@/lib/companion/projectFolder";

const NAME_MAX = 200;

/** realpath of the longest existing prefix of `abs`, with the not-yet-created rest appended. */
async function resolveExisting(abs: string): Promise<string> {
  const rest: string[] = [];
  let cur = path.resolve(abs);
  for (;;) {
    try {
      return path.join(await fs.realpath(cur), ...rest.reverse());
    } catch (err) {
      const parent = path.dirname(cur);
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || parent === cur) throw err;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

// Creates a fresh project folder for Mini Me: <parent>/<slug>, unique, inside the
// user's home. The folder is approved for the Agent without becoming the active
// workspace of the main window.
export async function POST(req: NextRequest) {
  let body: { name?: unknown; parent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > NAME_MAX) return NextResponse.json({ error: "name is too long" }, { status: 400 });
  if (body.parent !== undefined && typeof body.parent !== "string") {
    return NextResponse.json({ error: "parent must be a string" }, { status: 400 });
  }

  try {
    const home = await fs.realpath(os.homedir());
    const requested = expandHome(body.parent?.trim() || DEFAULT_PROJECTS_DIR, home);
    if (!path.isAbsolute(requested)) {
      return NextResponse.json({ error: "parent must be an absolute path or start with ~" }, { status: 400 });
    }
    // Resolve symlinks in the part that exists, so a link can't lead out of home.
    const parent = await resolveExisting(requested);
    const rejected = parentRejection(parent, home);
    if (rejected) return NextResponse.json({ error: rejected }, { status: 400 });
    await fs.mkdir(parent, { recursive: true });
    // Re-check after creating, in case something swapped in a link meanwhile.
    const realParent = await fs.realpath(parent);
    const rejectedAfter = parentRejection(realParent, home);
    if (rejectedAfter) return NextResponse.json({ error: rejectedAfter }, { status: 400 });

    const base = projectSlug(name);
    const taken = await fs.readdir(realParent);
    let candidate = pickUniqueName(base, taken);
    for (let attempt = 0; attempt < 50; attempt++) {
      const root = path.join(realParent, candidate);
      try {
        await fs.mkdir(root); // not recursive: fails if someone else took the name
        approveWorkspaceRoot(root);
        return NextResponse.json({ root });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        taken.push(candidate);
        candidate = pickUniqueName(base, taken);
      }
    }
    return NextResponse.json({ error: "Could not find a free folder name" }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: `Could not create the project folder: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
