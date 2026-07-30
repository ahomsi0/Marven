import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { runGit } from "@/lib/agent/git";

interface ReleaseBody {
  workspaceRoot?: string;
}

interface PackageJsonShape {
  version?: string;
  scripts?: Record<string, string>;
}

async function readPackage(root: string): Promise<PackageJsonShape | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as PackageJsonShape;
  } catch {
    return null;
  }
}

async function listDist(root: string, version: string | null): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(root, "dist"));
    return entries
      .filter((file) => !version || file.includes(version) || /^latest(-mac|-linux)?\.yml$/.test(file))
      .sort();
  } catch {
    return [];
  }
}

function scriptCommand(script: string): string {
  return script === "test" ? "npm test" : `npm run ${script}`;
}

export async function POST(req: NextRequest) {
  let body: ReleaseBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceRoot = body.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return NextResponse.json({ error: "workspaceRoot is required" }, { status: 400 });
  }

  const pkg = await readPackage(workspaceRoot);
  const version = pkg?.version ?? null;
  const scripts = pkg?.scripts ?? {};
  const [branch, status, latestTag, releaseTagRemote] = await Promise.all([
    runGit(["branch", "--show-current"], workspaceRoot),
    runGit(["status", "--short"], workspaceRoot),
    runGit(["tag", "--sort=-v:refname"], workspaceRoot).then((out) => out.split(/\r?\n/)[0]?.trim() ?? ""),
    version ? runGit(["ls-remote", "--tags", "origin", `v${version}`], workspaceRoot) : Promise.resolve(""),
  ]);

  const suggestedCommands = ["typecheck", "lint", "test", "build", "electron:build"]
    .filter((script) => Boolean(scripts[script]?.trim()))
    .map(scriptCommand);
  const artifacts = await listDist(workspaceRoot, version);
  const tag = version ? `v${version}` : null;
  const checklist = [
    { label: "Working tree reviewed", done: status.trim().length === 0, detail: status.trim() || "Clean" },
    { label: "Version is set", done: Boolean(version), detail: version ?? "No package version found" },
    { label: "Release tag is not already on origin", done: Boolean(tag) && releaseTagRemote.trim().length === 0, detail: tag ?? "No tag" },
    { label: "Verification commands available", done: suggestedCommands.length > 0, detail: suggestedCommands.join(", ") || "No release checks detected" },
    { label: "Release artifacts present", done: artifacts.length > 0, detail: artifacts.slice(0, 8).join(", ") || "No matching dist artifacts" },
  ];

  return NextResponse.json({
    version,
    tag,
    branch: branch.trim(),
    latestTag,
    suggestedCommands,
    artifacts,
    checklist,
    generatedAt: new Date().toISOString(),
  });
}
